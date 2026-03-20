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
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('options')">Auswahlfelder</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('articles')">Artikel</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('customers')">Kunden</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('email')">✉️ E-Mail</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('lieferschein')">📥 LS-Import</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('drive')">☁️ Drive</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('prompt')">🤖 KI-Prompt</button>
        <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('cleanup')">🗑️ Dateien</button>
      </div>
      <div id="settings-content"></div>`;
    await AdminViews.showSettingsTab('options');
  },

  async showSettingsTab(tab) {
    const tabs = ['options','articles','customers','email','lieferschein','drive','prompt','cleanup'];
    document.querySelectorAll('#settings-tabs .btn').forEach(b => b.classList.remove('btn-primary'));
    document.querySelectorAll('#settings-tabs .btn')[tabs.indexOf(tab)]?.classList.add('btn-primary');
    if (tab === 'options')      await AdminViews.renderOptions();
    if (tab === 'articles')     await AdminViews.renderArticles();
    if (tab === 'customers')    await AdminViews.renderCustomers();
    if (tab === 'email')        await AdminViews.renderEmailSettings();
    if (tab === 'lieferschein') await AdminViews.renderLieferscheinImport();
    if (tab === 'drive')        await AdminViews.renderDriveStatus();
    if (tab === 'prompt')       await AdminViews.renderPromptAssistant();
    if (tab === 'cleanup')      await AdminViews.renderFileCleanup();
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

    let status = { active: false, inbox_dir: '–', inbox_files: [] };
    let imports = [];
    let driveStatus = { active: false, inbox_folder_id: null };
    let monteure = [];
    let importDefaults = { default_monteur_id: null };
    try {
      [status, imports, driveStatus, monteure, importDefaults] = await Promise.all([
        API.getLsStatus(), API.getLsImports(), API.getLsDriveStatus(),
        API.getMonteure(), API.getImportDefaults()
      ]);
    } catch(e) {}

    const statusBadge = status.active
      ? '<span class="badge badge-green">Aktiv</span>'
      : '<span class="badge badge-gray">Inaktiv – ANTHROPIC_API_KEY fehlt</span>';

    const statusBanner = !status.active ? `
      <div class="card" style="border-left:4px solid #f59e0b;background:#fffbeb">
        <p style="margin:0;font-size:0.875rem">
          <strong>Einrichtung erforderlich:</strong> Trage <code>ANTHROPIC_API_KEY=sk-ant-...</code> in deine
          <code>.env</code>-Datei ein und starte den Server neu.
          Den API-Key erhältst du auf <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.
        </p>
      </div>` : '';

    const driveBadge = driveStatus.active
      ? '<span class="badge badge-green">Aktiv</span>'
      : '<span class="badge badge-gray">Inaktiv</span>';

    const driveInboxLink = driveStatus.inbox_folder_id
      ? `<a href="https://drive.google.com/drive/folders/${driveStatus.inbox_folder_id}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">📁 Ordner öffnen</a>`
      : '';

    const driveCard = `
      <div class="card">
        <div class="card-title">☁️ Google Drive Auto-Import ${driveBadge}</div>
        ${driveStatus.active ? `
          <p class="text-muted text-sm mb-1">
            PDFs in den Google Drive Ordner <strong>"${UI.esc(driveStatus.inbox_subfolder)}"</strong> ablegen
            → werden alle ${driveStatus.poll_interval_min} Minuten automatisch importiert.<br>
            ${driveStatus.last_poll_at ? `Letzte Abfrage: ${driveStatus.last_poll_at.substring(0,16).replace('T',' ')} UTC` : ''}
          </p>
          <div class="flex gap-2 mt-2 flex-wrap">
            ${driveInboxLink}
          </div>` : `
          <p class="text-muted text-sm">
            Google Drive nicht konfiguriert. Stelle sicher, dass
            <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> und <code>GOOGLE_DRIVE_FOLDER_ID</code> gesetzt sind.
          </p>`}
      </div>`;

    const importRows = imports.length ? imports.map(i => {
      const statusMap = { success: 'badge-green', error: 'badge-red', processing: 'badge-blue', pending: 'badge-gray' };
      const statusLabel = { success: 'Erfolgreich', error: 'Fehler', processing: 'Verarbeitung…', pending: 'Ausstehend' };
      const sourceIcon = i.drive_file_id ? '☁️' : '💻';
      return `<tr>
        <td style="font-size:0.8rem">${sourceIcon} ${UI.esc(i.original_name)}</td>
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
      ${statusBanner}
      ${driveCard}
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
        <div class="card-title">📥 Lieferschein Auto-Import ${statusBadge}</div>
        <p class="text-muted text-sm mb-1">
          PDFs in diesen lokalen Ordner legen → automatisch als Auftrag importiert:<br>
          <code style="font-size:0.85rem;word-break:break-all">${UI.esc(status.inbox_dir)}</code>
        </p>
        <div class="flex gap-2 mt-2 flex-wrap">
          <div>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">
              📂 PDF manuell hochladen
              <input type="file" accept=".pdf" style="display:none" onchange="AdminViews.uploadLieferschein(this)">
            </label>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="AdminViews.showSettingsTab('lieferschein')">↺ Aktualisieren</button>
        </div>
        ${status.inbox_files.length ? `
          <p class="text-sm mt-2"><strong>Inbox (${status.inbox_files.length} PDF${status.inbox_files.length>1?'s':''} ausstehend):</strong></p>
          <ul class="text-sm text-muted" style="margin:4px 0 0 16px">
            ${status.inbox_files.map(f => `<li>${UI.esc(f.name)}</li>`).join('')}
          </ul>` : ''}
      </div>
      <div class="card">
        <div class="card-title">Import-Verlauf <span style="font-weight:normal;font-size:0.8rem;color:#6b7280">(☁️ = Google Drive, 💻 = manuell)</span></div>
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
    const file = input.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      UI.toast('PDF wird verarbeitet…', 'info', 3000);
      await API.uploadLieferschein(form);
      UI.toast('Verarbeitung gestartet – Seite lädt in 3s neu', 'success', 3000);
      setTimeout(() => AdminViews.showSettingsTab('lieferschein'), 3500);
    } catch (e) { UI.toast(e.message, 'error'); }
    input.value = '';
  },

  async retryLsImport(id) {
    try {
      UI.toast('Retry gestartet…', 'info', 2000);
      await API.retryLsImport(id);
      UI.toast('Erneuter Versuch gestartet', 'success');
      setTimeout(() => AdminViews.showSettingsTab('lieferschein'), 2000);
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async deleteLsImport(id) {
    if (!await UI.confirm('Import-Eintrag löschen?')) return;
    try { await API.deleteLsImport(id); await AdminViews.showSettingsTab('lieferschein'); }
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
};
