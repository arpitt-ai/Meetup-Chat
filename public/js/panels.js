'use strict';
/* Meetup - side panels (new chat/group, status, calls, profile, starred) and the info drawer */
function switchTab(tab, force) {
  if (!force && state.tab === tab && tab === 'chats' && $('#chatList')) return;
  state.tab = tab;
  $$('.rail-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'chats') { chatSearchQuery = ''; msgSearchResults = []; renderChatsPanel(); }
  else if (tab === 'status') renderStatusPanel();
  else if (tab === 'calls') renderCallsPanel();
  else if (tab === 'profile') renderProfilePanel();
}
const backHead = (title) => `<div class="back-head"><button class="icon-btn" id="pBack" title="Back">${icons.back}</button><h3>${esc(title)}</h3></div>`;
const backToChats = () => switchTab('chats', true);

async function startDirectWith(userId) {
  if (userId === state.me.id) return;
  try {
    const { chat } = await api('/api/chats/direct', { method: 'POST', body: { userId } });
    if (!state.chats.has(chat.id)) state.chats.set(chat.id, chat);
    switchTab('chats', true);
    openChat(chat.id);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- user rows ---------- */
const userRow = (u, extra = '') => `<div class="item" data-user="${u.id}">${avatarHTML(u, 46, { presence: true })}
  <div class="item-main"><div class="item-name">${esc(u.displayName)}</div><div class="item-sub">@${esc(u.username)} · ${esc(u.about)}</div></div>${extra}</div>`;

/* ---------- new chat ---------- */
function openNewChatPanel(prefill = '') {
  $('#side').innerHTML = `${backHead('New chat')}
    <div class="search" style="padding-top:12px">${icons.search}<input id="userSearch" placeholder="Search name or username" autocomplete="off" value="${esc(prefill)}"></div>
    <div class="list" id="userList"></div>`;
  $('#pBack').onclick = backToChats;
  let timer;
  const run = async () => {
    const q = $('#userSearch').value.trim();
    try {
      const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (q !== $('#userSearch')?.value.trim()) return;
      const top = q ? '' : `<div class="menu-row" data-newgroup><span class="ic">${icons.users}</span>New group</div><div class="list-title">People on Meetup</div>`;
      $('#userList').innerHTML = top + (users.length ? users.map((u) => userRow(u)).join('') : '<div class="empty-list">Nobody found.<br>Ask a friend to sign up, then search for their username.</div>');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#userSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
  $('#userList').onclick = (e) => {
    if (e.target.closest('[data-newgroup]')) return openNewGroupPanel();
    const it = e.target.closest('[data-user]'); if (it) startDirectWith(Number(it.dataset.user));
  };
  run();
  $('#userSearch').focus();
}

/* ---------- new group ---------- */
function openNewGroupPanel() {
  const selected = new Map();
  $('#side').innerHTML = `${backHead('Add group members')}
    <div class="sel-chips" id="selChips"></div>
    <div class="search">${icons.search}<input id="userSearch" placeholder="Search people" autocomplete="off"></div>
    <div class="list" id="userList"></div>
    <div style="position:absolute;right:18px;bottom:22px"><button class="round primary" id="grpNext" title="Next" style="width:54px;height:54px">${icons.send}</button></div>`;
  $('#side').style.position = 'relative';
  $('#pBack').onclick = () => { $('#side').style.position = ''; openNewChatPanel(); };
  const renderChips = () => {
    $('#selChips').innerHTML = [...selected.values()].map((u) => `<span class="sel-chip" data-rm="${u.id}">${avatarHTML(u, 26)}${esc(u.displayName.split(' ')[0])}${icons.close.replace('<svg', '<svg style="width:14px;height:14px"')}</span>`).join('');
  };
  let timer; let cache = [];
  const renderList = () => {
    $('#userList').innerHTML = cache.length ? cache.map((u) => userRow(u, `<input type="checkbox" ${selected.has(u.id) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)">`)).join('') : '<div class="empty-list">Nobody found.</div>';
  };
  const run = async () => {
    try { cache = (await api(`/api/users/search?q=${encodeURIComponent($('#userSearch').value.trim())}`)).users; renderList(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#userSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
  $('#userList').onclick = (e) => {
    const it = e.target.closest('[data-user]'); if (!it) return;
    const u = cache.find((x) => x.id === Number(it.dataset.user));
    if (selected.has(u.id)) selected.delete(u.id); else selected.set(u.id, u);
    renderChips(); renderList();
  };
  $('#selChips').onclick = (e) => { const c = e.target.closest('[data-rm]'); if (c) { selected.delete(Number(c.dataset.rm)); renderChips(); renderList(); } };
  $('#grpNext').onclick = () => {
    if (!selected.size) return toast('Pick at least one person.', 'err');
    $('#side').style.position = '';
    renderGroupNameStep([...selected.values()]);
  };
  run();
}
function renderGroupNameStep(members) {
  $('#side').innerHTML = `${backHead('New group')}
    <div class="panel-body">
      <div class="avatar-edit">${avatarHTML({ type: 'group', name: 'Group', color: '#bdb2ff' }, 110)}</div>
      <label class="field"><span>Group name</span><input id="grpName" maxlength="50" placeholder="e.g. Weekend plans" autocomplete="off"></label>
      <div><div class="list-title" style="padding-left:0">${members.length} member${members.length > 1 ? 's' : ''}</div><div class="sel-chips" style="padding:4px 0">${members.map((u) => `<span class="sel-chip">${avatarHTML(u, 26)}${esc(u.displayName.split(' ')[0])}</span>`).join('')}</div></div>
      <button class="btn primary" id="grpCreate">Create group</button>
    </div>`;
  $('#pBack').onclick = () => openNewGroupPanel();
  $('#grpName').focus();
  const create = async () => {
    const name = $('#grpName').value.trim();
    if (!name) return toast('Give the group a name.', 'err');
    $('#grpCreate').disabled = true;
    try {
      const { chat } = await api('/api/chats/group', { method: 'POST', body: { name, memberIds: members.map((m) => m.id) } });
      state.chats.set(chat.id, chat);
      switchTab('chats', true);
      openChat(chat.id);
    } catch (e) { toast(e.message, 'err'); $('#grpCreate').disabled = false; }
  };
  $('#grpCreate').onclick = create;
  $('#grpName').onkeydown = (e) => { if (e.key === 'Enter') create(); };
}

/* ---------- starred ---------- */
async function openStarredPanel() {
  $('#side').innerHTML = `${backHead('Starred messages')}<div class="list" id="starList"><div class="empty-list">Loading…</div></div>`;
  $('#pBack').onclick = backToChats;
  try {
    const { results } = await api('/api/starred');
    $('#starList').innerHTML = results.length ? results.map((m) => {
      const c = state.chats.get(m.chatId); if (!c) return '';
      const who = m.senderId === state.me.id ? 'You' : memberOf(c, m.senderId)?.displayName || 'Member';
      return `<div class="item" data-chat="${c.id}" data-msg="${m.id}">${avatarHTML(chatEntity(c), 42)}<div class="item-main">
        <div class="item-top"><span class="item-name">${esc(who)} › ${esc(chatTitle(c))}</span><span class="item-time">${fmtListTime(m.createdAt)}</span></div>
        <div class="item-sub">${esc(previewText(m))}</div></div></div>`;
    }).join('') : `<div class="empty-list"><span class="big">⭐</span>No starred messages.<br>Open a message menu and tap Star.</div>`;
  } catch (e) { toast(e.message, 'err'); }
  $('#starList').onclick = (e) => {
    const it = e.target.closest('.item'); if (!it) return;
    switchTab('chats', true);
    jumpToSearchResult(Number(it.dataset.chat), Number(it.dataset.msg));
  };
}

/* ---------- status ---------- */
async function loadStatuses() {
  try {
    const { groups } = await api('/api/statuses');
    state.statusGroups = groups;
    $('#statusPing')?.classList.toggle('hidden', !groups.some((g) => g.user.id !== state.me.id && g.items.some((i) => !i.viewed)));
    if (state.tab === 'status') renderStatusList();
  } catch { /* ignore */ }
}
function onStatusNew() { loadStatuses(); }
function renderStatusPanel() {
  $('#side').innerHTML = `<div class="side-head"><h2>Status</h2><div class="side-actions"><button class="icon-btn" id="addStatus" title="Add status">${icons.plus}</button></div></div><div class="list" id="statusList"></div>`;
  $('#addStatus').onclick = openStatusComposer;
  $('#statusList').onclick = (e) => {
    if (e.target.closest('[data-add]')) return openStatusComposer();
    const row = e.target.closest('[data-sg]'); if (!row) return;
    const g = state.statusGroups.find((x) => x.user.id === Number(row.dataset.sg));
    if (g) openStatusViewer(g);
  };
  renderStatusList();
  loadStatuses();
}
function renderStatusList() {
  const list = $('#statusList'); if (!list) return;
  const mine = state.statusGroups.find((g) => g.user.id === state.me.id);
  const others = state.statusGroups.filter((g) => g.user.id !== state.me.id);
  const unseen = (g) => g.items.some((i) => !i.viewed);
  const ago = (g) => fmtListTime(g.items[g.items.length - 1].createdAt) === fmtTime(g.items[g.items.length - 1].createdAt) ? `Today, ${fmtTime(g.items[g.items.length - 1].createdAt)}` : fmtListTime(g.items[g.items.length - 1].createdAt);
  const row = (g, seen) => `<div class="item" data-sg="${g.user.id}"><span class="ring ${seen ? 'seen' : ''}">${avatarHTML(g.user, 46)}</span>
    <div class="item-main"><div class="item-name">${esc(g.user.displayName)}</div><div class="item-sub">${g.items.length} update${g.items.length > 1 ? 's' : ''} · ${esc(ago(g))}</div></div></div>`;
  let html = mine
    ? `<div class="item" data-sg="${state.me.id}"><span class="ring">${avatarHTML(state.me, 46)}</span><div class="item-main"><div class="item-name">My status</div><div class="item-sub">${mine.items.length} update${mine.items.length > 1 ? 's' : ''} · ${esc(ago(mine))}</div></div><button class="icon-btn" data-add title="Add">${icons.plus}</button></div>`
    : `<div class="item" data-add><span class="ring add">${avatarHTML(state.me, 52)}<span class="plus">${icons.plus}</span></span><div class="item-main"><div class="item-name">My status</div><div class="item-sub">Tap to add a status update</div></div></div>`;
  const fresh = others.filter(unseen); const seen = others.filter((g) => !unseen(g));
  if (fresh.length) html += `<div class="list-title">Recent updates</div>${fresh.map((g) => row(g, false)).join('')}`;
  if (seen.length) html += `<div class="list-title">Viewed updates</div>${seen.map((g) => row(g, true)).join('')}`;
  if (!others.length) html += `<div class="empty-list"><span class="big">🌈</span>Status updates from people you chat with show up here for 24 hours.</div>`;
  list.innerHTML = html;
}

function openStatusViewer(group) {
  let idx = group.items.findIndex((i) => !i.viewed);
  if (idx < 0 || group.user.id === state.me.id) idx = 0;
  const own = group.user.id === state.me.id;
  let timer;
  const el = h('<div class="story"></div>');
  $('#layer').appendChild(el);
  const close = () => { clearTimeout(timer); el.remove(); document.removeEventListener('keydown', onKey); loadStatuses(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', onKey);
  const next = () => { if (idx >= group.items.length - 1) close(); else { idx++; show(); } };
  const prev = () => { idx = Math.max(0, idx - 1); show(); };
  function show() {
    clearTimeout(timer);
    const it = group.items[idx];
    const bg = it.kind === 'image' ? '#111' : it.bg;
    el.innerHTML = `<div class="story-card" style="background:${esc(bg)}">
      ${it.kind === 'image' ? `<img class="bgimg" src="${esc(it.mediaUrl)}" alt="">${it.body ? `<div class="story-caption">${esc(it.body)}</div>` : ''}` : `<div class="story-text">${esc(it.body)}</div>`}
      <div class="story-top"><div class="bars">${group.items.map((_, i) => `<i class="${i < idx ? 'done' : ''}"><b></b></i>`).join('')}</div>
        <div class="story-user">${avatarHTML(group.user, 38)}<div><div class="nm">${own ? 'My status' : esc(group.user.displayName)}</div><div class="tm">${fmtDay(it.createdAt)}, ${fmtTime(it.createdAt)}</div></div>
        <button class="icon-btn x" data-x>${icons.close}</button></div></div>
      <div class="story-tap l" data-prev></div><div class="story-tap r" data-next></div>
      ${own ? `<div class="story-foot"><button data-views>${icons.eye}${it.viewCount || 0}</button> <button data-del style="margin-left:8px">${icons.trash}</button></div>` : ''}
    </div>`;
    const bar = $$('.bars i b', el)[idx];
    void bar.offsetWidth;
    bar.style.transition = 'width 5s linear'; bar.style.width = '100%';
    timer = setTimeout(next, 5000);
    if (!own && !it.viewed) { it.viewed = true; api(`/api/statuses/${it.id}/view`, { method: 'POST' }).catch(() => {}); }
  }
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]') || e.target === el) return close();
    if (e.target.closest('[data-next]')) return next();
    if (e.target.closest('[data-prev]')) return prev();
    const it = group.items[idx];
    if (e.target.closest('[data-views]')) {
      clearTimeout(timer);
      try {
        const { views } = await api(`/api/statuses/${it.id}/views`);
        const m = modal({ title: `Viewed by ${views.length}`, body: views.length ? views.map((v) => `<div class="pick">${avatarHTML(v.user, 38)}<span class="nm">${esc(v.user.displayName)}</span><small>${fmtTime(v.viewedAt)}</small></div>`).join('') : 'No views yet.' });
        m.el.addEventListener('click', (ev) => { if (ev.target === m.el) timer = setTimeout(next, 3000); });
      } catch (err) { toast(err.message, 'err'); }
    }
    if (e.target.closest('[data-del]')) {
      clearTimeout(timer);
      if (await confirmDialog('Delete status update?', 'This update will be removed for everyone.', 'Delete', true)) {
        await api(`/api/statuses/${it.id}`, { method: 'DELETE' }).catch(() => {});
        group.items.splice(idx, 1);
        if (!group.items.length) return close();
        idx = Math.min(idx, group.items.length - 1);
      }
      show();
    }
  });
  show();
}

function openStatusComposer() {
  let mode = 'text'; let bg = SWATCHES[0]; let file = null;
  const m = modal({
    title: 'New status',
    body: `<div class="seg" style="margin-bottom:12px" id="stTabs"><button data-m="text" class="active">Text</button><button data-m="photo">Photo</button></div>
      <div id="stText"><div class="story-canvas" id="stCanvas" style="background:${bg}"><textarea id="stBody" maxlength="700" placeholder="Type a status"></textarea></div>
        <div class="colors" id="stColors">${SWATCHES.map((c) => `<button class="swatch ${c === bg ? 'active' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <div id="stPhoto" class="hidden"><div class="preview-box" id="stPrev" style="min-height:140px;color:var(--ink-2)">No photo chosen</div>
        <button class="btn" id="stPick" style="width:100%;margin-bottom:10px">Choose photo</button>
        <input class="plain-input" id="stCap" placeholder="Add a caption (optional)" maxlength="300"></div>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="stPost">Post</button>',
  });
  m.el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-m]');
    if (t) {
      mode = t.dataset.m;
      $$('#stTabs button', m.el).forEach((b) => b.classList.toggle('active', b === t));
      $('#stText', m.el).classList.toggle('hidden', mode !== 'text'); $('#stPhoto', m.el).classList.toggle('hidden', mode !== 'photo');
    }
    const c = e.target.closest('[data-c]');
    if (c) { bg = c.dataset.c; $('#stCanvas', m.el).style.background = bg; $$('#stColors .swatch', m.el).forEach((s) => s.classList.toggle('active', s === c)); }
    if (e.target.closest('#stPick')) $('#fileStatus').click();
  });
  const onFile = () => {
    const f = $('#fileStatus').files[0]; $('#fileStatus').value = '';
    if (!f) return;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(f.name)) return toast('Please choose a PNG, JPG, GIF or WebP image.', 'err');
    if (f.size > 10 * 1024 * 1024) return toast('Image is larger than 10 MB.', 'err');
    file = f;
    $('#stPrev', m.el).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  };
  $('#fileStatus').onchange = onFile;
  $('#stPost', m.el).onclick = async () => {
    $('#stPost', m.el).disabled = true;
    try {
      if (mode === 'text') {
        const body = $('#stBody', m.el).value.trim();
        if (!body) throw new Error('Write something first.');
        await api('/api/statuses', { method: 'POST', body: { kind: 'text', body, bg } });
      } else {
        if (!file) throw new Error('Choose a photo first.');
        const up = await uploadFile(file);
        await api('/api/statuses', { method: 'POST', body: { kind: 'image', mediaUrl: up.url, body: $('#stCap', m.el).value.trim() } });
      }
      m.close(); toast('Status posted', 'ok'); loadStatuses();
    } catch (e) { toast(e.message, 'err'); $('#stPost', m.el).disabled = false; }
  };
  setTimeout(() => $('#stBody', m.el)?.focus(), 50);
}

/* ---------- calls ---------- */
async function loadCalls() {
  try { state.calls = (await api('/api/calls')).calls; if (state.tab === 'calls') renderCallsList(); } catch { /* ignore */ }
}
function renderCallsPanel() {
  $('#side').innerHTML = `<div class="side-head"><h2>Calls</h2></div><div class="list" id="callList"></div>`;
  $('#callList').onclick = (e) => {
    const b = e.target.closest('[data-recall]'); if (!b) return;
    const peer = state.calls.find((c) => c.id === Number(b.dataset.call))?.peer;
    if (peer) startCall(peer, b.dataset.recall === 'video');
  };
  renderCallsList();
  loadCalls();
}
function renderCallsList() {
  const list = $('#callList'); if (!list) return;
  if (!state.calls.length) { list.innerHTML = `<div class="empty-list"><span class="big">📞</span>No calls yet.<br>Open a chat and tap the phone or video icon.</div>`; return; }
  list.innerHTML = state.calls.map((c) => {
    const missed = c.status === 'missed' && c.direction === 'in';
    const declined = c.status === 'declined';
    const icon = c.direction === 'in' ? icons.inbound : icons.outbound;
    const label = c.status === 'answered' ? fmtDuration(c.duration) : missed ? 'Missed' : declined ? 'Declined' : c.direction === 'out' ? 'No answer' : 'Cancelled';
    return `<div class="item"><span>${avatarHTML(c.peer, 46)}</span><div class="item-main">
      <div class="item-name" style="${missed ? 'color:var(--danger)' : ''}">${esc(c.peer.displayName)}</div>
      <div class="item-sub"><span class="call-ico ${missed ? 'call-miss' : 'call-in'}">${icon.replace('<svg', '<svg class="call-ico"')}</span>${esc(startOfDay(c.startedAt) === startOfDay(Date.now()) ? fmtTime(c.startedAt) : `${fmtListTime(c.startedAt)}, ${fmtTime(c.startedAt)}`)} · ${esc(label)}</div></div>
      <button class="icon-btn" data-recall="voice" data-call="${c.id}" title="Voice call">${icons.phone}</button>
      <button class="icon-btn" data-recall="video" data-call="${c.id}" title="Video call">${icons.video}</button></div>`;
  }).join('');
}

/* ---------- profile ---------- */
let avatarTarget = 'me';
function renderProfilePanel() {
  const me = state.me;
  $('#side').innerHTML = `<div class="side-head"><h2>Profile</h2></div>
    <div class="panel-body">
      <div class="avatar-edit"><span id="profAvatar">${avatarHTML(me, 120)}</span>
        <button class="link-btn" id="changeAvatar">Change photo</button>
        ${me.avatarUrl ? '<button class="link-btn" id="removeAvatar" style="color:var(--danger)">Remove photo</button>' : ''}</div>
      <label class="field"><span>Your name</span><input id="pName" maxlength="40" value="${esc(me.displayName)}"></label>
      <label class="field"><span>About</span><input id="pAbout" maxlength="140" value="${esc(me.about)}"></label>
      <div class="field"><span>Avatar colour</span><div class="colors" id="pColors">${AVATAR_COLORS.map((c) => `<button class="swatch ${c === me.color ? 'active' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <button class="btn primary" id="pSave">Save changes</button>
      <div class="switch"><span>Dark mode</span><button class="toggle ${document.documentElement.dataset.theme === 'dark' ? 'on' : ''}" id="darkToggle" aria-label="Dark mode"></button></div>
      <div class="switch"><span>Desktop notifications</span><button class="toggle ${('Notification' in window && Notification.permission === 'granted') ? 'on' : ''}" id="notifToggle" aria-label="Notifications"></button></div>
      <div class="menu-row" id="starredRow"><span class="ic peach">${icons.star}</span>Starred messages</div>
      <button class="btn danger" id="pLogout">${icons.logout.replace('<svg', '<svg style="vertical-align:-5px;margin-right:6px"')}Log out</button>
      <p class="hint">Signed in as @${esc(me.username)}</p>
    </div>`;
  let color = me.color;
  $('#pColors').onclick = (e) => { const c = e.target.closest('[data-c]'); if (!c) return; color = c.dataset.c; $$('#pColors .swatch').forEach((s) => s.classList.toggle('active', s === c)); };
  $('#changeAvatar').onclick = () => { avatarTarget = 'me'; $('#fileAvatar').click(); };
  $('#removeAvatar')?.addEventListener('click', async () => {
    try { const { user } = await api('/api/me', { method: 'PATCH', body: { avatarUrl: '' } }); state.me = user; refreshMe(); renderProfilePanel(); } catch (e) { toast(e.message, 'err'); }
  });
  $('#pSave').onclick = async () => {
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: { displayName: $('#pName').value, about: $('#pAbout').value, color } });
      state.me = user; refreshMe(); toast('Profile saved', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#darkToggle').onclick = (e) => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    applyTheme(dark ? 'dark' : 'light'); e.currentTarget.classList.toggle('on', dark); syncThemeBtn();
  };
  $('#notifToggle').onclick = async (e) => {
    if (!('Notification' in window)) return toast('Notifications are not supported here.', 'err');
    if (Notification.permission === 'granted') return toast('Notifications are on. Change this in your browser settings to turn them off.');
    const p = await Notification.requestPermission();
    e.currentTarget.classList.toggle('on', p === 'granted');
  };
  $('#starredRow').onclick = openStarredPanel;
  $('#pLogout').onclick = logout;
}
function refreshMe() {
  const ra = $('#railAvatar'); if (ra) ra.innerHTML = avatarHTML(state.me, 44);
}
async function onAvatarPicked() {
  const input = $('#fileAvatar'); const f = input.files[0]; input.value = '';
  if (!f) return;
  if (!/\.(png|jpe?g|gif|webp)$/i.test(f.name)) return toast('Please choose a PNG, JPG, GIF or WebP image.', 'err');
  if (f.size > 8 * 1024 * 1024) return toast('Image is larger than 8 MB.', 'err');
  try {
    const up = await uploadFile(f);
    if (avatarTarget === 'me') {
      const { user } = await api('/api/me', { method: 'PATCH', body: { avatarUrl: up.url } });
      state.me = user; refreshMe(); if (state.tab === 'profile') renderProfilePanel();
    } else {
      const { chat } = await api(`/api/chats/${avatarTarget}`, { method: 'PATCH', body: { avatarUrl: up.url } });
      state.chats.set(chat.id, chat); renderChatList(); renderConversationHead(); renderDrawer();
    }
  } catch (e) { toast(e.message, 'err'); }
}
async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  forceLogout();
}

/* ---------- info drawer ---------- */
function toggleDrawer() { $('#drawer').classList.contains('open') ? closeDrawer() : openDrawer(); }
function openDrawer() { renderDrawer(); $('#drawer').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); }
function renderDrawer() {
  const chat = activeChat(); if (!chat) return;
  const d = $('#drawer');
  const media = (entryOf(chat.id)?.list || []).filter((m) => (m.kind === 'image' || m.kind === 'video') && m.mediaUrl && !m.pending).slice(-9).reverse();
  const mediaSection = media.length ? `<section><h4>Media</h4><div class="media-grid">${media.map((m) => m.kind === 'image' ? `<img src="${esc(m.mediaUrl)}" data-lb="image" alt="" loading="lazy">` : `<video src="${esc(m.mediaUrl)}" data-lb="video" muted preload="metadata"></video>`).join('')}</div></section>` : '';
  if (chat.type === 'direct') {
    const p = peerOf(chat);
    d.innerHTML = `${`<div class="back-head"><button class="icon-btn" id="drawerClose">${icons.close}</button><h3>Contact info</h3></div>`}
      <div class="drawer-hero">${avatarHTML(p, 120)}<h3>${esc(p.displayName)}</h3><div class="sub">@${esc(p.username)}</div><div class="sub" style="margin-top:4px">${esc(lastSeenText(p))}</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:14px"><button class="btn" data-act="call-voice">${icons.phone.replace('<svg', '<svg style="vertical-align:-5px;margin-right:6px;width:19px;height:19px"')}Voice</button><button class="btn" data-act="call-video">${icons.video.replace('<svg', '<svg style="vertical-align:-5px;margin-right:6px;width:19px;height:19px"')}Video</button></div></div>
      <section><h4>About</h4><div>${esc(p.about)}</div></section>${mediaSection}`;
    return;
  }
  const me = memberOf(chat, state.me.id);
  const admin = me?.role === 'admin';
  d.innerHTML = `<div class="back-head"><button class="icon-btn" id="drawerClose">${icons.close}</button><h3>Group info</h3></div>
    <div class="drawer-hero">${avatarHTML(chatEntity(chat), 120)}${admin ? `<div><button class="link-btn" data-act="group-photo" style="margin-top:8px">Change photo</button></div>` : ''}
      <h3>${esc(chat.name)} ${admin ? `<button class="icon-btn" data-act="rename" title="Rename" style="display:inline-grid;vertical-align:middle;width:32px;height:32px">${icons.edit.replace('<svg', '<svg style="width:17px;height:17px"')}</button>` : ''}</h3>
      <div class="sub">Group · ${chat.members.length} member${chat.members.length > 1 ? 's' : ''}</div></div>
    ${mediaSection}
    <section><h4>${chat.members.length} members</h4>
      ${admin ? `<div class="menu-row" data-act="add-members" style="padding-left:0"><span class="ic mint">${icons.userPlus}</span>Add members</div>` : ''}
      ${chat.members.map((u) => `<div class="row" data-member="${u.id}" style="cursor:${u.id === state.me.id ? 'default' : 'pointer'}">${avatarHTML(u, 42, { presence: true })}
        <div class="grow"><div class="nm">${u.id === state.me.id ? 'You' : esc(u.displayName)}</div><div class="ab">${esc(u.about)}</div></div>
        ${u.role === 'admin' ? '<span class="tag">Admin</span>' : ''}
        ${admin && u.id !== state.me.id ? `<button class="icon-btn" data-member-menu="${u.id}" data-keep-menu>${icons.more}</button>` : ''}</div>`).join('')}
    </section>
    <section><div class="danger-row" data-act="leave">${icons.logout}Exit group</div></section>`;
}
function initPanelUI() {
  $('#fileAvatar').addEventListener('change', onAvatarPicked);
  $('#drawer').addEventListener('click', async (e) => {
    const chat = activeChat(); if (!chat) return;
    if (e.target.closest('#drawerClose')) return closeDrawer();
    const lb = e.target.closest('[data-lb]'); if (lb) return openLightbox(lb.getAttribute('src'), lb.dataset.lb);
    const mm = e.target.closest('[data-member-menu]');
    if (mm) {
      const uid = Number(mm.dataset.memberMenu); const u = memberOf(chat, uid); const r = mm.getBoundingClientRect();
      return showMenu(`${u.role !== 'admin' ? `<button data-act="admin">${icons.crown}Make admin</button>` : ''}<button class="danger" data-act="remove">${icons.logout}Remove from group</button>`, r.left - 150, r.bottom + 4, async (act) => {
        try {
          if (act === 'admin') await api(`/api/chats/${chat.id}/members/${uid}/admin`, { method: 'POST' });
          if (act === 'remove') { if (await confirmDialog('Remove member?', `Remove ${u.displayName} from this group?`, 'Remove', true)) await api(`/api/chats/${chat.id}/members/${uid}`, { method: 'DELETE' }); }
        } catch (err) { toast(err.message, 'err'); }
      });
    }
    const row = e.target.closest('[data-member]');
    if (row && !e.target.closest('button') && Number(row.dataset.member) !== state.me.id) { closeDrawer(); return startDirectWith(Number(row.dataset.member)); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'call-voice') startCall(peerOf(chat), false);
    if (act === 'call-video') startCall(peerOf(chat), true);
    if (act === 'group-photo') { avatarTarget = chat.id; $('#fileAvatar').click(); }
    if (act === 'rename') {
      const m = modal({ title: 'Rename group', body: `<input class="plain-input" id="rnName" maxlength="50" value="${esc(chat.name)}">`, foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="rnSave">Save</button>' });
      const save = async () => {
        try { await api(`/api/chats/${chat.id}`, { method: 'PATCH', body: { name: $('#rnName', m.el).value } }); m.close(); } catch (err) { toast(err.message, 'err'); }
      };
      $('#rnSave', m.el).onclick = save; $('#rnName', m.el).onkeydown = (ev) => { if (ev.key === 'Enter') save(); };
      setTimeout(() => $('#rnName', m.el).select(), 50);
    }
    if (act === 'add-members') openAddMembers(chat);
    if (act === 'leave' && await confirmDialog('Exit group?', `You will no longer receive messages from “${chat.name}”.`, 'Exit', true)) {
      try { await api(`/api/chats/${chat.id}/members/${state.me.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'err'); }
    }
  });
}
async function openAddMembers(chat) {
  const selected = new Set(); let users = [];
  const m = modal({ title: 'Add members', body: `<div style="padding-bottom:8px"><input class="plain-input" id="amSearch" placeholder="Search people"></div><div id="amList"></div>`, foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="amAdd" disabled>Add</button>' });
  const render = () => {
    $('#amList', m.el).innerHTML = users.length ? users.map((u) => `<label class="pick">${avatarHTML(u, 40)}<span class="nm">${esc(u.displayName)}</span><input type="checkbox" value="${u.id}" ${selected.has(u.id) ? 'checked' : ''}></label>`).join('') : 'Nobody to add.';
  };
  let timer;
  const run = async () => {
    const q = $('#amSearch', m.el).value.trim();
    try { users = (await api(`/api/users/search?q=${encodeURIComponent(q)}`)).users.filter((u) => !memberOf(chat, u.id)); render(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#amSearch', m.el).oninput = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
  $('#amList', m.el).onchange = (e) => { const id = Number(e.target.value); if (e.target.checked) selected.add(id); else selected.delete(id); $('#amAdd', m.el).disabled = !selected.size; };
  $('#amAdd', m.el).onclick = async () => {
    try { await api(`/api/chats/${chat.id}/members`, { method: 'POST', body: { userIds: [...selected] } }); m.close(); toast('Members added', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  run();
}
