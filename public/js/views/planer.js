// ── Planer Views ─────────────────────────────────────────────────────────
const PlanerViews = {
  _options: null,
  _customers: null,
  _monteure: null,

  async _loadMeta() {
    if (!this._options) this._options = await API.getOptions();
    if (!this._customers) this._customers = await API.getCustomers();
    if (!this._monteure) this._monteure = await API.getMonteure();
  },

  // ── Order List ──────────────────────────────────────────────────────────
  async renderOrders() {
    const el = document.getElementById('main-content');
    el.innerHTML = `
      <div class="page-header">
        <h2>📋 Aufträge</h2>
        <div class="flex gap-2">
          <button class="btn btn-ghost" onclick="PlanerViews.openImport()">📥 Excel Import</button>
          <button class="btn btn-primary" onclick="PlanerViews.renderOrderForm()">+ Neuer Auftrag</button>
        </div>
      </div>
      <div class="card mb-3">
        <div class="flex gap-2 flex-wrap">
          <select id="filter-status" style="width:180px" onchange="PlanerViews.applyFilter()">
            <option value="">Alle Status</option>
            <option value="geplant">Geplant</option>
            <option value="in_bearbeitung">In Bearbeitung</option>
            <option value="abgeschlossen">Abgeschlossen</option>
          </select>
          <input type="date" id="filter-date" style="width:160px" onchange="PlanerViews.applyFilter()">
          <input type="text" id="filter-search" placeholder="Suche…" style="flex:1;min-width:140px" oninput="PlanerViews.applyFilter()">
        </div>
      </div>
      <div class="card"><div class="table-wrap"><div id="orders-list">Lade…</div></div></div>`;
    await PlanerViews.loadOrdersTable();
  },

  _allOrders: [],
  async loadOrdersTable() {
    this._allOrders = await API.getOrders();
    PlanerViews.applyFilter();
  },

  applyFilter() {
    const status = document.getElementById('filter-status')?.value || '';
    const date   = document.getElementById('filter-date')?.value || '';
    const search = (document.getElementById('filter-search')?.value || '').toLowerCase();

    let orders = PlanerViews._allOrders;
    if (status) orders = orders.filter(o => o.status === status);
    if (date)   orders = orders.filter(o => (o.planned_date||'').startsWith(date));
    if (search) orders = orders.filter(o =>
      (o.order_number||'').toLowerCase().includes(search) ||
      (o.customer_name||o.cust_name||'').toLowerCase().includes(search) ||
      (o.installation_address||'').toLowerCase().includes(search)
    );

    const el = document.getElementById('orders-list');
    if (!el) return;
    el.innerHTML = orders.length ? `<table>
      <thead><tr>
        <th>Nr.</th><th>Kunde</th><th>Montageadresse</th>
        <th>Montagedatum</th><th>Techniker</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
      ${orders.map(o => `<tr>
        <td><code>${UI.esc(o.order_number)}</code></td>
        <td>${UI.esc(o.customer_name || o.cust_name || '–')}</td>
        <td>${UI.esc(o.installation_address || '–')}</td>
        <td>${UI.fmtDate(o.planned_date)}</td>
        <td>${UI.esc(o.assigned_name || '–')}</td>
        <td>${UI.statusBadge(o.status)}</td>
        <td class="text-right">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrderDetail(${o.id})">Ansicht</button>
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrderForm(${o.id})">Bearbeiten</button>
          <button class="btn btn-danger btn-sm" onclick="PlanerViews.deleteOrder(${o.id})">✕</button>
        </td>
      </tr>`).join('')}
      </tbody></table>` : '<p class="text-muted text-sm">Keine Aufträge gefunden.</p>';
  },

  async deleteOrder(id) {
    if (!await UI.confirm('Auftrag archivieren?')) return;
    try { await API.deleteOrder(id); UI.toast('Auftrag archiviert', 'success'); await PlanerViews.loadOrdersTable(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  // ── Order Form (Create / Edit) ──────────────────────────────────────────
  async renderOrderForm(orderId) {
    await this._loadMeta();
    let order = null;
    if (orderId) order = await API.getOrder(orderId);

    const opts = this._options;
    const customers = this._customers;
    const monteure = this._monteure;
    const sel = (v) => (list, key) => list.map(i => `<option value="${i[key]||i.id}" ${(order?.[v])===String(i[key]||i.id)?'selected':''}>${UI.esc(i.name||i.full_name)}</option>`).join('');

    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <div class="flex gap-2 align-items-center">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrders()">← Zurück</button>
          <h2>${order ? `Auftrag ${order.order_number}` : 'Neuer Auftrag'}</h2>
        </div>
        <div class="flex gap-2">
          ${order ? `<button class="btn btn-ghost" onclick="PlanerViews.renderOrderDetail(${orderId})">Vorschau</button>` : ''}
          <button class="btn btn-primary" onclick="PlanerViews.saveOrder(${orderId||'null'})">Speichern</button>
        </div>
      </div>

      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📄 Auftragsinformation</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <div class="form-grid">
            <div class="field">
              <label>Kundenname <span class="req">*</span></label>
              <select id="f-customer-id" onchange="PlanerViews.onCustomerChange()">
                <option value="">– Bitte wählen –</option>
                ${customers.map(c => `<option value="${c.id}" ${order?.customer_id==c.id?'selected':''}>${UI.esc(c.name)}</option>`).join('')}
                <option value="__new">+ Neuer Kunde…</option>
              </select>
            </div>
            <div class="field">
              <label>Kundenadresse</label>
              <input type="text" id="f-customer-address" value="${UI.esc(order?.customer_address||'')}" placeholder="Wird aus Kunde übernommen">
            </div>
            <div class="field">
              <label>Besteller <span class="req">*</span></label>
              <input type="text" id="f-orderer" value="${UI.esc(order?.orderer||'')}">
            </div>
            <div class="field">
              <label>Kontaktperson vor Ort</label>
              <input type="text" id="f-on-site-contact" value="${UI.esc(order?.on_site_contact||'')}">
            </div>
            <div class="field">
              <label>Montageadresse <span class="req">*</span></label>
              <input type="text" id="f-installation-address" value="${UI.esc(order?.installation_address||'')}">
            </div>
            <div class="field">
              <label>Kommunizierte Ankunftszeit (von – bis)</label>
              <input type="text" id="f-arrival-time" value="${UI.esc(order?.arrival_time||'')}" placeholder="z.B. 08:00 – 10:00">
            </div>
            <div class="field">
              <label>Vorgesehenes Montagedatum <span class="req">*</span></label>
              <input type="date" id="f-planned-date" value="${UI.esc(order?.planned_date||'')}">
            </div>
            <div class="field">
              <label>Spätestes Montagedatum</label>
              <input type="date" id="f-latest-date" value="${UI.esc(order?.latest_date||'')}">
            </div>
          </div>

          <div class="field mt-3">
            <label>Arbeit <span class="req">*</span></label>
            ${UI.multiCheck('arbeit', opts.arbeit || [], order?.work_types || [])}
          </div>

          <div class="field mt-3">
            <label>Bemerkungen (Planer)</label>
            <textarea id="f-notes-planer">${UI.esc(order?.notes_planer||'')}</textarea>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>👷 Zuweisung</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <div class="form-grid">
            <div class="field">
              <label>Zugewiesener Monteur</label>
              <select id="f-assigned-to">
                <option value="">– Kein Monteur –</option>
                ${monteure.map(m => `<option value="${m.id}" ${order?.assigned_to==m.id?'selected':''}>${UI.esc(m.full_name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Reihenfolge (Sortiernummer)</label>
              <input type="number" id="f-sort-order" value="${order?.sort_order||0}" min="0">
            </div>
            <div class="field">
              <label>Status</label>
              <select id="f-status">
                ${['geplant','in_bearbeitung','abgeschlossen'].map(s => `<option value="${s}" ${order?.status===s?'selected':''}>${UI.statusName(s)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      ${order ? `
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📎 Anhänge & Fotos</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body" id="attachments-section">
          ${PlanerViews.renderAttachmentsSection(order)}
        </div>
      </div>` : '<div class="card"><p class="text-muted text-sm">Anhänge können nach dem Erstellen des Auftrags hochgeladen werden.</p></div>'}
    `;

    if (order?.customer_id) {
      const cust = customers.find(c => c.id == order.customer_id);
      if (cust?.address && !order.customer_address) {
        document.getElementById('f-customer-address').value = cust.address;
      }
    }

    window._currentOrderId = orderId;
  },

  renderAttachmentsSection(order) {
    const atts = order.attachments || [];
    const photos = order.photos || [];
    return `
      <div class="form-grid">
        <div>
          <p class="text-sm text-muted mb-2">Anhänge (PDF, Zeichnungen etc.)</p>
          <div class="file-list mb-2" id="att-list">
            ${atts.map(a => `
              <div class="file-item" id="att-${a.id}">
                <span class="file-type">📄</span>
                <span class="file-name">${UI.esc(a.original_name)}</span>
                <button class="btn btn-ghost btn-sm" onclick="PlanerViews.delAttachment(${order.id},${a.id})">✕</button>
              </div>`).join('') || '<p class="text-muted text-sm">Keine Anhänge</p>'}
          </div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            📎 Anhänge hochladen
            <input type="file" id="att-upload" multiple accept=".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png" style="display:none" onchange="PlanerViews.uploadAttachments(${order.id})">
          </label>
        </div>
        <div>
          <p class="text-sm text-muted mb-2">Foto Montagestandort</p>
          <div class="photo-grid mb-2" id="photo-grid">
            ${photos.map(p => `
              <div class="photo-thumb" id="photo-${p.id}">
                <img src="${API.fileUrl(order.id, p.filename)}" alt="">
                <button class="del-photo" onclick="PlanerViews.delPhoto(${order.id},${p.id})">✕</button>
              </div>`).join('') || '<p class="text-muted text-sm">Keine Fotos</p>'}
          </div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            📷 Fotos hochladen
            <input type="file" id="photo-upload" multiple accept="image/*" style="display:none" onchange="PlanerViews.uploadPhotos(${order.id})">
          </label>
        </div>
      </div>`;
  },

  async uploadAttachments(orderId) {
    const inp = document.getElementById('att-upload');
    if (!inp.files.length) return;
    const form = new FormData();
    [...inp.files].forEach(f => form.append('files', f));
    try {
      await API.uploadAttachments(orderId, form);
      UI.toast('Anhänge hochgeladen', 'success');
      const order = await API.getOrder(orderId);
      document.getElementById('attachments-section').innerHTML = PlanerViews.renderAttachmentsSection(order);
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async uploadPhotos(orderId) {
    const inp = document.getElementById('photo-upload');
    if (!inp.files.length) return;
    const form = new FormData();
    [...inp.files].forEach(f => form.append('photos', f));
    form.append('photo_type', 'standort');
    try {
      await API.uploadPhotos(orderId, form);
      UI.toast('Fotos hochgeladen', 'success');
      const order = await API.getOrder(orderId);
      document.getElementById('attachments-section').innerHTML = PlanerViews.renderAttachmentsSection(order);
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async delAttachment(orderId, attId) {
    try {
      await API.deleteAttachment(orderId, attId);
      document.getElementById(`att-${attId}`)?.remove();
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async delPhoto(orderId, photoId) {
    try {
      await API.deletePhoto(orderId, photoId);
      document.getElementById(`photo-${photoId}`)?.remove();
    } catch(e) { UI.toast(e.message,'error'); }
  },

  onCustomerChange() {
    const val = document.getElementById('f-customer-id').value;
    if (val === '__new') {
      PlanerViews.openNewCustomerModal();
      return;
    }
    const cust = PlanerViews._customers?.find(c => c.id == val);
    if (cust) {
      const addr = document.getElementById('f-customer-address');
      if (!addr.value) addr.value = cust.address || '';
    }
  },

  async openNewCustomerModal() {
    UI.modal('Neuer Kunde',
      `<div class="form-grid">
        <div class="field span-2"><label>Name <span class="req">*</span></label><input type="text" id="nc-name"></div>
        <div class="field span-2"><label>Adresse</label><input type="text" id="nc-addr"></div>
        <div class="field"><label>Kontaktperson</label><input type="text" id="nc-contact"></div>
        <div class="field"><label>Telefon</label><input type="text" id="nc-phone"></div>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="PlanerViews.saveNewCustomer()">Erstellen</button>`
    );
  },

  async saveNewCustomer() {
    const d = {
      name: document.getElementById('nc-name').value.trim(),
      address: document.getElementById('nc-addr').value.trim(),
      contact_name: document.getElementById('nc-contact').value.trim(),
      contact_phone: document.getElementById('nc-phone').value.trim(),
    };
    if (!d.name) { UI.toast('Name erforderlich','error'); return; }
    try {
      const cust = await API.createCustomer(d);
      PlanerViews._customers = null; // refresh cache
      PlanerViews._customers = await API.getCustomers();
      const sel = document.getElementById('f-customer-id');
      const opt = document.createElement('option');
      opt.value = cust.id; opt.textContent = cust.name; opt.selected = true;
      const lastOpt = sel.querySelector('[value="__new"]');
      sel.insertBefore(opt, lastOpt);
      sel.value = cust.id;
      if (cust.address) document.getElementById('f-customer-address').value = cust.address;
      UI.closeModal(); UI.toast('Kunde erstellt','success');
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async saveOrder(orderId) {
    const customerId = document.getElementById('f-customer-id').value;
    const customerName = customerId && customerId !== '__new'
      ? PlanerViews._customers?.find(c => c.id == customerId)?.name || ''
      : '';

    const data = {
      customer_id:           customerId || null,
      customer_name:         customerName,
      customer_address:      document.getElementById('f-customer-address').value.trim(),
      orderer:               document.getElementById('f-orderer').value.trim(),
      on_site_contact:       document.getElementById('f-on-site-contact').value.trim(),
      installation_address:  document.getElementById('f-installation-address').value.trim(),
      arrival_time:          document.getElementById('f-arrival-time').value.trim(),
      planned_date:          document.getElementById('f-planned-date').value,
      latest_date:           document.getElementById('f-latest-date').value,
      work_types:            UI.getMultiCheck('arbeit'),
      notes_planer:          document.getElementById('f-notes-planer').value.trim(),
      assigned_to:           document.getElementById('f-assigned-to').value || null,
      sort_order:            parseInt(document.getElementById('f-sort-order').value) || 0,
      status:                document.getElementById('f-status').value,
    };

    if (!data.customer_id && !data.customer_name) { UI.toast('Kunde erforderlich','error'); return; }
    if (!data.orderer) { UI.toast('Besteller erforderlich','error'); return; }
    if (!data.installation_address) { UI.toast('Montageadresse erforderlich','error'); return; }
    if (!data.planned_date) { UI.toast('Vorgesehenes Montagedatum erforderlich','error'); return; }
    if (!data.work_types.length) { UI.toast('Mindestens eine Arbeit wählen','error'); return; }

    try {
      let saved;
      if (orderId) saved = await API.updateOrder(orderId, data);
      else         saved = await API.createOrder(data);
      UI.toast('Auftrag gespeichert','success');
      PlanerViews.renderOrderForm(saved.id);
    } catch(e) { UI.toast(e.message,'error'); }
  },

  // ── Order Detail (read-only overview) ──────────────────────────────────
  async renderOrderDetail(orderId) {
    await this._loadMeta();
    const order = await API.getOrder(orderId);
    const main = document.getElementById('main-content');

    const fv = v => UI.esc(v || '–');
    const fa = v => (Array.isArray(v) ? v : []).join(', ') || '–';

    main.innerHTML = `
      <div class="page-header">
        <div class="flex gap-2 align-items-center">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrders()">← Zurück</button>
          <h2>Auftrag ${fv(order.order_number)}</h2>
          ${UI.statusBadge(order.status)}
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" onclick="window.print()">🖨 Drucken</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openEmailModal(${order.id})">✉️ Per E-Mail</button>
          <button class="btn btn-primary" onclick="PlanerViews.renderOrderForm(${order.id})">Bearbeiten</button>
        </div>
      </div>

      <div class="form-grid">
        <div class="card">
          <div class="card-title">Auftragsinformation</div>
          ${[
            ['Auftragsnummer', fv(order.order_number)],
            ['Kunde',          fv(order.customer_name || order.cust_name)],
            ['Kundenadresse',  fv(order.customer_address || order.cust_address)],
            ['Besteller',      fv(order.orderer)],
            ['Montageadresse', fv(order.installation_address)],
            ['Kontakt vor Ort',fv(order.on_site_contact)],
            ['Ankunftszeit',   fv(order.arrival_time)],
            ['Montagedatum',   UI.fmtDate(order.planned_date)],
            ['Spätestes Datum',UI.fmtDate(order.latest_date)],
            ['Arbeit',         fa(order.work_types)],
            ['Bemerkungen',    fv(order.notes_planer)],
          ].map(([l,v]) => `<div class="flex mb-2"><span style="width:180px;color:var(--text2);font-size:12px;font-weight:600">${l}</span><span>${v}</span></div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title">Ausgeführte Arbeiten</div>
          ${[
            ['Ausgeführte Arbeiten', fa(order.executed_work)],
            ['Datum',               UI.fmtDate(order.work_date)],
            ['Arbeitszeit',         `${fv(order.work_time_from)} – ${fv(order.work_time_to)}`],
            ['Techniker',           fv(order.technician_name)],
            ['Blockschrift',        fv(order.technician_block)],
            ['Bemerkungen',         fv(order.notes_monteur)],
          ].map(([l,v]) => `<div class="flex mb-2"><span style="width:180px;color:var(--text2);font-size:12px;font-weight:600">${l}</span><span>${v}</span></div>`).join('')}

          ${order.signature_data ? `
          <div class="mt-3">
            <p class="text-sm text-muted mb-2">Unterschrift Kunde</p>
            <div style="background:#fff;border-radius:6px;padding:4px;display:inline-block;max-width:100%">
              <img src="${order.signature_data}" style="max-width:300px;max-height:120px;display:block">
            </div>
          </div>` : ''}

          ${order.items_table?.length ? `
          <div class="mt-3">
            <p class="text-sm text-muted mb-2">Material / Positionen</p>
            <table class="items-table">
              <thead><tr><th>Artikel</th><th>Menge</th><th>Einheit</th></tr></thead>
              <tbody>${order.items_table.map(i => `<tr><td>${UI.esc(i.name)}</td><td>${UI.esc(i.quantity)}</td><td>${UI.esc(i.unit)}</td></tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
        </div>
      </div>

      ${(order.attachments?.length || order.photos?.length) ? `
      <div class="card">
        <div class="card-title">Anhänge & Fotos</div>
        <div class="form-grid">
          <div>
            ${order.attachments?.length ? `<p class="text-sm text-muted mb-2">Dokumente</p>
            <div class="file-list">
              ${order.attachments.map(a => `<div class="file-item">
                <span>📄</span>
                <a href="${API.fileUrl(order.id, a.filename)}" target="_blank" class="file-name">${UI.esc(a.original_name)}</a>
              </div>`).join('')}
            </div>` : ''}
          </div>
          <div>
            ${order.photos?.length ? `<p class="text-sm text-muted mb-2">Fotos (Montagestandort)</p>
            <div class="photo-grid">
              ${order.photos.map(p => `<div class="photo-thumb">
                <img src="${API.fileUrl(order.id, p.filename)}" alt="">
              </div>`).join('')}
            </div>` : ''}
          </div>
        </div>
      </div>` : ''}

      <p class="text-muted text-sm mt-3">Es gelten unsere AGB's.</p>
    `;
  },

  // ── Email Modal ─────────────────────────────────────────────────────────
  async openEmailModal(orderId) {
    const status = await API.emailStatus();
    if (!status.configured) {
      UI.toast('E-Mail nicht konfiguriert. Bitte SMTP in .env einrichten.','error', 5000);
      return;
    }
    UI.modal('Rapport per E-Mail senden',
      `<div class="field mb-3">
        <label>An (E-Mail-Adresse)</label>
        <input type="email" id="mail-to" placeholder="empfaenger@firma.ch">
      </div>
      <div class="field">
        <label>Betreff</label>
        <input type="text" id="mail-subject" placeholder="Montagerapport…">
      </div>
      <p class="text-muted text-sm mt-2">Von: ${UI.esc(status.user || 'Konfiguriertes Absenderkonto')}</p>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="PlanerViews.sendEmail(${orderId})">Senden</button>`
    );
  },

  async sendEmail(orderId) {
    const to      = document.getElementById('mail-to').value.trim();
    const subject = document.getElementById('mail-subject').value.trim();
    if (!to) { UI.toast('Empfänger erforderlich','error'); return; }
    try {
      UI.closeModal();
      UI.toast('Sende E-Mail…','info');
      await API.sendEmail({ orderId, to, subject });
      UI.toast('E-Mail erfolgreich gesendet','success');
    } catch(e) { UI.toast(e.message,'error'); }
  },

  // ── Kundenanfragen ──────────────────────────────────────────────────────
  async renderAnfragen() {
    const el = document.getElementById('main-content');
    el.innerHTML = `
      <div class="page-header">
        <h2>📩 Kundenanfragen</h2>
        <button class="btn btn-ghost" onclick="PlanerViews.copyAnfrageLink()">🔗 Formular-Link kopieren</button>
      </div>
      <div class="card"><div id="anfragen-list">Lade…</div></div>`;
    await PlanerViews.loadAnfragenTable();
  },

  async loadAnfragenTable() {
    let rows;
    try { rows = await API.getAnfragen(); }
    catch(e) { document.getElementById('anfragen-list').innerHTML = `<p class="text-danger">${UI.esc(e.message)}</p>`; return; }

    const statusBadge = s => ({
      neu:            '<span class="badge badge-warn">Neu</span>',
      in_bearbeitung: '<span class="badge badge-info">In Bearbeitung</span>',
      erledigt:       '<span class="badge badge-ok">Erledigt</span>',
    }[s] || s);

    const el = document.getElementById('anfragen-list');
    if (!el) return;
    el.innerHTML = rows.length ? `<table>
      <thead><tr>
        <th>Datum</th><th>Name / Firma</th><th>Ort</th><th>Art</th><th>Termin</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
      ${rows.map(a => `<tr>
        <td>${UI.fmtDate(a.created_at?.split('T')[0] || a.created_at?.substring(0,10))}</td>
        <td>
          <strong>${UI.esc(a.vorname)} ${UI.esc(a.nachname)}</strong>
          ${a.firma ? `<br><span class="text-muted text-sm">${UI.esc(a.firma)}</span>` : ''}
        </td>
        <td>${UI.esc(a.plz)} ${UI.esc(a.ort)}</td>
        <td>${UI.esc(a.art_der_arbeit || '–')}</td>
        <td>${a.wunschtermin ? UI.fmtDate(a.wunschtermin) : '–'}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="text-right" style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderAnfrageDetail(${a.id})">Ansicht</button>
          ${a.status !== 'erledigt' ? `<button class="btn btn-primary btn-sm" onclick="PlanerViews.doConvert(${a.id})">→ Auftrag</button>` : `<span class="text-muted text-sm">Auftrag erstellt</span>`}
        </td>
      </tr>`).join('')}
      </tbody></table>` : '<p class="text-muted text-sm">Noch keine Anfragen eingegangen.</p>';
  },

  async renderAnfrageDetail(id) {
    let a;
    try { a = await API.getAnfrage(id); }
    catch(e) { UI.toast(e.message, 'error'); return; }

    const fv = v => v ? UI.esc(String(v)) : '<span class="text-muted">–</span>';
    const yn = v => v ? 'Ja' : 'Nein';

    UI.modal(`Anfrage von ${a.vorname} ${a.nachname}`,
      `<div style="max-height:60vh;overflow-y:auto">
        <table class="detail-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td colspan="2" style="padding:6px 0 2px;font-weight:700;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Kontaktdaten</td></tr>
          <tr><td style="width:160px;color:var(--text2);padding:4px 0">Firma</td><td>${fv(a.firma)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Name</td><td>${fv(a.vorname)} ${fv(a.nachname)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">E-Mail</td><td><a href="mailto:${UI.esc(a.email)}">${fv(a.email)}</a></td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Telefon</td><td><a href="tel:${UI.esc(a.telefon)}">${fv(a.telefon)}</a></td></tr>
          <tr><td colspan="2" style="padding:12px 0 2px;font-weight:700;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Montageadresse</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Adresse</td><td>${fv(a.strasse)}, ${fv(a.plz)} ${fv(a.ort)}</td></tr>
          <tr><td colspan="2" style="padding:12px 0 2px;font-weight:700;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Objekt & Sibox</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Objektart</td><td>${fv(a.objektart)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Art der Arbeit</td><td>${fv(a.art_der_arbeit)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Anzahl Türen</td><td>${fv(a.anzahl_tueren)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Zylinder (ca.)</td><td>${fv(a.anzahl_zylinder)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Schlüssel (ca.)</td><td>${fv(a.anzahl_schluessel)}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Bestehendes System</td><td>${yn(a.bestehendes_system)}</td></tr>
          <tr><td colspan="2" style="padding:12px 0 2px;font-weight:700;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Terminwunsch</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Wunschtermin</td><td>${a.wunschtermin ? UI.fmtDate(a.wunschtermin) : '–'}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Alternativtermin</td><td>${a.alternativtermin ? UI.fmtDate(a.alternativtermin) : '–'}</td></tr>
          <tr><td style="color:var(--text2);padding:4px 0">Präferenz</td><td>${fv(a.terminpraeferenz)}</td></tr>
          ${a.bemerkungen ? `<tr><td colspan="2" style="padding:12px 0 2px;font-weight:700;color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Bemerkungen</td></tr>
          <tr><td colspan="2" style="padding:4px 0;white-space:pre-wrap">${fv(a.bemerkungen)}</td></tr>` : ''}
        </table>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Schliessen</button>
       ${a.status !== 'erledigt' ? `<button class="btn btn-primary" onclick="UI.closeModal();PlanerViews.doConvert(${a.id})">→ Zu Auftrag konvertieren</button>` : ''}`
    );
  },

  async doConvert(id) {
    if (!await UI.confirm('Anfrage in einen neuen Auftrag umwandeln?')) return;
    try {
      const res = await API.convertAnfrage(id);
      UI.toast(`Auftrag ${res.order_number} erstellt`, 'success', 4000);
      await PlanerViews.loadAnfragenTable();
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  copyAnfrageLink() {
    const url = `${location.origin}/anfrage`;
    navigator.clipboard.writeText(url)
      .then(() => UI.toast('Link kopiert: ' + url, 'success', 4000))
      .catch(() => UI.toast('Link: ' + url, 'info', 6000));
  },

  // ── Excel Import ────────────────────────────────────────────────────────
  openImport() {
    UI.modal('Excel Import',
      `<p class="text-muted text-sm mb-3">Unterstützte Spalten: <code>Kunde</code>, <code>Montagedatum</code>, <code>Montageadresse</code>, <code>Besteller</code>, <code>Bemerkungen</code></p>
       <div class="field">
         <label>Excel-Datei (.xlsx/.xls)</label>
         <input type="file" id="import-file" accept=".xlsx,.xls">
       </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="PlanerViews.runImport()">Importieren</button>`
    );
  },

  async runImport() {
    const file = document.getElementById('import-file')?.files[0];
    if (!file) { UI.toast('Bitte Datei wählen','error'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      UI.closeModal();
      const result = await API.importOrders(form);
      UI.toast(`${result.imported} Aufträge importiert`,'success');
      PlanerViews._allOrders = [];
      await PlanerViews.renderOrders();
    } catch(e) { UI.toast(e.message,'error'); }
  },
};

// ── Extend UI helper ──────────────────────────────────────────────────────
UI.statusName = s => ({ geplant:'Geplant', in_bearbeitung:'In Bearbeitung', abgeschlossen:'Abgeschlossen', archiviert:'Archiviert' }[s] || s);

UI.toggleSection = function(header) {
  header.classList.toggle('open');
  const body = header.nextElementSibling;
  body.classList.toggle('collapsed');
};
