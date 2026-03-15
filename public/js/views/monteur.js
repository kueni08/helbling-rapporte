// ── Monteur Views ────────────────────────────────────────────────────────
const MonteurViews = {
  _options:  null,
  _articles: null,
  _sigPad:   null,

  async _loadMeta() {
    if (!this._options)  this._options  = await API.getOptions();
    if (!this._articles) this._articles = await API.getArticles();
  },

  // ── My Assignments List ─────────────────────────────────────────────────
  async renderMyOrders() {
    const el = document.getElementById('main-content');
    el.innerHTML = `
      <div class="page-header">
        <h2>Meine Auftr\u00e4ge</h2>
        <div class="flex gap-2">
          <input type="date" id="m-filter-date" style="width:160px" onchange="MonteurViews.applyFilter()"
            value="${new Date().toISOString().split('T')[0]}">
          <button class="btn btn-ghost btn-sm" onclick="MonteurViews.clearFilter()">Alle anzeigen</button>
        </div>
      </div>
      <div id="monteur-orders-list">Lade\u2026</div>`;
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
    // Datumsfilter anwenden, aber abgeschlossene Aufträge immer anzeigen
    if (date) orders = orders.filter(o => o.status === 'abgeschlossen' || (o.planned_date||'').startsWith(date));

    const el = document.getElementById('monteur-orders-list');
    if (!el) return;

    if (!orders.length) {
      el.innerHTML = `<div class="card"><p class="text-muted text-sm">Keine Auftr\u00e4ge f\u00fcr diesen Tag.</p></div>`;
      return;
    }

    el.innerHTML = orders.map((o, idx) => {
      const isRunning = MonteurViews._timerRunning(o.id);
      const projectLabel = o.project_number || o.order_number;
      return `
      <div class="card" style="cursor:pointer" onclick="MonteurViews.renderWorkForm(${o.id})">
        <div class="flex gap-3 align-items-start">
          <div style="background:var(--accent);color:#fff;border-radius:50%;width:32px;height:32px;
            display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:13px">
            ${idx + 1}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:var(--accent);font-size:15px;margin-bottom:2px">
              ${UI.esc(projectLabel)}
            </div>
            <div class="flex gap-2 align-items-center mb-1">
              <strong>${UI.esc(o.customer_name || o.cust_name || 'Unbekannt')}</strong>
              ${UI.statusBadge(o.status)}
            </div>
            <div class="text-sm text-muted">${UI.esc(o.installation_address || '\u2013')}</div>
            <div class="flex gap-3 mt-2 text-sm">
              <span>\ud83d\udcc5 ${UI.fmtDate(o.planned_date)}</span>
              ${o.arrival_time ? `<span>\ud83d\udd50 ${UI.esc(o.arrival_time)}</span>` : ''}
            </div>
          </div>
          <div class="flex gap-2" style="flex-shrink:0">
            <button class="btn ${isRunning ? 'btn-danger' : 'btn-success'} btn-sm"
              onclick="event.stopPropagation(); MonteurViews.quickToggleTimer(${o.id})"
              title="${isRunning ? 'Timer l\u00e4uft' : 'Timer starten'}"
              style="min-width:44px;min-height:44px;font-size:18px;padding:0;display:flex;align-items:center;justify-content:center">
              ${isRunning ? '\u23f9' : '\u25b6'}
            </button>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  quickToggleTimer(orderId) {
    if (MonteurViews._timerRunning(orderId)) {
      // Stop and navigate to form
      MonteurViews.renderWorkForm(orderId);
    } else {
      MonteurViews.startTimer(orderId);
      UI.toast('Timer gestartet', 'success');
      MonteurViews.applyFilter(); // refresh card to show stop icon
    }
  },

  // ── Work Form (Monteur fills in) ────────────────────────────────────────
  async renderWorkForm(orderId) {
    await this._loadMeta();
    const order = await API.getOrder(orderId);
    const opts = this._options;
    const main = document.getElementById('main-content');

    // Separate LS items (from planer/import) and monteur items
    const allItems = order.items_table || [];
    const lsItems = allItems.filter(i => i._source === 'planer');
    const monteurItems = allItems.filter(i => i._source !== 'planer');

    // Prev/Next navigation
    const filteredOrders = MonteurViews._myOrders.filter(o => o.status !== 'archiviert');
    const currentIdx = filteredOrders.findIndex(o => o.id === orderId);
    const prevOrder = currentIdx > 0 ? filteredOrders[currentIdx - 1] : null;
    const nextOrder = currentIdx < filteredOrders.length - 1 ? filteredOrders[currentIdx + 1] : null;

    const projectLabel = order.project_number || order.order_number;
    const isStamped = MonteurViews._isStamped(orderId);
    const isRunning = MonteurViews._timerRunning(orderId);
    const isLocked = order.status === 'abgeschlossen';

    main.innerHTML = `
      <div class="page-header" style="flex-wrap:wrap">
        <div class="flex gap-2 align-items-center">
          <button class="btn btn-ghost btn-sm" onclick="MonteurViews.renderMyOrders()">\u2190 Zur\u00fcck</button>
          <h2 style="color:var(--accent)">${UI.esc(projectLabel)}</h2>
          ${order.project_number ? `<span class="text-muted text-sm">${UI.esc(order.order_number)}</span>` : ''}
          ${UI.statusBadge(order.status)}
        </div>
        <div class="flex gap-2">
          ${prevOrder ? `<button class="btn btn-ghost btn-sm" onclick="MonteurViews.renderWorkForm(${prevOrder.id})">\u2190 Vorheriger</button>` : ''}
          ${nextOrder ? `<button class="btn btn-ghost btn-sm" onclick="MonteurViews.renderWorkForm(${nextOrder.id})">N\u00e4chster \u2192</button>` : ''}
        </div>
      </div>

      ${isLocked ? `
      <div style="background:rgba(45,122,45,.12);border:1px solid #2d7a2d;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">✅</span>
        <span style="font-weight:600;color:#2d7a2d">Auftrag abgeschlossen \u2013 nur Nachtrag-Bemerkungen können noch hinzugefügt werden</span>
      </div>` : ''}

      <fieldset ${isLocked ? 'disabled' : ''} style="border:none;padding:0;margin:0">

      <!-- READ-ONLY: Order info from planer -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>\ud83d\udcc4 Auftragsinformation</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">
          ${[
            ['Kunde',           order.customer_name || order.cust_name || '\u2013'],
            ['Kundenadresse',   order.customer_address || order.cust_address || '\u2013'],
            ['Montageadresse',  order.installation_address || '\u2013'],
            ['Besteller',       order.orderer || '\u2013'],
            ['Kontakt vor Ort', order.on_site_contact || '\u2013'],
            ['Ankunftszeit',    order.arrival_time || '\u2013'],
            ['Montagedatum',    UI.fmtDate(order.planned_date)],
            ['Sp\u00e4testes Datum', UI.fmtDate(order.latest_date)],
            ['Arbeit',          (order.work_types||[]).join(', ') || '\u2013'],
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
          <p class="text-sm text-muted mt-3 mb-2">Anh\u00e4nge</p>
          <div class="file-list">
            ${order.attachments.map(a => `<div class="file-item">
              <span>\ud83d\udcc4</span>
              <a href="${API.fileUrl(order.id, a.filename)}" target="_blank" class="file-name">${UI.esc(a.original_name)}</a>
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <!-- MONTEUR: Executed work -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>\ud83d\udd27 Ausgef\u00fchrte Arbeiten</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">
          <div class="field mb-3">
            <label>Ausgef\u00fchrte Arbeiten</label>
            ${UI.multiCheck('ausgefuehrte_arbeiten', opts.ausgefuehrte_arbeiten || [], order.executed_work || [])}
          </div>

          <div class="field mb-3">
            <label>Bemerkungen</label>
            <textarea id="f-notes-monteur">${UI.esc(order.notes_monteur||'')}</textarea>
          </div>
        </div>
      </div>

      <!-- LS-Artikel (Planer/Import) – eingeklappt -->
      ${lsItems.length ? `
      <div class="card">
        <div class="section-header" onclick="UI.toggleSection(this)">
          <h3>\ud83d\udce6 LS-Artikel (Lieferschein)</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body collapsed">
          <p class="text-sm text-muted mb-2">Vom Planer/Import vordefinierte Positionen. Nur löschen möglich – gelöschte Artikel erscheinen im Rapport durchgestrichen.</p>
          <table class="items-table" id="ls-items-table">
            <thead><tr>
              <th>Artikel / Beschreibung</th><th style="width:80px">Menge</th><th style="width:70px">Einheit</th><th style="width:36px"></th>
            </tr></thead>
            <tbody id="ls-items-rows">
              ${lsItems.map((item, i) => MonteurViews.lsItemRow(i, item)).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <!-- Zusätzliche Positionen (Monteur) – offen -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>\ud83d\udd27 Zus\u00e4tzliche Positionen</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">
          <table class="items-table" id="items-table-body">
            <thead><tr>
              <th>Artikel / Beschreibung</th><th style="width:80px">Menge</th><th style="width:70px">Einheit</th><th style="width:36px"></th>
            </tr></thead>
            <tbody id="items-rows">
              ${monteurItems.map((item, i) => MonteurViews.itemRow(i, item)).join('')}
            </tbody>
          </table>
          <button class="btn btn-ghost btn-sm mt-2" onclick="MonteurViews.addItemRow()">+ Zeile hinzuf\u00fcgen</button>
        </div>
      </div>

      <!-- Nicht auf LS aufgeführt -->
      <div class="card" id="extra-material-card" style="${(order.extra_material?.length || order.extra_aufwand) ? 'border:2px solid #d48a00;background:rgba(212,138,0,.05)' : ''}">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3 style="color:${(order.extra_material?.length || order.extra_aufwand) ? '#d48a00' : 'inherit'}">\u26a0\ufe0f Nicht auf LS aufgef\u00fchrt</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">
          <p class="text-sm text-muted mb-3">Zus\u00e4tzliches Material und Mehraufwand, das nicht auf dem Lieferschein aufgef\u00fchrt ist.</p>

          <div class="field mb-3">
            <label>Artikel hinzuf\u00fcgen</label>
            <div class="flex gap-2">
              <input type="text" id="extra-art-search" list="extra-art-list" placeholder="Artikel suchen\u2026" style="flex:1"
                autocomplete="off" oninput="MonteurViews.filterExtraArticles()">
              <datalist id="extra-art-list">
                ${(MonteurViews._articles||[]).map(a => `<option data-id="${a.id}" data-unit="${UI.esc(a.unit||'Stk.')}" value="${UI.esc(a.article_number ? a.article_number+' \u2013 '+a.name : a.name)}"></option>`).join('')}
              </datalist>
              <input type="number" id="extra-art-qty" value="1" min="0.01" step="0.1" style="width:80px" placeholder="Menge">
              <button class="btn btn-primary btn-sm" onclick="MonteurViews.addExtraRow()">+ Hinzuf\u00fcgen</button>
            </div>
          </div>

          <table class="items-table" id="extra-items-table" style="${(order.extra_material?.length) ? '' : 'display:none'}">
            <thead><tr>
              <th>Artikel</th><th style="width:80px">Menge</th><th style="width:70px">Einheit</th><th style="width:36px"></th>
            </tr></thead>
            <tbody id="extra-rows">
              ${(order.extra_material||[]).map((item, i) => MonteurViews.extraRow(i, item)).join('')}
            </tbody>
          </table>

          <div class="form-grid mt-3">
            <div class="field">
              <label>Mehraufwand (Std.)</label>
              <input type="number" id="f-extra-aufwand" value="${UI.esc(String(order.extra_aufwand||''))}" min="0" step="0.25" placeholder="z.B. 1.5">
            </div>
            <div class="field">
              <label>Argumentation / Begr\u00fcndung</label>
              <input type="text" id="f-extra-argumentation" value="${UI.esc(order.extra_argumentation||'')}" placeholder="Grund f\u00fcr Mehraufwand\u2026">
            </div>
          </div>
        </div>
      </div>

      <!-- Halteringe & Schlüssel -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>\ud83d\udd11 Halteringe & Schl\u00fcssel</h3><span class="toggle">\u25b6</span>
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
              <p class="text-sm text-muted mb-2">Schl\u00fcssel</p>
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
          <h3>\u23f1 Zeiten & Techniker</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">

          <!-- Start/Stop Timer -->
          <div id="timer-box" style="background:var(--bg3);border-radius:8px;padding:14px 16px;margin-bottom:16px">
            <div class="flex gap-3 align-items-center flex-wrap">
              <div id="timer-display" style="font-size:22px;font-weight:700;font-family:monospace;letter-spacing:2px;min-width:90px">
                ${MonteurViews._timerDisplay(orderId)}
              </div>
              <button id="timer-btn-start" class="btn ${isStamped && !isRunning ? 'btn-ghost' : 'btn-primary'}" onclick="MonteurViews.startTimer(${orderId})"
                style="${isRunning ? 'display:none' : ''}">${isStamped ? '\u21bb Neu starten' : '\u25b6 Arbeit starten'}</button>
              <button id="timer-btn-stop" class="btn btn-danger" onclick="MonteurViews.stopTimer(${orderId})"
                style="${isRunning ? '' : 'display:none'}">\u23f9 Arbeit stoppen</button>
              <button class="btn btn-ghost btn-sm" onclick="MonteurViews.resetTimer(${orderId})" title="Timer zur\u00fccksetzen">\u21ba</button>
              ${isStamped && !isRunning ? `<span class="text-sm" style="color:var(--success);font-weight:600">\u2713 Eingestempelt</span>` : ''}
            </div>
          </div>

          <div class="form-grid">
            <div class="field">
              <label>Datum <span class="req">*</span></label>
              <input type="date" id="f-work-date" value="${UI.esc(order.work_date || new Date().toISOString().split('T')[0])}">
            </div>
            <div class="field"></div>
            <div class="field">
              <label>Arbeitszeit exkl. Anfahrt \u2013 von</label>
              <input type="time" id="f-work-from" value="${UI.esc(order.work_time_from||'')}">
            </div>
            <div class="field">
              <label>Arbeitszeit exkl. Anfahrt \u2013 bis</label>
              <input type="time" id="f-work-to" value="${UI.esc(order.work_time_to||'')}">
            </div>
            <div class="field">
              <label>Techniker (Druckschrift) <span class="req">*</span></label>
              <input type="text" id="f-technician" value="${UI.esc(order.technician_name || (App.state?.fullName||''))}">
            </div>
            <div class="field"></div>
          </div>

          <!-- Fahrzeit & Kilometer – intern, erscheint nicht auf Rapport -->
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <p class="text-sm text-muted mb-2" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">
              Fahrzeit & Kilometer (intern \u2013 nicht auf Rapport)
            </p>
            <div class="form-grid">
              <div class="field">
                <label>Fahrzeit / Transferzeit (Std.)</label>
                <input type="number" id="f-travel-time" value="${UI.esc(String(order.travel_time||''))}" min="0" step="0.25" placeholder="z.B. 0.5">
              </div>
              <div class="field">
                <label>Kilometer</label>
                <input type="number" id="f-travel-km" value="${UI.esc(String(order.travel_km||''))}" min="0" step="1" placeholder="z.B. 45">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Signature -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>\u270d\ufe0f Unterschrift Kunde</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body">
          <div class="field mb-3">
            <label>Blockschrift (Name in Druckbuchstaben)</label>
            <input type="text" id="f-block" value="${UI.esc(order.technician_block||'')}" placeholder="Name des Unterzeichners">
          </div>
          <p class="text-muted text-sm mb-2">Bitte Unterschrift des Kunden hier einholen:</p>
          <div class="sig-wrap" id="sig-wrap-container">
            <canvas id="sig-canvas" style="height:150px;cursor:crosshair"></canvas>
          </div>
          <div class="sig-actions mt-2">
            <button class="btn btn-ghost btn-sm" onclick="MonteurViews.clearSig()">L\u00f6schen</button>
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
          <h3>\ud83d\udcf8 Fotos hochladen</h3><span class="toggle">\u25b6</span>
        </div>
        <div class="section-body" id="monteur-photos-section">
          ${MonteurViews.renderPhotosSection(order)}
        </div>
      </div>

      </fieldset>

      ${isLocked ? `
      <!-- Nachtrag (nachträgliche Bemerkungen, nach Abschluss) -->
      <div class="card">
        <div class="section-header open" onclick="UI.toggleSection(this)">
          <h3>📝 Nachtrag</h3><span class="toggle">▶</span>
        </div>
        <div class="section-body">
          <p class="text-sm text-muted mb-2">Nachträgliche Bemerkungen werden mit Datum und Uhrzeit als Nachtrag deklariert und den bisherigen Bemerkungen angefügt.</p>
          <div class="field mb-2">
            <label>Nachträgliche Bemerkung</label>
            <textarea id="f-nachtrag" placeholder="Nachtrag eingeben…" rows="3"></textarea>
          </div>
          <button class="btn btn-primary" onclick="MonteurViews.saveNachtrag(${orderId})">Nachtrag speichern</button>
        </div>
      </div>` : ''}

      ${!isLocked ? `
      <button class="btn btn-success" style="width:100%;margin-top:16px;background:#2d7a2d;font-size:16px;padding:14px" onclick="MonteurViews.closeOrder(${orderId})">✅ Auftrag abschliessen</button>
      ` : ''}

      <!-- Sticky save bar spacer for mobile -->
      <div style="height:80px" class="mobile-save-spacer"></div>

      <!-- Bottom save buttons (hidden on mobile, replaced by sticky bar) -->
      <div class="flex gap-2 mt-3 mb-3 desktop-save-bar flex-wrap">
        ${!isLocked ? `
        <button class="btn btn-primary" onclick="MonteurViews.saveWork(${orderId})">Speichern & Abschicken</button>
        <button class="btn btn-success" onclick="MonteurViews.closeOrder(${orderId})" style="background:#2d7a2d">✅ Auftrag abschliessen</button>
        ` : ''}
        <button class="btn btn-ghost" onclick="MonteurViews.renderMyOrders()">Abbrechen</button>
      </div>

      <!-- Sticky save bar for mobile -->
      <div class="sticky-save-bar" id="sticky-save">
        ${!isLocked ? `<button class="btn btn-primary" style="flex:1" onclick="MonteurViews.saveWork(${orderId})">Speichern & Abschicken</button>` : ''}
        <button class="btn btn-ghost" onclick="MonteurViews.renderMyOrders()">Zurück</button>
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
    MonteurViews._itemCount  = monteurItems.length;
    MonteurViews._extraCount = (order.extra_material||[]).length;
    MonteurViews._lsItems    = lsItems; // store for save

    // Resume timer if it was already running (page reload / navigation)
    if (MonteurViews._timerRunning(orderId)) {
      MonteurViews._startTimerInterval(orderId);
    }
  },

  // ── LS Item Row (read-only, nur löschen möglich) ─────────────────
  lsItemRow(i, item = {}) {
    const deleted = !!item._deleted;
    const s = deleted ? 'text-decoration:line-through;opacity:0.45;' : '';
    return `<tr id="ls-item-row-${i}" data-deleted="${deleted}">
      <td style="${s}">
        <span style="font-weight:500">${UI.esc(item.name||'')}</span>
        ${item.article_number ? `<br><code style="font-size:11px;color:var(--text2)">${UI.esc(item.article_number)}</code>` : ''}
      </td>
      <td style="${s}color:var(--text2);font-size:12px">${UI.esc(String(item.quantity||''))}</td>
      <td style="${s}color:var(--text2);font-size:12px">${UI.esc(item.unit||'Stk.')}</td>
      <td><button class="del-btn" onclick="MonteurViews.toggleLsItemDeleted(${i})" title="${deleted ? 'Wiederherstellen' : 'Löschen'}">${deleted ? '↩' : '×'}</button></td>
    </tr>`;
  },

  toggleLsItemDeleted(i) {
    const row = document.getElementById(`ls-item-row-${i}`);
    if (!row) return;
    const deleted = row.dataset.deleted !== 'true';
    row.dataset.deleted = deleted;
    const s = deleted ? 'text-decoration:line-through;opacity:0.45;' : '';
    row.querySelectorAll('td').forEach((td, idx) => {
      if (idx < 3) td.style.cssText = s + (idx > 0 ? 'color:var(--text2);font-size:12px' : '');
    });
    const btn = row.querySelector('.del-btn');
    if (btn) { btn.textContent = deleted ? '↩' : '×'; btn.title = deleted ? 'Wiederherstellen' : 'Löschen'; }
  },

  getLsItemRows() {
    const lsItems = MonteurViews._lsItems || [];
    return lsItems.map((orig, i) => {
      const row = document.getElementById(`ls-item-row-${i}`);
      const deleted = row?.dataset.deleted === 'true';
      return {
        name: orig.name,
        article_number: orig.article_number || null,
        quantity: orig.quantity,
        unit: orig.unit || 'Stk.',
        _source: 'planer',
        ...(deleted ? { _deleted: true } : {}),
      };
    });
  },

  // ── Monteur Item Row (fully editable) ──────────────────────────────────
  _itemCount: 0,
  itemRow(i, item = {}) {
    return `<tr id="item-row-${i}">
      <td><input type="text" id="item-name-${i}" value="${UI.esc(item.name||'')}"></td>
      <td><input type="number" id="item-qty-${i}" value="${UI.esc(String(item.quantity||''))}" min="0" step="0.1"></td>
      <td><input type="text" id="item-unit-${i}" value="${UI.esc(item.unit||'Stk.')}" style="width:60px"></td>
      <td><button class="del-btn" onclick="MonteurViews.removeItemRow(${i})">\u2715</button></td>
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

  // ── Extra Material (Nicht auf LS) ────────────────────────────────────────
  _extraCount: 0,
  extraRow(i, item = {}) {
    return `<tr id="extra-row-${i}">
      <td>${UI.esc(item.name||'')}${item.article_number ? `<br><code style="font-size:11px;color:var(--text2)">${UI.esc(item.article_number)}</code>` : ''}</td>
      <td><input type="number" id="extra-qty-${i}" value="${UI.esc(String(item.quantity||'1'))}" min="0.01" step="0.1" style="width:70px"
        data-unit="${UI.esc(item.unit||'Stk.')}" data-name="${UI.esc(item.name||'')}" data-artnr="${UI.esc(item.article_number||'')}"></td>
      <td>${UI.esc(item.unit||'Stk.')}</td>
      <td><button class="del-btn" onclick="MonteurViews.removeExtraRow(${i})">\u2715</button></td>
    </tr>`;
  },
  removeExtraRow(i) {
    document.getElementById(`extra-row-${i}`)?.remove();
    MonteurViews._updateExtraHighlight();
  },
  filterExtraArticles() {
    MonteurViews._updateExtraHighlight();
  },
  addExtraRow() {
    const searchEl = document.getElementById('extra-art-search');
    const qtyEl    = document.getElementById('extra-art-qty');
    const val      = searchEl?.value.trim();
    if (!val) { UI.toast('Bitte Artikel eingeben', 'error'); return; }

    const articles = MonteurViews._articles || [];
    const match = articles.find(a =>
      val === (a.article_number ? a.article_number + ' \u2013 ' + a.name : a.name) ||
      val.toLowerCase() === a.name.toLowerCase()
    );

    const qty  = parseFloat(qtyEl?.value) || 1;
    const item = match
      ? { name: match.name, article_number: match.article_number || null, quantity: qty, unit: match.unit || 'Stk.' }
      : { name: val, article_number: null, quantity: qty, unit: 'Stk.' };

    const tbody = document.getElementById('extra-rows');
    const table = document.getElementById('extra-items-table');
    if (table) table.style.display = '';
    const i = MonteurViews._extraCount++;
    tbody.insertAdjacentHTML('beforeend', MonteurViews.extraRow(i, item));
    searchEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    MonteurViews._updateExtraHighlight();
  },
  getExtraRows() {
    const items = [];
    document.querySelectorAll('#extra-rows tr').forEach(row => {
      const id  = row.id.replace('extra-row-', '');
      const inp = document.getElementById(`extra-qty-${id}`);
      if (!inp) return;
      items.push({
        name:           inp.dataset.name,
        article_number: inp.dataset.artnr || null,
        quantity:       parseFloat(inp.value) || 1,
        unit:           inp.dataset.unit || 'Stk.',
      });
    });
    return items;
  },
  _updateExtraHighlight() {
    const card   = document.getElementById('extra-material-card');
    const h3     = card?.querySelector('h3');
    const hasData = document.querySelectorAll('#extra-rows tr').length > 0 ||
                    parseFloat(document.getElementById('f-extra-aufwand')?.value) > 0;
    if (card) {
      card.style.border    = hasData ? '2px solid #d48a00' : '';
      card.style.background = hasData ? 'rgba(212,138,0,.05)' : '';
    }
    if (h3) h3.style.color = hasData ? '#d48a00' : '';
    const tbl = document.getElementById('extra-items-table');
    if (tbl) tbl.style.display = document.querySelectorAll('#extra-rows tr').length ? '' : 'none';
  },

  // ── Work Timer ──────────────────────────────────────────────────────────
  _timerInterval: null,
  _lsItems: [],

  _timerKey: (orderId) => `work_start_${orderId}`,
  _stampedKey: (orderId) => `stamped_${orderId}`,

  _timerRunning(orderId) {
    return !!localStorage.getItem(MonteurViews._timerKey(orderId));
  },

  _isStamped(orderId) {
    return !!localStorage.getItem(MonteurViews._stampedKey(orderId));
  },

  _timerDisplay(orderId) {
    const key = MonteurViews._timerKey(orderId);
    const startIso = localStorage.getItem(key);
    if (!startIso) return '00:00:00';
    const elapsed = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
    return MonteurViews._fmtElapsed(elapsed);
  },

  _fmtElapsed(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  },

  _fmtTime(date) {
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  },

  startTimer(orderId) {
    const key = MonteurViews._timerKey(orderId);
    const now = new Date();

    // Auto-calculate transfer time from last order's end
    const lastEnd = localStorage.getItem('last_order_end_time');
    const lastOrderId = localStorage.getItem('last_order_id');
    if (lastEnd && lastOrderId && String(lastOrderId) !== String(orderId)) {
      const transferMinutes = (now - new Date(lastEnd)) / 60000;
      if (transferMinutes > 0 && transferMinutes < 480) { // max 8h reasonable
        const transferHours = Math.round(transferMinutes / 15) * 0.25; // round to 15min
        const travelEl = document.getElementById('f-travel-time');
        if (travelEl && !travelEl.value) travelEl.value = transferHours;
      }
    }

    // Always update start time (overwrite if already running)
    clearInterval(MonteurViews._timerInterval);
    localStorage.setItem(key, now.toISOString());
    localStorage.setItem(MonteurViews._stampedKey(orderId), 'true');

    // Always set work-from field
    const fromEl = document.getElementById('f-work-from');
    if (fromEl) fromEl.value = MonteurViews._fmtTime(now);
    // set work-date
    const dateEl = document.getElementById('f-work-date');
    if (dateEl) dateEl.value = now.toISOString().split('T')[0];

    // toggle buttons
    const startBtn = document.getElementById('timer-btn-start');
    const stopBtn = document.getElementById('timer-btn-stop');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';

    // start interval
    MonteurViews._startTimerInterval(orderId);
  },

  stopTimer(orderId) {
    const key = MonteurViews._timerKey(orderId);
    const startIso = localStorage.getItem(key);
    if (!startIso) return;
    const now  = new Date();
    const start = new Date(startIso);
    localStorage.removeItem(key);
    clearInterval(MonteurViews._timerInterval);
    MonteurViews._timerInterval = null;
    // fill in work-to
    const toEl = document.getElementById('f-work-to');
    if (toEl) toEl.value = MonteurViews._fmtTime(now);
    // update display to final elapsed
    const elapsed = Math.floor((now - start) / 1000);
    const display = document.getElementById('timer-display');
    if (display) display.textContent = MonteurViews._fmtElapsed(elapsed);
    // toggle buttons – show "Neu starten" (rewind) since already stamped
    const stopBtn = document.getElementById('timer-btn-stop');
    const startBtn = document.getElementById('timer-btn-start');
    if (stopBtn) stopBtn.style.display = 'none';
    if (startBtn) {
      startBtn.style.display = '';
      startBtn.textContent = '\u21bb Neu starten';
      startBtn.className = 'btn btn-ghost';
    }
    UI.toast(`Arbeitszeit gestoppt: ${MonteurViews._fmtTime(start)} \u2013 ${MonteurViews._fmtTime(now)}`, 'success', 4000);
  },

  resetTimer(orderId) {
    const key = MonteurViews._timerKey(orderId);
    localStorage.removeItem(key);
    localStorage.removeItem(MonteurViews._stampedKey(orderId));
    clearInterval(MonteurViews._timerInterval);
    MonteurViews._timerInterval = null;
    const display = document.getElementById('timer-display');
    if (display) display.textContent = '00:00:00';
    const stopBtn = document.getElementById('timer-btn-stop');
    const startBtn = document.getElementById('timer-btn-start');
    if (stopBtn) stopBtn.style.display = 'none';
    if (startBtn) {
      startBtn.style.display = '';
      startBtn.textContent = '\u25b6 Arbeit starten';
      startBtn.className = 'btn btn-primary';
    }
  },

  _startTimerInterval(orderId) {
    clearInterval(MonteurViews._timerInterval);
    MonteurViews._timerInterval = setInterval(() => {
      const display = document.getElementById('timer-display');
      if (!display) { clearInterval(MonteurViews._timerInterval); return; }
      display.textContent = MonteurViews._timerDisplay(orderId);
    }, 1000);
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
          <button class="del-photo" onclick="MonteurViews.delPhoto(${order.id},${p.id})">\u2715</button>
        </div>`).join('')}
      </div>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">
        \ud83d\udcf7 Bilder hochladen
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
    // Auto-set end time to now
    const now = new Date();
    const toEl = document.getElementById('f-work-to');
    if (toEl) toEl.value = MonteurViews._fmtTime(now);

    // Stop timer if running
    if (MonteurViews._timerRunning(orderId)) {
      const key = MonteurViews._timerKey(orderId);
      localStorage.removeItem(key);
      clearInterval(MonteurViews._timerInterval);
      MonteurViews._timerInterval = null;
    }

    // Store last end time for transfer time calculation
    localStorage.setItem('last_order_end_time', now.toISOString());
    localStorage.setItem('last_order_id', String(orderId));

    // Clean up stamped flag
    localStorage.removeItem(MonteurViews._stampedKey(orderId));

    const signatureData = MonteurViews._sigPad?.getData() || null;

    // Combine LS items + monteur items
    const allItems = [
      ...MonteurViews.getLsItemRows(),
      ...MonteurViews.getItemRows()
    ];

    const data = {
      executed_work:       UI.getMultiCheck('ausgefuehrte_arbeiten'),
      items_table:         allItems,
      additional_material: [],
      extra_material:      MonteurViews.getExtraRows(),
      extra_aufwand:       parseFloat(document.getElementById('f-extra-aufwand')?.value) || null,
      extra_argumentation: document.getElementById('f-extra-argumentation')?.value.trim() || null,
      notes_monteur:       document.getElementById('f-notes-monteur')?.value.trim() || null,
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
      work_date:        document.getElementById('f-work-date')?.value || null,
      work_time_from:   document.getElementById('f-work-from')?.value || null,
      work_time_to:     document.getElementById('f-work-to')?.value || null,
      travel_time:      parseFloat(document.getElementById('f-travel-time')?.value) || null,
      travel_km:        parseInt(document.getElementById('f-travel-km')?.value) || null,
      technician_name:  document.getElementById('f-technician')?.value.trim() || null,
      technician_block: document.getElementById('f-block')?.value.trim() || null,
      signature_data:   signatureData,
      agb_accepted:     true,
      status:           document.getElementById('f-m-status')?.value || 'in_bearbeitung',
    };

    if (!data.technician_name) { UI.toast('Techniker-Name erforderlich','error'); return; }

    try {
      await API.updateOrder(orderId, data);
      UI.toast('Auftrag gespeichert','success');
      MonteurViews.renderMyOrders();
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async closeOrder(orderId) {
    const answers = await new Promise(resolve => {
      window._clResolve = (val) => { window._clResolve = () => {}; resolve(val); };
      UI.modal('Auftrag abschliessen – Checkliste',
        `<div style="display:flex;flex-direction:column;gap:16px;padding:8px 0">
          <label style="display:flex;align-items:center;gap:12px;font-size:15px;cursor:pointer">
            <input type="checkbox" id="cl-material" style="width:20px;height:20px">
            Zusätzliches Material (nicht auf LS) ausgeführt?
          </label>
          <label style="display:flex;align-items:center;gap:12px;font-size:15px;cursor:pointer">
            <input type="checkbox" id="cl-foto" style="width:20px;height:20px">
            Foto gemacht?
          </label>
          <label style="display:flex;align-items:center;gap:12px;font-size:15px;cursor:pointer">
            <input type="checkbox" id="cl-done" style="width:20px;height:20px">
            Auftrag abgeschlossen?
          </label>
        </div>`,
        `<button class="btn btn-ghost" onclick="window._clResolve(null);UI.closeModal()">Abbrechen</button>
         <button class="btn btn-success" style="background:#2d7a2d" onclick="window._clResolve({material:document.getElementById('cl-material').checked,foto:document.getElementById('cl-foto').checked,done:document.getElementById('cl-done').checked});UI.closeModal()">Auftrag abschliessen</button>`
      );
      const mc = document.getElementById('modal-container');
      const obs = new MutationObserver(() => { if (!mc.innerHTML.trim()) { obs.disconnect(); window._clResolve(null); } });
      obs.observe(mc, { childList: true });
    });

    if (!answers || !answers.done) {
      if (answers !== null) UI.toast('Auftrag nicht abgeschlossen – Status unverändert.', 'warning');
      return;
    }
    if (answers.material && !MonteurViews.getExtraRows().length) {
      UI.toast('Hinweis: Bitte zusätzliches Material unter "Zusätzliche Positionen" eintragen.', 'warning');
    }

    const now = new Date();
    const toEl = document.getElementById('f-work-to');
    if (toEl) toEl.value = MonteurViews._fmtTime(now);

    if (MonteurViews._timerRunning(orderId)) {
      const key = MonteurViews._timerKey(orderId);
      localStorage.removeItem(key);
      clearInterval(MonteurViews._timerInterval);
      MonteurViews._timerInterval = null;
    }
    localStorage.setItem('last_order_end_time', now.toISOString());
    localStorage.setItem('last_order_id', String(orderId));
    localStorage.removeItem(MonteurViews._stampedKey(orderId));

    const signatureData = MonteurViews._sigPad?.getData() || null;
    const allItems = [
      ...MonteurViews.getLsItemRows(),
      ...MonteurViews.getItemRows()
    ];

    const data = {
      executed_work:       UI.getMultiCheck('ausgefuehrte_arbeiten'),
      items_table:         allItems,
      additional_material: [],
      extra_material:      MonteurViews.getExtraRows(),
      extra_aufwand:       parseFloat(document.getElementById('f-extra-aufwand')?.value) || null,
      extra_argumentation: document.getElementById('f-extra-argumentation')?.value.trim() || null,
      notes_monteur:       document.getElementById('f-notes-monteur')?.value.trim() || null,
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
      work_date:        document.getElementById('f-work-date')?.value || null,
      work_time_from:   document.getElementById('f-work-from')?.value || null,
      work_time_to:     MonteurViews._fmtTime(now),
      travel_time:      parseFloat(document.getElementById('f-travel-time')?.value) || null,
      travel_km:        parseInt(document.getElementById('f-travel-km')?.value) || null,
      technician_name:  document.getElementById('f-technician')?.value.trim() || null,
      technician_block: document.getElementById('f-block')?.value.trim() || null,
      signature_data:   signatureData,
      agb_accepted:     true,
      status:           'abgeschlossen',
    };

    if (!data.technician_name) { UI.toast('Techniker-Name erforderlich','error'); return; }

    try {
      await API.updateOrder(orderId, data);

      // Erfolgs-Bestätigung anzeigen dann zurück zur Übersicht
      const order = await API.getOrder(orderId);
      await new Promise(resolve => {
        window._doneResolve = (val) => { window._doneResolve = () => {}; resolve(val); };
        UI.modal('✅ Auftrag abgeschlossen',
          `<div style="display:flex;flex-direction:column;gap:12px;padding:8px 0">
            <div style="background:#f0faf0;border:1px solid #2d7a2d;border-radius:8px;padding:16px;text-align:center">
              <div style="font-size:32px;margin-bottom:8px">✅</div>
              <div style="font-weight:700;font-size:16px;color:#2d7a2d">Auftrag ${UI.esc(order.order_number||'')} abgeschlossen</div>
              <div style="color:#666;margin-top:4px">${UI.esc(order.customer_name||'')} – ${UI.esc(order.installation_address||'')}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <tr><td style="padding:5px 8px;font-weight:600;width:40%">Techniker</td><td style="padding:5px 8px">${UI.esc(data.technician_name)}</td></tr>
              <tr style="background:#f5f5f5"><td style="padding:5px 8px;font-weight:600">Datum</td><td style="padding:5px 8px">${UI.esc(data.work_date||'–')}</td></tr>
              <tr><td style="padding:5px 8px;font-weight:600">Arbeitszeit</td><td style="padding:5px 8px">${UI.esc(data.work_time_from||'–')} – ${UI.esc(data.work_time_to||'–')}</td></tr>
              ${data.travel_time ? `<tr style="background:#f5f5f5"><td style="padding:5px 8px;font-weight:600">Fahrzeit</td><td style="padding:5px 8px">${data.travel_time} h</td></tr>` : ''}
              ${data.travel_km ? `<tr><td style="padding:5px 8px;font-weight:600">Kilometer</td><td style="padding:5px 8px">${data.travel_km} km</td></tr>` : ''}
            </table>
            <div style="color:#666;font-size:12px;text-align:center">Rapport wurde gespeichert. Der Planer kann jetzt die E-Mail versenden.</div>
          </div>`,
          `<button class="btn btn-success" style="background:#2d7a2d" onclick="UI.closeModal();window._doneResolve(true)">Zurück zur Übersicht</button>`
        );
        const mc = document.getElementById('modal-container');
        const obs = new MutationObserver(() => { if (!mc.innerHTML.trim()) { obs.disconnect(); window._doneResolve(true); } });
        obs.observe(mc, { childList: true });
      });

      App.navigate('monteur-orders');
    } catch(e) { UI.toast(e.message,'error'); }
  },

  async saveNachtrag(orderId) {
    const text = document.getElementById('f-nachtrag')?.value.trim();
    if (!text) { UI.toast('Bitte Nachtrag-Text eingeben','error'); return; }

    let existingNotes = '';
    try {
      const order = await API.getOrder(orderId);
      existingNotes = order.notes_monteur || '';
    } catch(e) { /* use empty */ }

    const now = new Date();
    const dateStr = now.toLocaleDateString('de-CH') + ' ' + now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    const nachtragLine = `[Nachtrag ${dateStr}]: ${text}`;
    const newNotes = existingNotes ? `${existingNotes}\n${nachtragLine}` : nachtragLine;

    try {
      await fetch(`/api/orders/${orderId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes_monteur: newNotes }),
        credentials: 'same-origin',
      });
      UI.toast('Nachtrag gespeichert','success');
      MonteurViews.renderWorkForm(orderId);
    } catch(e) { UI.toast(e.message,'error'); }
  },
};
