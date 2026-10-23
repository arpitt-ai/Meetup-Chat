'use strict';
/* Meetup - 1:1 voice/video calls. Signalling goes through the server; media is peer-to-peer WebRTC. */
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let call = null; // { id, peer, video, dir, state, pc, local, remote, offer, pendingIce, outIce, startedAt, timer, ring, muted, camOff }

function mediaErrorText(e) {
  if (e?.name === 'NotAllowedError') return 'Allow microphone/camera access in your browser to use calls.';
  if (e?.name === 'NotFoundError') return 'No microphone or camera was found.';
  return 'Could not start your microphone or camera.';
}
const getMedia = (video) => navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false });

function createPC() {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.onicecandidate = (e) => { if (e.candidate && call) sendIce(e.candidate); };
  pc.ontrack = (e) => { if (!call) return; call.remote = e.streams[0]; attachStreams(); };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    if (pc.connectionState === 'connected' && call.state !== 'active') {
      stopRing();
      call.state = 'active'; call.startedAt = Date.now();
      call.timer = setInterval(updateCallUI, 1000);
      updateCallUI();
    }
    if (pc.connectionState === 'failed') { toast('The call connection failed.', 'err'); hangup(); }
  };
  return pc;
}
function sendIce(candidate) {
  const c = candidate.toJSON ? candidate.toJSON() : candidate;
  if (call.id) wsSend({ t: 'call_ice', callId: call.id, candidate: c }); else call.outIce.push(c);
}

async function startCall(peer, video) {
  if (call) return toast('You are already in a call.');
  if (!state.wsReady) return toast('Not connected. Try again in a moment.', 'err');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Calls need a modern browser on https or localhost.', 'err');
  let stream;
  try { stream = await getMedia(video); } catch (e) { return toast(mediaErrorText(e), 'err'); }
  call = { id: null, peer, video, dir: 'out', state: 'calling', local: stream, remote: null, pendingIce: [], outIce: [] };
  buildCallUI(); ringLoop('out');
  try {
    const pc = createPC(); call.pc = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    await pc.setLocalDescription(await pc.createOffer());
    wsSend({ t: 'call_invite', to: peer.id, video, offer: pc.localDescription });
  } catch { toast('Could not start the call.', 'err'); cleanupCall(); }
}

async function acceptCall() {
  const c = call;
  if (!c || c.state !== 'ringing') return;
  stopRing();
  let stream;
  try { stream = await getMedia(c.video); } catch (e) { toast(mediaErrorText(e), 'err'); declineCall(); return; }
  if (call !== c) { stream.getTracks().forEach((t) => t.stop()); return; }
  c.local = stream; c.state = 'connecting'; updateCallUI();
  try {
    const pc = createPC(); c.pc = pc;
    await pc.setRemoteDescription(c.offer);
    for (const ice of c.pendingIce) await pc.addIceCandidate(ice).catch(() => {});
    c.pendingIce = [];
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    await pc.setLocalDescription(await pc.createAnswer());
    wsSend({ t: 'call_answer', callId: c.id, answer: pc.localDescription });
    attachStreams();
  } catch { toast('Could not connect the call.', 'err'); hangup(); }
}
function declineCall() { if (call?.id) wsSend({ t: 'call_end', callId: call.id }); cleanupCall(); }
function hangup() {
  if (!call) return;
  if (call.id) wsSend({ t: 'call_end', callId: call.id }); else call.endRequested = true;
  cleanupCall();
}
function cleanupCall() {
  if (!call) return;
  stopRing();
  clearInterval(call.timer);
  call.local?.getTracks().forEach((t) => t.stop());
  try { call.pc?.close(); } catch { /* ignore */ }
  call = null;
  $('#callLayer')?.remove();
  if (state.tab === 'calls') loadCalls();
}

async function onCallEvent(m) {
  switch (m.t) {
    case 'call_created':
      if (!call || call.endRequested) { wsSend({ t: 'call_end', callId: m.callId }); if (call) cleanupCall(); break; }
      call.id = m.callId;
      for (const c of call.outIce) wsSend({ t: 'call_ice', callId: m.callId, candidate: c });
      call.outIce = [];
      break;
    case 'call_unavailable':
      toast(m.reason === 'busy' ? 'They are on another call.' : 'They are offline right now.');
      cleanupCall();
      break;
    case 'call_incoming':
      if (call) return;
      call = { id: m.callId, peer: m.from, video: m.video, dir: 'in', state: 'ringing', offer: m.offer, pendingIce: [], local: null, remote: null };
      buildCallUI(); ringLoop('in');
      desktopNotify(m.from.displayName, `Incoming ${m.video ? 'video' : 'voice'} call`, 0);
      break;
    case 'call_answered':
      if (!call || call.id !== m.callId) return;
      stopRing(); call.state = 'connecting'; updateCallUI();
      try {
        await call.pc.setRemoteDescription(m.answer);
        for (const ice of call.pendingIce) await call.pc.addIceCandidate(ice).catch(() => {});
        call.pendingIce = [];
      } catch { toast('Could not connect the call.', 'err'); hangup(); }
      break;
    case 'call_ice':
      if (!call || call.id !== m.callId) return;
      if (call.pc?.remoteDescription) call.pc.addIceCandidate(m.candidate).catch(() => {});
      else call.pendingIce.push(m.candidate);
      break;
    case 'call_ended': {
      if (!call || (call.id && call.id !== m.callId)) return;
      const dir = call.dir; const was = call.state;
      cleanupCall();
      if (m.reason === 'missed') toast(dir === 'out' ? 'No answer.' : 'Missed call.');
      else if (m.reason === 'declined') toast('Call declined.');
      else if (m.reason === 'ended' && was === 'active') toast('Call ended.');
      break;
    }
    default:
  }
}

/* ---------- ringing ---------- */
function ringLoop(dir) {
  stopRing();
  const beep = () => playBeep(dir === 'in' ? 'ring' : 'msg');
  beep();
  call.ring = setInterval(beep, 2200);
}
function stopRing() { if (call?.ring) { clearInterval(call.ring); call.ring = null; } }

/* ---------- UI ---------- */
function buildCallUI() {
  $('#callLayer')?.remove();
  const layer = h(`<div class="call-layer" id="callLayer"><div class="call-box" id="callBox">
    <video class="remote-video hidden" id="remoteVideo" autoplay playsinline></video>
    <video class="local-video hidden" id="localVideo" autoplay playsinline muted></video>
    <div class="call-info"><div id="callAvatar">${avatarHTML(call.peer, 128)}</div><h2>${esc(call.peer.displayName)}</h2><div class="st" id="callState"></div></div>
    <div class="call-actions" id="callActions"></div></div></div>`);
  document.body.appendChild(layer);
  layer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ca]'); if (!b || !call) return;
    const a = b.dataset.ca;
    if (a === 'end') hangup();
    if (a === 'decline') declineCall();
    if (a === 'accept') acceptCall();
    if (a === 'mute') { call.muted = !call.muted; call.local?.getAudioTracks().forEach((t) => { t.enabled = !call.muted; }); updateCallUI(); }
    if (a === 'cam') { call.camOff = !call.camOff; call.local?.getVideoTracks().forEach((t) => { t.enabled = !call.camOff; }); updateCallUI(); }
  });
  updateCallUI();
  attachStreams();
}
function attachStreams() {
  if (!call) return;
  const rv = $('#remoteVideo'); const lv = $('#localVideo');
  if (rv && call.remote && rv.srcObject !== call.remote) rv.srcObject = call.remote;
  if (lv && call.local && lv.srcObject !== call.local) lv.srcObject = call.local;
}
function updateCallUI() {
  if (!call || !$('#callBox')) return;
  const box = $('#callBox');
  const videoOn = call.video && call.state !== 'ringing';
  box.classList.toggle('video-on', videoOn && call.state === 'active');
  $('#remoteVideo').classList.toggle('hidden', !(call.video && call.state === 'active'));
  $('#localVideo').classList.toggle('hidden', !(call.video && call.local && !call.camOff));
  const txt = { calling: 'Calling…', ringing: `Incoming ${call.video ? 'video' : 'voice'} call`, connecting: 'Connecting…', active: fmtDuration((Date.now() - call.startedAt) / 1000) }[call.state];
  $('#callState').textContent = txt;
  const btn = (a, cls, icon, title) => `<button class="round ${cls}" data-ca="${a}" title="${title}">${icon}</button>`;
  $('#callActions').innerHTML = call.state === 'ringing'
    ? btn('decline', 'end', icons.phone, 'Decline') + btn('accept', 'ok', icons.phone, 'Accept')
    : btn('mute', call.muted ? 'on' : '', call.muted ? icons.micOff : icons.mic, call.muted ? 'Unmute' : 'Mute')
      + (call.video ? btn('cam', call.camOff ? 'on' : '', call.camOff ? icons.videoOff : icons.video, call.camOff ? 'Camera on' : 'Camera off') : '')
      + btn('end', 'end', icons.phone, 'End call');
}
