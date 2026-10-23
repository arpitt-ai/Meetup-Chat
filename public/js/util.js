'use strict';
/* Meetup - shared helpers, icons, emoji data */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const icons = {
  chat: svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  status: svg('<circle cx="12" cy="12" r="9" stroke-dasharray="3.4 3.1"/><circle cx="12" cy="12" r="4"/>'),
  phone: svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  video: svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  more: svg('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  back: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  send: svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
  mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  micOff: svg('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  videoOff: svg('<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  smile: svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
  clip: svg('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  checks: svg('<polyline points="18 6 9.5 15 6 11.5"/><polyline points="23 6 14.5 15 13 13.4"/><polyline points="1 12 6 17" />'),
  clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  star: svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  reply: svg('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
  forward: svg('<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  userPlus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  sun: svg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  file: svg('<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  pause: svg('<rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/>'),
  down: svg('<polyline points="6 9 12 15 18 9"/>'),
  up: svg('<polyline points="18 15 12 9 6 15"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  bell: svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  inbound: svg('<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>'),
  outbound: svg('<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  ban: svg('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  crown: svg('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>'),
};
const LOGO = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#ff8fc2"/></linearGradient></defs><rect width="64" height="64" rx="19" fill="url(#lg1)"/><path d="M17 23a8 8 0 0 1 8-8h14a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8h-8l-8 7v-7a8 8 0 0 1-6-8z" fill="#fff"/><circle cx="26" cy="27" r="2.6" fill="#8b7bff"/><circle cx="32" cy="27" r="2.6" fill="#c29bff"/><circle cx="38" cy="27" r="2.6" fill="#ff8fc2"/></svg>`;

const NAME_COLORS = ['#e0527a', '#7c5cff', '#12a4a0', '#e8873b', '#3b82f6', '#c04bd1', '#2f9e6f', '#c99600'];
const nameColor = (id) => NAME_COLORS[Math.abs(Number(id) || 0) % NAME_COLORS.length];
const SWATCHES = ['#bdb2ff', '#ffc6ff', '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff'];
const AVATAR_COLORS = ['#ff9aa2', '#ffb7b2', '#ffdac1', '#b5ead7', '#c7ceea', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fdffb6', '#caffbf', '#9bf6ff', '#ffd6a5'];

const initials = (name) => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
function avatarHTML(e, size = 48, opts = {}) {
  const name = e.displayName || e.name || '?';
  const inner = e.avatarUrl ? `<img src="${esc(e.avatarUrl)}" alt="" loading="lazy">` : esc(e.type === 'group' ? '' : initials(name));
  const groupIcon = !e.avatarUrl && e.type === 'group' ? icons.users.replace('<svg', '<svg style="width:55%;height:55%"') : '';
  const dot = opts.presence && e.online ? '<span class="presence"></span>' : '';
  return `<span class="avatar" style="--s:${size}px;background:${esc(e.color || '#c7ceea')}">${inner}${groupIcon}${dot}</span>`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
function fmtDay(ts) {
  const d = startOfDay(ts), today = startOfDay(Date.now());
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtListTime(ts) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (diff === 0) return fmtTime(ts);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(ts).toLocaleDateString([], { weekday: 'short' });
  return new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function lastSeenText(u) {
  if (!u) return '';
  if (u.online) return 'online';
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(u.lastSeen)) / 86400000);
  if (diff === 0) return `last seen today at ${fmtTime(u.lastSeen)}`;
  if (diff === 1) return `last seen yesterday at ${fmtTime(u.lastSeen)}`;
  return `last seen ${new Date(u.lastSeen).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}
const fmtDuration = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
};
function linkify(text, highlight) {
  let out = esc(text);
  if (highlight) {
    const re = new RegExp(esc(highlight).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return out.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, (u) => `<a href="${u.replace(/<\/?mark>/g, '')}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function toast(msg, kind = '') {
  const el = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* popup menu anchored to a point */
let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }
function showMenu(html, x, y, onClick) {
  closeMenu();
  const el = h(`<div class="menu">${html}</div>`);
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMenu();
    onClick(b.dataset.act, b);
  });
  openMenuEl = el;
  return el;
}
document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('[data-keep-menu]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

/* modal helper: returns {el, close} */
function modal({ title, body, foot, wide }) {
  const scrim = h(`<div class="scrim"><div class="modal" role="dialog" aria-label="${esc(title || '')}" ${wide ? 'style="width:min(520px,100%)"' : ''}>
    ${title ? `<div class="modal-head"><span>${esc(title)}</span><button class="icon-btn" data-close>${icons.close}</button></div>` : ''}
    <div class="modal-body">${body || ''}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`);
  $('#layer').appendChild(scrim);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  scrim.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { el: scrim, close };
}
function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>` });
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-ok]')) { m.close(); resolve(true); } else if (e.target.closest('[data-close]')) resolve(false); });
  });
}

const EMOJI = {
  '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕',
  '👋': '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋',
  '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✨ ⭐ 🌟 💫 🔥 💥 💯 ✅ ❌ ❓ ❗ 💤 🎉 🎊 🎈 🎁 🏆 🥇 🎯',
  '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐬 🐳 🌸 🌼 🌻 🌹 🌷 🌲 🌴 🍀 🌈 ☀️ 🌙 ⛅ ☔ ❄️',
  '🍕': '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🥕 🍞 🧀 🍳 🥞 🍔 🍟 🍕 🌭 🌮 🌯 🍜 🍝 🍣 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🥤 🍺 🍷 🥂',
  '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🏸 🥊 🎮 🎲 🎸 🎹 🎧 🎤 🎬 📷 📱 💻 ⌚ 📚 ✏️ 💡 🔑 🚗 ✈️ 🚀 🏠 🌍 🗺️ ⏰ 💰 🎓 🛒',
};
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
