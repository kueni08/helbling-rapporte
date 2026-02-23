// ── Monteur Views ────────────────────────────────────────────────────────
const MonteurViews = {
  _options: null,
  _sigPad:  null,

  async _loadMeta() {
    if (!this._options) this._options = await API.getOptions();
  },

  // ── My Assignments List ─────────────────────────────────────────────────
  async renderMyOrders() {
    const el = document.getElementById('main-content');
    el.innerHTML = `
      <div class="page-header">
        <h2>📅 Meine Aufträge</h2>
        <div class="flex gap-2">
          <input type="date" id="m-filter-date" style="width:160px" onchange="MonteurViews.applyFilter()"
            value="${new Date().toISOString().split('T')[0]}">
          <button class="btn btn-ghost btn-sm" onclick="MonteurViews.clearFilter()">Alle anzeigen</button>
        </div>
      </div>
      <div id="monteur-orders-list">Lade…</div>`;
    await MonteurViews.loadMyOrders();
  },

  _myOrders: [],
  async loadMyOrders() {
    this._myOrders = await API.getOrders();
    MonteurViews.applyFilter();
  },

  clearFilter() {
    const d = document.getElementById('m-filter-date');
    if (d) d.value = '';
    MonteurViews.applyFilter();
  },

  applyFilter() {
    const date = document.getElementById('m-filter-date')?.value || '';
    let orders = MonteurViews._myOrders.filter(o => o.status !== 'archiviert');
    if (date) orders = orders.filter(o => (o.planned_date||'').startsWith(date));

    const el = document.getElementById('monteur-orders-list');
    if (!el) return;

    if (!orders.length) {
      el.innerHTML = `<div class="card"><p class="text-muted text-sm">Keine Aufträge für diesen Tag.</p></div>`;
      return;
    }

    el.innerHTML = orders.map((o, idx) => `
      <div class="card" style="cursor:pointer" onclick="MonteurViews.renderWorkForm(${o.id})">
        <div class="flex gap-3 align-items-start">
          <div style="background:var(--accent);color:#fff;border-radius:50%;width:32px;height:32px;
            display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:13px">
            ${idx + 1}
          </div>
          <div style="flex:1;min-width:0">
            <div class="flex gap-2 align-items-center mb-1">
              <strong>${UI.esc(o.customer_name || o.cust_name || 'Unbekannt')}</strong>
              ${UI.statusBadge(o.status)}
            </div>
            <div class="text-sm text-muted">${UI.esc(o.installation_address || '–')}</div>
            <div class="flex gap-3 mt-2 text-sm">
              <span>📅 ${UI.fmtDate(o.planned_date)}</span>
              ${o.arrival_time ? `<span>🕐 ${UI.esc(o.arrival_time)}</span>` : ''}
              <span>📋 ${UI.esc(o.order_number)}</span>
            </div>
          </div>
          <div>
            <button class="btn btn-primary btn-sm">Auftrag öffnen →</button>
          </div>
        </div>
      </div>`).join('');
  },

  // ── Work Form (Monteur fills in) ────────────────────────────────────────
  async renderWorkForm(orderId) {
    await this._loadMeta();
    const order = await API.getOrder(orderId);
    const opts = this._options;
    const main = document.getElementById('main-content');

    main.innerHTML = `
      <div class="page-header">
        <div class="flex gap-2 align-items-center">
          <button class="btn btn-ghost btn-sm" onclick="MonteurViews.renderMyOrders()">← Zurück</button>
          <h2>Auftrag ${UI.esc(order.order_number)}</h2>
          ${UI.statusBadge(order.status)}
        </div>
        <button class="btn btn-primary" onclick="MonteurViews.saveWork(${orderId})">Speichern</button>
      </div>

      <!-- READ-ONLY: Order info from planer -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📄 Auftragsinformation</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          ${[
            ['Kunde',           order.customer_name || order.cust_name || '–'],
            ['Kundenadresse',   order.customer_address || order.cust_address || '–'],
            ['Montageadresse',  order.installation_address || '–'],
            ['Besteller',       order.orderer || '–'],
            ['Kontakt vor Ort', order.on_site_contact || '–'],
            ['Ankunftszeit',    order.arrival_time || '–'],
            ['Montagedatum',    UI.fmtDate(order.planned_date)],
            ['Spätestes Datum', UI.fmtDate(order.latest_date)],
            ['Arbeit',          (order.work_types||[]).join(', ') || '–'],
          ].map(([l,v]) => `<div class="flex mb-2 gap-2">
            <span style="width:180px;flex-shrink:0;color:var(--text2);font-size:12px;font-weight:600">${l}</span>
            <span>${UI.esc(String(v))}</span>
          </div>`).join('')}
          ${order.notes_planer ? `<div class="flex mb-2 gap-2">
            <span style="width:180px;flex-shrink:0;color:var(--text2);font-size:12px;font-weight:600">Bemerkungen</span>
            <span>${UI.esc(order.notes_planer)}</span>
          </div>` : ''}

          ${order.photos?.length ? `
          <p class="text-sm text-muted mt-3 mb-2">Fotos Montagestandort</p>
          <div class="photo-grid">
            ${order.photos.map(p => `<div class="photo-thumb">
              <img src="${API.fileUrl(order.id, p.filename)}" alt="">
            </div>`).join('')}
          </div>` : ''}

          ${order.attachments?.length ? `
          <p class="text-sm text-muted mt-3 mb-2">Anhänge</p>
          <div class="file-list">
            ${order.attachments.map(a => `<div class="file-item">
              <span>📄</span>
              <a href="${API.fileUrl(order.id, a.filename)}" target="_blank" class="file-name">${UI.esc(a.original_name)}</a>
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <!-- MONTEUR: Executed work -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>🔧 Ausgeführte Arbeiten</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <div class="field mb-3">
            <label>Ausgeführte Arbeiten</label>
            ${UI.multiCheck('ausgefuehrte_arbeiten', opts.ausgefuehrte_arbeiten || [], order.executed_work || [])}
          </div>

          <!-- Items table -->
          <div class="field mb-3">
            <label>Material / Positionen</label>
            <table class="items-table" id="items-table-body">
              <thead><tr>
                <th>Artikel / Beschreibung</th><th style="width:80px">Menge</th><th style="width:70px">Einheit</th><th style="width:36px"></th>
              </tr></thead>
              <tbody id="items-rows">
                ${(order.items_table||[]).map((item, i) => MonteurViews.itemRow(i, item)).join('')}
              </tbody>
            </table>
            <button class="btn btn-ghost btn-sm mt-2" onclick="MonteurViews.addItemRow()">+ Zeile hinzufügen</button>
          </div>

          <!-- Additional material -->
          <div class="field mb-3">
            <label>Zusätzliches Material</label>
            ${UI.multiCheck('zusatz_material', opts.zusatz_material || [], order.additional_material || [])}
          </div>

          <div class="field mb-3">
            <label>Bemerkungen</label>
            <textarea id="f-notes-monteur">${UI.esc(order.notes_monteur||'')}</textarea>
          </div>
        </div>
      </div>

      <!-- Halteringe & Schlüssel -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>🔑 Halteringe & Schlüssel</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <div class="form-grid">
            <div>
              <p class="text-sm text-muted mb-2">Halteringe</p>
              ${UI.multiCheck('halteringe', opts.halteringe || [], order.rings_data?.type ? [order.rings_data.type] : [])}
              <div class="flex gap-2 mt-2">
                <div class="field flex-1">
                  <label>Anzahl Stk.</label>
                  <input type="number" id="f-rings-count" value="${UI.esc(String(order.rings_data?.count||''))}" min="0">
                </div>
                <div class="field flex-1">
                  <label>Bemerkung</label>
                  <input type="text" id="f-rings-note" value="${UI.esc(order.rings_data?.note||'')}">
                </div>
              </div>
            </div>
            <div>
              <p class="text-sm text-muted mb-2">Schlüssel</p>
              ${UI.multiCheck('schluessel', opts.schluessel || [], order.keys_data?.type ? [order.keys_data.type] : [])}
              <div class="form-grid-3 mt-2">
                <div class="field">
                  <label>Anzahl Stk.</label>
                  <input type="number" id="f-keys-count" value="${UI.esc(String(order.keys_data?.count||''))}" min="0">
                </div>
                <div class="field">
                  <label>Nr.</label>
                  <input type="text" id="f-keys-id" value="${UI.esc(order.keys_data?.id||'')}">
                </div>
                <div class="field">
                  <label>Bemerkung</label>
                  <input type="text" id="f-keys-note" value="${UI.esc(order.keys_data?.note||'')}">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Time & Technician -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>⏱ Zeiten & Techniker</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <div class="form-grid">
            <div class="field">
              <label>Datum <span class="req">*</span></label>
              <input type="date" id="f-work-date" value="${UI.esc(order.work_date || new Date().toISOString().split('T')[0])}">
            </div>
            <div class="field"></div>
            <div class="field">
              <label>Arbeitszeit exkl. Anfahrt – von</label>
              <input type="time" id="f-work-from" value="${UI.esc(order.work_time_from||'')}">
            </div>
            <div class="field">
              <label>Arbeitszeit exkl. Anfahrt – bis</label>
              <input type="time" id="f-work-to" value="${UI.esc(order.work_time_to||'')}">
            </div>
            <div class="field">
              <label>Techniker (Druckschrift) <span class="req">*</span></label>
              <input type="text" id="f-technician" value="${UI.esc(order.technician_name || (App.state?.fullName||''))}">
            </div>
            <div class="field">
              <label>Blockschrift</label>
              <input type="text" id="f-block" value="${UI.esc(order.technician_block||'')}">
            </div>
          </div>
        </div>
      </div>

      <!-- Signature -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>✍️ Unterschrift Kunde</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <p class="text-muted text-sm mb-2">Bitte Unterschrift des Kunden hier einholen:</p>
          <div class="sig-wrap" style="max-width:500px">
            <canvas id="sig-canvas" style="height:150px;cursor:crosshair"></canvas>
          </div>
          <div class="sig-actions mt-2">
            <button class="btn btn-ghost btn-sm" onclick="MonteurViews.clearSig()">Löschen</button>
          </div>
          <p class="text-muted text-sm mt-3">Es gelten unsere AGB's.</p>

          <div class="field mt-3">
            <label>Status</label>
            <select id="f-m-status">
              <option value="in_bearbeitung" ${order.status==='in_bearbeitung'?'selected':''}>In Bearbeitung</option>
              <option value="abgeschlossen" ${order.status==='abgeschlossen'?'selected':''}>Abgeschlossen</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Upload photos -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📸 Fotos hochladen</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body" id="monteur-photos-section">
          ${MonteurViews.renderPhotosSection(order)}
        </div>
      </div>

      <div class="flex gap-2 mt-3 mb-3">
        <button class="btn btn-primary" onclick="MonteurViews.saveWork(${orderId})">Speichern & Abschicken</button>
        <button class="btn btn-ghost" onclick="MonteurViews.renderMyOrders()">Abbrechen</button>
      </div>
    `;

    // Init signature pad
    setTimeout(() => {
      const canvas = document.getElementById('sig-canvas');
      if (!canvas) return;
      canvas.style.width = '100%';
      MonteurViews._sigPad = UI.initSignaturePad(canvas);
      if (order.signature_data) {
        MonteurViews._sigPad.setData(order.signature_data);
      }
    }, 50);

    window._monteurOrderId = orderId;
    MonteurViews._itemCount = (order.items_table||[]).length;
  },

  _itemCount: 0,
  itemRow(i, item = {}) {
    return `<tr id="item-row-${i}">
      <td><input type="text" id="item-name-${i}" value="${UI.esc(item.name||'')}"></td>
      <td><input type="number" id="item-qty-${i}" value="${UI.esc(String(item.quantity||''))}" min="0" step="0.1"></td>
      <td><input type="text" id="item-unit-${i}" value="${UI.esc(item.unit||'Stk.')}" style="width:60px"></td>
      <td><button class="del-btn" onclick="MonteurViews.removeItemRow(${i})">✕</button></td>
    </tr>`;
  },

  addItemRow() {
    const tbody = document.getElementById('items-rows');
    const i = MonteurViews._itemCount++;
    tbody.insertAdjacentHTML('beforeend', MonteurViews.itemRow(i));
  },

  removeItemRow(i) {
    document.getElementById(`item-row-${i}`)?.remove();
  },

  getItemRows() {
    const items = [];
    document.querySelectorAll('#items-rows tr').forEach(row => {
      const id = row.id.replace('item-row-','');
      const name = document.getElementById(`item-name-${id}`)?.value.trim();
      const qty  = document.getElementById(`item-qty-${id}`)?.value;
      const unit = document.getElementById(`item-unit-${id}`)?.value.trim();
      if (name) items.push({ name, quantity: qty || '', unit: unit || 'Stk.' });
    });
    return items;
  },

  clearSig() {
    MonteurViews._sigPad?.clear();
  },

  renderPhotosSection(order) {
    const photos = order.photos || [];
    return `
      <div class="photo-grid mb-2" id="m-photo-grid">
        ${photos.map(p => `<div class="photo-thumb" id="m-photo-${p.id}">
          <img src="${API.fileUrl(order.id, p.filename)}" alt="">
          <button class="del-photo" onclick="MonteurViews.delPhoto(${order.id},${p.id})">✕</button>
        </div>`).join('')}
      </div>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">
        📷 Bilder hochladen
        <input type="file" id="m-photo-upload" multiple accept="image/*" capture="environment"
          style="display:none" onchange="MonteurViews.uploadPhotos(${order.id})">
      </label>`;
  },

  async uploadPhotos(orderId) {
    const inp = document.getElementById('m-photo-upload');
    if (!inp?.files.length) return;
    const form = new FormData();
    [...inp.files].forEach(f => form.append('photos', f));
    try {
      await API.uploadPhotos(orderId, form);
      UI.toast('Fotos hochgeladen','success');
      const order = await API.getOrder(orderId);
      document.getElementById('monteur-photos-section').innerHTML = MonteurViews.renderPhotosSection(order);
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async delPhoto(orderId, photoId) {
    try {
      await API.deletePhoto(orderId, photoId);
      document.getElementById(`m-photo-${photoId}`)?.remove();
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async saveWork(orderId) {
    const signatureData = MonteurViews._sigPad?.getData() || null;

    const data = {
      executed_work:      UI.getMultiCheck('ausgefuehrte_arbeiten'),
      items_table:        MonteurViews.getItemRows(),
      additional_material:UI.getMultiCheck('zusatz_material'),
      notes_monteur:      document.getElementById('f-notes-monteur')?.value.trim() || null,
      rings_data: {
        type:  UI.getMultiCheck('halteringe')[0] || null,
        count: document.getElementById('f-rings-count')?.value || null,
        note:  document.getElementById('f-rings-note')?.value.trim() || null,
      },
      keys_data: {
        type:  UI.getMultiCheck('schluessel')[0] || null,
        count: document.getElementById('f-keys-count')?.value || null,
        id:    document.getElementById('f-keys-id')?.value.trim() || null,
        note:  document.getElementById('f-keys-note')?.value.trim() || null,
      },
      work_date:       document.getElementById('f-work-date')?.value || null,
      work_time_from:  document.getElementById('f-work-from')?.value || null,
      work_time_to:    document.getElementById('f-work-to')?.value || null,
      technician_name: document.getElementById('f-technician')?.value.trim() || null,
      technician_block:document.getElementById('f-block')?.value.trim() || null,
      signature_data:  signatureData,
      agb_accepted:    true,
      status:          document.getElementById('f-m-status')?.value || 'in_bearbeitung',
    };

    if (!data.technician_name) { UI.toast('Techniker-Name erforderlich','error'); return; }

    try {
      await API.updateOrder(orderId, data);
      UI.toast('Auftrag gespeichert','success');
      MonteurViews.renderMyOrders();
    } catch(e) { UI.toast(e.message,'error'); }
  },
};
