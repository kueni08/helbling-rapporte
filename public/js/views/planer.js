// ── Planer Views ─────────────────────────────────────────────────────────
const PlanerViews = {
  _options: null,
  _monteure: null,

  async _loadMeta() {
    if (!this._options) this._options = await API.getOptions();
    if (!this._monteure) this._monteure = await API.getMonteure();
  },

  // ── Order List ──────────────────────────────────────────────────────────
  async renderOrders() {
    const el = document.getElementById('main-content');
    el.innerHTML = `
      <div class="page-header">
        <h2>📋 Aufträge</h2>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-ghost" onclick="window.location='/api/orders/import-template'">📄 Vorlage</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openImport()">📥 Excel Import</button>
          <button class="btn btn-ghost" onclick="window.location='/api/orders/export'">📤 Excel Export</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openColSettings()">📊 Spalten</button>
          <button class="btn btn-ghost" onclick="PlanerViews.printOrders()">🖨️ Drucken</button>
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
  _filteredOrders: [],
  _sortCol: 'planned_date',
  _sortDir: 'asc',
  _visibleCols: null,

  _getVisibleCols() {
    if (!this._visibleCols) {
      try { this._visibleCols = new Set(JSON.parse(localStorage.getItem('planer_cols') || '[]')); }
      catch { this._visibleCols = new Set(); }
    }
    return this._visibleCols;
  },

  async loadOrdersTable() {
    this._allOrders = await API.getOrders();
    PlanerViews.applyFilter();
  },

  toggleSort(col) {
    if (PlanerViews._sortCol === col) {
      PlanerViews._sortDir = PlanerViews._sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      PlanerViews._sortCol = col;
      PlanerViews._sortDir = 'asc';
    }
    PlanerViews.applyFilter();
  },

  applyFilter() {
    const status = document.getElementById('filter-status')?.value || '';
    const date   = document.getElementById('filter-date')?.value || '';
    const search = (document.getElementById('filter-search')?.value || '').toLowerCase();

    let orders = [...PlanerViews._allOrders];
    if (status) orders = orders.filter(o => o.status === status);
    if (date)   orders = orders.filter(o => (o.planned_date||'').startsWith(date));
    if (search) orders = orders.filter(o =>
      (o.order_number||'').toLowerCase().includes(search) ||
      (o.customer_name||o.cust_name||'').toLowerCase().includes(search) ||
      (o.installation_address||'').toLowerCase().includes(search) ||
      (o.assigned_name||'').toLowerCase().includes(search)
    );

    // Sort
    const col = PlanerViews._sortCol;
    const dir = PlanerViews._sortDir === 'asc' ? 1 : -1;
    orders.sort((a, b) => {
      let va = a[col] || '', vb = b[col] || '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });

    PlanerViews._filteredOrders = orders;

    const el = document.getElementById('orders-list');
    if (!el) return;

    const sortTh = (label, colId) => {
      const isActive = PlanerViews._sortCol === colId;
      const cls = isActive ? (PlanerViews._sortDir === 'asc' ? 'sortable sort-asc' : 'sortable sort-desc') : 'sortable';
      return `<th class="${cls}" onclick="PlanerViews.toggleSort('${colId}')">${label}</th>`;
    };

    const cols = PlanerViews._getVisibleCols();

    el.innerHTML = orders.length ? `<table>
      <thead><tr>
        ${sortTh('Nr.','order_number')}
        ${cols.has('project_number') ? sortTh('Projekt','project_number') : ''}
        ${sortTh('Kunde','customer_name')}
        ${sortTh('Montageadresse','installation_address')}
        ${sortTh('Datum','planned_date')}
        ${cols.has('latest_date') ? sortTh('Spätestens','latest_date') : ''}
        ${sortTh('Techniker','assigned_name')}
        ${cols.has('sort_order') ? `<th>Reihenf.</th>` : ''}
        ${cols.has('notes_planer') ? `<th>Bemerkungen</th>` : ''}
        ${sortTh('Status','status')}
        <th></th>
      </tr></thead>
      <tbody>
      ${orders.map(o => {
        const hasExtra = (o.extra_material?.length > 0) || (o.extra_aufwand > 0);
        const rowStyle = hasExtra ? 'background:rgba(212,138,0,.10);' : '';
        const totalFiles = (o.attachment_count || 0) + (o.photo_count || 0);
        const attachBadge = totalFiles > 0 ? ` <span title="${totalFiles} Anhänge/Fotos" style="color:#555;font-size:11px;font-weight:600">📎${totalFiles}</span>` : '';
        return `<tr style="${rowStyle}">
          <td><code>${UI.esc(o.order_number)}</code>${attachBadge}${hasExtra ? ' <span title="Nicht auf LS aufgeführt" style="color:#d48a00;font-size:12px">⚠️</span>' : ''}</td>
          ${cols.has('project_number') ? `<td style="font-size:12px;color:var(--accent)">${UI.esc(o.project_number||'')}</td>` : ''}
          <td class="inline-edit-cell" onclick="PlanerViews.inlineEdit(event,${o.id},'customer_name','${UI.esc(o.customer_name||o.cust_name||'')}')">${UI.esc(o.customer_name || o.cust_name || '–')}</td>
          <td class="inline-edit-cell" onclick="PlanerViews.inlineEdit(event,${o.id},'installation_address','${UI.esc(o.installation_address||'')}')">${UI.esc(o.installation_address || '–')}</td>
          <td class="inline-edit-cell" onclick="PlanerViews.inlineEdit(event,${o.id},'planned_date','${UI.esc(o.planned_date||'')}','date')">${UI.fmtDate(o.planned_date)}</td>
          ${cols.has('latest_date') ? `<td>${UI.fmtDate(o.latest_date)}</td>` : ''}
          <td>${UI.esc(o.assigned_name || '–')}</td>
          ${cols.has('sort_order') ? `<td style="text-align:center;color:var(--text2)">${o.sort_order||0}</td>` : ''}
          ${cols.has('notes_planer') ? `<td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${UI.esc(o.notes_planer||'')}">${UI.esc((o.notes_planer||'').substring(0,60))}${(o.notes_planer||'').length>60?'…':''}</td>` : ''}
          <td class="inline-edit-cell" onclick="PlanerViews.inlineEditStatus(event,${o.id},'${o.status}')">${UI.statusBadge(o.status)}</td>
          <td class="text-right" style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrderDetail(${o.id})">Ansicht</button>
            <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrderForm(${o.id})">Bearb.</button>
            <button class="btn btn-danger btn-sm" onclick="PlanerViews.deleteOrder(${o.id})">✕</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody></table>` : '<p class="text-muted text-sm">Keine Aufträge gefunden.</p>';
  },

  // ── Inline Editing ──────────────────────────────────────────────────────
  async inlineEdit(e, orderId, field, currentVal, inputType = 'text') {
    e.stopPropagation();
    const td = e.currentTarget;
    if (td.querySelector('.inline-edit-input')) return; // already editing

    const orig = td.innerHTML;
    td.innerHTML = `<input class="inline-edit-input" type="${inputType}" value="${UI.esc(currentVal)}" id="ie-${orderId}-${field}">`;
    const inp = td.querySelector('.inline-edit-input');
    inp.focus();
    if (inputType === 'text') inp.select();

    const save = async () => {
      const val = inp.value.trim();
      try {
        await API.updateOrder(orderId, { [field]: val });
        const idx = PlanerViews._allOrders.findIndex(o => o.id === orderId);
        if (idx >= 0) PlanerViews._allOrders[idx][field] = val;
        PlanerViews.applyFilter();
      } catch(err) {
        td.innerHTML = orig;
        UI.toast(err.message, 'error');
      }
    };

    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { td.innerHTML = orig; }
    });
  },

  async inlineEditStatus(e, orderId, currentStatus) {
    e.stopPropagation();
    const td = e.currentTarget;
    if (td.querySelector('select')) return;

    const statuses = ['geplant','in_bearbeitung','abgeschlossen'];
    td.innerHTML = `<select class="inline-edit-input" style="width:130px">
      ${statuses.map(s => `<option value="${s}" ${s===currentStatus?'selected':''}>${UI.statusName(s)}</option>`).join('')}
    </select>`;
    const sel = td.querySelector('select');
    sel.focus();

    const save = async () => {
      const val = sel.value;
      try {
        await API.updateOrder(orderId, { status: val });
        const idx = PlanerViews._allOrders.findIndex(o => o.id === orderId);
        if (idx >= 0) PlanerViews._allOrders[idx].status = val;
        UI.toast(`Status gesetzt: ${UI.statusName(val)}`, 'success');
        PlanerViews.applyFilter();
      } catch(err) {
        PlanerViews.applyFilter();
        UI.toast(err.message, 'error');
      }
    };

    sel.addEventListener('change', () => sel.blur());
    sel.addEventListener('blur', save);
  },

  async deleteOrder(id) {
    if (!await UI.confirm('Auftrag archivieren?')) return;
    try { await API.deleteOrder(id); UI.toast('Auftrag archiviert', 'success'); await PlanerViews.loadOrdersTable(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },

  // ── Column Toggle ────────────────────────────────────────────────────────
  openColSettings() {
    const cols = PlanerViews._getVisibleCols();
    UI.modal('Spalten anzeigen',
      `<div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="checkbox" id="col-project" ${cols.has('project_number') ? 'checked' : ''}>
          <span>Projektnummer</span>
        </label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="checkbox" id="col-sort" ${cols.has('sort_order') ? 'checked' : ''}>
          <span>Reihenfolge</span>
        </label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="checkbox" id="col-notes" ${cols.has('notes_planer') ? 'checked' : ''}>
          <span>Bemerkungen Planer</span>
        </label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="checkbox" id="col-latest" ${cols.has('latest_date') ? 'checked' : ''}>
          <span>Spätestes Datum</span>
        </label>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="PlanerViews.applyColSettings()">Übernehmen</button>`
    );
  },

  applyColSettings() {
    const cols = new Set();
    if (document.getElementById('col-project')?.checked) cols.add('project_number');
    if (document.getElementById('col-sort')?.checked) cols.add('sort_order');
    if (document.getElementById('col-notes')?.checked) cols.add('notes_planer');
    if (document.getElementById('col-latest')?.checked) cols.add('latest_date');
    PlanerViews._visibleCols = cols;
    try { localStorage.setItem('planer_cols', JSON.stringify([...cols])); } catch {}
    UI.closeModal();
    PlanerViews.applyFilter();
  },

  // ── Print Orders ─────────────────────────────────────────────────────────
  printOrders() {
    const orders = PlanerViews._filteredOrders.length ? PlanerViews._filteredOrders : PlanerViews._allOrders;
    const today = new Date().toLocaleDateString('de-CH');
    const rows = orders.map(o => `<tr>
      <td><code>${UI.esc(o.order_number)}</code></td>
      <td style="color:#1a4fa0;font-weight:600">${UI.esc(o.project_number || '')}</td>
      <td>${o.planned_date ? new Date(o.planned_date + 'T00:00:00').toLocaleDateString('de-CH') : '–'}</td>
      <td>${UI.esc(o.customer_name || o.cust_name || '')}</td>
      <td>${UI.esc(o.installation_address || '')}</td>
      <td>${UI.esc(o.assigned_name || '')}</td>
      <td class="status-${UI.esc(o.status)}">${UI.esc(o.status || '')}</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Montageliste</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; margin: 12px; color: #000; }
      h3 { margin: 0 0 10px; font-size: 14px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
      th { background: #e8e8e8; font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
      tr:nth-child(even) { background: #f5f5f5; }
      .status-abgeschlossen { color: #2d7a2d; font-weight: 600; }
      .status-in_bearbeitung { color: #c07000; font-weight: 600; }
      .status-geplant { color: #555; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h3>Montageliste – Stand ${today} (${orders.length} Aufträge)</h3>
    <table>
      <thead><tr><th>Nr.</th><th>Projekt</th><th>Datum</th><th>Kunde</th><th>Montageadresse</th><th>Techniker</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { UI.toast('Popup blockiert – bitte Popups erlauben', 'error'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  },

  // ── Planer: items table editor ───────────────────────────────────────────
  _planerItemCount: 0,
  planerItemRow(i, item = {}) {
    return `<tr id="p-item-row-${i}">
      <td><input type="text" id="p-item-name-${i}" value="${UI.esc(item.name||'')}" placeholder="Artikel / Beschreibung"></td>
      <td><input type="number" id="p-item-qty-${i}" value="${UI.esc(String(item.quantity||'1'))}" min="0" step="0.1" style="width:70px"></td>
      <td><input type="text" id="p-item-unit-${i}" value="${UI.esc(item.unit||'Stk.')}" style="width:60px"></td>
      <td><button class="del-btn" onclick="PlanerViews.removePlanerItemRow(${i})">✕</button></td>
    </tr>`;
  },
  addPlanerItemRow() {
    const tbody = document.getElementById('p-items-rows');
    if (!tbody) return;
    const i = PlanerViews._planerItemCount++;
    tbody.insertAdjacentHTML('beforeend', PlanerViews.planerItemRow(i));
  },
  removePlanerItemRow(i) { document.getElementById(`p-item-row-${i}`)?.remove(); },
  getPlanerItemRows() {
    const items = [];
    document.querySelectorAll('#p-items-rows tr').forEach(row => {
      const id = row.id.replace('p-item-row-', '');
      const name = document.getElementById(`p-item-name-${id}`)?.value.trim();
      const qty  = document.getElementById(`p-item-qty-${id}`)?.value;
      const unit = document.getElementById(`p-item-unit-${id}`)?.value.trim();
      if (name) items.push({ name, quantity: parseFloat(qty) || 1, unit: unit || 'Stk.', _source: 'planer' });
    });
    return items;
  },

  async sendOrderToCustomer(orderId) {
    try {
      const res = await API.orderCustomerForm(orderId);
      const url = res.url;
      await navigator.clipboard.writeText(url).catch(() => {});
      UI.modal('Kundenformular-Link',
        `<p class="mb-3">Der Formular-Link wurde in die Zwischenablage kopiert.</p>
         <div style="background:var(--bg3);padding:10px;border-radius:6px;word-break:break-all;font-size:13px;font-family:monospace">${UI.esc(url)}</div>`,
        `<button class="btn btn-primary" onclick="navigator.clipboard.writeText('${UI.esc(url)}');UI.toast('Link kopiert','success')">Nochmals kopieren</button>
         <button class="btn btn-ghost" onclick="UI.closeModal()">Schliessen</button>`
      );
      UI.toast('Formular-Link erstellt und kopiert', 'success');
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  // ── Order Form (Create / Edit) ──────────────────────────────────────────
  async renderOrderForm(orderId) {
    await this._loadMeta();
    let order = null;
    if (orderId) order = await API.getOrder(orderId);

    const opts = this._options;
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
          ${order ? `<button class="btn btn-ghost" onclick="PlanerViews.sendOrderToCustomer(${orderId})">📧 An Kunden senden</button>` : ''}
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
              <input type="text" id="f-customer-name" value="${UI.esc(order?.customer_name||'')}" placeholder="z.B. Muster AG">
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
              <label>Projektnummer</label>
              <input type="text" id="f-project-number" value="${UI.esc(order?.project_number||'')}" placeholder="z.B. PR26-001">
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

      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📦 Material / Positionen (Lieferschein)</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <table class="items-table">
            <thead><tr>
              <th>Artikel / Beschreibung</th><th style="width:90px">Menge</th><th style="width:70px">Einheit</th><th style="width:36px"></th>
            </tr></thead>
            <tbody id="p-items-rows">
              ${(order?.items_table||[]).map((item, i) => PlanerViews.planerItemRow(i, item)).join('')}
            </tbody>
          </table>
          <button class="btn btn-ghost btn-sm mt-2" onclick="PlanerViews.addPlanerItemRow()">+ Zeile</button>
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

    PlanerViews._planerItemCount = (order?.items_table||[]).length;

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

  async saveOrder(orderId) {
    const data = {
      customer_id:           null,
      customer_name:         document.getElementById('f-customer-name').value.trim(),
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
      items_table:           PlanerViews.getPlanerItemRows(),
      project_number:        document.getElementById('f-project-number')?.value.trim() || null,
    };

    if (!data.customer_name) { UI.toast('Kundenname erforderlich','error'); return; }
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

    const filteredOrders = PlanerViews._filteredOrders || PlanerViews._allOrders;
    const idx = filteredOrders.findIndex(o => o.id === orderId);
    const prevOrder = idx > 0 ? filteredOrders[idx - 1] : null;
    const nextOrder = idx < filteredOrders.length - 1 ? filteredOrders[idx + 1] : null;

    main.innerHTML = `
      <div class="page-header" style="flex-wrap:wrap">
        <div class="flex gap-2 align-items-center flex-wrap">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderOrders()">← Zurück</button>
          <h2>${order.project_number ? `Projekt ${fv(order.project_number)}` : `Auftrag ${fv(order.order_number)}`}</h2>
          ${order.project_number ? `<span class="text-muted text-sm">${fv(order.order_number)}</span>` : ''}
          ${UI.statusBadge(order.status)}
        </div>
        <div class="flex gap-2 flex-wrap align-items-center">
          ${filteredOrders.length > 1 ? `
          <div class="flex gap-1 align-items-center">
            <button class="btn btn-ghost btn-sm" ${!prevOrder ? 'disabled' : ''} onclick="PlanerViews.renderOrderDetail(${prevOrder?.id})">← Vorheriger</button>
            <span class="text-muted text-sm" style="white-space:nowrap">${idx + 1} / ${filteredOrders.length}</span>
            <button class="btn btn-ghost btn-sm" ${!nextOrder ? 'disabled' : ''} onclick="PlanerViews.renderOrderDetail(${nextOrder?.id})">Nächster →</button>
          </div>` : ''}
          <button class="btn btn-ghost" onclick="window.print()">🖨 Drucken</button>
          <button class="btn btn-ghost" onclick="PlanerViews.openEmailModal(${order.id})">✉️ Per E-Mail</button>
          <button class="btn btn-ghost" onclick="PlanerViews.sendOrderToCustomer(${order.id})">📧 An Kunden senden</button>
          <button class="btn btn-primary" onclick="PlanerViews.renderOrderForm(${order.id})">Bearbeiten</button>
        </div>
      </div>

      <div class="form-grid">
        <div class="card">
          <div class="card-title">Auftragsinformation</div>
          ${[
            ['Auftragsnummer', fv(order.order_number)],
            ...(order.project_number ? [['Projektnummer', fv(order.project_number)]] : []),
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
            <p class="text-sm text-muted mb-2">Material / Positionen (Lieferschein)</p>
            <table class="items-table">
              <thead><tr><th>Artikel</th><th>Menge</th><th>Einheit</th></tr></thead>
              <tbody>${order.items_table.map(i => `<tr><td>${UI.esc(i.name)}</td><td>${UI.esc(i.quantity)}</td><td>${UI.esc(i.unit)}</td></tr>`).join('')}</tbody>
            </table>
          </div>` : ''}

          ${(order.extra_material?.length || order.extra_aufwand) ? `
          <div class="mt-3" style="border:2px solid #d48a00;border-radius:8px;padding:12px;background:rgba(212,138,0,.06)">
            <p class="text-sm mb-2" style="font-weight:700;color:#d48a00">⚠️ Nicht auf LS aufgeführt</p>
            ${order.extra_material?.length ? `
            <table class="items-table mb-2">
              <thead><tr><th>Artikel</th><th>Menge</th><th>Einheit</th></tr></thead>
              <tbody>${order.extra_material.map(i => `<tr><td>${UI.esc(i.name)}${i.article_number ? ` <code style="font-size:11px;color:var(--text2)">${UI.esc(i.article_number)}</code>` : ''}</td><td>${UI.esc(String(i.quantity))}</td><td>${UI.esc(i.unit)}</td></tr>`).join('')}</tbody>
            </table>` : ''}
            ${order.extra_aufwand ? `<div class="flex mb-1 gap-2"><span style="width:150px;font-size:12px;color:var(--text2);font-weight:600">Mehraufwand</span><span>${fv(order.extra_aufwand)} Std.</span></div>` : ''}
            ${order.extra_argumentation ? `<div class="flex gap-2"><span style="width:150px;font-size:12px;color:var(--text2);font-weight:600">Argumentation</span><span>${fv(order.extra_argumentation)}</span></div>` : ''}
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
      <div class="card"><div class="table-wrap"><div id="anfragen-list">Lade…</div></div></div>`;
    await PlanerViews.loadAnfragenTable();
  },

  async loadAnfragenTable() {
    let rows;
    try { rows = await API.getAnfragen(); }
    catch(e) { document.getElementById('anfragen-list').innerHTML = `<p class="text-danger">${UI.esc(e.message)}</p>`; return; }

    const anfrageBadge = s => ({
      neu:            '<span class="badge badge-warn">Neu</span>',
      versendet:      '<span class="badge badge-info">Versendet</span>',
      'ausgefüllt':   '<span class="badge badge-orange">Ausgefüllt</span>',
      in_bearbeitung: '<span class="badge badge-blue">In Bearbeitung</span>',
      erledigt:       '<span class="badge badge-ok">Erledigt</span>',
    }[s] || `<span class="badge badge-gray">${s}</span>`);

    const el = document.getElementById('anfragen-list');
    if (!el) return;
    el.innerHTML = rows.length ? `<table>
      <thead><tr>
        <th>Datum</th><th>Name / Firma</th><th>Ort</th><th>Art</th><th>Termin</th><th>Status</th><th>Auftrag</th><th></th>
      </tr></thead>
      <tbody>
      ${rows.map(a => `<tr>
        <td style="white-space:nowrap">${UI.fmtDate(a.created_at?.split('T')[0] || a.created_at?.substring(0,10))}</td>
        <td>
          <strong>${UI.esc(a.vorname)} ${UI.esc(a.nachname)}</strong>
          ${a.firma ? `<br><span class="text-muted text-sm">${UI.esc(a.firma)}</span>` : ''}
        </td>
        <td>${UI.esc(a.plz)} ${UI.esc(a.ort)}</td>
        <td>${UI.esc(a.art_der_arbeit || '–')}</td>
        <td>${a.wunschtermin ? UI.fmtDate(a.wunschtermin) : '–'}</td>
        <td>${anfrageBadge(a.status)}</td>
        <td>${a.order_number ? `<code>${UI.esc(a.order_number)}</code>${a.order_status ? ' ' + UI.statusBadge(a.order_status) : ''}` : '–'}</td>
        <td class="text-right" style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.renderAnfrageDetail(${a.id})">Ansicht</button>
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.editAnfrage(${a.id})">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="PlanerViews.sendAnfrageLink(${a.id})" title="Formular-Link generieren & kopieren">🔗</button>
          ${a.status !== 'erledigt' ? `<button class="btn btn-primary btn-sm" onclick="PlanerViews.doConvert(${a.id})">→ Auftrag</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="PlanerViews.deleteAnfrage(${a.id})">✕</button>
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

    const tokenUrl = a.token ? `${location.origin}/anfrage/f/${a.token}` : null;

    UI.modal(`Anfrage von ${a.vorname} ${a.nachname}`,
      `<div style="max-height:60vh;overflow-y:auto">
        ${tokenUrl ? `<div style="background:var(--bg3);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px">
          <strong style="color:var(--accent)">🔗 Kunden-Link:</strong>
          <span style="color:var(--text2);word-break:break-all"> ${tokenUrl}</span>
          <button onclick="navigator.clipboard.writeText('${tokenUrl}').then(()=>UI.toast('Link kopiert','success'))" style="margin-left:8px;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--accent)">Kopieren</button>
        </div>` : ''}
        ${a.order_number ? `<div style="background:rgba(26,79,160,.08);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px">
          <strong>Verknüpfter Auftrag:</strong> ${UI.esc(a.order_number)} — ${UI.statusBadge(a.order_status||'')}
          ${a.order_planned_date ? ` · <strong>Datum:</strong> ${UI.fmtDate(a.order_planned_date)}` : ''}
        </div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${[
            ['Kontaktdaten',''],
            ['Firma', a.firma],
            ['Name', `${a.vorname} ${a.nachname}`],
            ['E-Mail', a.email ? `<a href="mailto:${UI.esc(a.email)}">${fv(a.email)}</a>` : '–'],
            ['Telefon', a.telefon ? `<a href="tel:${UI.esc(a.telefon)}">${fv(a.telefon)}</a>` : '–'],
            ['Montageadresse',''],
            ['Adresse', `${a.strasse}, ${a.plz} ${a.ort}`],
            ['Objekt & Sibox',''],
            ['Objektart', a.objektart],
            ['Art der Arbeit', a.art_der_arbeit],
            ['Anzahl Türen', a.anzahl_tueren],
            ['Zylinder (ca.)', a.anzahl_zylinder],
            ['Schlüssel (ca.)', a.anzahl_schluessel],
            ['Bestehendes System', yn(a.bestehendes_system)],
            ['Terminwunsch',''],
            ['Wunschtermin', a.wunschtermin ? UI.fmtDate(a.wunschtermin) : '–'],
            ['Alternativtermin', a.alternativtermin ? UI.fmtDate(a.alternativtermin) : '–'],
            ['Präferenz', a.terminpraeferenz],
            ...(a.bemerkungen ? [['Bemerkungen', a.bemerkungen]] : []),
          ].map(([l,v]) => v === '' ?
            `<tr><td colspan="2" style="padding:12px 0 4px;font-weight:700;color:var(--accent);font-size:10px;text-transform:uppercase;letter-spacing:.07em">${l}</td></tr>` :
            `<tr><td style="width:150px;color:var(--text2);padding:4px 0;font-size:12px">${l}</td><td style="padding:4px 0">${v ? String(v).includes('<') ? v : fv(v) : '<span class="text-muted">–</span>'}</td></tr>`
          ).join('')}
        </table>
        ${a.attachments?.length ? `<div style="margin-top:14px"><strong style="font-size:12px;color:var(--text2)">Anhänge</strong>
          ${a.attachments.map(att => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span>📄</span>
            <a href="/api/anfragen/${a.id}/attachment/${att.filename}" target="_blank">${UI.esc(att.original_name)}</a>
          </div>`).join('')}
        </div>` : ''}
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Schliessen</button>
       <button class="btn btn-ghost" onclick="UI.closeModal();PlanerViews.editAnfrage(${a.id})">✏️ Bearbeiten</button>
       ${a.status !== 'erledigt' ? `<button class="btn btn-primary" onclick="UI.closeModal();PlanerViews.doConvert(${a.id})">→ Zu Auftrag</button>` : ''}`
    );
  },

  async editAnfrage(id) {
    let a;
    try { a = await API.getAnfrage(id); }
    catch(e) { UI.toast(e.message, 'error'); return; }

    UI.modal(`Anfrage bearbeiten – ${a.vorname} ${a.nachname}`,
      `<div style="max-height:65vh;overflow-y:auto">
        <div class="form-grid">
          <div class="field"><label>Firma</label><input type="text" id="ea-firma" value="${UI.esc(a.firma||'')}"></div>
          <div class="field"><!-- spacer --></div>
          <div class="field"><label>Vorname *</label><input type="text" id="ea-vorname" value="${UI.esc(a.vorname||'')}"></div>
          <div class="field"><label>Nachname *</label><input type="text" id="ea-nachname" value="${UI.esc(a.nachname||'')}"></div>
          <div class="field"><label>E-Mail *</label><input type="email" id="ea-email" value="${UI.esc(a.email||'')}"></div>
          <div class="field"><label>Telefon *</label><input type="tel" id="ea-telefon" value="${UI.esc(a.telefon||'')}"></div>
          <div class="field span-2"><label>Strasse *</label><input type="text" id="ea-strasse" value="${UI.esc(a.strasse||'')}"></div>
          <div class="field"><label>PLZ *</label><input type="text" id="ea-plz" value="${UI.esc(a.plz||'')}"></div>
          <div class="field"><label>Ort *</label><input type="text" id="ea-ort" value="${UI.esc(a.ort||'')}"></div>
          <div class="field"><label>Objektart</label>
            <select id="ea-objektart">
              <option value="">–</option>
              ${['Einfamilienhaus','Mehrfamilienhaus','Gewerbe','Industrie','Öffentlich','Andere'].map(v => `<option ${a.objektart===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Art der Arbeit</label>
            <select id="ea-art">
              <option value="">–</option>
              ${['Neuinstallation','Erweiterung','Reparatur','Service/Wartung'].map(v => `<option ${a.art_der_arbeit===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Anzahl Türen</label><input type="number" id="ea-tueren" value="${a.anzahl_tueren||''}"></div>
          <div class="field"><label>Anzahl Zylinder</label><input type="number" id="ea-zylinder" value="${a.anzahl_zylinder||''}"></div>
          <div class="field"><label>Anzahl Schlüssel</label><input type="number" id="ea-schluessel" value="${a.anzahl_schluessel||''}"></div>
          <div class="field"><!-- spacer --></div>
          <div class="field"><label>Wunschtermin</label><input type="date" id="ea-wunsch" value="${UI.esc(a.wunschtermin||'')}"></div>
          <div class="field"><label>Alternativtermin</label><input type="date" id="ea-alt" value="${UI.esc(a.alternativtermin||'')}"></div>
          <div class="field span-2"><label>Bemerkungen</label><textarea id="ea-bemerkungen">${UI.esc(a.bemerkungen||'')}</textarea></div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="PlanerViews.saveAnfrage(${id})">Speichern</button>`
    );
  },

  async saveAnfrage(id) {
    const g = (s) => document.getElementById(s)?.value?.trim() || null;
    const data = {
      firma: g('ea-firma'),
      vorname: g('ea-vorname'),
      nachname: g('ea-nachname'),
      email: g('ea-email'),
      telefon: g('ea-telefon'),
      strasse: g('ea-strasse'),
      plz: g('ea-plz'),
      ort: g('ea-ort'),
      objektart: g('ea-objektart'),
      art_der_arbeit: g('ea-art'),
      anzahl_tueren: g('ea-tueren') ? parseInt(g('ea-tueren')) : null,
      anzahl_zylinder: g('ea-zylinder') ? parseInt(g('ea-zylinder')) : null,
      anzahl_schluessel: g('ea-schluessel') ? parseInt(g('ea-schluessel')) : null,
      wunschtermin: g('ea-wunsch'),
      alternativtermin: g('ea-alt'),
      bemerkungen: g('ea-bemerkungen'),
    };
    try {
      await API.updateAnfrage(id, data);
      UI.closeModal();
      UI.toast('Anfrage gespeichert', 'success');
      await PlanerViews.loadAnfragenTable();
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async sendAnfrageLink(id) {
    try {
      const res = await API.generateAnfrageToken(id);
      const url = res.url || `${location.origin}/anfrage/f/${res.token}`;
      await navigator.clipboard.writeText(url);
      UI.toast('Kunden-Link kopiert! Status → Versendet', 'success', 5000);
      await PlanerViews.loadAnfragenTable();
    } catch(e) {
      UI.toast(e.message || 'Fehler beim Generieren des Links', 'error');
    }
  },

  async doConvert(id) {
    if (!await UI.confirm('Anfrage in einen neuen Auftrag umwandeln?')) return;
    try {
      const res = await API.convertAnfrage(id);
      UI.toast(`Auftrag ${res.order_number} erstellt`, 'success', 4000);
      await PlanerViews.loadAnfragenTable();
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  async deleteAnfrage(id) {
    if (!await UI.confirm('Anfrage dauerhaft löschen?')) return;
    try { await API.deleteAnfrage(id); UI.toast('Anfrage gelöscht', 'success'); await PlanerViews.loadAnfragenTable(); }
    catch(e) { UI.toast(e.message, 'error'); }
  },

  copyAnfrageLink() {
    const url = `${location.origin}/anfrage`;
    navigator.clipboard.writeText(url)
      .then(() => UI.toast('Link kopiert: ' + url, 'success', 4000))
      .catch(() => UI.toast('Link: ' + url, 'info', 6000));
  },

  // ── Excel Import ────────────────────────────────────────────────────────
  openImport() {
    UI.modal('Excel Import – Aufträge',
      `<p class="text-muted text-sm mb-3">
        <strong>Standard-Format:</strong> Spalten: <code>Kunde</code>, <code>Montagedatum</code>, <code>Montageadresse</code>, <code>Besteller</code>, <code>Bemerkungen</code>, <code>Projekt</code><br>
        <strong>ERPNext Lieferschein:</strong> Spalten: <code>ID</code>, <code>Kunde</code>, <code>Datum</code>, <code>Anweisungen</code>, <code>Projekt</code>, <code>Artikel-Code</code>, <code>Artikelname</code>, <code>Anzahl</code>, <code>Einheit</code> (Lieferschein-Artikel)
      </p>
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
UI.statusName = s => ({
  geplant:'Geplant', in_bearbeitung:'In Bearbeitung',
  abgeschlossen:'Abgeschlossen', archiviert:'Archiviert',
  versendet:'Versendet', 'ausgefüllt':'Ausgefüllt',
}[s] || s);

UI.toggleSection = function(header) {
  header.classList.toggle('open');
  const body = header.nextElementSibling;
  body.classList.toggle('collapsed');
};
