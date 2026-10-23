'use strict';
// Meetup server: REST API + WebSocket realtime + SQLite (node:sqlite) persistence.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.MEETUP_DATA || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'meetup.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT 'Hey there! I am using Meetup.',
  color TEXT NOT NULL,
  avatar_url TEXT,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('direct','group')),
  name TEXT,
  color TEXT,
  avatar_url TEXT,
  direct_key TEXT UNIQUE,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members(
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_url TEXT,
  media_name TEXT,
  media_mime TEXT,
  media_size INTEGER,
  duration REAL,
  reply_to INTEGER,
  forwarded INTEGER NOT NULL DEFAULT 0,
  deleted_all INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS receipts(
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  delivered_at INTEGER,
  read_at INTEGER,
  PRIMARY KEY(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id, read_at);
CREATE TABLE IF NOT EXISTS message_hidden(
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  PRIMARY KEY(message_id, user_id)
);
CREATE TABLE IF NOT EXISTS stars(
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  PRIMARY KEY(message_id, user_id)
);
CREATE TABLE IF NOT EXISTS reactions(
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id)
);
CREATE TABLE IF NOT EXISTS statuses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT,
  bg TEXT,
  media_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS status_views(
  status_id INTEGER NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY(status_id, viewer_id)
);
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_id INTEGER NOT NULL,
  callee_id INTEGER NOT NULL,
  video INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ringing',
  started_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER
);
`);

const stmtCache = new Map();
function S(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

const COLORS = ['#ff9aa2', '#ffb7b2', '#ffdac1', '#b5ead7', '#c7ceea', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fdffb6', '#caffbf', '#9bf6ff', '#ffd6a5'];
const STATUS_TTL = 24 * 60 * 60 * 1000;
const DELETE_FOR_ALL_WINDOW = 48 * 60 * 60 * 1000;
const MAX_TEXT = 5000;
const MEDIA_KINDS = new Set(['image', 'video', 'file', 'voice']);

/* ---------- realtime registry ---------- */
const clients = new Map(); // userId -> Set<ws>
const online = (uid) => (clients.get(uid)?.size || 0) > 0;
function sendTo(uid, obj) {
  const set = clients.get(uid);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

/* ---------- helpers ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function publicUser(u) {
  return {
    id: u.id, username: u.username, displayName: u.display_name, about: u.about,
    color: u.color, avatarUrl: u.avatar_url, online: online(u.id), lastSeen: u.last_seen,
  };
}
const getUser = (id) => S('SELECT * FROM users WHERE id = ?').get(id);
const isMember = (chatId, uid) => !!S('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
const snippet = (s) => (s || '').slice(0, 140);

function msgStatus(id) {
  const r = S('SELECT COUNT(*) AS total, COUNT(delivered_at) AS d, COUNT(read_at) AS r FROM receipts WHERE message_id = ?').get(id);
  if (!r.total) return 'sent';
  if (r.r === r.total) return 'read';
  if (r.d === r.total) return 'delivered';
  return 'sent';
}

function serializeMessage(m, viewerId) {
  const deleted = !!m.deleted_all;
  const out = {
    id: m.id, chatId: m.chat_id, senderId: m.sender_id,
    kind: deleted ? 'deleted' : m.kind,
    body: deleted ? null : m.body,
    mediaUrl: deleted ? null : m.media_url,
    mediaName: deleted ? null : m.media_name,
    mediaMime: deleted ? null : m.media_mime,
    mediaSize: deleted ? null : m.media_size,
    duration: deleted ? null : m.duration,
    forwarded: !!m.forwarded && !deleted,
    createdAt: m.created_at,
    replyTo: null, reactions: [], starred: false, status: null,
  };
  if (m.reply_to && !deleted) {
    const r = S('SELECT * FROM messages WHERE id = ? AND chat_id = ?').get(m.reply_to, m.chat_id);
    if (r) {
      out.replyTo = {
        id: r.id, senderId: r.sender_id, kind: r.deleted_all ? 'deleted' : r.kind,
        body: r.deleted_all ? null : snippet(r.body), mediaName: r.deleted_all ? null : r.media_name,
      };
    }
  }
  if (!deleted) {
    const groups = new Map();
    for (const r of S('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY rowid').all(m.id)) {
      if (!groups.has(r.emoji)) groups.set(r.emoji, []);
      groups.get(r.emoji).push(r.user_id);
    }
    out.reactions = [...groups].map(([emoji, userIds]) => ({ emoji, userIds }));
    out.starred = !!S('SELECT 1 FROM stars WHERE message_id = ? AND user_id = ?').get(m.id, viewerId);
  }
  if (m.sender_id === viewerId && m.kind !== 'system') out.status = msgStatus(m.id);
  return out;
}

function serializeChat(chatId, viewerId) {
  const c = S('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!c) return null;
  const members = S(`SELECT u.*, m.role FROM chat_members m JOIN users u ON u.id = m.user_id
                     WHERE m.chat_id = ? ORDER BY m.joined_at, u.id`).all(chatId)
    .map((u) => ({ ...publicUser(u), role: u.role }));
  const last = S(`SELECT * FROM messages m WHERE chat_id = ?
                  AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)
                  ORDER BY id DESC LIMIT 1`).get(chatId, viewerId);
  const unread = S(`SELECT COUNT(*) AS n FROM receipts r JOIN messages m ON m.id = r.message_id
                    WHERE m.chat_id = ? AND r.user_id = ? AND r.read_at IS NULL AND m.deleted_all = 0`).get(chatId, viewerId).n;
  return {
    id: c.id, type: c.type, name: c.name, color: c.color, avatarUrl: c.avatar_url,
    createdBy: c.created_by, createdAt: c.created_at, members,
    lastMessage: last ? serializeMessage(last, viewerId) : null, unread,
  };
}

function createMessage(p) {
  const now = Date.now();
  const info = S(`INSERT INTO messages(chat_id, sender_id, kind, body, media_url, media_name, media_mime, media_size,
                  duration, reply_to, forwarded, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.chatId, p.senderId, p.kind || 'text', p.body ?? null, p.mediaUrl ?? null, p.mediaName ?? null,
    p.mediaMime ?? null, p.mediaSize ?? null, p.duration ?? null, p.replyTo ?? null, p.forwarded ? 1 : 0, now);
  const id = Number(info.lastInsertRowid);
  if ((p.kind || 'text') !== 'system') {
    for (const m of S('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').all(p.chatId, p.senderId)) {
      S('INSERT INTO receipts(message_id, user_id) VALUES (?, ?)').run(id, m.user_id);
    }
  }
  return S('SELECT * FROM messages WHERE id = ?').get(id);
}

function dispatchMessage(m, tempId) {
  const members = S('SELECT user_id FROM chat_members WHERE chat_id = ?').all(m.chat_id);
  const now = Date.now();
  if (m.kind !== 'system') {
    for (const { user_id } of members) {
      if (user_id !== m.sender_id && online(user_id)) {
        S('UPDATE receipts SET delivered_at = ? WHERE message_id = ? AND user_id = ?').run(now, m.id, user_id);
      }
    }
  }
  for (const { user_id } of members) {
    const message = serializeMessage(m, user_id);
    sendTo(user_id, { t: 'message', message, tempId: user_id === m.sender_id ? tempId : undefined });
  }
}

function addSystemMessage(chatId, actorId, body) {
  dispatchMessage(createMessage({ chatId, senderId: actorId, kind: 'system', body }));
}

function notifyStatusChanges(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.sender_id)) by.set(r.sender_id, []);
    by.get(r.sender_id).push({ chatId: r.chat_id, messageId: r.message_id, status: msgStatus(r.message_id) });
  }
  for (const [uid, items] of by) sendTo(uid, { t: 'msg_status', items });
}

function markDeliveredOnConnect(uid) {
  const rows = S(`SELECT r.message_id, m.chat_id, m.sender_id FROM receipts r JOIN messages m ON m.id = r.message_id
                  WHERE r.user_id = ? AND r.delivered_at IS NULL`).all(uid);
  if (!rows.length) return;
  S('UPDATE receipts SET delivered_at = ? WHERE user_id = ? AND delivered_at IS NULL').run(Date.now(), uid);
  notifyStatusChanges(rows);
}

function markRead(uid, chatId) {
  const rows = S(`SELECT r.message_id, m.chat_id, m.sender_id FROM receipts r JOIN messages m ON m.id = r.message_id
                  WHERE m.chat_id = ? AND r.user_id = ? AND r.read_at IS NULL`).all(chatId, uid);
  if (rows.length) {
    const now = Date.now();
    S(`UPDATE receipts SET read_at = ?, delivered_at = COALESCE(delivered_at, ?)
       WHERE user_id = ? AND read_at IS NULL AND message_id IN (SELECT id FROM messages WHERE chat_id = ?)`).run(now, now, uid, chatId);
    notifyStatusChanges(rows);
  }
  sendTo(uid, { t: 'chat_read', chatId });
}

const contactsOf = (uid) => S(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1
  JOIN chat_members m2 ON m1.chat_id = m2.chat_id WHERE m1.user_id = ? AND m2.user_id != ?`).all(uid, uid).map((r) => r.id);

function broadcastPresence(uid) {
  const u = getUser(uid);
  if (!u) return;
  for (const c of contactsOf(uid)) sendTo(c, { t: 'presence', userId: uid, online: online(uid), lastSeen: u.last_seen });
}

function pushChatUpdate(chatId) {
  for (const { user_id } of S('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId)) {
    sendTo(user_id, { t: 'chat_update', chat: serializeChat(chatId, user_id) });
  }
}

function pushMessageUpdate(messageId) {
  const m = S('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!m) return;
  for (const { user_id } of S('SELECT user_id FROM chat_members WHERE chat_id = ?').all(m.chat_id)) {
    sendTo(user_id, { t: 'msg_update', message: serializeMessage(m, user_id) });
  }
}

function getOrCreateDirect(a, b) {
  const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
  let c = S('SELECT id FROM chats WHERE direct_key = ?').get(key);
  let created = false;
  if (!c) {
    const now = Date.now();
    const info = S("INSERT INTO chats(type, direct_key, created_by, created_at) VALUES ('direct', ?, ?, ?)").run(key, a, now);
    const id = Number(info.lastInsertRowid);
    S("INSERT INTO chat_members(chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, a, now);
    S("INSERT INTO chat_members(chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, b, now);
    c = { id };
    created = true;
  }
  return { id: c.id, created };
}

/* ---------- HTTP ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // hosted behind a reverse proxy: use the real client IP for login throttling
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.json({ limit: '1mb' }));

const loginAttempts = new Map();
function throttle(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const rec = (loginAttempts.get(key) || []).filter((t) => now - t < 60_000);
  if (rec.length >= 15) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  rec.push(now);
  loginAttempts.set(key, rec);
  next();
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && S('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  req.uid = s.user_id;
  req.token = token;
  next();
}

function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  S('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, uid, Date.now());
  return token;
}

app.post('/api/signup', throttle, (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.displayName || '').trim().slice(0, 40);
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, dots or underscores.' });
  if (!displayName) return res.status(400).json({ error: 'Please enter your name.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (S('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'That username is taken.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const now = Date.now();
  const info = S('INSERT INTO users(username, display_name, color, salt, hash, last_seen, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(username, displayName, color, salt, hashPassword(password, salt), now, now);
  const uid = Number(info.lastInsertRowid);
  res.json({ token: newSession(uid), user: publicUser(getUser(uid)) });
});

app.post('/api/login', throttle, (req, res) => {
  const u = S('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPassword(String(req.body.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: newSession(u.id), user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  S('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(getUser(req.uid)) }));

app.patch('/api/me', auth, (req, res) => {
  const u = getUser(req.uid);
  const displayName = req.body.displayName !== undefined ? String(req.body.displayName).trim().slice(0, 40) : u.display_name;
  const about = req.body.about !== undefined ? String(req.body.about).trim().slice(0, 140) : u.about;
  const color = COLORS.includes(req.body.color) ? req.body.color : u.color;
  let avatar = u.avatar_url;
  if (req.body.avatarUrl !== undefined) {
    avatar = req.body.avatarUrl && /^\/uploads\/[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/.test(req.body.avatarUrl) ? req.body.avatarUrl : null;
  }
  if (!displayName) return res.status(400).json({ error: 'Name cannot be empty.' });
  S('UPDATE users SET display_name = ?, about = ?, color = ?, avatar_url = ? WHERE id = ?').run(displayName, about, color, avatar, req.uid);
  for (const c of contactsOf(req.uid)) sendTo(c, { t: 'user_update', user: publicUser(getUser(req.uid)) });
  res.json({ user: publicUser(getUser(req.uid)) });
});

app.get('/api/users/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[\\%_]/g, '\\$&');
  const rows = S(`SELECT * FROM users WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
                  ORDER BY display_name COLLATE NOCASE LIMIT 40`).all(req.uid, `%${q}%`, `%${q}%`);
  res.json({ users: rows.map(publicUser) });
});

/* ----- chats ----- */
app.get('/api/chats', auth, (req, res) => {
  const ids = S('SELECT chat_id FROM chat_members WHERE user_id = ?').all(req.uid).map((r) => r.chat_id);
  res.json({ chats: ids.map((id) => serializeChat(id, req.uid)) });
});

app.get('/api/chats/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.uid)) return res.status(404).json({ error: 'Chat not found' });
  res.json({ chat: serializeChat(id, req.uid) });
});

app.post('/api/chats/direct', auth, (req, res) => {
  const other = Number(req.body.userId);
  if (!other || other === req.uid || !getUser(other)) return res.status(400).json({ error: 'Invalid user' });
  const { id, created } = getOrCreateDirect(req.uid, other);
  if (created) pushChatUpdate(id);
  res.json({ chat: serializeChat(id, req.uid) });
});

app.post('/api/chats/group', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Give the group a name.' });
  const memberIds = [...new Set((req.body.memberIds || []).map(Number))].filter((id) => id && id !== req.uid && getUser(id));
  if (!memberIds.length) return res.status(400).json({ error: 'Add at least one member.' });
  const now = Date.now();
  const info = S("INSERT INTO chats(type, name, color, created_by, created_at) VALUES ('group', ?, ?, ?, ?)")
    .run(name, COLORS[Math.floor(Math.random() * COLORS.length)], req.uid, now);
  const id = Number(info.lastInsertRowid);
  S("INSERT INTO chat_members(chat_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(id, req.uid, now);
  for (const m of memberIds) S("INSERT INTO chat_members(chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, m, now);
  pushChatUpdate(id);
  addSystemMessage(id, req.uid, `${getUser(req.uid).display_name} created the group "${name}"`);
  res.json({ chat: serializeChat(id, req.uid) });
});

function requireGroupAdmin(req, res) {
  const id = Number(req.params.id);
  const chat = S('SELECT * FROM chats WHERE id = ?').get(id);
  const me = S('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(id, req.uid);
  if (!chat || !me) { res.status(404).json({ error: 'Chat not found' }); return null; }
  if (chat.type !== 'group') { res.status(400).json({ error: 'Not a group' }); return null; }
  if (me.role !== 'admin') { res.status(403).json({ error: 'Only admins can do that.' }); return null; }
  return chat;
}

app.patch('/api/chats/:id', auth, (req, res) => {
  const chat = requireGroupAdmin(req, res);
  if (!chat) return;
  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 50) : chat.name;
  if (!name) return res.status(400).json({ error: 'Group name cannot be empty.' });
  let avatar = chat.avatar_url;
  if (req.body.avatarUrl !== undefined) {
    avatar = req.body.avatarUrl && /^\/uploads\/[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/.test(req.body.avatarUrl) ? req.body.avatarUrl : null;
  }
  S('UPDATE chats SET name = ?, avatar_url = ? WHERE id = ?').run(name, avatar, chat.id);
  if (name !== chat.name) addSystemMessage(chat.id, req.uid, `${getUser(req.uid).display_name} renamed the group to "${name}"`);
  pushChatUpdate(chat.id);
  res.json({ chat: serializeChat(chat.id, req.uid) });
});

app.post('/api/chats/:id/members', auth, (req, res) => {
  const chat = requireGroupAdmin(req, res);
  if (!chat) return;
  const added = [];
  for (const uid of [...new Set((req.body.userIds || []).map(Number))]) {
    if (!uid || !getUser(uid) || isMember(chat.id, uid)) continue;
    S("INSERT INTO chat_members(chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(chat.id, uid, Date.now());
    added.push(getUser(uid).display_name);
  }
  pushChatUpdate(chat.id);
  if (added.length) addSystemMessage(chat.id, req.uid, `${getUser(req.uid).display_name} added ${added.join(', ')}`);
  res.json({ chat: serializeChat(chat.id, req.uid) });
});

app.post('/api/chats/:id/members/:userId/admin', auth, (req, res) => {
  const chat = requireGroupAdmin(req, res);
  if (!chat) return;
  const target = Number(req.params.userId);
  if (!isMember(chat.id, target)) return res.status(404).json({ error: 'Not a member' });
  S("UPDATE chat_members SET role = 'admin' WHERE chat_id = ? AND user_id = ?").run(chat.id, target);
  pushChatUpdate(chat.id);
  res.json({ chat: serializeChat(chat.id, req.uid) });
});

app.delete('/api/chats/:id/members/:userId', auth, (req, res) => {
  const id = Number(req.params.id);
  const target = Number(req.params.userId);
  const chat = S('SELECT * FROM chats WHERE id = ?').get(id);
  const me = S('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(id, req.uid);
  if (!chat || !me || chat.type !== 'group') return res.status(404).json({ error: 'Group not found' });
  if (target !== req.uid && me.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove members.' });
  if (!isMember(id, target)) return res.status(404).json({ error: 'Not a member' });
  const actor = getUser(req.uid).display_name;
  const targetName = getUser(target).display_name;
  addSystemMessage(id, req.uid, target === req.uid ? `${actor} left` : `${actor} removed ${targetName}`);
  S('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, target);
  sendTo(target, { t: 'chat_removed', chatId: id });
  const left = S('SELECT user_id, role FROM chat_members WHERE chat_id = ? ORDER BY joined_at').all(id);
  if (!left.length) {
    S('DELETE FROM chats WHERE id = ?').run(id);
  } else {
    if (!left.some((m) => m.role === 'admin')) S("UPDATE chat_members SET role = 'admin' WHERE chat_id = ? AND user_id = ?").run(id, left[0].user_id);
    pushChatUpdate(id);
  }
  res.json({ ok: true });
});

app.get('/api/chats/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.uid)) return res.status(404).json({ error: 'Chat not found' });
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = S(`SELECT * FROM messages m WHERE chat_id = ? AND id < ?
                  AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)
                  ORDER BY id DESC LIMIT ?`).all(id, before, req.uid, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse().map((m) => serializeMessage(m, req.uid));
  res.json({ messages: page, hasMore });
});

app.get('/api/search', auth, (req, res) => {
  const term = String(req.query.q || '').trim();
  if (!term) return res.json({ results: [] });
  const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const chatId = Number(req.query.chatId) || null;
  if (chatId && !isMember(chatId, req.uid)) return res.status(404).json({ error: 'Chat not found' });
  const rows = S(`SELECT m.* FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
                  WHERE m.deleted_all = 0 AND m.kind != 'system' AND (m.body LIKE ? ESCAPE '\\' OR m.media_name LIKE ? ESCAPE '\\')
                  AND (? IS NULL OR m.chat_id = ?)
                  AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)
                  ORDER BY m.id DESC LIMIT 50`).all(req.uid, like, like, chatId, chatId, req.uid);
  res.json({ results: rows.map((m) => serializeMessage(m, req.uid)) });
});

app.get('/api/starred', auth, (req, res) => {
  const rows = S(`SELECT m.* FROM stars s JOIN messages m ON m.id = s.message_id
                  WHERE s.user_id = ? AND m.deleted_all = 0 ORDER BY m.id DESC LIMIT 100`).all(req.uid);
  res.json({ results: rows.map((m) => serializeMessage(m, req.uid)) });
});

/* ----- uploads ----- */
const INLINE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', pdf: 'application/pdf',
};
app.post('/api/upload', auth, express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty upload' });
  let name = 'file';
  try { name = decodeURIComponent(req.headers['x-filename'] || 'file'); } catch { /* keep default */ }
  name = path.basename(name).slice(0, 120) || 'file';
  const ext = (path.extname(name).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)) || 'bin';
  const id = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, id), req.body);
  res.json({ url: `/uploads/${id}`, name, size: req.body.length, mime: INLINE_TYPES[ext] || 'application/octet-stream' });
});

app.get('/uploads/:name', (req, res) => {
  const n = req.params.name;
  if (!/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/.test(n)) return res.sendStatus(404);
  const file = path.join(UPLOAD_DIR, n);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const mime = INLINE_TYPES[n.split('.')[1]];
  res.set('Cache-Control', 'private, max-age=86400');
  if (mime) res.type(mime);
  else { res.type('application/octet-stream'); res.set('Content-Disposition', 'attachment'); }
  res.sendFile(file);
});

/* ----- status stories ----- */
function statusContacts(uid) {
  const rows = S(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1 JOIN chats c ON c.id = m1.chat_id AND c.type = 'direct'
                  JOIN chat_members m2 ON m2.chat_id = m1.chat_id WHERE m1.user_id = ? AND m2.user_id != ?`).all(uid, uid);
  return rows.map((r) => r.id);
}

app.get('/api/statuses', auth, (req, res) => {
  const since = Date.now() - STATUS_TTL;
  const ids = [req.uid, ...statusContacts(req.uid)];
  const groups = [];
  for (const uid of ids) {
    const items = S('SELECT * FROM statuses WHERE user_id = ? AND created_at > ? ORDER BY id').all(uid, since).map((s) => ({
      id: s.id, kind: s.kind, body: s.body, bg: s.bg, mediaUrl: s.media_url, createdAt: s.created_at,
      viewed: uid === req.uid ? true : !!S('SELECT 1 FROM status_views WHERE status_id = ? AND viewer_id = ?').get(s.id, req.uid),
      viewCount: uid === req.uid ? S('SELECT COUNT(*) AS n FROM status_views WHERE status_id = ?').get(s.id).n : undefined,
    }));
    if (items.length) groups.push({ user: publicUser(getUser(uid)), items });
  }
  res.json({ groups });
});

app.post('/api/statuses', auth, (req, res) => {
  const kind = req.body.kind === 'image' ? 'image' : 'text';
  const body = String(req.body.body || '').slice(0, 700);
  const bg = /^#[0-9a-fA-F]{6}$/.test(req.body.bg || '') ? req.body.bg : '#bdb2ff';
  let mediaUrl = null;
  if (kind === 'image') {
    mediaUrl = String(req.body.mediaUrl || '');
    if (!/^\/uploads\/[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/.test(mediaUrl)) return res.status(400).json({ error: 'Invalid image' });
  } else if (!body.trim()) return res.status(400).json({ error: 'Write something first.' });
  S('INSERT INTO statuses(user_id, kind, body, bg, media_url, created_at) VALUES (?,?,?,?,?,?)').run(req.uid, kind, body, bg, mediaUrl, Date.now());
  for (const c of statusContacts(req.uid)) sendTo(c, { t: 'status_new', userId: req.uid });
  sendTo(req.uid, { t: 'status_new', userId: req.uid });
  res.json({ ok: true });
});

app.post('/api/statuses/:id/view', auth, (req, res) => {
  const s = S('SELECT * FROM statuses WHERE id = ?').get(Number(req.params.id));
  if (!s || s.user_id === req.uid) return res.json({ ok: true });
  if (!statusContacts(req.uid).includes(s.user_id)) return res.status(403).json({ error: 'Not allowed' });
  S('INSERT OR IGNORE INTO status_views(status_id, viewer_id, viewed_at) VALUES (?,?,?)').run(s.id, req.uid, Date.now());
  sendTo(s.user_id, { t: 'status_view', statusId: s.id });
  res.json({ ok: true });
});

app.get('/api/statuses/:id/views', auth, (req, res) => {
  const s = S('SELECT * FROM statuses WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.uid);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const rows = S('SELECT * FROM status_views WHERE status_id = ? ORDER BY viewed_at DESC').all(s.id);
  res.json({ views: rows.map((v) => ({ user: publicUser(getUser(v.viewer_id)), viewedAt: v.viewed_at })) });
});

app.delete('/api/statuses/:id', auth, (req, res) => {
  S('DELETE FROM statuses WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.uid);
  for (const c of [req.uid, ...statusContacts(req.uid)]) sendTo(c, { t: 'status_new', userId: req.uid });
  res.json({ ok: true });
});

/* ----- call history ----- */
app.get('/api/calls', auth, (req, res) => {
  const rows = S('SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status != \'ringing\' ORDER BY id DESC LIMIT 60').all(req.uid, req.uid);
  res.json({
    calls: rows.map((c) => ({
      id: c.id, video: !!c.video, status: c.status, direction: c.caller_id === req.uid ? 'out' : 'in',
      peer: publicUser(getUser(c.caller_id === req.uid ? c.callee_id : c.caller_id)),
      startedAt: c.started_at, duration: c.answered_at && c.ended_at ? Math.round((c.ended_at - c.answered_at) / 1000) : 0,
    })),
  });
});

app.use(express.static(path.join(__dirname, 'public')));

/* ---------- WebSocket ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
const activeCalls = new Map(); // callId -> { caller, callee, video, answered, timer }
const inCall = (uid) => [...activeCalls.values()].some((c) => c.caller === uid || c.callee === uid);

function endCall(callId, endedBy) {
  const call = activeCalls.get(callId);
  if (!call) return;
  activeCalls.delete(callId);
  clearTimeout(call.timer);
  const now = Date.now();
  let status;
  let reason;
  if (call.answered) { status = 'answered'; reason = 'ended'; }
  else if (endedBy === 'timeout') { status = 'missed'; reason = 'missed'; }
  else if (endedBy === call.caller) { status = 'missed'; reason = 'cancelled'; }
  else { status = 'declined'; reason = 'declined'; }
  S('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run(status, now, callId);
  const other = endedBy === call.caller ? call.callee : call.caller;
  if (endedBy === 'timeout') {
    sendTo(call.caller, { t: 'call_ended', callId, reason });
    sendTo(call.callee, { t: 'call_ended', callId, reason });
  } else {
    sendTo(other, { t: 'call_ended', callId, reason });
    sendTo(endedBy, { t: 'call_ended', callId, reason });
  }
  // log into the direct chat
  const key = `${Math.min(call.caller, call.callee)}:${Math.max(call.caller, call.callee)}`;
  const chat = S('SELECT id FROM chats WHERE direct_key = ?').get(key);
  if (chat) {
    const label = call.video ? 'video call' : 'voice call';
    const icon = call.video ? '📹' : '📞';
    let text;
    if (status === 'answered') {
      const secs = Math.max(0, Math.round((now - call.answered) / 1000));
      text = `${icon} ${label[0].toUpperCase() + label.slice(1)} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    } else if (status === 'declined') text = `${icon} Declined ${label}`;
    else text = `${icon} Missed ${label}`;
    addSystemMessage(chat.id, call.caller, text);
  }
}

function handleSocket(ws, uid) {
  if (!clients.has(uid)) clients.set(uid, new Set());
  const first = clients.get(uid).size === 0;
  clients.get(uid).add(ws);
  S('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), uid);
  if (first) broadcastPresence(uid);
  markDeliveredOnConnect(uid);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const reply = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try { handle(msg); } catch (err) { console.error('ws handler error', err); reply({ t: 'error', error: 'Something went wrong.' }); }
  });

  function handle(msg) {
    switch (msg.t) {
      case 'send': {
        const chatId = Number(msg.chatId);
        if (!isMember(chatId, uid)) return reply({ t: 'send_failed', tempId: msg.tempId, error: 'You are not in this chat.' });
        const kind = msg.kind || 'text';
        const p = { chatId, senderId: uid, kind, forwarded: !!msg.forwarded };
        if (kind === 'text') {
          const body = String(msg.body || '').trim();
          if (!body) return;
          p.body = body.slice(0, MAX_TEXT);
        } else if (MEDIA_KINDS.has(kind)) {
          const url = String(msg.mediaUrl || '');
          if (!/^\/uploads\/[a-f0-9]{32}\.[a-z0-9]{1,8}$/.test(url) || !fs.existsSync(path.join(UPLOAD_DIR, url.slice(9)))) {
            return reply({ t: 'send_failed', tempId: msg.tempId, error: 'Upload not found.' });
          }
          p.mediaUrl = url;
          p.mediaName = String(msg.mediaName || 'file').slice(0, 120);
          p.mediaMime = String(msg.mediaMime || '').slice(0, 100);
          p.mediaSize = Number(msg.mediaSize) || null;
          p.duration = Number(msg.duration) || null;
          p.body = msg.body ? String(msg.body).slice(0, MAX_TEXT) : null;
        } else return;
        if (msg.replyTo) {
          const r = S('SELECT id FROM messages WHERE id = ? AND chat_id = ?').get(Number(msg.replyTo), chatId);
          if (r) p.replyTo = r.id;
        }
        dispatchMessage(createMessage(p), msg.tempId);
        break;
      }
      case 'typing': {
        const chatId = Number(msg.chatId);
        if (!isMember(chatId, uid)) return;
        for (const { user_id } of S('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').all(chatId, uid)) {
          sendTo(user_id, { t: 'typing', chatId, userId: uid, typing: !!msg.typing });
        }
        break;
      }
      case 'read':
        if (isMember(Number(msg.chatId), uid)) markRead(uid, Number(msg.chatId));
        break;
      case 'delete': {
        const m = S('SELECT * FROM messages WHERE id = ?').get(Number(msg.messageId));
        if (!m || !isMember(m.chat_id, uid)) return;
        if (msg.scope === 'all') {
          if (m.sender_id !== uid || m.kind === 'system') return reply({ t: 'error', error: 'You can only delete your own messages for everyone.' });
          if (Date.now() - m.created_at > DELETE_FOR_ALL_WINDOW) return reply({ t: 'error', error: 'Too old to delete for everyone.' });
          S('UPDATE messages SET deleted_all = 1, body = NULL, media_url = NULL, media_name = NULL WHERE id = ?').run(m.id);
          S('DELETE FROM reactions WHERE message_id = ?').run(m.id);
          pushMessageUpdate(m.id);
          pushChatUpdate(m.chat_id);
        } else {
          S('INSERT OR IGNORE INTO message_hidden(message_id, user_id) VALUES (?, ?)').run(m.id, uid);
          sendTo(uid, { t: 'msg_hidden', chatId: m.chat_id, messageId: m.id });
        }
        break;
      }
      case 'react': {
        const m = S('SELECT * FROM messages WHERE id = ?').get(Number(msg.messageId));
        if (!m || m.deleted_all || m.kind === 'system' || !isMember(m.chat_id, uid)) return;
        const emoji = String(msg.emoji || '').slice(0, 16);
        const cur = S('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(m.id, uid);
        if (!emoji || (cur && cur.emoji === emoji)) S('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(m.id, uid);
        else S('INSERT INTO reactions(message_id, user_id, emoji) VALUES (?,?,?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji').run(m.id, uid, emoji);
        pushMessageUpdate(m.id);
        break;
      }
      case 'star': {
        const m = S('SELECT * FROM messages WHERE id = ?').get(Number(msg.messageId));
        if (!m || m.deleted_all || m.kind === 'system' || !isMember(m.chat_id, uid)) return;
        if (S('SELECT 1 FROM stars WHERE message_id = ? AND user_id = ?').get(m.id, uid)) S('DELETE FROM stars WHERE message_id = ? AND user_id = ?').run(m.id, uid);
        else S('INSERT INTO stars(message_id, user_id) VALUES (?, ?)').run(m.id, uid);
        sendTo(uid, { t: 'msg_update', message: serializeMessage(S('SELECT * FROM messages WHERE id = ?').get(m.id), uid) });
        break;
      }
      /* --- 1:1 calls (WebRTC signalling only; media flows peer to peer) --- */
      case 'call_invite': {
        const to = Number(msg.to);
        if (!to || to === uid || !getUser(to)) return;
        if (!online(to)) return reply({ t: 'call_unavailable', reason: 'offline' });
        if (inCall(uid) || inCall(to)) return reply({ t: 'call_unavailable', reason: 'busy' });
        if (!getOrCreateDirect(uid, to).id) return;
        const video = msg.video ? 1 : 0;
        const info = S('INSERT INTO calls(caller_id, callee_id, video, started_at) VALUES (?,?,?,?)').run(uid, to, video, Date.now());
        const callId = Number(info.lastInsertRowid);
        const timer = setTimeout(() => endCall(callId, 'timeout'), 40_000);
        activeCalls.set(callId, { caller: uid, callee: to, video: !!video, answered: 0, timer });
        reply({ t: 'call_created', callId, to });
        sendTo(to, { t: 'call_incoming', callId, from: publicUser(getUser(uid)), video: !!video, offer: msg.offer });
        break;
      }
      case 'call_answer': {
        const callId = Number(msg.callId);
        const call = activeCalls.get(callId);
        if (!call || call.callee !== uid || call.answered) return;
        clearTimeout(call.timer);
        call.answered = Date.now();
        S("UPDATE calls SET answered_at = ?, status = 'answered' WHERE id = ?").run(call.answered, callId);
        sendTo(call.caller, { t: 'call_answered', callId, answer: msg.answer });
        break;
      }
      case 'call_ice': {
        const call = activeCalls.get(Number(msg.callId));
        if (!call || (call.caller !== uid && call.callee !== uid)) return;
        sendTo(call.caller === uid ? call.callee : call.caller, { t: 'call_ice', callId: Number(msg.callId), candidate: msg.candidate });
        break;
      }
      case 'call_end': {
        const call = activeCalls.get(Number(msg.callId));
        if (call && (call.caller === uid || call.callee === uid)) endCall(Number(msg.callId), uid);
        break;
      }
      default:
    }
  }

  ws.on('close', () => {
    const set = clients.get(uid);
    set.delete(ws);
    if (!set.size) {
      clients.delete(uid);
      S('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), uid);
      broadcastPresence(uid);
      for (const [id, c] of activeCalls) if (c.caller === uid || c.callee === uid) endCall(id, uid);
    }
  });
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  const s = token && S('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!s) { ws.close(4001, 'unauthorized'); return; }
  handleSocket(ws, s.user_id);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Meetup is running at http://localhost:${PORT}`));
