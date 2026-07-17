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
      <div id="settings-tabs" class="flex gap-2 mb-3 flex-wrap">
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('orders')">📋 Aufträge</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('options')">Auswahlfelder</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('articles')">Artikel</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('customers')">Kunden</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('portal')">Kundenportal</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('email')">✉️ E-Mail</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('prompt')">🤖 KI-Prompt</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('cleanup')">🗑️ Dateien</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('backup')">💾 Backup</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('database')">🗄️ Datenbank</button>
      </div>
      <div id="settings-content"></div>`;
    await AdminViews.showSettingsTab('options');
  },

  async showSettingsTab(tab) {
    const tabs = ['orders','options','articles','customers','portal','email','prompt','cleanup','backup','database'];
    document.querySelectorAll('#settings-tabs .btn').forEach(b => b.classList.remove('btn-primary'));
    document.querySelectorAll('#settings-tabs .btn')[tabs.indexOf(tab)]?.classList.add('btn-primary');
    if (tab === 'orders')       await AdminViews.renderOrderTools();
    if (tab === 'options')      await AdminViews.renderOptions();
    if (tab === 'articles')     await AdminViews.renderArticles();
    if (tab === 'customers')    await AdminViews.renderCustomers();
    if (tab === 'portal')       await AdminViews.renderPortalUsers();
    if (tab === 'email')        await AdminViews.renderEmailSettings();
    if (tab === 'prompt')       await AdminViews.renderPromptAssistant();
    if (tab === 'cleanup')      await AdminViews.renderFileCleanup();
    if (tab === 'backup')       await AdminViews.renderBackup();
    if (tab === 'database')     await AdminViews.renderDbViewer();
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
              <button class="btn btn-ghost btn-sm" onclick="AdminViews.openCustomerOrderImport(${c.id})">Excel-Aufträge</button>
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

  async openCustomerOrderImport(customerId) {
    const customer = (await API.getCustomers()).find(item => item.id === customerId);
    if (!customer) return;
    UI.modal(`Excel-Aufträge für ${UI.esc(customer.name)}`, `
      <p class="text-muted text-sm mb-3">Die erste Tabelle wird eingelesen. Erkannte Spalten sind beispielsweise Projekt/Anlage, Objekt, Montageadresse oder Strasse/PLZ/Ort, Kontakt, Telefon, Termin, Zeitfenster und Bemerkungen.</p>
      <div class="field"><label>Excel-Datei (.xlsx oder .xls)</label><input type="file" id="customer-order-excel" accept=".xlsx,.xls"></div>
      <p class="text-muted text-sm mt-2">Vor dem Anlegen erscheint immer eine Vorschau. Bereits vorhandene Projekte oder identische Montageadressen werden als Duplikat markiert.</p>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="AdminViews.previewCustomerOrderImport(${customerId})">Vorschau laden</button>`);
  },

  async previewCustomerOrderImport(customerId) {
    const file = document.getElementById('customer-order-excel')?.files[0];
    if (!file) { UI.toast('Bitte Excel-Datei auswählen', 'error'); return; }
    const form = new FormData(); form.append('file', file);
    try {
      const result = await API.previewCustomerOrderImport(customerId, form);
      AdminViews._customerImportRows = result.rows;
      UI.closeModal();
      const selectedCount = result.rows.filter(row => !row.duplicate).length;
      UI.modal(`Importvorschau · ${UI.esc(result.customer.name)}`, `
        <p class="text-muted text-sm mb-3">Tabelle: ${UI.esc(result.sheet)} · ${result.rows.length} Zeilen erkannt. Unvollständige Aufträge können importiert und später im Portal ergänzt werden.</p>
        <div class="table-wrap" style="max-height:55vh"><table><thead><tr><th></th><th>Zeile</th><th>Projekt/Anlage</th><th>Objekt</th><th>Montageadresse</th><th>Kontakt</th><th>Termin</th><th>Hinweis</th></tr></thead>
          <tbody>${result.rows.map((row, index) => `<tr style="${row.duplicate ? 'opacity:.55' : ''}">
            <td><input type="checkbox" class="customer-import-check" value="${index}" ${row.duplicate ? 'disabled' : 'checked'}></td>
            <td>${row.row_number}</td><td>${UI.esc(row.project_number||'–')}</td><td>${UI.esc(row.object_name||'–')}</td>
            <td>${UI.esc(row.installation_address||'–')}</td><td>${UI.esc(row.contact_name||'–')}${row.contact_phone ? `<div class="text-muted text-sm">${UI.esc(row.contact_phone)}</div>` : ''}</td>
            <td>${UI.fmtDate(row.planned_date)}</td><td>${row.duplicate ? '<span class="badge badge-gray">Duplikat</span>' : (row.warnings.length ? `<span class="badge badge-blue">Fehlt: ${UI.esc(row.warnings.join(', '))}</span>` : '<span class="badge badge-green">Bereit</span>')}</td>
          </tr>`).join('')}</tbody></table></div>`,
        `<button class="btn btn-ghost" onclick="UI.closeModal();AdminViews.openCustomerOrderImport(${customerId})">Andere Datei</button><button class="btn btn-primary" onclick="AdminViews.confirmCustomerOrderImport(${customerId})">${selectedCount} Aufträge anlegen</button>`);
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async confirmCustomerOrderImport(customerId) {
    const indexes = [...document.querySelectorAll('.customer-import-check:checked')].map(input => Number(input.value));
    const rows = indexes.map(index => AdminViews._customerImportRows[index]);
    if (!rows.length) { UI.toast('Keine Aufträge ausgewählt', 'error'); return; }
    try {
      const result = await API.confirmCustomerOrderImport(customerId, rows);
      UI.closeModal();
      UI.toast(`${result.imported} Aufträge angelegt${result.skipped_duplicates ? `, ${result.skipped_duplicates} Duplikate übersprungen` : ''}`, 'success', 6000);
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async renderPortalUsers() {
    const [users, customers] = await Promise.all([API.getPortalUsers(), API.getCustomers()]);
    document.getElementById('settings-content').innerHTML = `
      <div class="card">
        <div class="card-title">Kundenportal-Zugänge
          <button class="btn btn-primary btn-sm" onclick="AdminViews.openPortalUserModal()">+ Zugang erstellen</button>
        </div>
        <p class="text-muted text-sm mb-3">Jeder Zugang ist genau einem Kunden zugeordnet. Die E-Mail-Adresse ist der Login; das Einmalpasswort wird automatisch per E-Mail versendet.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Kunde</th><th>Name</th><th>Login-E-Mail</th><th>Telefon</th><th>Status</th><th></th></tr></thead>
          <tbody>${users.map(u => `<tr>
            <td>${UI.esc(u.customer_name)}</td><td>${UI.esc(u.full_name)}</td><td>${UI.esc(u.email)}</td>
            <td>${UI.esc(u.phone)}</td>
            <td>${u.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Inaktiv</span>'}${u.must_change_password ? ' <span class="badge badge-blue">Passwortwechsel offen</span>' : ''}</td>
            <td class="text-right"><button class="btn btn-ghost btn-sm" onclick="AdminViews.togglePortalUser(${u.id},${u.active ? 'false' : 'true'})">${u.active ? 'Deaktivieren' : 'Aktivieren'}</button>
              <button class="btn btn-ghost btn-sm" onclick="AdminViews.resetPortalUser(${u.id})">Passwort zurücksetzen</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    AdminViews._portalCustomers = customers;
    AdminViews._portalUsers = users;
  },

  openPortalUserModal() {
    const customers = AdminViews._portalCustomers || [];
    UI.modal('Kundenportal-Zugang erstellen', `<div class="form-grid">
      <div class="field span-2"><label>Kunde <span class="req">*</span></label><select id="pu-customer"><option value="">Bitte wählen</option>${customers.map(c => `<option value="${c.id}">${UI.esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Vollständiger Name <span class="req">*</span></label><input id="pu-name"></div>
      <div class="field"><label>E-Mail <span class="req">*</span></label><input id="pu-email" type="email"></div>
      <div class="field"><label>Telefon <span class="req">*</span></label><input id="pu-phone" type="tel"></div>
    </div>`, `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="AdminViews.createPortalUser()">Zugang erstellen</button>`);
  },

  async createPortalUser() {
    const data = { customer_id: Number(document.getElementById('pu-customer').value), full_name: document.getElementById('pu-name').value.trim(), email: document.getElementById('pu-email').value.trim(), phone: document.getElementById('pu-phone').value.trim() };
    try { const result = await API.createPortalUser(data); UI.closeModal(); AdminViews.showPortalEmailSent(result, 'Zugang erstellt'); await AdminViews.renderPortalUsers(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  async togglePortalUser(id, active) {
    const user = (AdminViews._portalUsers || []).find(u => u.id === id);
    if (!user) return;
    try { await API.updatePortalUser(id, { active, full_name: user.full_name, email: user.email, phone: user.phone }); await AdminViews.renderPortalUsers(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  async resetPortalUser(id) {
    if (!await UI.confirm('Passwort wirklich zurücksetzen?')) return;
    try { const result = await API.resetPortalPassword(id); AdminViews.showPortalEmailSent(result, 'Passwort zurückgesetzt'); await AdminViews.renderPortalUsers(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  showPortalEmailSent(result, title) {
    UI.modal(title, `<p>Das Einmalpasswort wurde direkt an <strong>${UI.esc(result.email)}</strong> gesendet.</p><p class="text-muted text-sm">Die E-Mail-Adresse ist der Login. Beim ersten Anmelden muss der Kunde ein eigenes Passwort setzen.</p>`, `<button class="btn btn-primary" onclick="UI.closeModal()">Schliessen</button>`);
  },

  // ── E-Mail / SMTP Einstellungen ──────────────────────────────────────────
  async renderEmailSettings() {
    let cfg = {};
    try { cfg = await API.getSmtp(); } catch(e) {}

    document.getElementById('settings-content').innerHTML = `
      <div class="card">
        <div class="card-title">✉️ Outlook / SMTP Einstellungen</div>
        <p class="text-muted text-sm mb-3">
          Für Microsoft 365 / Outlook: Host <code>smtp.office365.com</code>, Port <code>587</code>.<br>
          Passwort wird verschlüsselt gespeichert. Beim Speichern ohne neues Passwort bleibt das bisherige erhalten.
        </p>
        <div class="form-grid">
          <div class="field">
            <label>SMTP Host</label>
            <input type="text" id="smtp-host" value="${UI.esc(cfg.host||'smtp.office365.com')}" placeholder="smtp.office365.com">
          </div>
          <div class="field">
            <label>Port</label>
            <input type="number" id="smtp-port" value="${UI.esc(String(cfg.port||'587'))}" placeholder="587">
          </div>
          <div class="field">
            <label>Benutzername (E-Mail-Adresse)</label>
            <input type="email" id="smtp-user" value="${UI.esc(cfg.user||'')}" placeholder="name@firma.ch">
          </div>
          <div class="field">
            <label>Passwort ${cfg.pass ? '(gespeichert – leer lassen zum Behalten)' : ''}</label>
            <input type="password" id="smtp-pass" placeholder="${cfg.pass ? '••••••••' : 'Passwort eingeben'}" autocomplete="new-password">
          </div>
          <div class="field span-2">
            <label>Absender-Adresse (From) – optional, Standard = Benutzername</label>
            <input type="email" id="smtp-from" value="${UI.esc(cfg.from||'')}" placeholder="rapporte@firma.ch">
          </div>
          <div class="field span-2">
            <label>Empfänger Abschlussrapporte</label>
            <input type="text" id="smtp-completion-to" value="${UI.esc(cfg.completion_to||'')}" placeholder="rapporte@firma.ch (mehrere mit Semikolon)">
          </div>
          <div class="field span-2">
            <label>CC – optional</label>
            <input type="text" id="smtp-completion-cc" value="${UI.esc(cfg.completion_cc||'')}" placeholder="cc@firma.ch">
          </div>
          <div class="field span-2">
            <label>Antwortadresse – optional</label>
            <input type="email" id="smtp-reply-to" value="${UI.esc(cfg.reply_to||'')}" placeholder="antwort@firma.ch">
          </div>
        </div>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-primary" onclick="AdminViews.saveSmtpSettings()">Speichern</button>
        </div>
      </div>`;
  },

  async saveSmtpSettings() {
    const d = {
      host: document.getElementById('smtp-host').value.trim(),
      port: document.getElementById('smtp-port').value.trim(),
      user: document.getElementById('smtp-user').value.trim(),
      pass: document.getElementById('smtp-pass').value,
      from: document.getElementById('smtp-from').value.trim(),
      completion_to: document.getElementById('smtp-completion-to').value.trim(),
      completion_cc: document.getElementById('smtp-completion-cc').value.trim(),
      reply_to: document.getElementById('smtp-reply-to').value.trim(),
    };
    try {
      await API.saveSmtp(d);
      UI.toast('SMTP-Einstellungen gespeichert', 'success');
      await AdminViews.renderEmailSettings();
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  // ── Lieferschein Auto-Import ─────────────────────────────────────────────
  async renderLieferscheinImport() {
    const el = document.getElementById('settings-content');
    el.innerHTML = '<p class="text-muted text-sm">Lade…</p>';

    let status = { inbox_files: [] };
    let imports = [];
    let monteure = [];
    let importDefaults = { default_monteur_id: null };
    const results = await Promise.allSettled([
      API.getLsStatus(), API.getLsImports(), API.getMonteure(), API.getImportDefaults()
    ]);
    if (results[0].status === 'fulfilled') status = results[0].value;
    if (results[1].status === 'fulfilled') imports = results[1].value;
    if (results[2].status === 'fulfilled') monteure = results[2].value;
    if (results[3].status === 'fulfilled') importDefaults = results[3].value;

    const importRows = imports.length ? imports.map(i => {
      const statusMap = { success: 'badge-green', error: 'badge-red', processing: 'badge-blue', pending: 'badge-gray' };
      const statusLabel = { success: 'Erfolgreich', error: 'Fehler', processing: 'Verarbeitung…', pending: 'Ausstehend' };
      return `<tr>
        <td style="font-size:0.8rem">${UI.esc(i.original_name)}</td>
        <td><span class="badge ${statusMap[i.status]||'badge-gray'}">${statusLabel[i.status]||i.status}</span></td>
        <td>${UI.esc(i.lieferschein_nr||'–')}</td>
        <td>${UI.esc(i.kunde||'–')}</td>
        <td>${UI.esc(i.projekt_nr||'–')}</td>
        <td>${i.articles_imported||0}</td>
        <td>${i.order_number ? `<a href="#" onclick="App.navigateTo('orders');return false">${UI.esc(i.order_number)}</a>` : '–'}</td>
        <td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${UI.esc(i.error_message||'')}">
          ${i.error_message ? `<span style="color:#dc2626">${UI.esc(i.error_message.substring(0,80))}</span>` : '–'}
        </td>
        <td style="font-size:0.75rem">${(i.created_at||'').substring(0,16).replace('T',' ')}</td>
        <td class="text-right" style="white-space:nowrap">
          ${i.status === 'error' ? `<button class="btn btn-ghost btn-sm" onclick="AdminViews.retryLsImport(${i.id})">↺ Retry</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="AdminViews.deleteLsImport(${i.id})">✕</button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="10" class="text-muted text-sm text-center">Noch keine Importe</td></tr>';

    const monteurOptions = monteure.map(m =>
      `<option value="${m.id}" ${importDefaults.default_monteur_id === m.id ? 'selected' : ''}>${UI.esc(m.full_name)}</option>`
    ).join('');

    el.innerHTML = `
      <div class="card">
        <div class="card-title">⚙️ Import-Einstellungen</div>
        <div class="form-grid" style="max-width:400px">
          <div class="field">
            <label>Standard-Monteur Zuweisung</label>
            <select id="import-default-monteur">
              <option value="">– Kein Standard –</option>
              ${monteurOptions}
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm mt-2" onclick="AdminViews.saveImportDefaults()">Speichern</button>
      </div>
      <div class="card">
        <div class="card-title">📥 Lieferscheine importieren</div>
        <div class="ls-drop-zone mt-2" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');AdminViews.uploadLieferschein({files:event.dataTransfer.files,value:''})">
          <div>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">
              📂 PDFs auswählen oder hierher ziehen
              <input type="file" accept=".pdf" multiple style="display:none" onchange="AdminViews.uploadLieferschein(this)">
            </label>
          </div>
          <span class="text-sm text-muted">Mehrere Lieferscheine gleichzeitig möglich</span>
        </div>
        <div class="flex gap-2 mt-2 flex-wrap">
          <button class="btn btn-ghost btn-sm" onclick="AdminViews.renderLieferscheinImport()">↺ Aktualisieren</button>
        </div>
        ${(status.inbox_files||[]).length ? `
          <p class="text-sm mt-2"><strong>Inbox (${status.inbox_files.length} PDF${status.inbox_files.length>1?'s':''} ausstehend):</strong></p>
          <ul class="text-sm text-muted" style="margin:4px 0 0 16px">
            ${status.inbox_files.map(f => `<li>${UI.esc(f.name)}</li>`).join('')}
          </ul>` : ''}
      </div>
      <div class="card">
        <div class="card-title">Import-Verlauf</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Datei</th><th>Status</th><th>LS-Nr.</th><th>Kunde</th>
              <th>Projekt-Nr.</th><th>Artikel</th><th>Auftrag</th><th>Fehler</th><th>Datum</th><th></th>
            </tr></thead>
            <tbody>${importRows}</tbody>
          </table>
        </div>
      </div>`;
  },

  async saveImportDefaults() {
    const val = document.getElementById('import-default-monteur')?.value;
    try {
      await API.saveImportDefaults({ default_monteur_id: val ? parseInt(val) : null });
      UI.toast('Import-Einstellungen gespeichert', 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async uploadLieferschein(input) {
    const files = [...input.files];
    if (!files.length) return;
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    try {
      UI.toast('PDF wird analysiert…', 'info', 3000);
      const result = await API.uploadLieferschein(form);
      AdminViews.showLsPreviews(result.previews || []);
      UI.toast('Analyse abgeschlossen – bitte Angaben kontrollieren', 'success', 4000);
    } catch (e) { UI.toast(e.message, 'error'); }
    input.value = '';
  },

  lsArticleRow(previewId, article = {}) {
    return `<tr>
      <td><input data-article-field="artikel_nr" type="text" value="${UI.esc(article.artikel_nr || '')}" aria-label="Artikelnummer"></td>
      <td><input data-article-field="beschreibung" type="text" value="${UI.esc(article.beschreibung || '')}" aria-label="Beschreibung"></td>
      <td><input data-article-field="menge" type="number" min="0.01" step="0.01" value="${Number(article.menge) || 1}" aria-label="Menge"></td>
      <td><input data-article-field="einheit" type="text" value="${UI.esc(article.einheit || 'Stk.')}" aria-label="Einheit"></td>
      <td class="text-center"><input data-article-field="ist_schluessebox_montage" type="checkbox" ${article.ist_schluessebox_montage ? 'checked' : ''} aria-label="Montage"></td>
      <td><input data-article-field="durchmesser" type="text" value="${UI.esc(article.durchmesser || '')}" aria-label="Durchmesser"></td>
      <td class="text-center"><input data-article-field="ist_fremdfabrikat" type="checkbox" ${article.ist_fremdfabrikat ? 'checked' : ''} aria-label="Fremdfabrikat"></td>
      <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()" aria-label="Artikel entfernen">✕</button></td>
    </tr>`;
  },

  addLsArticle(previewId) {
    document.querySelector(`#ls-preview-${previewId} tbody[data-ls-articles]`)
      ?.insertAdjacentHTML('beforeend', AdminViews.lsArticleRow(previewId));
  },

  showLsPreviews(previews) {
    const rows = previews.map(p => {
      const d = p.data || {};
      const customer = d.kunde || {};
      const field = (name, label, value, type = 'text') => `<div class="field">
        <label>${label}</label>
        <input type="${type}" data-ls-field="${name}" value="${UI.esc(value || '')}">
      </div>`;
      const warning = p.duplicate ? `<div style="color:#b45309;font-weight:600">⚠ Bereits vorhanden: ${UI.esc(p.duplicate.order_number || 'Auftrag')}</div>` : '';
      return `<div class="card" id="ls-preview-${p.id}" style="margin-bottom:10px">
        <div class="mb-2"><strong>${UI.esc(p.original_name)}</strong>${warning}</div>
        <div class="ls-preview-grid">
          <div class="ls-pdf-preview">
            <iframe src="/api/lieferschein/preview/${p.id}" title="PDF-Vorschau ${UI.esc(p.original_name)}"></iframe>
          </div>
          <div class="ls-preview-fields">
            <div class="card-title">Erkannte Angaben direkt korrigieren</div>
            <div class="form-grid">
              ${field('lieferschein_nr', 'Lieferschein-Nr.', d.lieferschein_nr)}
              ${field('projekt_nr', 'Projekt-Nr.', d.projekt_nr)}
              ${field('montagetermin', 'Montagetermin', d.montagetermin, 'date')}
              ${field('bestell_nr', 'Bestell-Nr.', d.bestell_nr)}
              ${field('iz', 'Besteller / IZ', d.iz)}
              ${field('uz', 'Unser Zeichen / UZ', d.uz)}
            </div>
            <div class="card-title mt-3">Kunde</div>
            <div class="form-grid">
              ${field('kunde.name', 'Firma / Kunde', customer.name)}
              ${field('kunde.kunden_nr', 'Kunden-Nr.', customer.kunden_nr)}
              ${field('kunde.strasse', 'Strasse', customer.strasse)}
              ${field('kunde.plz', 'PLZ', customer.plz)}
              ${field('kunde.ort', 'Ort', customer.ort)}
              ${field('kunde.land', 'Land', customer.land)}
              ${field('kunde.kontakt', 'Kontakt beim Kunden', customer.kontakt)}
            </div>
            <div class="card-title mt-3">Montageort</div>
            <div class="form-grid">
              ${field('montage_objekt', 'Objekt', d.montage_objekt)}
              ${field('montage_strasse', 'Strasse', d.montage_strasse)}
              ${field('montage_plz', 'PLZ', d.montage_plz)}
              ${field('montage_ort', 'Ort', d.montage_ort)}
              ${field('kontaktperson_vor_ort', 'Kontakt vor Ort', d.kontaktperson_vor_ort)}
              ${field('kontaktperson_vor_ort_telefon', 'Telefon vor Ort', d.kontaktperson_vor_ort_telefon, 'tel')}
            </div>
          </div>
        </div>
        <div class="card-title mt-3">Artikel und Arbeiten</div>
        <div class="table-wrap ls-article-editor"><table>
          <thead><tr><th>Art.-Nr.</th><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Montage</th><th>Ø</th><th>Fremd</th><th></th></tr></thead>
          <tbody data-ls-articles>${(d.artikel || []).map(a => AdminViews.lsArticleRow(p.id, a)).join('')}</tbody>
        </table></div>
        <button type="button" class="btn btn-ghost btn-sm mt-2" onclick="AdminViews.addLsArticle(${p.id})">+ Artikelzeile</button>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-primary" onclick="AdminViews.confirmLs(${p.id},false)">Geprüfte Angaben übernehmen</button>
          ${p.duplicate ? `<button class="btn btn-danger" onclick="AdminViews.confirmLs(${p.id},true)">Als Duplikat trotzdem übernehmen</button>` : ''}
        </div>
      </div>`;
    }).join('');
    UI.modal('Lieferscheine prüfen und freigeben', `<div>${rows}</div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal();AdminViews.renderLieferscheinImport()">Schliessen</button>`);
    document.querySelector('#active-modal .modal')?.classList.add('modal-wide');
  },

  async renderOrderTools() {
    document.getElementById('settings-content').innerHTML = `
      <div class="card">
        <div class="card-title">Auftragsdaten</div>
        <p class="text-muted text-sm mb-3">Vorlagen, Excel-Datenaustausch und die optionalen Spalten der Auftragsliste.</p>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-ghost" onclick="window.location='/api/orders/import-template'">📄 Vorlage herunterladen</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openImport()">📥 Excel importieren</button>
          <button class="btn btn-ghost" onclick="window.location='/api/orders/export'">📤 Excel exportieren</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openColSettings()">📊 Optionale Spalten</button>
        </div>
      </div>`;
  },

  async confirmLs(id, allowDuplicate) {
    const card = document.getElementById(`ls-preview-${id}`);
    if (!card) return;
    const data = { kunde: {}, artikel: [] };
    card.querySelectorAll('[data-ls-field]').forEach(input => {
      const parts = input.dataset.lsField.split('.');
      if (parts[0] === 'kunde') data.kunde[parts[1]] = input.value.trim();
      else data[parts[0]] = input.value.trim();
    });
    card.querySelectorAll('tbody[data-ls-articles] tr').forEach(row => {
      const article = {};
      row.querySelectorAll('[data-article-field]').forEach(input => {
        const key = input.dataset.articleField;
        article[key] = input.type === 'checkbox' ? input.checked : input.value.trim();
      });
      data.artikel.push(article);
    });
    try {
      const result = await API.confirmLsImport(id, allowDuplicate, data);
      document.getElementById(`ls-preview-${id}`)?.remove();
      UI.toast(`Auftrag ${result.orderNumber} erstellt`, 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async retryLsImport(id) {
    try {
      UI.toast('Retry gestartet…', 'info', 2000);
      await API.retryLsImport(id);
      UI.toast('Erneuter Versuch gestartet', 'success');
      setTimeout(() => AdminViews.renderLieferscheinImport(), 2000);
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async deleteLsImport(id) {
    if (!await UI.confirm('Import-Eintrag löschen?')) return;
    try { await API.deleteLsImport(id); await AdminViews.renderLieferscheinImport(); }
    catch(e) { UI.toast(e.message, 'error'); }
  },

  // ── KI-Prompt-Assistent ─────────────────────────────────────────────────
  // ── Drive Status & Diagnostics ──────────────────────────────────────────
  async renderDriveStatus() {
    const el = document.getElementById('settings-content');
    el.innerHTML = `<div class="card"><p class="text-muted">Lade Drive-Status…</p></div>`;
    let status;
    try { status = await API.get('/api/settings/drive-status'); }
    catch(e) { el.innerHTML = `<div class="card" style="color:red">${UI.esc(e.message)}</div>`; return; }

    const pendingTotal = (status.pending_uploads?.attachments || 0) + (status.pending_uploads?.photos || 0);
    el.innerHTML = `
      <div class="card">
        <h3 style="margin-bottom:16px">☁️ Google Drive – Anhänge & Fotos</h3>
        <div class="form-grid">
          <div>
            <p class="text-sm text-muted mb-1">Status</p>
            <p style="font-weight:600;color:${status.enabled ? '#2d7a2d' : '#c00'}">
              ${status.enabled ? '✅ Konfiguriert' : '❌ Nicht konfiguriert'}
            </p>
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Root-Ordner</p>
            <p style="font-family:monospace;font-size:12px">${UI.esc(status.rootFolderId || '–')}</p>
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Meldung</p>
            <p>${UI.esc(status.message || '')}</p>
          </div>
          ${status.pending_uploads ? `
          <div>
            <p class="text-sm text-muted mb-1">Ausstehende Uploads</p>
            <p style="font-weight:600;color:${pendingTotal > 0 ? '#c67a00' : '#2d7a2d'}">
              ${status.pending_uploads.attachments} Anhänge, ${status.pending_uploads.photos} Fotos
              ${pendingTotal > 0 ? '(nicht hochgeladen)' : '(alle hochgeladen ✅)'}
            </p>
          </div>` : ''}
        </div>
        ${pendingTotal > 0 ? `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <p class="text-sm text-muted mb-2">
            ${pendingTotal} Datei(en) wurden noch nicht zu Google Drive hochgeladen.
            Dies kann passieren, wenn der Upload im Hintergrund fehlgeschlagen ist.
            Klicke unten, um fehlgeschlagene Uploads erneut zu versuchen.
          </p>
          <button class="btn btn-primary" id="drive-retry-btn" onclick="AdminViews.retryDriveUploads()">
            🔄 Fehlgeschlagene Uploads wiederholen (${pendingTotal})
          </button>
          <div id="drive-retry-result" style="margin-top:8px"></div>
        </div>` : ''}
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <p class="text-sm text-muted">
            <strong>Wie funktioniert der Drive-Upload?</strong><br>
            Wenn Anhänge oder Fotos hochgeladen werden, werden sie zuerst lokal gespeichert und
            dann asynchron zu Google Drive hochgeladen. Der Ordner wird automatisch erstellt.
            Wenn Fehler auftreten, sind die Dateien weiterhin lokal verfügbar.
          </p>
        </div>
      </div>`;
  },

  async retryDriveUploads() {
    const btn = document.getElementById('drive-retry-btn');
    const result = document.getElementById('drive-retry-result');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Wird versucht…'; }
    try {
      const res = await API.post('/api/settings/drive-retry', {});
      if (result) result.innerHTML = `<span style="color:${res.fail ? '#c67a00' : '#2d7a2d'}">
        ✓ ${res.ok} erfolgreich hochgeladen, ${res.fail} fehlgeschlagen (von ${res.total} gesamt)
      </span>`;
      if (res.ok > 0) AdminViews.renderDriveStatus();
    } catch(e) {
      if (result) result.innerHTML = `<span style="color:red">${UI.esc(e.message)}</span>`;
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Fehlgeschlagene Uploads wiederholen'; }
  },

  _promptChatHistory: [],

  async renderPromptAssistant() {
    const el = document.getElementById('settings-content');
    const { prompt } = await API.getExtractionPrompt();
    AdminViews._currentPrompt = prompt;
    AdminViews._promptChatHistory = [];

    el.innerHTML = `
      <div class="card" style="max-width:860px">
        <div class="card-title">🤖 KI-Extraktions-Prompt</div>
        <p class="text-muted text-sm mb-2">
          Dieser Prompt wird an Claude gesendet, wenn ein Lieferschein-PDF verarbeitet wird.
          Chatte mit dem Assistenten, um den Prompt anzupassen – oder bearbeite ihn direkt.
        </p>

        <details style="margin-bottom:1rem">
          <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:#374151">
            Aktueller Prompt anzeigen / bearbeiten
          </summary>
          <div style="margin-top:0.5rem">
            <textarea id="prompt-raw" rows="14"
              style="width:100%;font-family:monospace;font-size:0.8rem;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;resize:vertical"
            >${UI.esc(prompt)}</textarea>
            <div class="flex gap-2 mt-1">
              <button class="btn btn-primary btn-sm" onclick="AdminViews.saveRawPrompt()">💾 Speichern</button>
              <button class="btn btn-ghost btn-sm" onclick="AdminViews.resetPrompt()">↺ Standard wiederherstellen</button>
            </div>
          </div>
        </details>

        <div id="prompt-chat-messages"
          style="min-height:120px;max-height:420px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:0.75rem;background:#f9fafb;margin-bottom:0.75rem;display:flex;flex-direction:column;gap:0.6rem">
          <p class="text-muted text-sm" style="margin:0;text-align:center">
            Beschreibe, was du am Prompt ändern möchtest…
          </p>
        </div>

        <div class="flex gap-2" style="align-items:flex-end">
          <textarea id="prompt-chat-input" rows="2"
            placeholder="z.B. «Extrahiere auch das Gewicht der Artikel» oder «Füge ein Feld für die Lieferanten-ID hinzu»"
            style="flex:1;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;resize:none;font-size:0.9rem"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();AdminViews.sendPromptMessage()}"
          ></textarea>
          <button class="btn btn-primary" onclick="AdminViews.sendPromptMessage()" id="prompt-send-btn">
            Senden
          </button>
        </div>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.3rem">Enter zum Senden · Shift+Enter für neue Zeile</p>
      </div>`;
  },

  async sendPromptMessage() {
    const input = document.getElementById('prompt-chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    const chatEl = document.getElementById('prompt-chat-messages');
    const sendBtn = document.getElementById('prompt-send-btn');

    // User-Nachricht anhängen
    AdminViews._promptChatHistory.push({ role: 'user', text: msg });
    chatEl.innerHTML = AdminViews._renderChatHistory();
    chatEl.scrollTop = chatEl.scrollHeight;
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    // Typing-Indikator
    const typingId = 'typing-indicator';
    chatEl.insertAdjacentHTML('beforeend',
      `<div id="${typingId}" style="color:#6b7280;font-size:0.85rem;font-style:italic">Claude denkt…</div>`);
    chatEl.scrollTop = chatEl.scrollHeight;

    try {
      const res = await API.promptChat({ message: msg, currentPrompt: AdminViews._currentPrompt });
      document.getElementById(typingId)?.remove();

      AdminViews._currentPrompt = res.newPrompt;
      AdminViews._promptChatHistory.push({ role: 'assistant', explanation: res.explanation, newPrompt: res.newPrompt });
      chatEl.innerHTML = AdminViews._renderChatHistory();
      chatEl.scrollTop = chatEl.scrollHeight;

      // Textarea aktualisieren
      const rawEl = document.getElementById('prompt-raw');
      if (rawEl) rawEl.value = res.newPrompt;
    } catch(e) {
      document.getElementById(typingId)?.remove();
      AdminViews._promptChatHistory.push({ role: 'error', text: e.message });
      chatEl.innerHTML = AdminViews._renderChatHistory();
      chatEl.scrollTop = chatEl.scrollHeight;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Senden';
      input.focus();
    }
  },

  _renderChatHistory() {
    if (!AdminViews._promptChatHistory.length) {
      return `<p class="text-muted text-sm" style="margin:0;text-align:center">Beschreibe, was du am Prompt ändern möchtest…</p>`;
    }
    return AdminViews._promptChatHistory.map((m, i) => {
      if (m.role === 'user') {
        return `<div style="align-self:flex-end;background:#3b82f6;color:#fff;border-radius:12px 12px 2px 12px;padding:0.5rem 0.75rem;max-width:80%;font-size:0.9rem">
          ${UI.esc(m.text)}
        </div>`;
      }
      if (m.role === 'assistant') {
        return `<div style="align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-radius:2px 12px 12px 12px;padding:0.6rem 0.75rem;max-width:90%;font-size:0.9rem">
          <p style="margin:0 0 0.4rem 0;color:#374151">${UI.esc(m.explanation)}</p>
          <button class="btn btn-primary btn-sm" onclick="AdminViews.applyPromptSuggestion(${i})">✅ Übernehmen & Speichern</button>
        </div>`;
      }
      if (m.role === 'error') {
        return `<div style="align-self:flex-start;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:0.5rem 0.75rem;max-width:90%;font-size:0.85rem;color:#991b1b">
          ❌ ${UI.esc(m.text)}
        </div>`;
      }
      return '';
    }).join('');
  },

  async applyPromptSuggestion(historyIndex) {
    const entry = AdminViews._promptChatHistory[historyIndex];
    if (!entry || entry.role !== 'assistant') return;
    try {
      await API.saveExtractionPrompt({ prompt: entry.newPrompt });
      AdminViews._currentPrompt = entry.newPrompt;
      const rawEl = document.getElementById('prompt-raw');
      if (rawEl) rawEl.value = entry.newPrompt;
      UI.toast('Prompt gespeichert ✓', 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async saveRawPrompt() {
    const val = document.getElementById('prompt-raw')?.value?.trim();
    if (!val) { UI.toast('Prompt darf nicht leer sein', 'error'); return; }
    try {
      await API.saveExtractionPrompt({ prompt: val });
      AdminViews._currentPrompt = val;
      UI.toast('Prompt gespeichert ✓', 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async resetPrompt() {
    if (!await UI.confirm('Standard-Prompt wiederherstellen? Der aktuelle Prompt wird überschrieben.')) return;
    try {
      const { prompt } = await API.get('/api/settings/extraction-prompt-default');
      await API.saveExtractionPrompt({ prompt });
      await AdminViews.renderPromptAssistant();
      UI.toast('Standard-Prompt wiederhergestellt', 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async renderFileCleanup() {
    const el = document.getElementById('settings-content');
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🗑️ Dateien bereinigen</div>
        <p class="text-muted text-sm mb-3">
          Löscht <strong>Fotos und Anhänge</strong> die älter als die gewählte Anzahl Tage sind.
          Die <strong>Auftragsdaten bleiben vollständig erhalten</strong>.
        </p>
        <div class="flex gap-2 align-items-center mb-3">
          <label>Dateien älter als</label>
          <input type="number" id="cleanup-days" value="60" min="1" max="3650" style="width:80px">
          <label>Tage löschen</label>
        </div>
        <button class="btn btn-danger" onclick="AdminViews.runFileCleanup()">🗑️ Jetzt bereinigen</button>
      </div>`;
  },

  async runFileCleanup() {
    const days = parseInt(document.getElementById('cleanup-days')?.value) || 60;
    if (!await new Promise(resolve => {
      UI.modal('Dateien löschen',
        `<p>Alle Fotos und Anhänge, die älter als <strong>${days} Tage</strong> sind, werden dauerhaft gelöscht.</p>
         <p class="text-muted text-sm mt-2">Auftragsdaten bleiben erhalten.</p>`,
        `<button class="btn btn-ghost" onclick="UI.closeModal();window._confirmResolve(false)">Abbrechen</button>
         <button class="btn btn-danger" onclick="UI.closeModal();window._confirmResolve(true)">Unwiderruflich löschen</button>`
      );
      window._confirmResolve = resolve;
    })) return;
    try {
      const res = await API.cleanupFiles(days);
      UI.toast(`${res.deleted} Datei(en) gelöscht (älter als ${days} Tage)`, 'success');
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  // ── Datenbank-Browser ──────────────────────────────────────────────────
  async renderDbViewer(table) {
    const el = document.getElementById('settings-content');
    const tables = ['orders','users','customers','order_attachments','order_photos','articles','lieferschein_imports'];
    const tableLabels = {
      orders:               'Aufträge',
      users:                'Benutzer',
      customers:            'Kunden',
      order_attachments:    'Anhänge',
      order_photos:         'Fotos',
      articles:             'Artikel',
      lieferschein_imports: 'LS-Imports',
    };

    const activeTable = table || 'orders';

    el.innerHTML = `
      <div class="card">
        <div class="card-title">🗄️ Datenbank-Browser</div>
        <p class="text-muted text-sm mb-3">Schreibgeschützte Ansicht — max. 500 Zeilen pro Tabelle.</p>
        <div class="flex gap-2 mb-3 flex-wrap">
          ${tables.map(t => `<button class="btn btn-sm ${t === activeTable ? 'btn-primary' : 'btn-ghost'}"
            onclick="AdminViews.renderDbViewer('${t}')">${tableLabels[t]}</button>`).join('')}
        </div>
        <div id="db-viewer-table">Lade…</div>
      </div>`;

    try {
      const data = await fetch(`/api/settings/db-table/${activeTable}`).then(r => r.json());
      const tableEl = document.getElementById('db-viewer-table');
      if (!data.rows || data.rows.length === 0) {
        tableEl.innerHTML = '<p class="text-muted text-sm">Keine Einträge vorhanden.</p>';
        return;
      }
      tableEl.innerHTML = `<div style="overflow-x:auto">
        <table style="font-size:0.75rem">
          <thead><tr>${data.columns.map(c => `<th>${UI.esc(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${data.rows.map(row => `<tr>${data.columns.map(c => {
              const val = row[c];
              const display = val === null || val === undefined ? '<span class="text-muted">–</span>' : UI.esc(String(val));
              return `<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${val === null ? '' : UI.esc(String(val))}">${display}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-muted text-sm" style="margin-top:8px">${data.rows.length} Zeile(n) geladen.</p>`;
    } catch (e) {
      document.getElementById('db-viewer-table').innerHTML = `<p class="text-muted text-sm">Fehler: ${UI.esc(e.message)}</p>`;
    }
  },

  // ── Backup & Download ───────────────────────────────────────────────────
  async renderBackup() {
    const el = document.getElementById('settings-content');
    el.innerHTML = `
      <div class="card">
        <div class="card-title">💾 Datenbank-Backup</div>
        <p class="text-muted text-sm mb-3">
          Lädt die vollständige SQLite-Datenbank herunter (alle Aufträge, Benutzer, Einstellungen).
          Die Datei kann direkt mit DB-Browser for SQLite oder ähnlichen Tools geöffnet werden.
        </p>
        <a href="/api/settings/backup/db" class="btn btn-primary" download>
          ⬇ Datenbank herunterladen (.db)
        </a>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-title">📁 Fotos & Anhänge herunterladen</div>
        <p class="text-muted text-sm mb-3">
          Lädt alle hochgeladenen Fotos und Dokumente als ZIP-Archiv herunter.
          Bei vielen Dateien kann dies etwas dauern.
        </p>
        <a href="/api/settings/backup/uploads" class="btn btn-primary" download>
          ⬇ Alle Uploads herunterladen (.zip)
        </a>
      </div>

      <div class="card" style="margin-top:16px;border-left:4px solid #f59e0b;background:#fffbeb">
        <p class="text-sm" style="margin:0">
          <strong>Tipp:</strong> Erstelle regelmässig ein Backup beider Dateien.
          Zusammen decken sie die gesamten Daten der Applikation ab.
        </p>
      </div>`;
  },
};
