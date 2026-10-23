# Meetup

A real-time chat app in a vibrant pastel theme. Original code, written from scratch.

## Run it

Needs Node.js 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:3000, sign up, then open a second browser (or a private window) and sign up as another user to chat between them. Other devices on your network can use `http://<your-ip>:3000`; note that browsers only allow camera and microphone (calls, voice notes) on `localhost` or `https`.

## Features

- Accounts, live 1:1 chats, online / last seen, typing indicator, unread badges
- Message ticks: sent, delivered, read
- Groups: create, rename, add / remove members, admins, exit group
- Reply, forward, copy, star, emoji reactions (double-click a message for a heart), delete for me / for everyone (within 48h)
- Search across chats and inside a chat, starred messages
- Photos, videos, documents (preview and caption), emoji picker, voice notes, drag-and-drop and paste
- 24-hour Status stories (text or photo) with viewer list
- 1:1 voice and video calls (WebRTC, signalling through the server), call history
- Light and dark themes, responsive layout, desktop notifications

## Layout

- `server.js` - Express REST API, WebSocket realtime, SQLite storage
- `public/` - front-end (plain HTML, CSS and JS, no build step)
- `data/` - created on first run: `meetup.db` and `uploads/`

## Notes

- This is its own chat network, not WhatsApp. There are no phone numbers and no end-to-end encryption; messages are stored on the server you run.
- Uploaded files are served at unguessable URLs but are not access-controlled.
- Calls use Google's public STUN server for NAT traversal. Calls across strict firewalls would need a TURN server added in `public/js/calls.js`.
- Group calls are not included.
