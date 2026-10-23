'use strict';
/* Meetup - chat list, conversation, composer, message actions */
let chatSearchQuery = '';
let msgSearchResults = [];
let msgSearchTimer = null;
let tmpCounter = 0;
let loadingOlder = false;
let newBelow = 0;
let convSearchTerm = '';
let convSearch = { ids: [], idx: -1 };

const activeChat = () => state.chats.get(state.activeChatId);
const entryOf = (chatId) => state.msgs.get(chatId);
const findMsg = (id, chatId = state.activeChatId) => entryOf(chatId)?.list.find((m) => String(m.id) === String(id));

const STAR_SVG = '<svg class="star" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const tickAttrs = 'class="tick{c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"';
function tickHTML(status) {
  if (status === 'pending') return `<svg ${tickAttrs.replace('{c}', '')}><circle cx="12" cy="12" r="8.5"/><polyline points="12 7.5 12 12 15 13.5"/></svg>`;
  if (status === 'sent') return `<svg ${tickAttrs.replace('{c}', '')}><polyline points="5 12.5 10 17.5 19 7"/></svg>`;
  const c = status === 'read' ? ' read' : '';
  return `<svg ${tickAttrs.replace('{c}', c)}><polyline points="1.5 12.5 6.5 17.5 15 7.5"/><polyline points="10.5 15.5 12 17 21.5 6.5"/></svg>`;
}

const mediaLabel = (m) => ({ image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', file: `📄 ${m.mediaName || 'Document'}` }[m.kind] || '');
function previewText(m) {
  if (m.kind === 'deleted') return 'This message was deleted';
  if (m.kind === 'voice') return `🎤 Voice message (${fmtDuration(m.duration)})`;
  if (m.body && m.kind !== 'text') return `${mediaLabel(m).split(' ')[0]} ${m.body}`;
  return m.kind === 'text' || m.kind === 'system' ? m.body || '' : mediaLabel(m);
}

/* =========================  Chat list  ========================= */
function renderChatsPanel() {
  $('#side').innerHTML = `
    <div class="side-head"><h2>Chats</h2>
      <div class="side-actions">
        <button class="icon-btn" id="newChatBtn" title="New chat">${icons.plus}</button>
        <button class="icon-btn" id="sideMenuBtn" title="Menu" data-keep-menu>${icons.more}</button>
      </div></div>
    <div class="search">${icons.search}<input id="chatSearch" placeholder="Search or start a new chat" autocomplete="off" value="${esc(chatSearchQuery)}"></div>
    <div class="filters">
      <button class="chip" data-f="all">All</button><button class="chip" data-f="unread">Unread</button><button class="chip" data-f="groups">Groups</button>
    </div>
    <div class="list" id="chatList"></div>`;
  $$('.filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === state.filter));
  $('#newChatBtn').onclick = () => openNewChatPanel();
  $('#sideMenuBtn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(`<button data-act="group">${icons.users}New group</button><button data-act="starred">${icons.star}Starred messages</button><button data-act="profile">${icons.edit}Profile</button><button class="danger" data-act="logout">${icons.logout}Log out</button>`, r.right - 200, r.bottom + 6, (act) => {
      if (act === 'group') openNewGroupPanel();
      if (act === 'starred') openStarredPanel();
      if (act === 'profile') switchTab('profile');
      if (act === 'logout') logout();
    });
  };
  $('.filters').onclick = (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    state.filter = b.dataset.f;
    $$('.filters .chip').forEach((c) => c.classList.toggle('active', c === b));
    renderChatList();
  };
  $('#chatSearch').oninput = (e) => {
    chatSearchQuery = e.target.value;
    clearTimeout(msgSearchTimer);
    if (chatSearchQuery.trim().length < 2) { msgSearchResults = []; renderChatList(); return; }
    renderChatList();
    msgSearchTimer = setTimeout(async () => {
      const q = chatSearchQuery.trim();
      try {
        const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (q !== chatSearchQuery.trim()) return;
        msgSearchResults = results;
        renderChatList();
      } catch { /* ignore */ }
    }, 250);
  };
  $('#chatList').onclick = (e) => {
    const it = e.target.closest('.item'); if (!it) return;
    if (it.dataset.msg) jumpToSearchResult(Number(it.dataset.chat), Number(it.dataset.msg));
    else openChat(Number(it.dataset.chat));
  };
  renderChatList();
}

function previewHTML(c) {
  const last = c.lastMessage;
  if (!last) return '<em>No messages yet</em>';
  if (last.kind === 'system') return `<em>${esc(last.body)}</em>`;
  const mine = last.senderId === state.me.id;
  let prefix = '';
  if (c.type === 'group') prefix = mine ? 'You: ' : `${(memberOf(c, last.senderId)?.displayName || 'Someone').split(' ')[0]}: `;
  const ticks = mine && last.kind !== 'deleted' ? tickHTML(last.pending ? 'pending' : last.status) : '';
  const text = esc(prefix + previewText(last));
  return `${ticks}<span>${last.kind === 'deleted' ? `<em>${text}</em>` : text}</span>`;
}
function chatItemHTML(c) {
  const last = c.lastMessage;
  const typing = typingNames(c);
  return `<div class="item ${c.id === state.activeChatId ? 'active' : ''}" data-chat="${c.id}">
    ${avatarHTML(chatEntity(c), 50, { presence: c.type === 'direct' })}
    <div class="item-main">
      <div class="item-top"><span class="item-name">${esc(chatTitle(c))}</span><span class="item-time ${c.unread ? 'unread' : ''}">${last ? fmtListTime(last.createdAt) : ''}</span></div>
      <div class="item-bot"><span class="item-sub">${typing ? `<span class="typing">${esc(typing)}</span>` : previewHTML(c)}</span>${c.unread ? `<span class="badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</div>
    </div></div>`;
}
function renderChatList() {
  const list = $('#chatList');
  if (!list) return;
  const q = chatSearchQuery.trim().toLowerCase();
  let chats = sortedChats();
  if (state.filter === 'unread') chats = chats.filter((c) => c.unread > 0);
  if (state.filter === 'groups') chats = chats.filter((c) => c.type === 'group');
  if (q) chats = chats.filter((c) => chatTitle(c).toLowerCase().includes(q));
  let html = chats.map(chatItemHTML).join('');
  if (!chats.length && !q) {
    html = `<div class="empty-list"><span class="big">${state.filter === 'all' ? '💬' : '✨'}</span>${state.filter === 'all' ? 'No chats yet.<br>Tap <b>+</b> to find people and say hi.' : 'Nothing here.'}</div>`;
  } else if (!chats.length && q && !msgSearchResults.length) {
    html = `<div class="empty-list">No chats match “${esc(chatSearchQuery)}”.<br><a href="#" class="link-btn" id="findPeople">Find people</a></div>`;
  }
  if (q && msgSearchResults.length) {
    html += '<div class="list-title">Messages</div>' + msgSearchResults.map((m) => {
      const c = state.chats.get(m.chatId); if (!c) return '';
      return `<div class="item" data-chat="${c.id}" data-msg="${m.id}">${avatarHTML(chatEntity(c), 42)}<div class="item-main">
        <div class="item-top"><span class="item-name">${esc(chatTitle(c))}</span><span class="item-time">${fmtListTime(m.createdAt)}</span></div>
        <div class="item-sub">${linkify(m.body || m.mediaName || '', chatSearchQuery.trim())}</div></div></div>`;
    }).join('');
  }
  const top = list.scrollTop;
  list.innerHTML = html;
  list.scrollTop = top;
  $('#findPeople')?.addEventListener('click', (e) => { e.preventDefault(); openNewChatPanel(chatSearchQuery.trim()); });
}

async function jumpToSearchResult(chatId, msgId) {
  await openChat(chatId);
  await jumpToMessage(msgId);
}

/* =========================  Open / close  ========================= */
function saveDraft() {
  if (state.activeChatId) state.drafts.set(state.activeChatId, $('#msgInput').value);
}
async function openChat(id) {
  const chat = state.chats.get(id);
  if (!chat) return;
  $('#app').classList.add('show-main');
  if (state.activeChatId === id && entryOf(id)?.loaded) { markReadIfVisible(); return; }
  saveDraft();
  state.activeChatId = id;
  state.replyTo = null;
  newBelow = 0;
  closeDrawer();
  closeConvSearch(true);
  stopRecording(true);
  $('#emojiPanel').classList.add('hidden');
  $('#emptyState').classList.add('hidden');
  $('#conv').classList.remove('hidden');
  renderConversationHead();
  renderReplyBar();
  const ta = $('#msgInput');
  ta.value = state.drafts.get(id) || '';
  autosize(); updateSendIcon();
  $('#messages').innerHTML = '';
  $('#toBottom').classList.add('hidden');
  renderChatList();
  try { await loadMessages(id); } catch (e) { toast(e.message, 'err'); return; }
  if (state.activeChatId !== id) return;
  renderMessages(true);
  markReadIfVisible();
  if (innerWidth > 800) ta.focus();
}
function closeChat() {
  saveDraft();
  state.activeChatId = null;
  closeDrawer();
  $('#conv').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  $('#app').classList.remove('show-main');
  renderChatList();
}
async function loadMessages(id, before) {
  let entry = entryOf(id);
  if (!entry) { entry = { list: [], hasMore: true, loaded: false }; state.msgs.set(id, entry); }
  if (entry.loaded && !before) return entry;
  const { messages, hasMore } = await api(`/api/chats/${id}/messages?limit=40${before ? `&before=${before}` : ''}`);
  entry.list = before ? [...messages, ...entry.list] : messages;
  entry.hasMore = hasMore;
  entry.loaded = true;
  return entry;
}
function markReadIfVisible() {
  const chat = activeChat();
  if (chat && chat.unread > 0 && document.hasFocus() && !document.hidden) wsSend({ t: 'read', chatId: chat.id });
}

/* =========================  Conversation header  ========================= */
function renderConversationHead() {
  const chat = activeChat();
  if (!chat) return;
  const typing = typingNames(chat);
  let sub; let cls = '';
  if (typing) { sub = typing; cls = 'typing'; }
  else if (chat.type === 'group') sub = chat.members.map((m) => (m.id === state.me.id ? 'You' : m.displayName.split(' ')[0])).join(', ');
  else { const p = peerOf(chat); sub = lastSeenText(p); cls = p.online ? 'live' : ''; }
  $('#convHead').innerHTML = `
    <button class="icon-btn mobile-back" id="backBtn" title="Back">${icons.back}</button>
    <div class="who" id="headWho">${avatarHTML(chatEntity(chat), 42, { presence: chat.type === 'direct' })}
      <div style="min-width:0"><div class="name">${esc(chatTitle(chat))}</div><div class="sub ${cls}">${esc(sub)}</div></div></div>
    ${chat.type === 'direct' ? `<button class="icon-btn" data-call="voice" title="Voice call">${icons.phone}</button><button class="icon-btn" data-call="video" title="Video call">${icons.video}</button>` : ''}
    <button class="icon-btn" id="convSearchBtn" title="Search in chat">${icons.search}</button>
    <button class="icon-btn" id="infoBtn" title="Info">${icons.info}</button>`;
}

/* =========================  Messages DOM  ========================= */
function quoteHTML(r, chat, withGoto) {
  const who = r.senderId === state.me.id ? 'You' : memberOf(chat, r.senderId)?.displayName || 'Member';
  const txt = r.kind === 'deleted' ? 'This message was deleted' : r.body || mediaLabel(r);
  return `<div class="quote" ${withGoto ? `data-goto="${r.id}"` : ''}><b>${esc(who)}</b><span>${esc(txt)}</span></div>`;
}
function mediaHTML(m) {
  switch (m.kind) {
    case 'image': return `<img class="media-img" src="${esc(m.mediaUrl)}" alt="${esc(m.mediaName)}" data-lightbox loading="lazy">`;
    case 'video': return `<video class="media-vid" controls preload="metadata" src="${esc(m.mediaUrl)}"></video>`;
    case 'voice': return `<div class="voice" data-src="${esc(m.mediaUrl)}" data-dur="${m.duration || 0}"><button class="vp" data-vp>${icons.play}</button><div class="vbar" data-vbar><i></i></div><span class="vdur">${fmtDuration(m.duration)}</span></div>`;
    case 'file': return `<a class="file-card" href="${esc(m.mediaUrl)}" download="${esc(m.mediaName)}" target="_blank" rel="noopener"><span class="fi">${icons.file}</span><span><div class="fn">${esc(m.mediaName)}</div><div class="fs">${fmtSize(m.mediaSize)}</div></span><span style="margin-left:auto;color:var(--ink-2)">${icons.download}</span></a>`;
    default: return '';
  }
}
function buildMsgEl(m, prev, chat) {
  if (m.kind === 'system') return h(`<div class="sys" data-id="${m.id}">${esc(m.body)}</div>`);
  const mine = m.senderId === state.me.id;
  const same = prev && prev.kind !== 'system' && prev.senderId === m.senderId && startOfDay(prev.createdAt) === startOfDay(m.createdAt);
  const cls = ['msg', mine ? 'out' : 'in', same ? 'cont' : 'gap'];
  if (m.pending) cls.push('pending');
  if (convSearch.ids.includes(m.id)) cls.push('hit');
  let inner = '';
  if (chat.type === 'group' && !mine && !same) {
    inner += `<div class="sender" style="color:${nameColor(m.senderId)}">${esc(memberOf(chat, m.senderId)?.displayName || 'Former member')}</div>`;
  }
  if (m.kind === 'deleted') {
    inner += `<div class="deleted">${icons.ban.replace('<svg', '<svg style="width:16px;height:16px"')}<span>${mine ? 'You deleted this message' : 'This message was deleted'}</span></div>`;
  } else {
    if (m.forwarded) inner += `<div class="fwd">${icons.forward}Forwarded</div>`;
    if (m.replyTo) inner += quoteHTML(m.replyTo, chat, true);
    inner += mediaHTML(m);
    if (m.body) inner += `<div class="text">${linkify(m.body, convSearchTerm)}</div>`;
  }
  const meta = `<span class="meta">${m.starred ? STAR_SVG : ''}${fmtTime(m.createdAt)}${mine && m.kind !== 'deleted' ? tickHTML(m.pending ? 'pending' : m.status) : ''}</span>`;
  const menuBtn = m.pending ? '' : `<button class="mm" data-menu title="Menu">${icons.down}</button>`;
  const reacts = m.reactions?.length
    ? `<div class="reacts">${m.reactions.map((r) => `<span class="react ${r.userIds.includes(state.me.id) ? 'mine' : ''}" data-emoji="${esc(r.emoji)}">${esc(r.emoji)}${r.userIds.length > 1 ? `<small>${r.userIds.length}</small>` : ''}</span>`).join('')}</div>` : '';
  return h(`<div class="${cls.join(' ')}" data-id="${m.id}"><div class="bubble">${inner}${meta}${menuBtn}</div>${reacts}</div>`);
}
function appendMsgTo(parent, m, prev, chat) {
  if (!prev || startOfDay(prev.createdAt) !== startOfDay(m.createdAt)) parent.appendChild(h(`<div class="day">${esc(fmtDay(m.createdAt))}</div>`));
  parent.appendChild(buildMsgEl(m, prev, chat));
}
function renderMessages(toBottom) {
  const chat = activeChat(); const entry = chat && entryOf(chat.id);
  if (!entry) return;
  const box = $('#messages');
  const frag = document.createDocumentFragment();
  if (entry.hasMore) frag.appendChild(h('<button class="chip load-more" style="align-self:center;margin:4px 0 8px">Load earlier messages</button>'));
  if (!entry.list.length) frag.appendChild(h(`<div class="sys">${chat.type === 'group' ? 'Say hello to the group 👋' : 'No messages yet. Say hi! 👋'}</div>`));
  let prev = null;
  for (const m of entry.list) { appendMsgTo(frag, m, prev, chat); prev = m; }
  box.replaceChildren(frag);
  if (toBottom) scrollToBottom();
}
function updateMsgEl(m) {
  const chat = activeChat(); const entry = chat && entryOf(chat.id);
  const el = $(`#messages [data-id="${CSS.escape(String(m.id))}"]`);
  if (!el || !entry) return;
  const idx = entry.list.findIndex((x) => String(x.id) === String(m.id));
  el.replaceWith(buildMsgEl(m, idx > 0 ? entry.list[idx - 1] : null, chat));
}
function scrollToBottom() {
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
  newBelow = 0; updateToBottom();
}
function updateToBottom() {
  const box = $('#messages');
  const far = box.scrollHeight - box.scrollTop - box.clientHeight > 300;
  const b = $('#toBottom');
  b.classList.toggle('hidden', !far && !newBelow);
  b.innerHTML = `${icons.down}${newBelow ? `<span class="badge">${newBelow}</span>` : ''}`;
}
async function loadOlder() {
  const chat = activeChat(); const entry = chat && entryOf(chat.id);
  if (!entry || !entry.hasMore || loadingOlder) return;
  const firstId = entry.list.find((m) => typeof m.id === 'number')?.id;
  if (!firstId) return;
  loadingOlder = true;
  const box = $('#messages');
  const prevH = box.scrollHeight; const prevTop = box.scrollTop;
  try {
    await loadMessages(chat.id, firstId);
    if (state.activeChatId !== chat.id) return;
    renderMessages(false);
    box.scrollTop = box.scrollHeight - prevH + prevTop;
  } catch (e) { toast(e.message, 'err'); } finally { loadingOlder = false; }
}
async function jumpToMessage(id) {
  const chat = activeChat(); const entry = chat && entryOf(chat.id);
  if (!entry) return;
  for (let i = 0; i < 40 && !entry.list.some((m) => m.id === id) && entry.hasMore; i++) await loadOlder();
  const el = $(`#messages [data-id="${id}"]`);
  if (!el) { toast('That message is no longer available.'); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* local list mutations */
function addMessageLocal(chatId, m) {
  const chat = state.chats.get(chatId); const entry = entryOf(chatId);
  if (entry?.loaded) entry.list.push(m);
  if (chat) chat.lastMessage = m;
  if (chatId === state.activeChatId && entry?.loaded) appendMessageDOM(m);
  renderChatList();
}
function appendMessageDOM(m) {
  const chat = activeChat(); const entry = entryOf(chat.id); const box = $('#messages');
  box.querySelector('.sys:not([data-id])')?.remove();
  const idx = entry.list.indexOf(m);
  const prev = idx > 0 ? entry.list[idx - 1] : null;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
  appendMsgTo(box, m, prev, chat);
  if (nearBottom || m.senderId === state.me.id) scrollToBottom();
  else { newBelow++; updateToBottom(); }
}
function removePending(tempId) {
  for (const [chatId, entry] of state.msgs) {
    const i = entry.list.findIndex((m) => m.id === tempId);
    if (i < 0) continue;
    entry.list.splice(i, 1);
    $(`#messages [data-id="${tempId}"]`)?.remove();
    const chat = state.chats.get(chatId);
    if (chat && chat.lastMessage?.id === tempId) chat.lastMessage = [...entry.list].reverse().find((x) => !x.pending) || null;
    renderChatList();
  }
}

/* =========================  Realtime handlers  ========================= */
function onIncomingMessage(m, tempId) {
  const chat = state.chats.get(m.chatId);
  if (!chat) {
    api(`/api/chats/${m.chatId}`).then(({ chat: c }) => { state.chats.set(c.id, c); renderChatList(); updateTitleBadge(); if (c.unread) { playBeep(); } }).catch(() => {});
    return;
  }
  const entry = entryOf(m.chatId);
  const mine = m.senderId === state.me.id;
  if (entry?.loaded) {
    const idx = tempId ? entry.list.findIndex((x) => x.id === tempId) : -1;
    if (idx >= 0) {
      entry.list[idx] = m;
      if (m.chatId === state.activeChatId) {
        const el = $(`#messages [data-id="${tempId}"]`);
        if (el) el.replaceWith(buildMsgEl(m, idx > 0 ? entry.list[idx - 1] : null, chat)); else appendMessageDOM(m);
      }
    } else if (!entry.list.some((x) => x.id === m.id)) {
      entry.list.push(m);
      if (m.chatId === state.activeChatId) appendMessageDOM(m);
    }
  }
  chat.lastMessage = m;
  const t = state.typing.get(chat.id);
  if (t?.has(m.senderId)) { clearTimeout(t.get(m.senderId)); t.delete(m.senderId); }
  if (!mine && m.kind !== 'system') {
    if (m.chatId === state.activeChatId && document.hasFocus() && !document.hidden) wsSend({ t: 'read', chatId: chat.id });
    else {
      chat.unread = (chat.unread || 0) + 1;
      playBeep();
      desktopNotify(chatTitle(chat), `${chat.type === 'group' ? `${memberOf(chat, m.senderId)?.displayName.split(' ')[0] || ''}: ` : ''}${previewText(m)}`, chat.id);
    }
  }
  if (m.chatId === state.activeChatId) renderConversationHead();
  renderChatList();
  updateTitleBadge();
}
function onMsgStatus(items) {
  for (const { chatId, messageId, status } of items) {
    const entry = entryOf(chatId);
    const m = entry?.list.find((x) => x.id === messageId);
    if (m) {
      m.status = status;
      if (chatId === state.activeChatId) {
        const tick = $(`#messages [data-id="${messageId}"] .meta .tick`);
        if (tick) tick.outerHTML = tickHTML(status);
      }
    }
    const chat = state.chats.get(chatId);
    if (chat?.lastMessage?.id === messageId) chat.lastMessage.status = status;
  }
  renderChatList();
}
function onMsgUpdate(m) {
  const entry = entryOf(m.chatId);
  const i = entry ? entry.list.findIndex((x) => x.id === m.id) : -1;
  if (i >= 0) { entry.list[i] = m; if (m.chatId === state.activeChatId) updateMsgEl(m); }
  const chat = state.chats.get(m.chatId);
  if (chat?.lastMessage?.id === m.id) { chat.lastMessage = m; renderChatList(); }
}
async function onMsgHidden(chatId, messageId) {
  const entry = entryOf(chatId);
  if (entry) entry.list = entry.list.filter((m) => m.id !== messageId);
  if (chatId === state.activeChatId) renderMessages(false);
  const chat = state.chats.get(chatId);
  if (chat?.lastMessage?.id === messageId) {
    try { const { chat: c } = await api(`/api/chats/${chatId}`); state.chats.set(chatId, c); renderChatList(); } catch { /* ignore */ }
  }
}
function onChatUpdate(chat) {
  const isNew = !state.chats.has(chat.id);
  const old = state.chats.get(chat.id);
  if (old && chat.id === state.activeChatId) chat.unread = old.unread && !document.hasFocus() ? chat.unread : 0;
  state.chats.set(chat.id, chat);
  if (isNew) updateTitleBadge();
  renderChatList();
  if (chat.id === state.activeChatId) {
    renderConversationHead();
    if ($('#drawer').classList.contains('open')) renderDrawer();
    const entry = entryOf(chat.id);
    if (entry?.loaded) renderMessages(false);
  }
}
function onChatRemoved(chatId) {
  state.chats.delete(chatId); state.msgs.delete(chatId);
  if (state.activeChatId === chatId) { closeChat(); toast('You are no longer in that group.'); }
  renderChatList(); updateTitleBadge();
}
function onPresence({ userId, online, lastSeen }) {
  for (const c of state.chats.values()) { const m = memberOf(c, userId); if (m) { m.online = online; m.lastSeen = lastSeen; } }
  const chat = activeChat();
  if (chat && memberOf(chat, userId)) { renderConversationHead(); if ($('#drawer').classList.contains('open')) renderDrawer(); }
  renderChatList();
}
function onUserUpdate(user) {
  for (const c of state.chats.values()) { const i = c.members.findIndex((m) => m.id === user.id); if (i >= 0) c.members[i] = { ...c.members[i], ...user }; }
  renderChatList();
  if (activeChat()) { renderConversationHead(); renderMessages(false); }
}
function onTyping({ chatId, userId, typing }) {
  if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
  const t = state.typing.get(chatId);
  if (t.has(userId)) { clearTimeout(t.get(userId)); t.delete(userId); }
  if (typing) {
    t.set(userId, setTimeout(() => { t.delete(userId); if (chatId === state.activeChatId) renderConversationHead(); renderChatList(); }, 5000));
  }
  if (chatId === state.activeChatId) renderConversationHead();
  renderChatList();
}
function onSendFailed({ tempId, error }) { removePending(tempId); toast(error || 'Message failed to send.', 'err'); }

/* =========================  Sending  ========================= */
function buildReplyRef(chatId, replyId) {
  const r = findMsg(replyId, chatId);
  return r ? { id: r.id, senderId: r.senderId, kind: r.kind, body: r.body ? r.body.slice(0, 140) : null, mediaName: r.mediaName } : null;
}
function addPending(chatId, payload, extra = {}) {
  const m = {
    id: `tmp-${++tmpCounter}`, chatId, senderId: state.me.id, kind: payload.kind, body: payload.body || null,
    createdAt: Date.now(), pending: true, status: 'pending', reactions: [], starred: false,
    replyTo: payload.replyTo ? buildReplyRef(chatId, payload.replyTo) : null, forwarded: !!payload.forwarded, ...extra,
  };
  addMessageLocal(chatId, m);
  return m;
}
function sendText() {
  const chat = activeChat(); const ta = $('#msgInput');
  const body = ta.value.trim();
  if (!chat || !body) return;
  const payload = { kind: 'text', body, replyTo: state.replyTo?.id };
  const m = addPending(chat.id, payload);
  if (!wsSend({ t: 'send', chatId: chat.id, tempId: m.id, ...payload })) { removePending(m.id); toast('Not connected. Try again in a moment.', 'err'); return; }
  ta.value = ''; state.drafts.delete(chat.id);
  state.replyTo = null; renderReplyBar(); autosize(); updateSendIcon(); stopTyping();
}
async function uploadFile(file, name) {
  return api('/api/upload', { method: 'POST', body: file, raw: true, headers: { 'x-filename': encodeURIComponent(name || file.name || 'file'), 'Content-Type': 'application/octet-stream' } });
}
async function sendMedia(chatId, file, kind, { caption = '', name, duration } = {}) {
  const replyTo = state.replyTo?.id;
  const m = addPending(chatId, { kind, body: caption, replyTo }, { mediaUrl: URL.createObjectURL(file), mediaName: name || file.name, mediaSize: file.size, duration });
  state.replyTo = null; renderReplyBar();
  try {
    const up = await uploadFile(file, name || file.name);
    const ok = wsSend({ t: 'send', chatId, tempId: m.id, kind, body: caption || null, replyTo, mediaUrl: up.url, mediaName: up.name, mediaMime: up.mime || file.type, mediaSize: up.size, duration });
    if (!ok) throw new Error('Not connected. Try again in a moment.');
  } catch (e) { removePending(m.id); toast(e.message || 'Upload failed', 'err'); }
}

/* typing indicator signal */
let typingOn = false; let typingTimer = null;
function signalTyping() {
  const chat = activeChat(); if (!chat) return;
  if (!typingOn) { typingOn = true; wsSend({ t: 'typing', chatId: chat.id, typing: true }); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2500);
}
function stopTyping() {
  clearTimeout(typingTimer);
  if (typingOn && state.activeChatId) wsSend({ t: 'typing', chatId: state.activeChatId, typing: false });
  typingOn = false;
}

/* composer helpers */
function autosize() { const ta = $('#msgInput'); ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; }
function updateSendIcon() {
  const has = $('#msgInput').value.trim().length > 0;
  $('#sendBtn').innerHTML = has ? icons.send : icons.mic;
  $('#sendBtn').title = has ? 'Send' : 'Record voice message';
  $('#sendBtn').dataset.mode = has ? 'send' : 'mic';
}
function renderReplyBar() {
  const bar = $('#replyBar');
  const chat = activeChat();
  if (!state.replyTo || !chat) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `${quoteHTML(state.replyTo, chat, false)}<button class="icon-btn" id="replyClose">${icons.close}</button>`;
}
function startReply(m) {
  state.replyTo = m; renderReplyBar();
  $('#msgInput').focus();
}

/* emoji panel */
let emojiTab = Object.keys(EMOJI)[0];
function renderEmojiPanel() {
  const p = $('#emojiPanel');
  p.innerHTML = `<div class="emoji-tabs">${Object.keys(EMOJI).map((k) => `<button data-tab="${k}" class="${k === emojiTab ? 'active' : ''}">${k}</button>`).join('')}</div>
    <div class="emoji-grid">${EMOJI[emojiTab].split(' ').map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
}
function insertAtCursor(text) {
  const ta = $('#msgInput');
  const s = ta.selectionStart ?? ta.value.length; const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus(); autosize(); updateSendIcon(); signalTyping();
}

/* attachments */
function openMediaPreview(file) {
  const chat = activeChat(); if (!chat) return;
  if (file.size > 30 * 1024 * 1024) { toast('That file is larger than 30 MB.', 'err'); return; }
  const isImg = file.type.startsWith('image/') && /\.(png|jpe?g|gif|webp)$/i.test(file.name || 'x.png');
  const isVid = file.type.startsWith('video/') && /\.(mp4|webm|mov)$/i.test(file.name || '');
  const url = URL.createObjectURL(file);
  const preview = isImg ? `<img src="${url}" alt="">` : isVid ? `<video src="${url}" controls></video>`
    : `<div class="file-card" style="margin:0"><span class="fi">${icons.file}</span><span><div class="fn">${esc(file.name)}</div><div class="fs">${fmtSize(file.size)}</div></span></div>`;
  const m = modal({
    title: `Send to ${chatTitle(chat)}`,
    body: `<div class="preview-box">${preview}</div><input class="plain-input" id="mediaCaption" placeholder="Add a caption (optional)" maxlength="1000">`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="mediaSend">Send</button>`,
  });
  const send = () => {
    const caption = $('#mediaCaption', m.el).value.trim();
    m.close(); URL.revokeObjectURL(url);
    sendMedia(chat.id, file, isImg ? 'image' : isVid ? 'video' : 'file', { caption });
  };
  $('#mediaSend', m.el).onclick = send;
  $('#mediaCaption', m.el).onkeydown = (e) => { if (e.key === 'Enter') send(); };
  setTimeout(() => $('#mediaCaption', m.el).focus(), 50);
}

/* voice notes */
let rec = null;
async function startRecording() {
  const chat = activeChat(); if (!chat || rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Voice notes are not supported in this browser.', 'err'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Microphone permission was denied.', 'err'); return; }
  const mr = new MediaRecorder(stream);
  const chunks = [];
  const chatId = chat.id;
  rec = { mr, stream, chunks, start: Date.now(), cancelled: false, timer: null };
  const mine = rec;
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(mine.timer);
    if (rec === mine) rec = null;
    $('#recorder').classList.add('hidden'); $('#composer').classList.remove('hidden');
    const dur = (Date.now() - mine.start) / 1000;
    if (mine.cancelled || dur < 0.7 || !chunks.length) return;
    const type = mr.mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    sendMedia(chatId, new Blob(chunks, { type }), 'voice', { name: `voice-${Date.now()}.${ext}`, duration: dur });
  };
  mr.start();
  $('#composer').classList.add('hidden');
  const r = $('#recorder');
  r.classList.remove('hidden');
  r.innerHTML = `<button class="icon-btn" id="recCancel" title="Cancel">${icons.trash}</button><span class="rec-dot"></span><span class="rec-time" id="recTime">0:00</span><button class="round primary" id="recSend" title="Send">${icons.send}</button>`;
  rec.timer = setInterval(() => { $('#recTime').textContent = fmtDuration((Date.now() - rec.start) / 1000); }, 250);
}
function stopRecording(cancel) {
  if (!rec) return;
  rec.cancelled = !!cancel;
  try { rec.mr.stop(); } catch { /* already stopped */ }
}

/* voice playback */
let playing = null;
function toggleVoice(box) {
  if (playing && playing.box !== box) { playing.audio.pause(); playing.box.querySelector('.vp').innerHTML = icons.play; }
  if (playing && playing.box === box) {
    if (playing.audio.paused) { playing.audio.play(); box.querySelector('.vp').innerHTML = icons.pause; }
    else { playing.audio.pause(); box.querySelector('.vp').innerHTML = icons.play; }
    return;
  }
  const audio = new Audio(box.dataset.src);
  const dur = Number(box.dataset.dur) || 0;
  playing = { box, audio };
  box.querySelector('.vp').innerHTML = icons.pause;
  audio.ontimeupdate = () => {
    const total = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : dur;
    box.querySelector('.vbar i').style.width = `${Math.min(100, (audio.currentTime / (total || 1)) * 100)}%`;
    box.querySelector('.vdur').textContent = fmtDuration(audio.currentTime);
  };
  audio.onended = () => {
    box.querySelector('.vp').innerHTML = icons.play; box.querySelector('.vbar i').style.width = '0';
    box.querySelector('.vdur').textContent = fmtDuration(dur); playing = null;
  };
  audio.play().catch(() => { toast('Could not play this voice message.', 'err'); box.querySelector('.vp').innerHTML = icons.play; playing = null; });
}
function seekVoice(box, e) {
  if (!playing || playing.box !== box) return;
  const r = box.querySelector('.vbar').getBoundingClientRect();
  const total = isFinite(playing.audio.duration) ? playing.audio.duration : Number(box.dataset.dur);
  playing.audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
}

/* lightbox */
function openLightbox(src, kind = 'image') {
  const el = h(`<div class="lightbox"><button class="x">${icons.close}</button>${kind === 'video' ? `<video src="${esc(src)}" controls autoplay></video>` : `<img src="${esc(src)}" alt="">`}</div>`);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.x')) close(); });
  document.addEventListener('keydown', onKey);
  $('#layer').appendChild(el);
}

/* =========================  Message menu & actions  ========================= */
function openMsgMenu(id, ev) {
  const m = findMsg(id); const chat = activeChat();
  if (!m || !chat || m.pending) return;
  const btn = ev.target.closest('[data-menu]');
  const r = btn ? btn.getBoundingClientRect() : null;
  const x = r ? r.left - 120 : ev.clientX; const y = r ? r.bottom + 4 : ev.clientY;
  const live = m.kind !== 'deleted';
  let html = '';
  if (live) html += `<div class="quick">${QUICK_REACTIONS.map((e) => `<button data-act="react" data-emoji="${e}">${e}</button>`).join('')}</div>`;
  if (live) {
    html += `<button data-act="reply">${icons.reply}Reply</button>`;
    if (m.body) html += `<button data-act="copy">${icons.copy}Copy</button>`;
    html += `<button data-act="forward">${icons.forward}Forward</button>`;
    html += `<button data-act="star">${icons.star}${m.starred ? 'Unstar' : 'Star'}</button>`;
  }
  html += `<button class="danger" data-act="delete">${icons.trash}Delete</button>`;
  showMenu(html, x, y, (act, b) => {
    if (act === 'react') wsSend({ t: 'react', messageId: m.id, emoji: b.dataset.emoji });
    if (act === 'reply') startReply(m);
    if (act === 'copy') navigator.clipboard?.writeText(m.body).then(() => toast('Copied', 'ok'), () => toast('Could not copy', 'err'));
    if (act === 'forward') forwardMessage(m);
    if (act === 'star') wsSend({ t: 'star', messageId: m.id });
    if (act === 'delete') deleteMessage(m);
  });
}
function deleteMessage(m) {
  const canAll = m.senderId === state.me.id && m.kind !== 'deleted' && Date.now() - m.createdAt < 48 * 3600 * 1000;
  const md = modal({
    title: 'Delete message?', body: '',
    foot: `${canAll ? '<button class="btn danger" style="flex:1 1 100%" data-all>Delete for everyone</button>' : ''}<button class="btn danger" style="flex:1 1 100%" data-me>Delete for me</button><button class="btn" style="flex:1 1 100%" data-close>Cancel</button>`,
  });
  md.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-all]')) { wsSend({ t: 'delete', messageId: m.id, scope: 'all' }); md.close(); }
    if (e.target.closest('[data-me]')) { wsSend({ t: 'delete', messageId: m.id, scope: 'me' }); md.close(); }
  });
}
function forwardMessage(m) {
  const chats = sortedChats();
  const selected = new Set();
  const row = (c) => `<label class="pick" data-title="${esc(chatTitle(c).toLowerCase())}">${avatarHTML(chatEntity(c), 40)}<span class="nm">${esc(chatTitle(c))}</span><input type="checkbox" value="${c.id}"></label>`;
  const md = modal({
    title: 'Forward message to…',
    body: `<div style="padding-bottom:8px"><input class="plain-input" id="fwdSearch" placeholder="Search chats"></div><div id="fwdList">${chats.map(row).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="fwdSend" disabled>Forward</button>',
  });
  $('#fwdSearch', md.el).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.pick', md.el).forEach((p) => p.classList.toggle('hidden', !!q && !p.dataset.title.includes(q)));
  };
  $('#fwdList', md.el).onchange = (e) => {
    const id = Number(e.target.value);
    if (e.target.checked) selected.add(id); else selected.delete(id);
    $('#fwdSend', md.el).disabled = !selected.size;
  };
  $('#fwdSend', md.el).onclick = () => {
    for (const chatId of selected) {
      wsSend({ t: 'send', chatId, kind: m.kind, body: m.body, mediaUrl: m.mediaUrl, mediaName: m.mediaName, mediaMime: m.mediaMime, mediaSize: m.mediaSize, duration: m.duration, forwarded: true });
    }
    md.close(); toast(`Forwarded to ${selected.size} chat${selected.size > 1 ? 's' : ''}`, 'ok');
  };
}

/* =========================  In-chat search  ========================= */
function openConvSearch() {
  $('#convSearch').classList.remove('hidden');
  $('#convSearchInput').focus();
}
function closeConvSearch(silent) {
  $('#convSearch').classList.add('hidden');
  $('#convSearchInput').value = ''; $('#convSearchCount').textContent = '';
  const had = convSearchTerm;
  convSearchTerm = ''; convSearch = { ids: [], idx: -1 };
  if (had && !silent) renderMessages(false);
}
let convSearchTimer = null;
function runConvSearch() {
  clearTimeout(convSearchTimer);
  convSearchTimer = setTimeout(async () => {
    const q = $('#convSearchInput').value.trim();
    const chat = activeChat(); if (!chat) return;
    if (!q) { convSearchTerm = ''; convSearch = { ids: [], idx: -1 }; $('#convSearchCount').textContent = ''; renderMessages(false); return; }
    try {
      const { results } = await api(`/api/search?q=${encodeURIComponent(q)}&chatId=${chat.id}`);
      convSearchTerm = q; convSearch = { ids: results.map((m) => m.id), idx: results.length ? 0 : -1 };
      renderMessages(false);
      $('#convSearchCount').textContent = results.length ? `1 of ${results.length}` : 'No results';
      if (results.length) jumpToMessage(convSearch.ids[0]);
    } catch (e) { toast(e.message, 'err'); }
  }, 250);
}
function stepConvSearch(dir) {
  if (!convSearch.ids.length) return;
  convSearch.idx = (convSearch.idx + dir + convSearch.ids.length) % convSearch.ids.length;
  $('#convSearchCount').textContent = `${convSearch.idx + 1} of ${convSearch.ids.length}`;
  jumpToMessage(convSearch.ids[convSearch.idx]);
}

/* =========================  Wire up static DOM (once)  ========================= */
function initConversationUI() {
  $('#emojiBtn').innerHTML = icons.smile;
  $('#attachBtn').innerHTML = icons.clip;
  $('#convSearchPrev').innerHTML = icons.up; $('#convSearchNext').innerHTML = icons.down; $('#convSearchClose').innerHTML = icons.close;
  const ta = $('#msgInput');
  ta.addEventListener('input', () => { autosize(); updateSendIcon(); if (ta.value.trim()) signalTyping(); else stopTyping(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); }
  });
  ta.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); openMediaPreview(f); }
  });
  $('#sendBtn').addEventListener('click', () => { if ($('#sendBtn').dataset.mode === 'send') sendText(); else startRecording(); });
  $('#recorder').addEventListener('click', (e) => {
    if (e.target.closest('#recCancel')) stopRecording(true);
    if (e.target.closest('#recSend')) stopRecording(false);
  });
  $('#replyBar').addEventListener('click', (e) => { if (e.target.closest('#replyClose')) { state.replyTo = null; renderReplyBar(); } });
  $('#emojiBtn').addEventListener('click', () => {
    const p = $('#emojiPanel');
    if (p.classList.contains('hidden')) { renderEmojiPanel(); p.classList.remove('hidden'); } else p.classList.add('hidden');
    $('#emojiBtn').classList.toggle('on', !p.classList.contains('hidden'));
  });
  $('#emojiPanel').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { emojiTab = t.dataset.tab; renderEmojiPanel(); return; }
    const b = e.target.closest('[data-e]');
    if (b) insertAtCursor(b.dataset.e);
  });
  $('#attachBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(`<button data-act="media">${icons.image}Photos &amp; videos</button><button data-act="doc">${icons.file}Document</button>`, r.left, r.top - 112, (act) => {
      (act === 'media' ? $('#fileMedia') : $('#fileDoc')).click();
    });
  });
  for (const input of [$('#fileMedia'), $('#fileDoc')]) {
    input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) openMediaPreview(f); });
  }
  const conv = $('#conv');
  conv.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  conv.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); openMediaPreview(f); } });

  const box = $('#messages');
  box.addEventListener('click', (e) => {
    const msgEl = e.target.closest('.msg');
    if (e.target.closest('.load-more')) return loadOlder();
    if (e.target.closest('[data-menu]') && msgEl) return openMsgMenu(msgEl.dataset.id, e);
    const q = e.target.closest('[data-goto]'); if (q) return jumpToMessage(Number(q.dataset.goto));
    const img = e.target.closest('[data-lightbox]'); if (img) return openLightbox(img.getAttribute('src'));
    const vp = e.target.closest('[data-vp]'); if (vp) return toggleVoice(vp.closest('.voice'));
    const vb = e.target.closest('[data-vbar]'); if (vb) return seekVoice(vb.closest('.voice'), e);
    const rc = e.target.closest('.react');
    if (rc && msgEl) return wsSend({ t: 'react', messageId: Number(msgEl.dataset.id), emoji: rc.dataset.emoji });
    const sender = e.target.closest('.sender');
    if (sender && msgEl) { const m = findMsg(msgEl.dataset.id); if (m) startDirectWith(m.senderId); }
  });
  box.addEventListener('contextmenu', (e) => {
    const msgEl = e.target.closest('.msg');
    if (msgEl && !e.target.closest('a') && !msgEl.classList.contains('pending')) { e.preventDefault(); openMsgMenu(msgEl.dataset.id, e); }
  });
  box.addEventListener('dblclick', (e) => {
    const msgEl = e.target.closest('.msg'); if (!msgEl || e.target.closest('a,video,img,button')) return;
    const m = findMsg(msgEl.dataset.id); if (m && !m.pending && m.kind !== 'deleted') wsSend({ t: 'react', messageId: m.id, emoji: '❤️' });
  });
  box.addEventListener('scroll', () => {
    updateToBottom();
    if (box.scrollTop < 60) loadOlder();
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 40) { newBelow = 0; updateToBottom(); }
  });
  $('#toBottom').addEventListener('click', () => scrollToBottom());
  $('#toBottom').innerHTML = icons.down;

  $('#convHead').addEventListener('click', (e) => {
    if (e.target.closest('#backBtn')) return closeChat();
    if (e.target.closest('#headWho') || e.target.closest('#infoBtn')) return toggleDrawer();
    if (e.target.closest('#convSearchBtn')) return openConvSearch();
    const call = e.target.closest('[data-call]');
    if (call) { const chat = activeChat(); if (chat) startCall(peerOf(chat), call.dataset.call === 'video'); }
  });
  $('#convSearchInput').addEventListener('input', runConvSearch);
  $('#convSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') stepConvSearch(e.shiftKey ? -1 : 1); });
  $('#convSearchPrev').onclick = () => stepConvSearch(1);
  $('#convSearchNext').onclick = () => stepConvSearch(-1);
  $('#convSearchClose').onclick = () => closeConvSearch();
  window.addEventListener('focus', markReadIfVisible);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markReadIfVisible(); });
}
