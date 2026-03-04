// ── App: Router + Auth State ─────────────────────────────────────────────
const App = {
  state: null, // { id, username, fullName, role, email }

  async init() {
    // Try to restore session
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

    // Mobile header user initial + avatar button
    const initial = (App.state.fullName || '?').charAt(0).toUpperCase();
    const mobileInitial = document.getElementById('mobile-user-initial');
    if (mobileInitial) mobileInitial.textContent = initial;
    const mobileBtn = document.getElementById('mobile-user-btn');
    if (mobileBtn) mobileBtn.onclick = () => App.navigate('change-password');

    App.buildNav();
    App.navigate(App.defaultView());
  },

  async logout() {
    await API.logout();
    App.state = null;
    App.showLogin();
  },

  defaultView() {
    switch(App.state.role) {
      case 'admin':   return 'admin-orders';
      case 'planer':  return 'planer-orders';
      case 'monteur': return 'monteur-orders';
    }
  },

  buildNav() {
    const { role } = App.state;
    const navItems = [];

    if (role === 'monteur') {
      navItems.push({ id: 'monteur-orders', icon: '📅', label: 'Meine Aufträge' });
    }

    if (role === 'planer' || role === 'admin') {
      navItems.push({ id: 'planer-orders',   icon: '📋', label: 'Aufträge' });
      navItems.push({ id: 'planer-anfragen', icon: '📩', label: 'Kundenanfragen' });
    }

    if (role === 'admin') {
      navItems.push(
        { id: 'admin-orders',  icon: '📋', label: 'Alle Aufträge' },
        { id: 'admin-users',   icon: '👥', label: 'Benutzer' },
        { id: 'admin-settings',icon: '⚙️',  label: 'Einstellungen' },
      );
    }

    navItems.push({ id: 'change-password', icon: '🔒', label: 'Passwort ändern' });

    document.getElementById('nav-menu').innerHTML = navItems.map(item => `
      <a data-view="${item.id}" onclick="App.navigate('${item.id}')">
        <span class="icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>`).join('');
  },

  navigate(viewId) {
    // Update active nav link
    document.querySelectorAll('#nav-menu a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === viewId);
    });

    // Update mobile header title
    const titles = {
      'monteur-orders':   'Meine Aufträge',
      'planer-orders':    'Aufträge',
      'planer-anfragen':  'Kundenanfragen',
      'admin-orders':     'Alle Aufträge',
      'admin-users':      'Benutzer',
      'admin-settings':   'Einstellungen',
      'change-password':  'Passwort ändern',
    };
    const titleEl = document.getElementById('mobile-title');
    if (titleEl) titleEl.textContent = titles[viewId] || 'Rapporte';

    switch(viewId) {
      case 'monteur-orders':   MonteurViews.renderMyOrders(); break;
      case 'planer-orders':    PlanerViews.renderOrders(); break;
      case 'planer-anfragen':  PlanerViews.renderAnfragen(); break;
      case 'admin-orders':     PlanerViews.renderOrders(); break;
      case 'admin-users':      AdminViews.renderUsers(); break;
      case 'admin-settings':   AdminViews.renderSettings(); break;
      case 'change-password':  App.renderChangePassword(); break;
    }
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
