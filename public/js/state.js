'use strict';
/* Meetup - client state, API client, realtime socket */
const state = {
  token: localStorage.getItem('meetup_token'),
  me: null,
  chats: new Map(),          // chatId -> chat
  msgs: new Map(),           // chatId -> { list: [], hasMore: bool, loaded: bool }
  activeChatId: null,
  tab: 'chats',
  filter: 'all',
  typing: new Map(),         // chatId -> Map(userId -> timeout)
  drafts: new Map(),         // chatId -> text
  replyTo: null,
  statusGroups: [],
  calls: [],
  ws: null, wsReady: false, retry: 0, reconnecting: false,
};

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/signup')) { forceLogout(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------- chat helpers ---------- */
const peerOf = (chat) => chat.members.find((m) => m.id !== state.me.id) || chat.members[0];
const memberOf = (chat, id) => chat.members.find((m) => m.id === id);
const chatTitle = (chat) => (chat.type === 'group' ? chat.name : peerOf(chat)?.displayName || 'Unknown');
function chatEntity(chat) {
  if (chat.type === 'group') return { type: 'group', name: chat.name, color: chat.color, avatarUrl: chat.avatarUrl };
  return peerOf(chat);
}
function sortedChats() {
  return [...state.chats.values()].sort((a, b) => (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt));
}
const totalUnread = () => [...state.chats.values()].reduce((n, c) => n + (c.unread || 0), 0);
const userById = (id) => {
  if (id === state.me.id) return state.me;
  for (const c of state.chats.values()) { const m = memberOf(c, id); if (m) return m; }
  return null;
};
function typingNames(chat) {
  const t = state.typing.get(chat.id);
  if (!t || !t.size) return null;
  const names = [...t.keys()].map((id) => memberOf(chat, id)?.displayName.split(' ')[0]).filter(Boolean);
  if (!names.length) return null;
  return chat.type === 'group' ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : 'typing…';
}

/* ---------- theme, sound, notifications ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('meetup_theme', t);
}
applyTheme(localStorage.getItem('meetup_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

let audioCtx;
function playBeep(kind = 'msg') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'msg' ? [[880, 0], [1174, 0.09]] : [[659, 0], [880, 0.2]];
    for (const [f, t] of notes) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
      o.start(s); o.stop(s + 0.25);
    }
  } catch { /* audio unavailable */ }
}
function desktopNotify(title, body, chatId) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag: `chat-${chatId}` });
    n.onclick = () => { window.focus(); openChat(chatId); n.close(); };
  } catch { /* ignore */ }
}
function updateTitleBadge() {
  const n = totalUnread();
  document.title = n ? `(${n}) Meetup` : 'Meetup';
  const b = $('#railBadge');
  if (b) { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); }
}

/* ---------- realtime ---------- */
function connectWS() {
  if (!state.token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${state.token}`);
  state.ws = ws;
  ws.onopen = () => {
    state.wsReady = true; state.retry = 0;
    if (state.reconnecting) { state.reconnecting = false; toast('Back online', 'ok'); resync(); }
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onWS(m); };
  ws.onclose = (e) => {
    state.wsReady = false;
    if (state.ws !== ws || !state.token || e.code === 4001) return;
    if (!state.reconnecting) toast('Connection lost. Reconnecting…', 'err');
    state.reconnecting = true;
    setTimeout(connectWS, Math.min(1000 * 2 ** state.retry++, 10000));
  };
}
function wsSend(obj) {
  if (state.ws && state.ws.readyState === 1) { state.ws.send(JSON.stringify(obj)); return true; }
  return false;
}
async function resync() {
  try {
    const { chats } = await api('/api/chats');
    state.chats = new Map(chats.map((c) => [c.id, c]));
    renderChatList();
    updateTitleBadge();
    if (state.activeChatId && state.chats.has(state.activeChatId)) {
      state.msgs.delete(state.activeChatId);
      await loadMessages(state.activeChatId);
      renderConversationHead();
      renderMessages(true);
    }
  } catch { /* will retry on next reconnect */ }
}

function onWS(m) {
  switch (m.t) {
    case 'message': onIncomingMessage(m.message, m.tempId); break;
    case 'msg_status': onMsgStatus(m.items); break;
    case 'msg_update': onMsgUpdate(m.message); break;
    case 'msg_hidden': onMsgHidden(m.chatId, m.messageId); break;
    case 'chat_read': { const c = state.chats.get(m.chatId); if (c) { c.unread = 0; renderChatList(); updateTitleBadge(); } break; }
    case 'chat_update': onChatUpdate(m.chat); break;
    case 'chat_removed': onChatRemoved(m.chatId); break;
    case 'presence': onPresence(m); break;
    case 'user_update': onUserUpdate(m.user); break;
    case 'typing': onTyping(m); break;
    case 'status_new': onStatusNew(m); break;
    case 'status_view': if (state.tab === 'status') loadStatuses(); break;
    case 'send_failed': onSendFailed(m); break;
    case 'error': toast(m.error, 'err'); break;
    default: if (m.t && m.t.startsWith('call_')) onCallEvent(m);
  }
}

function forceLogout() {
  state.token = null;
  localStorage.removeItem('meetup_token');
  try { state.ws?.close(); } catch { /* ignore */ }
  location.reload();
}
