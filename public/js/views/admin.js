// ── Admin Views ──────────────────────────────────────────────────────────
const AdminViews = {

  // ── User Management ────────────────────────────────────────────────────
  async renderUsers() {
    const el = document.getElementById('main-content');
    el.innerHTML = `<div class="page-header">
      <h2>👥 Benutzerverwaltung</h2>
      <div class="flex gap-2">
        <button class="btn btn-danger" onclick="AdminViews.deleteInactiveUsers()">🗑 Inaktive löschen</button>
        <button class="btn btn-primary" onclick="AdminViews.openUserModal()">+ Benutzer erstellen</button>
      </div>
    </div><div class="card"><div class="table-wrap"><div id="users-table-body">Lade…</div></div></div>`;
    await AdminViews.loadUsersTable();
  },

  async loadUsersTable() {
    const users = await API.getUsers();
    const el = document.getElementById('users-table-body');
    el.innerHTML = `<table>
      <thead><tr>
        <th>Name</th><th>Benutzername</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
      ${users.map(u => `<tr>
        <td>${UI.esc(u.full_name)}</td>
        <td><code>${UI.esc(u.username)}</code></td>
        <td>${UI.esc(u.email || '–')}</td>
        <td><span class="badge badge-blue">${UI.roleName(u.role)}</span></td>
        <td>${u.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Inaktiv</span>'}</td>
        <td class="text-right">
          <button class="btn btn-ghost btn-sm" onclick="AdminViews.openUserModal(${u.id})">Bearbeiten</button>
          <button class="btn btn-danger btn-sm" onclick="AdminViews.deleteUser(${u.id})">Löschen</button>
        </td>
      </tr>`).join('')}
      </tbody></table>`;
  },

  async openUserModal(userId) {
    let user = null;
    if (userId) user = (await API.getUsers()).find(u => u.id === userId);

    UI.modal(user ? 'Benutzer bearbeiten' : 'Neuer Benutzer',
      `<div class="form-grid">
        <div class="field"><label>Voller Name <span class="req">*</span></label>
          <input type="text" id="u-fullname" value="${UI.esc(user?.full_name||'')}"></div>
        <div class="field"><label>Benutzername <span class="req">*</span></label>
          <input type="text" id="u-username" value="${UI.esc(user?.username||'')}" ${user?'readonly':''}></div>
        <div class="field"><label>E-Mail</label>
          <input type="email" id="u-email" value="${UI.esc(user?.email||'')}"></div>
        <div class="field"><label>Rolle <span class="req">*</span></label>
          <select id="u-role">
            ${['admin','planer','monteur'].map(r => `<option value="${r}" ${user?.role===r?'selected':''}>${UI.roleName(r)}</option>`).join('')}
          </select></div>
        <div class="field span-2"><label>${user ? 'Neues Passwort (leer = unverändert)' : 'Passwort *'}</label>
          <input type="password" id="u-pass" autocomplete="new-password" placeholder="Mindestens 6 Zeichen"></div>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="AdminViews.saveUser(${userId||null})">Speichern</button>`
    );
  },

  async saveUser(userId) {
    const data = {
      full_name: document.getElementById('u-fullname').value.trim(),
      username:  document.getElementById('u-username').value.trim(),
      email:     document.getElementById('u-email').value.trim(),
      role:      document.getElementById('u-role').value,
      password:  document.getElementById('u-pass').value,
    };
    if (!data.full_name || (!userId && !data.username)) { UI.toast('Pflichtfelder ausfüllen', 'error'); return; }
    if (!userId && data.password.length < 6) { UI.toast('Passwort min. 6 Zeichen', 'error'); return; }
    try {
      if (userId) await API.updateUser(userId, data);
      else        await API.createUser(data);
      UI.closeModal();
      UI.toast('Benutzer gespeichert', 'success');
      await AdminViews.loadUsersTable();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async deleteUser(id) {
    if (!await UI.confirm('Benutzer wirklich deaktivieren?')) return;
    try { await API.deleteUser(id); UI.toast('Benutzer deaktiviert', 'success'); await AdminViews.loadUsersTable(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  async deleteInactiveUsers() {
    if (!await UI.confirm('Alle inaktiven Benutzer dauerhaft löschen?')) return;
    try {
      const res = await API.deleteInactiveUsers();
      UI.toast(`${res.deleted} Benutzer gelöscht`, 'success');
      await AdminViews.loadUsersTable();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  // ── Multiselect Settings ────────────────────────────────────────────────
  async renderSettings() {
    const el = document.getElementById('main-content');
    el.innerHTML = `<div class="page-header"><h2>⚙️ Einstellungen</h2></div>
      <div id="settings-tabs" class="flex gap-2 mb-3">
        <button class="btn btn-ghost btn-sm active-tab" onclick="AdminViews.showSettingsTab('options')">Auswahlfelder</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('articles')">Artikel</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('customers')">Kunden</button>
      </div>
      <div id="settings-content"></div>`;
    await AdminViews.showSettingsTab('options');
  },

  async showSettingsTab(tab) {
    document.querySelectorAll('#settings-tabs .btn').forEach(b => b.classList.remove('btn-primary'));
    document.querySelectorAll('#settings-tabs .btn')[['options','articles','customers'].indexOf(tab)]?.classList.add('btn-primary');
    if (tab === 'options')    await AdminViews.renderOptions();
    if (tab === 'articles')   await AdminViews.renderArticles();
    if (tab === 'customers')  await AdminViews.renderCustomers();
  },

  async renderOptions() {
    const fields = {
      arbeit:               'Arbeit (Auftragserfassung)',
      ausgefuehrte_arbeiten:'Ausgeführte Arbeiten',
      zusatz_material:      'Zusätzliches Material',
      halteringe:           'Halteringe',
      schluessel:           'Schlüssel',
    };

    const allOptions = await API.getOptions();

    const html = Object.entries(fields).map(([key, label]) => {
      const opts = allOptions[key] || [];
      return `<div class="card">
        <div class="card-title">${label}
          <button class="btn btn-ghost btn-sm" onclick="AdminViews.addOption('${key}')">+ Hinzufügen</button>
        </div>
        <div id="opts-${key}">
        ${opts.length ? opts.map(o => `
          <div class="flex gap-2 mb-2 align-items-center" id="opt-row-${o.id}">
            <input type="text" value="${UI.esc(o.label)}" id="opt-label-${o.id}" style="flex:1">
            <button class="btn btn-primary btn-sm" onclick="AdminViews.saveOption(${o.id},'${key}')">✓</button>
            <button class="btn btn-danger btn-sm" onclick="AdminViews.removeOption(${o.id},'${key}')">✕</button>
          </div>`).join('') : '<p class="text-muted text-sm">Keine Optionen</p>'}
        </div>
      </div>`;
    }).join('');

    document.getElementById('settings-content').innerHTML = html;
  },

  async addOption(fieldName) {
    const label = prompt('Neue Option:');
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
    try {
      await API.createOption({ field_name: fieldName, option_key: key, option_label: label });
      UI.toast('Option hinzugefügt', 'success');
      await AdminViews.renderOptions();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async saveOption(id, fieldName) {
    const label = document.getElementById(`opt-label-${id}`).value.trim();
    if (!label) return;
    try { await API.updateOption(id, { option_label: label }); UI.toast('Gespeichert', 'success'); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  async removeOption(id, fieldName) {
    if (!await UI.confirm('Option löschen?')) return;
    await API.deleteOption(id);
    await AdminViews.renderOptions();
  },

  // ── Articles ────────────────────────────────────────────────────────────
  async renderArticles() {
    const articles = await API.getArticles();
    document.getElementById('settings-content').innerHTML = `
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="flex:1">Artikel</span>
          <button class="btn btn-ghost btn-sm" onclick="AdminViews.openArticleImport()">📥 Excel Import</button>
          <button class="btn btn-primary btn-sm" onclick="AdminViews.openArticleModal()">+ Artikel</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nr.</th><th>Name</th><th>Beschreibung</th><th>Einheit</th><th></th></tr></thead>
          <tbody id="articles-body">
          ${articles.map(a => `<tr>
            <td><code>${UI.esc(a.article_number||'–')}</code></td>
            <td>${UI.esc(a.name)}</td>
            <td>${UI.esc(a.description||'–')}</td>
            <td>${UI.esc(a.unit)}</td>
            <td class="text-right">
              <button class="btn btn-ghost btn-sm" onclick="AdminViews.openArticleModal(${a.id})">Bearb.</button>
              <button class="btn btn-danger btn-sm" onclick="AdminViews.deleteArticle(${a.id})">✕</button>
            </td>
          </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  },

  openArticleImport() {
    UI.modal('Artikel Excel-Import',
      `<p class="text-muted text-sm mb-3">
        Unterstützte Spalten: <code>Artikel-Code</code>, <code>Artikelname</code>, <code>Einheit</code>, <code>Beschreibung</code><br>
        Bestehende Artikel (gleiche Artikelnummer) werden aktualisiert.
      </p>
      <div class="field">
        <label>Excel-Datei (.xlsx/.xls)</label>
        <input type="file" id="article-import-file" accept=".xlsx,.xls">
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="AdminViews.runArticleImport()">Importieren</button>`
    );
  },

  async runArticleImport() {
    const file = document.getElementById('article-import-file')?.files[0];
    if (!file) { UI.toast('Bitte Datei wählen', 'error'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      UI.closeModal();
      const result = await API.importArticles(form);
      UI.toast(`${result.imported} Artikel importiert${result.skipped ? `, ${result.skipped} übersprungen` : ''}`, 'success', 5000);
      await AdminViews.showSettingsTab('articles');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async openArticleModal(id) {
    let a = null;
    if (id) a = (await API.getArticles()).find(x => x.id === id);
    UI.modal(a ? 'Artikel bearbeiten' : 'Neuer Artikel',
      `<div class="form-grid">
        <div class="field"><label>Artikelnummer</label><input type="text" id="a-nr" value="${UI.esc(a?.article_number||'')}"></div>
        <div class="field"><label>Name <span class="req">*</span></label><input type="text" id="a-name" value="${UI.esc(a?.name||'')}"></div>
        <div class="field span-2"><label>Beschreibung</label><input type="text" id="a-desc" value="${UI.esc(a?.description||'')}"></div>
        <div class="field"><label>Einheit</label><input type="text" id="a-unit" value="${UI.esc(a?.unit||'Stk.')}"></div>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="AdminViews.saveArticle(${id||null})">Speichern</button>`
    );
  },

  async saveArticle(id) {
    const d = {
      article_number: document.getElementById('a-nr').value.trim(),
      name:           document.getElementById('a-name').value.trim(),
      description:    document.getElementById('a-desc').value.trim(),
      unit:           document.getElementById('a-unit').value.trim() || 'Stk.',
    };
    if (!d.name) { UI.toast('Name erforderlich', 'error'); return; }
    try {
      if (id) await API.updateArticle(id, d); else await API.createArticle(d);
      UI.closeModal(); UI.toast('Artikel gespeichert', 'success');
      await AdminViews.showSettingsTab('articles');
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async deleteArticle(id) {
    if (!await UI.confirm('Artikel löschen?')) return;
    await API.deleteArticle(id); await AdminViews.showSettingsTab('articles');
  },

  // ── Customers ────────────────────────────────────────────────────────────
  async renderCustomers() {
    const customers = await API.getCustomers();
    document.getElementById('settings-content').innerHTML = `
      <div class="card">
        <div class="card-title">Kunden
          <button class="btn btn-primary btn-sm" onclick="AdminViews.openCustomerModal()">+ Kunde</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Adresse</th><th>Kontakt</th><th>Tel</th><th></th></tr></thead>
          <tbody>
          ${customers.map(c => `<tr>
            <td>${UI.esc(c.name)}</td>
            <td>${UI.esc(c.address||'–')}</td>
            <td>${UI.esc(c.contact_name||'–')}</td>
            <td>${UI.esc(c.contact_phone||'–')}</td>
            <td class="text-right">
              <button class="btn btn-ghost btn-sm" onclick="AdminViews.openCustomerModal(${c.id})">Bearb.</button>
            </td>
          </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  },

  async openCustomerModal(id) {
    let c = null;
    if (id) c = (await API.getCustomers()).find(x => x.id === id);
    UI.modal(c ? 'Kunde bearbeiten' : 'Neuer Kunde',
      `<div class="form-grid">
        <div class="field span-2"><label>Kundenname <span class="req">*</span></label><input type="text" id="c-name" value="${UI.esc(c?.name||'')}"></div>
        <div class="field span-2"><label>Adresse</label><input type="text" id="c-addr" value="${UI.esc(c?.address||'')}"></div>
        <div class="field"><label>Kontaktperson</label><input type="text" id="c-contact" value="${UI.esc(c?.contact_name||'')}"></div>
        <div class="field"><label>Telefon</label><input type="text" id="c-phone" value="${UI.esc(c?.contact_phone||'')}"></div>
        <div class="field span-2"><label>E-Mail</label><input type="email" id="c-email" value="${UI.esc(c?.contact_email||'')}"></div>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="AdminViews.saveCustomer(${id||null})">Speichern</button>`
    );
  },

  async saveCustomer(id) {
    const d = {
      name:         document.getElementById('c-name').value.trim(),
      address:      document.getElementById('c-addr').value.trim(),
      contact_name: document.getElementById('c-contact').value.trim(),
      contact_phone:document.getElementById('c-phone').value.trim(),
      contact_email:document.getElementById('c-email').value.trim(),
    };
    if (!d.name) { UI.toast('Name erforderlich', 'error'); return; }
    try {
      if (id) await API.updateCustomer(id, d); else await API.createCustomer(d);
      UI.closeModal(); UI.toast('Kunde gespeichert', 'success');
      await AdminViews.showSettingsTab('customers');
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
