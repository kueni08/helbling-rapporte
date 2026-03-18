// ── App: Router + Auth State ─────────────────────────────────────────────
const App = {
  state: null, // { id, username, fullName, role, email }

  async init() {
    try {
      App.state = await API.me();
      App.showApp();
    } catch {
      App.showLogin();
    }
  },

  showLogin() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');

    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;
      const err  = document.getElementById('login-error');
      err.classList.add('hidden');
      try {
        App.state = await API.login(user, pass);
        App.showApp();
      } catch(ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    };
  },

  showApp() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('nav-username').textContent = App.state.fullName;
    document.getElementById('nav-role').textContent = UI.roleName(App.state.role);
    document.getElementById('nav-logout').onclick = App.logout;

    const initial = (App.state.fullName || '?').charAt(0).toUpperCase();
    const mobileInitial = document.getElementById('mobile-user-initial');
    if (mobileInitial) mobileInitial.textContent = initial;
    const mobileBtn = document.getElementById('mobile-user-btn');
    if (mobileBtn) mobileBtn.onclick = () => App.navigate('change-password');

    App.buildNav();
    App.navigate('email-agent');
  },

  async logout() {
    await API.logout();
    App.state = null;
    App.showLogin();
  },

  buildNav() {
    const { role } = App.state;
    const navItems = [];

    navItems.push({ id: 'email-agent', icon: '📧', label: 'Posteingang' });

    if (role === 'admin') {
      navItems.push({ id: 'admin-users', icon: '👥', label: 'Benutzer' });
    }

    navItems.push({ id: 'change-password', icon: '🔒', label: 'Passwort ändern' });

    document.getElementById('nav-menu').innerHTML = navItems.map(item => `
      <a data-view="${item.id}" onclick="App.navigate('${item.id}')">
        <span class="icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>`).join('');
  },

  navigate(viewId) {
    document.querySelectorAll('#nav-menu a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === viewId);
    });

    const titles = {
      'email-agent':     'Posteingang',
      'admin-users':     'Benutzer',
      'change-password': 'Passwort ändern',
    };
    const titleEl = document.getElementById('mobile-title');
    if (titleEl) titleEl.textContent = titles[viewId] || 'Email-Agent';

    switch(viewId) {
      case 'email-agent':     EmailAgentView.renderInbox(); break;
      case 'admin-users':     App.renderUsers(); break;
      case 'change-password': App.renderChangePassword(); break;
    }
  },

  renderUsers() {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header"><h2>👥 Benutzer</h2></div><div id="users-content"><p>Wird geladen...</p></div>`;
    API.getUsers().then(users => {
      document.getElementById('users-content').innerHTML = `
        <div class="card">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f5f7ff">
              <th style="padding:8px;text-align:left">Benutzername</th>
              <th style="padding:8px;text-align:left">Name</th>
              <th style="padding:8px;text-align:left">Rolle</th>
              <th style="padding:8px;text-align:left">Status</th>
            </tr></thead>
            <tbody>
              ${users.map(u => `<tr style="border-top:1px solid #eee">
                <td style="padding:8px">${u.username}</td>
                <td style="padding:8px">${u.full_name}</td>
                <td style="padding:8px">${u.role}</td>
                <td style="padding:8px">${u.active ? '✅ Aktiv' : '❌ Inaktiv'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }).catch(e => {
      document.getElementById('users-content').innerHTML = `<p class="text-danger">${e.message}</p>`;
    });
  },

  renderChangePassword() {
    document.getElementById('main-content').innerHTML = `
      <div class="page-header"><h2>🔒 Passwort ändern</h2></div>
      <div class="card" style="max-width:400px">
        <div class="field mb-3">
          <label>Aktuelles Passwort</label>
          <input type="password" id="cp-current">
        </div>
        <div class="field mb-3">
          <label>Neues Passwort (min. 6 Zeichen)</label>
          <input type="password" id="cp-new">
        </div>
        <div class="field mb-3">
          <label>Neues Passwort bestätigen</label>
          <input type="password" id="cp-confirm">
        </div>
        <button class="btn btn-primary" onclick="App.changePassword()">Passwort ändern</button>
      </div>`;
  },

  async changePassword() {
    const cur     = document.getElementById('cp-current').value;
    const newPass = document.getElementById('cp-new').value;
    const confirm = document.getElementById('cp-confirm').value;
    if (newPass !== confirm) { UI.toast('Passwörter stimmen nicht überein','error'); return; }
    if (newPass.length < 6)  { UI.toast('Mindestens 6 Zeichen','error'); return; }
    try {
      await API.changePassword(cur, newPass);
      UI.toast('Passwort geändert','success');
    } catch(e) { UI.toast(e.message,'error'); }
  },
};

// ── Start ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
