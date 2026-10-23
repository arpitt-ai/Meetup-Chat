'use strict';
/* Meetup - boot, auth, rail */
let authMode = 'login';

function syncThemeBtn() {
  const b = $('#themeBtn');
  if (b) b.innerHTML = document.documentElement.dataset.theme === 'dark' ? icons.sun : icons.moon;
}
function renderRail() {
  $('#rail').innerHTML = `<div class="logo-sm">${LOGO}</div>
    <button class="rail-btn active" data-tab="chats" title="Chats">${icons.chat}<span class="badge hidden" id="railBadge"></span></button>
    <button class="rail-btn" data-tab="status" title="Status">${icons.status}<span class="ping hidden" id="statusPing"></span></button>
    <button class="rail-btn" data-tab="calls" title="Calls">${icons.phone}</button>
    <div class="spacer"></div>
    <button class="rail-btn theme-btn" id="themeBtn" title="Toggle theme"></button>
    <button class="rail-btn me-btn" data-tab="profile" title="Profile"><span id="railAvatar"></span></button>`;
  syncThemeBtn();
  refreshMe();
  $('#rail').onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { $('#app').classList.remove('show-main'); return switchTab(t.dataset.tab); }
    if (e.target.closest('#themeBtn')) { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); syncThemeBtn(); }
  };
}

function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#authLogo').innerHTML = LOGO;
}
function setAuthMode(mode) {
  authMode = mode;
  $$('#authTabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $$('.signup-only').forEach((el) => el.classList.toggle('hidden', mode !== 'signup'));
  $('#authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('#fPass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
}

async function boot() {
  $('#emptyLogo').innerHTML = LOGO;
  initConversationUI();
  initPanelUI();
  $('#authTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setAuthMode(b.dataset.mode); });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#authError'); err.textContent = '';
    const btn = $('#authSubmit'); btn.disabled = true;
    try {
      const body = { username: $('#fUser').value.trim(), password: $('#fPass').value };
      if (authMode === 'signup') body.displayName = $('#fName').value.trim();
      const res = await api(authMode === 'signup' ? '/api/signup' : '/api/login', { method: 'POST', body });
      state.token = res.token; state.me = res.user;
      localStorage.setItem('meetup_token', res.token);
      $('#fPass').value = '';
      await startApp();
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  });

  if (state.token) {
    try { state.me = (await api('/api/me')).user; await startApp(); return; } catch { /* fall through to login */ }
  }
  showAuth();
}

async function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderRail();
  const { chats } = await api('/api/chats');
  state.chats = new Map(chats.map((c) => [c.id, c]));
  switchTab('chats', true);
  updateTitleBadge();
  connectWS();
  loadStatuses();
}

boot();
