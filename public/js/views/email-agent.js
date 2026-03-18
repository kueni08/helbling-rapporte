/**
 * Email-Agent View
 * EML-Upload + Microsoft Graph API + KI-Klassifizierung
 */

const EmailAgentView = {

  currentFilter: { status: '', kategorie: '', page: 0 },
  PAGE_SIZE: 30,

  // ── Hauptansicht: Posteingang ──────────────────────────────────────────────

  async renderInbox() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h2>📧 Email-Agent</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" onclick="EmailAgentView.openUpload()">
            ↑ E-Mail(s) hochladen (.eml)
          </button>
          <button class="btn btn-secondary" id="ea-poll-btn" onclick="EmailAgentView.pollGraph()" style="display:none">
            ↻ Postfach prüfen
          </button>
          <select id="ea-filter-status" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border)">
            <option value="">Alle Status</option>
            <option value="neu">Neu</option>
            <option value="verarbeitet">Verarbeitet</option>
            <option value="ignoriert">Ignoriert</option>
            <option value="fehler">Fehler</option>
          </select>
          <select id="ea-filter-kat" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border)">
            <option value="">Alle Kategorien</option>
            <option value="kundenanfrage">Kundenanfrage</option>
            <option value="lieferschein">Lieferschein</option>
            <option value="auftrag_info">Auftrag-Info</option>
            <option value="intern">Intern</option>
            <option value="spam">Spam</option>
            <option value="sonstiges">Sonstiges</option>
          </select>
          <button class="btn btn-ghost btn-sm" onclick="EmailAgentView.renderSettings()" title="Einstellungen">⚙</button>
        </div>
      </div>
      <div id="ea-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px"></div>
      <div id="ea-list">Lade...</div>
      <div id="ea-pagination" style="margin-top:16px;text-align:center"></div>`;

    document.getElementById('ea-filter-status').value = EmailAgentView.currentFilter.status;
    document.getElementById('ea-filter-kat').value    = EmailAgentView.currentFilter.kategorie;
    document.getElementById('ea-filter-status').onchange = e => {
      EmailAgentView.currentFilter.status = e.target.value;
      EmailAgentView.currentFilter.page = 0;
      EmailAgentView._loadList();
    };
    document.getElementById('ea-filter-kat').onchange = e => {
      EmailAgentView.currentFilter.kategorie = e.target.value;
      EmailAgentView.currentFilter.page = 0;
      EmailAgentView._loadList();
    };

    await EmailAgentView._loadStats();
    await EmailAgentView._loadList();
  },

  async _loadStats() {
    try {
      const s = await API.get('/api/email-agent/status');
      const el = document.getElementById('ea-stats');
      if (!el) return;

      // Graph Poll Button zeigen wenn konfiguriert
      const pollBtn = document.getElementById('ea-poll-btn');
      if (pollBtn && s.graph_configured) pollBtn.style.display = '';

      el.innerHTML = `
        ${s.stats.high > 0 ? `<div class="stat-chip stat-danger">⚠ ${s.stats.high} hohe Priorität</div>` : ''}
        <div class="stat-chip">🔵 ${s.stats.unread} ungelesen</div>
        <div class="stat-chip">📧 ${s.stats.total} gesamt</div>
        ${s.stats.errors > 0 ? `<div class="stat-chip stat-danger">❌ ${s.stats.errors} Fehler</div>` : ''}
        <div class="stat-chip">📅 ${s.stats.today} heute</div>
        <div class="stat-chip ${s.graph_configured ? 'stat-ok' : 'stat-warn'}">
          ${s.graph_configured ? `✅ Graph API: ${s.graph_mailbox}` : '⚠ Graph API nicht aktiv'}
        </div>`;
    } catch {}
  },

  async _loadList() {
    const el = document.getElementById('ea-list');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Lade...</div>';

    const { status, kategorie, page } = EmailAgentView.currentFilter;
    const params = new URLSearchParams({ limit: EmailAgentView.PAGE_SIZE, offset: page * EmailAgentView.PAGE_SIZE });
    if (status)    params.set('status', status);
    if (kategorie) params.set('kategorie', kategorie);

    try {
      const data = await API.get(`/api/email-agent/inbox?${params}`);
      if (!data.emails.length) {
        el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">
          <p style="font-size:2rem;margin-bottom:8px">📭</p>
          <p>Keine E-Mails gefunden.</p>
          <p style="font-size:13px">Lade eine .eml-Datei hoch oder aktiviere die Graph API.</p>
        </div>`;
        document.getElementById('ea-pagination').innerHTML = '';
        return;
      }
      el.innerHTML = `<div class="email-list">${data.emails.map(e => EmailAgentView._emailRow(e)).join('')}</div>`;

      const totalPages = Math.ceil(data.total / EmailAgentView.PAGE_SIZE);
      if (totalPages > 1) {
        document.getElementById('ea-pagination').innerHTML = `
          <button class="btn btn-secondary" ${page===0?'disabled':''} onclick="EmailAgentView.currentFilter.page--;EmailAgentView._loadList()">← Zurück</button>
          <span style="margin:0 12px;color:var(--text-muted)">Seite ${page+1} / ${totalPages}</span>
          <button class="btn btn-secondary" ${page>=totalPages-1?'disabled':''} onclick="EmailAgentView.currentFilter.page++;EmailAgentView._loadList()">Weiter →</button>`;
      } else {
        document.getElementById('ea-pagination').innerHTML = '';
      }
    } catch(e) {
      el.innerHTML = `<div class="alert alert-danger">Fehler: ${e.message}</div>`;
    }
  },

  _emailRow(e) {
    const kBadge   = { kundenanfrage:'badge-blue', lieferschein:'badge-purple', auftrag_info:'badge-teal', intern:'badge-gray', spam:'badge-red', sonstiges:'badge-gray' };
    const kLabel   = { kundenanfrage:'Kundenanfrage', lieferschein:'Lieferschein', auftrag_info:'Auftrag-Info', intern:'Intern', spam:'Spam', sonstiges:'Sonstiges' };
    const sBadge   = { neu:'<span class="badge badge-blue">Neu</span>', verarbeitet:'<span class="badge badge-green">OK</span>', ignoriert:'<span class="badge badge-gray">Ignoriert</span>', fehler:'<span class="badge badge-red">Fehler</span>' };
    const pIcon    = { hoch:'🔴', normal:'🟡', niedrig:'⚪' };

    const kat    = e.ai_kategorie ? `<span class="badge ${kBadge[e.ai_kategorie]||'badge-gray'}">${kLabel[e.ai_kategorie]||e.ai_kategorie}</span>` : '';
    const linked = e.linked_inquiry_id ? `<span class="badge badge-teal">📋 Anfrage #${e.linked_inquiry_id}</span>` : (e.linked_order_id ? `<span class="badge badge-purple">Auftrag ${e.order_number||e.linked_order_id}</span>` : '');
    const att    = e.has_attachments ? '<span style="font-size:12px" title="Anhänge vorhanden">📎</span>' : '';
    const date   = e.received_at ? new Date(e.received_at).toLocaleString('de-CH',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';

    return `<div class="email-row ${e.status==='neu'?'email-row-unread':''}" onclick="EmailAgentView.renderDetail(${e.id})">
      <div class="email-row-meta">
        <span class="email-prio">${pIcon[e.ai_prioritaet]||'⚪'}</span>
        ${sBadge[e.status]||''}
        ${kat} ${linked} ${att}
      </div>
      <div class="email-row-main">
        <span class="email-from">${UI.esc(e.from_name||e.from_addr||'?')}</span>
        <span class="email-subject">${UI.esc(e.subject||'(kein Betreff)')}</span>
        <span class="email-date">${date}</span>
      </div>
      ${e.ai_zusammenfassung ? `<div class="email-summary">${UI.esc(e.ai_zusammenfassung)}</div>` : ''}
      ${e.ai_aktion ? `<div class="email-action-hint">💡 ${UI.esc(e.ai_aktion)}</div>` : ''}
    </div>`;
  },

  // ── EML Upload ─────────────────────────────────────────────────────────────

  openUpload() {
    UI.modal('📤 E-Mail(s) hochladen',
      `<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
        Exportiere E-Mails aus Outlook als <strong>.eml-Datei</strong> und lade sie hier hoch.<br>
        Die KI analysiert jede E-Mail automatisch.
      </p>
      <div style="border:2px dashed var(--border);border-radius:8px;padding:24px;text-align:center;cursor:pointer" onclick="document.getElementById('ea-upload-input').click()">
        <div style="font-size:2rem;margin-bottom:8px">📨</div>
        <p style="margin:0;font-weight:600">Klicken zum Auswählen</p>
        <p style="margin:4px 0 0;font-size:12px;color:var(--text-muted)">.eml oder .msg Dateien – mehrere möglich</p>
        <input type="file" id="ea-upload-input" accept=".eml,.msg" multiple style="display:none" onchange="EmailAgentView._previewFiles(event)">
      </div>
      <div id="ea-upload-preview" style="margin-top:12px"></div>
      <div id="ea-upload-result" style="margin-top:12px"></div>`,
      `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" id="ea-do-upload" onclick="EmailAgentView._doUpload()" disabled>Verarbeiten</button>`
    );
  },

  _previewFiles(e) {
    const files = [...e.target.files];
    const preview = document.getElementById('ea-upload-preview');
    const btn = document.getElementById('ea-do-upload');
    if (!files.length) { preview.innerHTML = ''; btn.disabled = true; return; }

    preview.innerHTML = `<div style="background:var(--bg-secondary);border-radius:6px;padding:10px">
      ${files.map(f => `<div style="font-size:13px;padding:3px 0">📧 ${UI.esc(f.name)} <span style="color:var(--text-muted)">(${(f.size/1024).toFixed(1)} KB)</span></div>`).join('')}
    </div>`;
    btn.disabled = false;
  },

  async _doUpload() {
    const input = document.getElementById('ea-upload-input');
    if (!input?.files?.length) return;

    const btn = document.getElementById('ea-do-upload');
    const result = document.getElementById('ea-upload-result');
    btn.disabled = true;
    btn.textContent = 'Verarbeite...';

    const form = new FormData();
    [...input.files].forEach(f => form.append('files', f));

    try {
      const res = await API.upload('/api/email-agent/upload', form);
      const ok      = res.results.filter(r => !r.error && !r.skipped).length;
      const skipped = res.results.filter(r => r.skipped).length;
      const errors  = res.results.filter(r => r.error).length;

      result.innerHTML = `
        <div style="padding:12px;border-radius:6px;background:var(--bg-secondary)">
          ${ok > 0      ? `<div style="color:#166534">✅ ${ok} E-Mail(s) erfolgreich verarbeitet</div>` : ''}
          ${skipped > 0 ? `<div style="color:#555">⏭ ${skipped} bereits vorhanden (übersprungen)</div>` : ''}
          ${errors > 0  ? `<div style="color:#b91c1c">❌ ${errors} Fehler</div>` : ''}
          ${res.results.filter(r => r.error).map(r => `<div style="font-size:12px;color:#b91c1c">• ${UI.esc(r.file)}: ${UI.esc(r.error)}</div>`).join('')}
        </div>`;

      if (ok > 0) {
        setTimeout(() => { UI.closeModal(); EmailAgentView.renderInbox(); }, 1800);
      } else {
        btn.disabled = false;
        btn.textContent = 'Verarbeiten';
      }
    } catch(e) {
      result.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Verarbeiten';
    }
  },

  // ── Detail-Ansicht ─────────────────────────────────────────────────────────

  async renderDetail(id) {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>📧 E-Mail</h2>
    </div><div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const email = await API.get(`/api/email-agent/inbox/${id}`);
      const kColors = { kundenanfrage:'#1a3a6b', lieferschein:'#6b1a6b', auftrag_info:'#0a5c5c', intern:'#555', spam:'#8b0000', sonstiges:'#444' };
      const kLabel  = { kundenanfrage:'👤 Kundenanfrage', lieferschein:'📦 Lieferschein', auftrag_info:'📋 Auftrag-Info', intern:'🏢 Intern', spam:'🚫 Spam', sonstiges:'📬 Sonstiges' };
      const pLabel  = { hoch:'🔴 Hoch', normal:'🟡 Normal', niedrig:'⚪ Niedrig' };

      const aiDaten  = email.ai_daten || {};
      const hasData  = Object.values(aiDaten).some(v => v !== null && v !== undefined && v !== '');
      const canConvert = email.ai_kategorie === 'kundenanfrage' && !email.linked_inquiry_id;

      main.innerHTML = `
      <div class="page-header">
        <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <h2>📧 E-Mail Detail</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canConvert ? `<button class="btn btn-success" onclick="EmailAgentView._openConvert(${id})">📋 Als Kundenanfrage anlegen</button>` : ''}
          ${email.status !== 'verarbeitet' ? `<button class="btn btn-primary" onclick="EmailAgentView._reclassify(${id})">🔄 KI neu analysieren</button>` : ''}
          ${email.status !== 'ignoriert' ? `<button class="btn btn-secondary" onclick="EmailAgentView._setStatus(${id},'ignoriert')">Ignorieren</button>` : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1200px">
        <div>
          <div class="card mb-3">
            <h3 style="margin:0 0 12px;font-size:15px">E-Mail Informationen</h3>
            <table style="width:100%;font-size:13px;border-collapse:collapse">
              <tr><td style="padding:4px 8px;color:var(--text-muted);white-space:nowrap">Von</td><td style="padding:4px 8px">${UI.esc(email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr||'–')}</td></tr>
              <tr><td style="padding:4px 8px;color:var(--text-muted)">Betreff</td><td style="padding:4px 8px;font-weight:600">${UI.esc(email.subject||'–')}</td></tr>
              <tr><td style="padding:4px 8px;color:var(--text-muted)">Datum</td><td style="padding:4px 8px">${email.received_at ? new Date(email.received_at).toLocaleString('de-CH') : '–'}</td></tr>
              ${email.has_attachments ? `<tr><td style="padding:4px 8px;color:var(--text-muted)">Anhänge</td><td style="padding:4px 8px">${(email.attachments||[]).map(a=>`<a href="/api/email-agent/attachment/${a.filename}" target="_blank" style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:4px;background:var(--bg-secondary);font-size:12px;text-decoration:none">📎 ${UI.esc(a.original_name)}</a>`).join('')||'–'}</td></tr>` : ''}
            </table>
          </div>
          <div class="card">
            <h3 style="margin:0 0 10px;font-size:15px">Nachrichtentext</h3>
            <div style="max-height:420px;overflow-y:auto;font-size:13px;line-height:1.6;white-space:pre-wrap;background:var(--bg-secondary);padding:12px;border-radius:6px;word-break:break-word">${UI.esc((email.body_text||'(kein Text)').substring(0,6000))}</div>
          </div>
        </div>

        <div>
          <div class="card mb-3">
            <h3 style="margin:0 0 12px;font-size:15px">🤖 KI-Analyse</h3>
            <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
              ${email.ai_kategorie ? `<span style="padding:4px 12px;border-radius:12px;background:${kColors[email.ai_kategorie]||'#444'};color:#fff;font-size:13px">${kLabel[email.ai_kategorie]||email.ai_kategorie}</span>` : '<span style="color:var(--text-muted)">Noch nicht klassifiziert</span>'}
              ${email.ai_prioritaet ? `<span style="padding:4px 12px;border-radius:12px;background:var(--bg-secondary);font-size:13px">${pLabel[email.ai_prioritaet]||email.ai_prioritaet}</span>` : ''}
            </div>
            ${email.ai_zusammenfassung ? `<div style="margin-bottom:10px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Zusammenfassung</strong><p style="margin:4px 0;font-size:13px">${UI.esc(email.ai_zusammenfassung)}</p></div>` : ''}
            ${email.ai_aktion ? `<div style="padding:10px 12px;background:#fff8e1;border-radius:6px;border-left:3px solid #f57f17;margin-top:8px"><strong style="font-size:12px">💡 Empfehlung</strong><p style="margin:4px 0;font-size:13px">${UI.esc(email.ai_aktion)}</p></div>` : ''}
          </div>

          ${hasData ? `
          <div class="card mb-3">
            <h3 style="margin:0 0 10px;font-size:15px">📋 Erkannte Daten</h3>
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              ${Object.entries(aiDaten).filter(([,v])=>v!==null&&v!==''&&v!==undefined).map(([k,v])=>`
                <tr>
                  <td style="padding:3px 8px;color:var(--text-muted);white-space:nowrap;font-size:11px">${EmailAgentView._fieldLabel(k)}</td>
                  <td style="padding:3px 8px">${UI.esc(String(v))}</td>
                </tr>`).join('')}
            </table>
          </div>` : ''}

          ${email.linked_inquiry_id ? `
          <div class="card mb-3" style="border-left:3px solid var(--accent)">
            <strong style="font-size:13px">📋 Verknüpfte Anfrage #${email.linked_inquiry_id}</strong>
            <p style="margin:4px 0 0;font-size:13px">${email.inquiry_name||''}</p>
          </div>` : ''}

          ${email.linked_order_id ? `
          <div class="card mb-3" style="border-left:3px solid var(--accent)">
            <strong style="font-size:13px">📌 Verknüpfter Auftrag: ${email.order_number||email.linked_order_id}</strong>
          </div>` : ''}
        </div>
      </div>`;
    } catch(e) {
      main.innerHTML = `<button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button><div class="alert alert-danger mt-3">${e.message}</div>`;
    }
  },

  _fieldLabel(k) {
    return { vorname:'Vorname', nachname:'Nachname', firma:'Firma', email:'E-Mail', telefon:'Telefon',
      strasse:'Strasse', plz:'PLZ', ort:'Ort', art_der_arbeit:'Art der Arbeit',
      anzahl_zylinder:'Zylinder (ca.)', anzahl_schluessel:'Schlüssel (ca.)', anzahl_tueren:'Türen (ca.)',
      bestehendes_system:'Best. System', wunschtermin:'Wunschtermin', bemerkungen:'Bemerkungen',
      lieferschein_nr:'Lieferschein-Nr.', auftrag_nr:'Auftrag-Nr.', empfohlene_aktion:'Empfehlung',
    }[k] || k;
  },

  async _reclassify(id) {
    try {
      UI.toast('KI analysiert...', 'info');
      await API.post(`/api/email-agent/inbox/${id}/reclassify`, {});
      UI.toast('Neu klassifiziert', 'success');
      EmailAgentView.renderDetail(id);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _setStatus(id, status) {
    try {
      await API.put(`/api/email-agent/inbox/${id}/status`, { status });
      UI.toast('Status gesetzt', 'success');
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  _openConvert(id) {
    // Daten aus dem aktuell geladenen Detailbereich holen
    API.get(`/api/email-agent/inbox/${id}`).then(email => {
      const d = email.ai_daten || {};
      UI.modal('📋 Als Kundenanfrage anlegen',
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field"><label>Vorname *</label><input id="ci-vorname" value="${UI.esc(d.vorname||'')}"></div>
          <div class="field"><label>Nachname *</label><input id="ci-nachname" value="${UI.esc(d.nachname||'')}"></div>
          <div class="field"><label>Firma</label><input id="ci-firma" value="${UI.esc(d.firma||'')}"></div>
          <div class="field"><label>E-Mail</label><input id="ci-email" value="${UI.esc(d.email||email.from_addr||'')}"></div>
          <div class="field"><label>Telefon</label><input id="ci-telefon" value="${UI.esc(d.telefon||'')}"></div>
          <div class="field"><label>Art der Arbeit</label>
            <select id="ci-arbeit"><option value="">–</option>
              ${['Neuinstallation','Erweiterung','Reparatur','Service/Wartung','Offerte'].map(a=>`<option ${d.art_der_arbeit===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Strasse</label><input id="ci-strasse" value="${UI.esc(d.strasse||'')}"></div>
          <div class="field"><label>PLZ / Ort</label><div style="display:flex;gap:6px">
            <input id="ci-plz" value="${UI.esc(d.plz||'')}" style="width:80px">
            <input id="ci-ort" value="${UI.esc(d.ort||'')}">
          </div></div>
          <div class="field"><label>Wunschtermin</label><input type="date" id="ci-termin" value="${UI.esc(d.wunschtermin||'')}"></div>
          <div class="field"><label>Zylinder (ca.)</label><input type="number" id="ci-zyl" value="${d.anzahl_zylinder||''}"></div>
        </div>
        <div class="field mt-2"><label>Bemerkungen</label><textarea id="ci-bem" rows="3">${UI.esc(d.bemerkungen||email.ai_zusammenfassung||'')}</textarea></div>`,
        `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
         <button class="btn btn-primary" onclick="EmailAgentView._doConvert(${id})">Anlegen</button>`
      );
    }).catch(e => UI.toast('Fehler: '+e.message, 'error'));
  },

  async _doConvert(id) {
    const body = {
      vorname:        document.getElementById('ci-vorname')?.value.trim(),
      nachname:       document.getElementById('ci-nachname')?.value.trim(),
      firma:          document.getElementById('ci-firma')?.value.trim() || null,
      email:          document.getElementById('ci-email')?.value.trim(),
      telefon:        document.getElementById('ci-telefon')?.value.trim(),
      strasse:        document.getElementById('ci-strasse')?.value.trim(),
      plz:            document.getElementById('ci-plz')?.value.trim(),
      ort:            document.getElementById('ci-ort')?.value.trim(),
      art_der_arbeit: document.getElementById('ci-arbeit')?.value || null,
      anzahl_zylinder:document.getElementById('ci-zyl')?.value || null,
      wunschtermin:   document.getElementById('ci-termin')?.value || null,
      bemerkungen:    document.getElementById('ci-bem')?.value.trim() || null,
    };
    try {
      await API.post(`/api/email-agent/inbox/${id}/convert-inquiry`, body);
      UI.toast('Kundenanfrage angelegt', 'success');
      UI.closeModal();
      EmailAgentView.renderDetail(id);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async pollGraph() {
    try {
      UI.toast('Prüfe Postfach...', 'info');
      const r = await API.post('/api/email-agent/poll', {});
      UI.toast(`Fertig – ${r.today} E-Mail(s) heute`, 'success');
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast(e.message, 'error'); }
  },

  // ── Einstellungen ──────────────────────────────────────────────────────────

  async renderSettings() {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>📧 Email-Agent Einstellungen</h2>
    </div><div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const cfg = await API.get('/api/email-agent/settings');

      main.innerHTML = `
      <div class="page-header">
        <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <h2>📧 Email-Agent Einstellungen</h2>
      </div>
      <div style="max-width:780px">

        <!-- EML-Upload Info -->
        <div class="card mb-4">
          <h3 style="margin:0 0 10px;font-size:15px">📨 E-Mail Upload (immer verfügbar)</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 8px">
            Exportiere E-Mails aus Outlook als <strong>.eml-Datei</strong> und lade sie über den «↑ E-Mail(s) hochladen» Button hoch.<br>
            Die KI analysiert und klassifiziert sie automatisch.
          </p>
          <p style="font-size:12px;color:var(--text-muted);margin:0">
            <strong>Outlook → E-Mail öffnen → Datei → Speichern unter → .eml</strong><br>
            EML-Ordner auf dem Server: <code style="font-size:11px">${UI.esc(cfg.inbox_dir||'–')}</code>
          </p>
        </div>

        <!-- Microsoft Graph API -->
        <div class="card mb-4">
          <h3 style="margin:0 0 4px;font-size:15px">🔌 Microsoft Graph API (automatisches Polling)</h3>
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">
            Funktioniert auch wenn IMAP gesperrt ist. Benötigt eine Azure App-Registrierung.
            <a href="https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app" target="_blank" rel="noopener" style="color:var(--accent)">Anleitung →</a>
          </p>
          <div style="margin-bottom:14px">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600">
              <input type="checkbox" id="ea-graph-enabled" ${cfg.graph_enabled==='true'?'checked':''} style="width:16px;height:16px">
              Graph API aktivieren
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>Tenant ID (Verzeichnis-ID) *</label><input id="ea-tenant" value="${UI.esc(cfg.graph_tenant_id||'')}"></div>
            <div class="field"><label>Client ID (App-ID) *</label><input id="ea-client-id" value="${UI.esc(cfg.graph_client_id||'')}"></div>
            <div class="field"><label>Client Secret *</label><input id="ea-client-secret" type="password" placeholder="${cfg.graph_client_secret?'gespeichert':'Secret eingeben'}"></div>
            <div class="field"><label>Postfach E-Mail *</label><input id="ea-mailbox" value="${UI.esc(cfg.graph_mailbox||'')}"></div>
            <div class="field"><label>Ordner</label><input id="ea-folder" value="${UI.esc(cfg.graph_folder||'Inbox')}"></div>
            <div class="field"><label>Polling-Intervall (Sekunden)</label><input type="number" id="ea-interval" value="${cfg.graph_poll_interval||'300'}"></div>
          </div>
          <div style="margin-top:14px;padding:12px;background:#f0f9ff;border-radius:6px;font-size:12px;border-left:3px solid #0ea5e9">
            <strong>Azure Setup (einmalig, 5 Minuten):</strong><br>
            1. <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">portal.azure.com</a> → App-Registrierungen → Neue Registrierung<br>
            2. API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen → <code>Mail.Read</code> hinzufügen<br>
            3. Administratorzustimmung erteilen → Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel<br>
            4. Tenant-ID und Client-ID aus «Übersicht» kopieren
          </div>
        </div>

        <!-- KI-Prompt -->
        <div class="card mb-4">
          <h3 style="margin:0 0 10px;font-size:15px">🤖 Claude AI Klassifizierungs-Prompt</h3>
          <textarea id="ea-prompt" rows="14" style="width:100%;font-family:monospace;font-size:11px">${UI.esc(cfg.email_agent_prompt||'')}</textarea>
          <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">Variablen: {SUBJECT} {FROM} {DATE} {BODY}</p>
        </div>

        <div style="display:flex;gap:10px">
          <button class="btn btn-primary" onclick="EmailAgentView._saveSettings()">Einstellungen speichern</button>
          <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">Abbrechen</button>
        </div>
      </div>`;
    } catch(e) {
      UI.toast('Fehler: '+e.message, 'error');
    }
  },

  async _saveSettings() {
    const body = {
      graph_tenant_id:     document.getElementById('ea-tenant').value.trim(),
      graph_client_id:     document.getElementById('ea-client-id').value.trim(),
      graph_client_secret: document.getElementById('ea-client-secret').value,
      graph_mailbox:       document.getElementById('ea-mailbox').value.trim(),
      graph_folder:        document.getElementById('ea-folder').value.trim() || 'Inbox',
      graph_poll_interval: document.getElementById('ea-interval').value.trim() || '300',
      graph_enabled:       document.getElementById('ea-graph-enabled').checked,
      email_agent_prompt:  document.getElementById('ea-prompt').value,
    };
    try {
      await API.post('/api/email-agent/settings', body);
      UI.toast('Einstellungen gespeichert', 'success');
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },
};
