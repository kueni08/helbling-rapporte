/**
 * Email-Agent View
 * EML-Ordner-Watcher + Microsoft Graph API + KI-Klassifizierung + Antwortentwurf
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
          <button class="btn btn-primary" onclick="EmailAgentView.openUpload()">↑ .eml hochladen</button>
          <button class="btn btn-secondary" id="ea-poll-btn" style="display:none" onclick="EmailAgentView.pollGraph()">↻ Postfach prüfen</button>
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
      <div id="ea-stats" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div>
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

    await Promise.all([EmailAgentView._loadStats(), EmailAgentView._loadList()]);
  },

  async _loadStats() {
    try {
      const s = await API.get('/api/email-agent/status');
      const el = document.getElementById('ea-stats');
      if (!el) return;
      if (s.graph_configured) document.getElementById('ea-poll-btn')?.removeAttribute('style');

      el.innerHTML = `
        ${s.stats.high > 0 ? `<span class="badge badge-red" style="padding:5px 10px">⚠ ${s.stats.high} hohe Priorität</span>` : ''}
        <span class="badge badge-blue" style="padding:5px 10px">🔵 ${s.stats.unread} ungelesen</span>
        <span class="badge badge-gray" style="padding:5px 10px">📧 ${s.stats.total} gesamt</span>
        ${s.stats.errors > 0 ? `<span class="badge badge-red" style="padding:5px 10px">❌ ${s.stats.errors} Fehler</span>` : ''}
        <span class="badge badge-gray" style="padding:5px 10px">📅 ${s.stats.today} heute</span>
        <span class="badge ${s.graph_configured ? 'badge-green' : 'badge-orange'}" style="padding:5px 10px">
          ${s.graph_configured ? `✅ Graph: ${s.graph_mailbox}` : '📁 Ordner-Watcher aktiv'}
        </span>`;
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
          <p style="font-weight:600">Keine E-Mails vorhanden</p>
          <p style="font-size:13px">Speichere .eml-Dateien in den konfigurierten Ordner oder lade sie manuell hoch.</p>
          <button class="btn btn-primary mt-2" onclick="EmailAgentView.renderSettings()">⚙ Ordner konfigurieren</button>
        </div>`;
        document.getElementById('ea-pagination').innerHTML = '';
        return;
      }
      el.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">${data.emails.map(e => EmailAgentView._emailRow(e)).join('')}</div>`;

      const totalPages = Math.ceil(data.total / EmailAgentView.PAGE_SIZE);
      document.getElementById('ea-pagination').innerHTML = totalPages > 1 ? `
        <button class="btn btn-secondary" ${page===0?'disabled':''} onclick="EmailAgentView.currentFilter.page--;EmailAgentView._loadList()">← Zurück</button>
        <span style="margin:0 12px;color:var(--text-muted)">Seite ${page+1} / ${totalPages}</span>
        <button class="btn btn-secondary" ${page>=totalPages-1?'disabled':''} onclick="EmailAgentView.currentFilter.page++;EmailAgentView._loadList()">Weiter →</button>` : '';
    } catch(e) {
      el.innerHTML = `<div class="alert alert-danger">Fehler: ${e.message}</div>`;
    }
  },

  _emailRow(e) {
    const kBadge = { kundenanfrage:'badge-blue', lieferschein:'badge-purple', auftrag_info:'badge-teal', intern:'badge-gray', spam:'badge-red', sonstiges:'badge-gray' };
    const kLabel = { kundenanfrage:'Kundenanfrage', lieferschein:'Lieferschein', auftrag_info:'Auftrag-Info', intern:'Intern', spam:'Spam', sonstiges:'Sonstiges' };
    const sBadge = { neu:'<span class="badge badge-blue">Neu</span>', verarbeitet:'<span class="badge badge-green">OK</span>', ignoriert:'<span class="badge badge-gray">Ignoriert</span>', fehler:'<span class="badge badge-red">Fehler</span>' };
    const pIcon  = { hoch:'🔴', normal:'🟡', niedrig:'⚪' };
    const date   = e.received_at ? new Date(e.received_at).toLocaleString('de-CH',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';

    return `<div style="background:var(--bg-card);border-radius:8px;padding:10px 14px;cursor:pointer;border:1px solid var(--border);${e.status==='neu'?'border-left:3px solid var(--accent-blue);':''}" onclick="EmailAgentView.renderDetail(${e.id})">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span>${pIcon[e.ai_prioritaet]||'⚪'}</span>
        ${sBadge[e.status]||''}
        ${e.ai_kategorie ? `<span class="badge ${kBadge[e.ai_kategorie]||'badge-gray'}">${kLabel[e.ai_kategorie]||e.ai_kategorie}</span>` : ''}
        ${e.linked_inquiry_id ? `<span class="badge badge-teal">📋 Anfrage #${e.linked_inquiry_id}</span>` : ''}
        ${e.linked_order_id ? `<span class="badge badge-blue">🔧 ${e.order_number||'Auftrag #'+e.linked_order_id}</span>` : ''}
        ${e.has_attachments ? '<span style="font-size:12px" title="Anhänge">📎</span>' : ''}
        ${e.ai_draft ? '<span class="badge badge-green" style="font-size:11px">📝 Entwurf</span>' : ''}
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">${date}</span>
      </div>
      <div style="display:flex;gap:12px;align-items:baseline">
        <span style="font-weight:600;font-size:13px;min-width:140px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(e.from_name||e.from_addr||'?')}</span>
        <span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${UI.esc(e.subject||'(kein Betreff)')}</span>
      </div>
      ${e.ai_zusammenfassung ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(e.ai_zusammenfassung)}</div>` : ''}
    </div>`;
  },

  // ── EML Upload (manuell) ───────────────────────────────────────────────────

  openUpload() {
    UI.modal('📤 E-Mail(s) hochladen (.eml)',
      `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Alternativ zum Ordner-Watcher: .eml-Dateien direkt hochladen.<br>
        <strong>Outlook:</strong> E-Mail öffnen → Datei → Speichern unter → .eml
      </p>
      <div style="border:2px dashed var(--border);border-radius:8px;padding:20px;text-align:center;cursor:pointer" onclick="document.getElementById('ea-upload-input').click()">
        <div style="font-size:2rem;margin-bottom:6px">📨</div>
        <p style="margin:0;font-weight:600">Klicken zum Auswählen</p>
        <p style="margin:4px 0 0;font-size:12px;color:var(--text-muted)">.eml oder .msg, mehrere möglich</p>
        <input type="file" id="ea-upload-input" accept=".eml,.msg" multiple style="display:none" onchange="EmailAgentView._previewFiles(event)">
      </div>
      <div id="ea-upload-preview" style="margin-top:10px"></div>
      <div id="ea-upload-result" style="margin-top:10px"></div>`,
      `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" id="ea-do-upload" onclick="EmailAgentView._doUpload()" disabled>Verarbeiten</button>`
    );
  },

  _previewFiles(e) {
    const files = [...e.target.files];
    document.getElementById('ea-upload-preview').innerHTML = files.length ? `
      <div style="background:var(--bg-secondary);border-radius:6px;padding:8px 12px">
        ${files.map(f => `<div style="font-size:13px;padding:2px 0">📧 ${UI.esc(f.name)} <span style="color:var(--text-muted)">(${(f.size/1024).toFixed(1)} KB)</span></div>`).join('')}
      </div>` : '';
    document.getElementById('ea-do-upload').disabled = !files.length;
  },

  async _doUpload() {
    const input = document.getElementById('ea-upload-input');
    if (!input?.files?.length) return;
    const btn = document.getElementById('ea-do-upload');
    const resultEl = document.getElementById('ea-upload-result');
    btn.disabled = true; btn.textContent = 'Verarbeite...';

    const form = new FormData();
    [...input.files].forEach(f => form.append('files', f));
    try {
      const res = await API.upload('/api/email-agent/upload', form);
      const ok = res.results.filter(r => !r.error && !r.skipped).length;
      resultEl.innerHTML = `<div style="padding:10px;background:var(--bg-secondary);border-radius:6px">
        ${ok > 0 ? `<div style="color:#166534">✅ ${ok} E-Mail(s) verarbeitet</div>` : ''}
        ${res.results.filter(r=>r.skipped).length ? `<div style="color:#555">⏭ ${res.results.filter(r=>r.skipped).length} Duplikat(e) übersprungen</div>` : ''}
        ${res.results.filter(r=>r.error).map(r=>`<div style="color:#b91c1c;font-size:12px">❌ ${UI.esc(r.file)}: ${UI.esc(r.error)}</div>`).join('')}
      </div>`;
      if (ok > 0) setTimeout(() => { UI.closeModal(); EmailAgentView.renderInbox(); }, 1600);
      else { btn.disabled = false; btn.textContent = 'Verarbeiten'; }
    } catch(e) {
      resultEl.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
      btn.disabled = false; btn.textContent = 'Verarbeiten';
    }
  },

  // ── Detail-Ansicht ─────────────────────────────────────────────────────────

  async renderDetail(id) {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>📧 E-Mail Detail</h2></div>
      <div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const email = await API.get(`/api/email-agent/inbox/${id}`);
      EmailAgentView._renderDetailContent(email);
    } catch(e) {
      main.innerHTML = `<button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <div class="alert alert-danger mt-3">${e.message}</div>`;
    }
  },

  _renderDetailContent(email) {
    const main = document.getElementById('main-content');
    const kColors = { kundenanfrage:'#1a3a6b', lieferschein:'#6b1a6b', auftrag_info:'#0a5c5c', intern:'#555', spam:'#8b0000', sonstiges:'#444' };
    const kLabel  = { kundenanfrage:'👤 Kundenanfrage', lieferschein:'📦 Lieferschein', auftrag_info:'📋 Auftrag-Info', intern:'🏢 Intern', spam:'🚫 Spam', sonstiges:'📬 Sonstiges' };
    const pLabel  = { hoch:'🔴 Hoch', normal:'🟡 Normal', niedrig:'⚪ Niedrig' };
    const aiDaten = email.ai_daten || {};
    const hasData = Object.values(aiDaten).some(v => v !== null && v !== undefined && v !== '');
    const canConvert = email.ai_kategorie === 'kundenanfrage' && !email.linked_inquiry_id;
    const thread = email.thread || [];
    const attTexts = email.attachment_texts_parsed || {};

    main.innerHTML = `
    <div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>📧 E-Mail Detail</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canConvert ? `<button class="btn btn-success" onclick="EmailAgentView._openConvert(${email.id})">📋 Als Anfrage anlegen</button>` : ''}
        ${!email.linked_order_id ? `<button class="btn btn-secondary" onclick="EmailAgentView._openLinkOrder(${email.id})">🔧 Auftrag verknüpfen</button>` : `<button class="btn btn-ghost btn-sm" onclick="EmailAgentView._unlinkOrder(${email.id})" title="Verknüpfung aufheben">🔧 ${email.order_number||'Auftrag'} ✕</button>`}
        <button class="btn btn-primary" onclick="EmailAgentView._reclassify(${email.id})">🔄 KI neu analysieren</button>
        ${email.status !== 'ignoriert' ? `<button class="btn btn-ghost btn-sm" onclick="EmailAgentView._setStatus(${email.id},'ignoriert')">Ignorieren</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="EmailAgentView._delete(${email.id})">🗑</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:1300px">

      <!-- LINKE SPALTE: E-Mail Info + Nachrichtentext + Verlauf + Anhänge -->
      <div>
        <div class="card mb-3">
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:4px 8px;color:var(--text-muted);white-space:nowrap">Von</td>
                <td style="padding:4px 8px;font-weight:600">${UI.esc(email.from_name ? `${email.from_name} <${email.from_addr}>` : (email.from_addr||'–'))}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--text-muted)">Betreff</td>
                <td style="padding:4px 8px;font-weight:600">${UI.esc(email.subject||'–')}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--text-muted)">Datum</td>
                <td style="padding:4px 8px">${email.received_at ? new Date(email.received_at).toLocaleString('de-CH') : '–'}</td></tr>
            ${email.source_folder ? `<tr><td style="padding:4px 8px;color:var(--text-muted)">Quelle</td>
                <td style="padding:4px 8px;font-size:11px;color:var(--text-muted)">${UI.esc(email.source_folder)}</td></tr>` : ''}
          </table>
        </div>

        <!-- Neueste Nachricht -->
        <div class="card mb-3">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Nachrichtentext</div>
          <div style="max-height:350px;overflow-y:auto;font-size:13px;line-height:1.6;white-space:pre-wrap;background:var(--bg-secondary);padding:10px;border-radius:6px;word-break:break-word">${UI.esc((email.body_text||'(kein Text)').substring(0,5000))}</div>
        </div>

        <!-- Gesprächsverlauf (wenn vorhanden) -->
        ${thread.length > 1 ? `
        <div class="card mb-3">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">
            💬 Gesprächsverlauf (${thread.length} Nachrichten)
          </div>
          ${thread.slice(0, -1).reverse().map((m, i) => `
          <details style="margin-bottom:6px" ${i===0?'open':''}>
            <summary style="cursor:pointer;font-size:12px;padding:6px;background:var(--bg-secondary);border-radius:4px;list-style:none;display:flex;align-items:center;gap:8px">
              <span style="font-weight:600">${UI.esc(m.from||'?')}</span>
              <span style="color:var(--text-muted)">${UI.esc(m.date||'')}</span>
            </summary>
            <div style="padding:8px;font-size:12px;white-space:pre-wrap;line-height:1.5;word-break:break-word;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-top:none;border-radius:0 0 4px 4px">${UI.esc((m.body||'').substring(0,2000))}</div>
          </details>`).join('')}
        </div>` : ''}

        <!-- Anhänge -->
        ${(email.attachments||[]).length ? `
        <div class="card mb-3">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">📎 Anhänge</div>
          ${(email.attachments||[]).map(a => {
            const hasText = attTexts[a.original_name] && !attTexts[a.original_name].startsWith('(');
            return `<div style="margin-bottom:${hasText?'8':'4'}px">
              <a href="/api/email-agent/attachment/${a.filename}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:var(--bg-secondary);border-radius:4px;text-decoration:none;font-size:13px">
                📎 ${UI.esc(a.original_name)} <span style="font-size:11px;color:var(--text-muted)">(${a.file_size ? (a.file_size/1024).toFixed(0)+'KB' : ''})</span>
              </a>
              ${hasText ? `<details style="margin-top:4px">
                <summary style="cursor:pointer;font-size:11px;color:var(--accent);padding:2px 0">Inhalt anzeigen</summary>
                <pre style="font-size:11px;background:var(--bg-secondary);padding:8px;border-radius:4px;overflow-x:auto;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;margin:4px 0">${UI.esc((attTexts[a.original_name]||'').substring(0,2000))}</pre>
              </details>` : ''}
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>

      <!-- RECHTE SPALTE: KI-Analyse + Antwortentwurf + Daten -->
      <div>

        <!-- KI-Analyse -->
        <div class="card mb-3">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">🤖 KI-Analyse</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            ${email.ai_kategorie ? `<span style="padding:4px 12px;border-radius:12px;background:${kColors[email.ai_kategorie]||'#444'};color:#fff;font-size:13px">${kLabel[email.ai_kategorie]||email.ai_kategorie}</span>` : '<span style="color:var(--text-muted);font-size:13px">Noch nicht klassifiziert</span>'}
            ${email.ai_prioritaet ? `<span style="padding:4px 12px;border-radius:12px;background:var(--bg-secondary);font-size:13px">${pLabel[email.ai_prioritaet]||email.ai_prioritaet}</span>` : ''}
          </div>
          ${email.ai_zusammenfassung ? `<p style="font-size:13px;margin:0 0 8px">${UI.esc(email.ai_zusammenfassung)}</p>` : ''}
          ${email.ai_aktion ? `<div style="padding:8px 12px;background:#fff8e1;border-radius:6px;border-left:3px solid #f57f17;font-size:13px">💡 ${UI.esc(email.ai_aktion)}</div>` : ''}
        </div>

        <!-- Antwortentwurf -->
        <div class="card mb-3" id="ea-draft-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted)">📝 Antwortentwurf</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick="EmailAgentView._regenerateDraft(${email.id})" id="ea-regen-btn" title="Neu generieren">↻ Neu</button>
              <button class="btn btn-secondary btn-sm" onclick="EmailAgentView._saveDraft(${email.id})">Speichern</button>
              <button class="btn btn-primary btn-sm" onclick="EmailAgentView._openSendDraft(${email.id}, '${UI.esc(email.from_addr||'')}')" id="ea-send-btn">📤 Versenden</button>
            </div>
          </div>
          ${email.ai_draft
            ? `<textarea id="ea-draft-text" rows="12" style="width:100%;font-size:13px;line-height:1.6;resize:vertical;border-radius:4px;padding:8px;border:1px solid var(--border);background:var(--bg-secondary)">${UI.esc(email.ai_draft)}</textarea>`
            : `<div id="ea-draft-empty" style="text-align:center;padding:20px;color:var(--text-muted)">
                <p style="font-size:13px;margin:0 0 10px">Noch kein Entwurf vorhanden.</p>
                <button class="btn btn-primary btn-sm" onclick="EmailAgentView._regenerateDraft(${email.id})">✨ Entwurf generieren</button>
              </div>
              <textarea id="ea-draft-text" rows="12" style="width:100%;font-size:13px;line-height:1.6;resize:vertical;border-radius:4px;padding:8px;border:1px solid var(--border);background:var(--bg-secondary);display:none"></textarea>`}
        </div>

        <!-- Erkannte Daten -->
        ${hasData ? `
        <div class="card mb-3">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">📋 Erkannte Daten</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            ${Object.entries(aiDaten).filter(([,v])=>v!==null&&v!==''&&v!==undefined).map(([k,v])=>`
              <tr>
                <td style="padding:3px 8px;color:var(--text-muted);white-space:nowrap;font-size:11px">${EmailAgentView._fieldLabel(k)}</td>
                <td style="padding:3px 8px">${UI.esc(String(v))}</td>
              </tr>`).join('')}
          </table>
          ${canConvert ? `<button class="btn btn-success btn-sm mt-2" onclick="EmailAgentView._openConvert(${email.id})">📋 Als Kundenanfrage anlegen</button>` : ''}
        </div>` : ''}

        ${email.linked_inquiry_id ? `
        <div class="card mb-3" style="border-left:3px solid var(--accent)">
          <strong style="font-size:13px">📋 Verknüpfte Anfrage #${email.linked_inquiry_id}</strong>
          ${email.inquiry_name ? `<p style="margin:4px 0 0;font-size:13px">${UI.esc(email.inquiry_name)}</p>` : ''}
        </div>` : ''}

        ${email.linked_order_id ? `
        <div class="card mb-3" style="border-left:3px solid #3b82f6">
          <strong style="font-size:13px">🔧 Verknüpfter Auftrag: ${UI.esc(email.order_number||'#'+email.linked_order_id)}</strong>
        </div>` : ''}
      </div>
    </div>`;
  },

  _fieldLabel(k) {
    return { vorname:'Vorname', nachname:'Nachname', firma:'Firma', email:'E-Mail', telefon:'Telefon',
      strasse:'Strasse', plz:'PLZ', ort:'Ort', art_der_arbeit:'Art der Arbeit',
      anzahl_zylinder:'Zylinder', anzahl_schluessel:'Schlüssel', anzahl_tueren:'Türen',
      bestehendes_system:'Best. System', wunschtermin:'Wunschtermin', bemerkungen:'Bemerkungen',
      lieferschein_nr:'LS-Nr.', auftrag_nr:'Auftrag-Nr.', empfohlene_aktion:'Empfehlung',
    }[k] || k;
  },

  async _reclassify(id) {
    try {
      UI.toast('KI analysiert...', 'info', 5000);
      await API.post(`/api/email-agent/inbox/${id}/reclassify`, {});
      UI.toast('Neu klassifiziert + Entwurf aktualisiert', 'success');
      EmailAgentView.renderDetail(id);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _regenerateDraft(id) {
    const btn = document.getElementById('ea-regen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      UI.toast('Generiere Entwurf...', 'info', 5000);
      const r = await API.post(`/api/email-agent/inbox/${id}/regenerate-draft`, {});
      // Textarea aktualisieren ohne Seite neu zu laden
      const ta = document.getElementById('ea-draft-text');
      const emptyDiv = document.getElementById('ea-draft-empty');
      if (ta) {
        ta.value = r.draft || '';
        ta.style.display = '';
      }
      if (emptyDiv) emptyDiv.style.display = 'none';
      UI.toast('Entwurf generiert', 'success');
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '↻ Neu'; } }
  },

  async _saveDraft(id) {
    const ta = document.getElementById('ea-draft-text');
    if (!ta) return;
    try {
      await API.put(`/api/email-agent/inbox/${id}/draft`, { draft: ta.value });
      UI.toast('Entwurf gespeichert', 'success');
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _setStatus(id, status) {
    try {
      await API.put(`/api/email-agent/inbox/${id}/status`, { status });
      UI.toast('Status gesetzt', 'success');
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _delete(id) {
    if (!await UI.confirm('E-Mail wirklich löschen?')) return;
    try {
      await API.delete(`/api/email-agent/inbox/${id}`);
      UI.toast('Gelöscht', 'success');
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  _openConvert(id) {
    API.get(`/api/email-agent/inbox/${id}`).then(email => {
      const d = email.ai_daten || {};
      UI.modal('📋 Als Kundenanfrage anlegen',
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field"><label>Vorname</label><input id="ci-vorname" value="${UI.esc(d.vorname||'')}"></div>
          <div class="field"><label>Nachname</label><input id="ci-nachname" value="${UI.esc(d.nachname||'')}"></div>
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
      <h2>📧 Email-Agent Einstellungen</h2></div>
      <div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const cfg = await API.get('/api/email-agent/settings');

      main.innerHTML = `
      <div class="page-header">
        <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <h2>📧 Email-Agent Einstellungen</h2>
      </div>
      <div style="max-width:800px">

        <!-- Ordner-Watcher (Haupt-Methode) -->
        <div class="card mb-4">
          <h3 style="margin:0 0 8px;font-size:15px">📁 E-Mail Eingangsordner (Ordner-Watcher)</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
            Der Server überwacht diesen Ordner. Neue .eml-Dateien werden automatisch verarbeitet.<br>
            <strong>Aktuell überwacht:</strong> <code style="font-size:12px">${UI.esc(cfg.inbox_dir||'–')}</code>
          </p>
          <div class="field">
            <label>Ordnerpfad (leer = Standard-Uploads-Ordner)</label>
            <input id="ea-inbox-path" value="${UI.esc(cfg.email_inbox_path||'')}" placeholder="z.B. C:/Users/Max/Helbling-Emails oder /home/user/emails">
            <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">
              Absoluter Pfad zum Ordner. Dieser Ordner muss vom Server aus erreichbar sein.<br>
              Nach Speichern wird der Watcher neu gestartet und überwacht den neuen Ordner.
            </p>
          </div>
          <div style="margin-top:12px;padding:10px 14px;background:#f0f9ff;border-radius:6px;border-left:3px solid #0ea5e9;font-size:13px">
            <strong>Outlook Tipp:</strong> Erstelle eine Regel: <em>Datei → Regeln verwalten → Neue Regel → E-Mail in Ordner verschieben</em><br>
            Speichere E-Mails manuell via <strong>Datei → Speichern unter → .eml</strong> in diesen Ordner.
          </div>
        </div>

        <!-- KI-Prompts -->
        <div class="card mb-4">
          <h3 style="margin:0 0 8px;font-size:15px">🤖 KI-Prompts</h3>
          <div style="display:flex;gap:10px;margin-bottom:14px">
            <button class="btn btn-sm ${EmailAgentView._promptTab!=='draft'?'btn-primary':'btn-secondary'}" onclick="EmailAgentView._switchPromptTab('classify',this)">Klassifizierungs-Prompt</button>
            <button class="btn btn-sm ${EmailAgentView._promptTab==='draft'?'btn-primary':'btn-secondary'}" onclick="EmailAgentView._switchPromptTab('draft',this)">Antwort-Entwurf Prompt</button>
          </div>
          <div id="ea-prompt-classify">
            <label style="font-size:12px;color:var(--text-muted)">Variablen: {SUBJECT} {FROM} {DATE} {BODY} {THREAD_SECTION} {ATTACHMENT_SECTION}</label>
            <textarea id="ea-prompt" rows="10" style="width:100%;font-family:monospace;font-size:11px;margin-top:4px">${UI.esc(cfg.email_agent_prompt||'')}</textarea>
          </div>
          <div id="ea-prompt-draft" style="display:none">
            <label style="font-size:12px;color:var(--text-muted)">Variablen: {SUBJECT} {FROM} {DATE} {BODY} {THREAD_SECTION} {ATTACHMENT_SECTION} {AI_KATEGORIE} {AI_PRIORITAET} {AI_ZUSAMMENFASSUNG}</label>
            <textarea id="ea-draft-prompt" rows="10" style="width:100%;font-family:monospace;font-size:11px;margin-top:4px">${UI.esc(cfg.email_agent_draft_prompt||'')}</textarea>
          </div>
        </div>

        <!-- Microsoft Graph API (optional) -->
        <div class="card mb-4">
          <h3 style="margin:0 0 4px;font-size:15px">🔌 Microsoft Graph API <span style="font-weight:400;font-size:12px;color:var(--text-muted)">(optional – für automatisches Polling)</span></h3>
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 14px">
            Funktioniert auch wenn IMAP gesperrt ist. Benötigt Azure App-Registrierung (einmalig ~5min).
          </p>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;margin-bottom:14px">
            <input type="checkbox" id="ea-graph-enabled" ${cfg.graph_enabled==='true'?'checked':''} style="width:16px;height:16px">
            Graph API aktivieren
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>Tenant ID *</label><input id="ea-tenant" value="${UI.esc(cfg.graph_tenant_id||'')}"></div>
            <div class="field"><label>Client ID *</label><input id="ea-client-id" value="${UI.esc(cfg.graph_client_id||'')}"></div>
            <div class="field"><label>Client Secret *</label><input id="ea-client-secret" type="password" placeholder="${cfg.graph_client_secret?'gespeichert (zum Ändern eingeben)':'Secret eingeben'}"></div>
            <div class="field"><label>Postfach E-Mail *</label><input id="ea-mailbox" value="${UI.esc(cfg.graph_mailbox||'')}"></div>
            <div class="field"><label>Ordner</label><input id="ea-folder" value="${UI.esc(cfg.graph_folder||'Inbox')}"></div>
            <div class="field"><label>Polling-Intervall (Sekunden)</label><input type="number" id="ea-interval" value="${cfg.graph_poll_interval||'300'}"></div>
          </div>
          <details style="margin-top:12px">
            <summary style="cursor:pointer;font-size:12px;color:var(--accent)">Azure App Setup Anleitung anzeigen</summary>
            <div style="margin-top:8px;padding:12px;background:#f0f9ff;border-radius:6px;font-size:12px;border-left:3px solid #0ea5e9">
              1. <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">portal.azure.com</a> → App-Registrierungen → Neue Registrierung<br>
              2. API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen → <code>Mail.Read</code> hinzufügen<br>
              3. Administratorzustimmung erteilen<br>
              4. Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel<br>
              5. Tenant-ID und Client-ID aus «Übersicht» kopieren
            </div>
          </details>
        </div>

        <div style="display:flex;gap:10px">
          <button class="btn btn-primary" onclick="EmailAgentView._saveSettings()">Einstellungen speichern</button>
          <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">Abbrechen</button>
        </div>
      </div>`;
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  _promptTab: 'classify',
  _switchPromptTab(tab, btn) {
    EmailAgentView._promptTab = tab;
    document.getElementById('ea-prompt-classify').style.display = tab === 'classify' ? '' : 'none';
    document.getElementById('ea-prompt-draft').style.display    = tab === 'draft' ? '' : 'none';
  },

  // ── Auftrag verknüpfen ────────────────────────────────────────────────────

  async _openLinkOrder(emailId) {
    UI.modal('🔧 Auftrag verknüpfen',
      `<div class="field">
        <label>Auftragsnummer suchen</label>
        <input id="lo-search" placeholder="H-1001 oder Kundenname..." oninput="EmailAgentView._searchOrders(this.value)">
      </div>
      <div id="lo-results" style="margin-top:10px;max-height:300px;overflow-y:auto"></div>
      <input type="hidden" id="lo-selected-id">`,
      `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" id="lo-do-btn" disabled onclick="EmailAgentView._doLinkOrder(${emailId})">Verknüpfen</button>`
    );
    EmailAgentView._searchOrders('');
  },

  async _searchOrders(q) {
    const el = document.getElementById('lo-results');
    if (!el) return;
    try {
      const data = await API.get('/api/orders');
      const orders = (data.orders || data).filter(o => {
        const s = (q || '').toLowerCase();
        return !s || (o.order_number||'').toLowerCase().includes(s) || (o.customer_name||'').toLowerCase().includes(s);
      }).slice(0, 20);
      if (!orders.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px">Keine Aufträge gefunden</p>'; return; }
      el.innerHTML = orders.map(o => `
        <div onclick="EmailAgentView._selectOrder(${o.id},'${UI.esc(o.order_number||'')}',this)"
          style="padding:8px 12px;border-radius:6px;cursor:pointer;border:1px solid var(--border);margin-bottom:4px;font-size:13px"
          data-order-id="${o.id}">
          <strong>${UI.esc(o.order_number||'–')}</strong>
          <span style="color:var(--text-muted);margin-left:8px">${UI.esc(o.customer_name||'')}</span>
          <span style="float:right;font-size:11px;color:var(--text-muted)">${o.status}</span>
        </div>`).join('');
    } catch(e) { el.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; }
  },

  _selectOrder(orderId, orderNumber, el) {
    document.querySelectorAll('#lo-results [data-order-id]').forEach(d => d.style.background = '');
    el.style.background = 'var(--accent-glow)';
    document.getElementById('lo-selected-id').value = orderId;
    const btn = document.getElementById('lo-do-btn');
    if (btn) { btn.disabled = false; btn.textContent = `Verknüpfen: ${orderNumber}`; }
  },

  async _doLinkOrder(emailId) {
    const orderId = document.getElementById('lo-selected-id')?.value;
    if (!orderId) return;
    try {
      await API.post(`/api/email-agent/inbox/${emailId}/link-order`, { order_id: orderId });
      UI.toast('Auftrag verknüpft', 'success');
      UI.closeModal();
      EmailAgentView.renderDetail(emailId);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _unlinkOrder(emailId) {
    try {
      await API.post(`/api/email-agent/inbox/${emailId}/link-order`, { order_id: null });
      UI.toast('Verknüpfung aufgehoben', 'success');
      EmailAgentView.renderDetail(emailId);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  // ── Entwurf per E-Mail versenden ─────────────────────────────────────────

  _openSendDraft(emailId, defaultTo) {
    const ta = document.getElementById('ea-draft-text');
    if (!ta?.value?.trim()) { UI.toast('Kein Entwurf vorhanden – bitte zuerst speichern', 'warning'); return; }
    UI.modal('📤 Entwurf versenden',
      `<div class="field">
        <label>Empfänger (An)</label>
        <input id="sd-to" value="${UI.esc(defaultTo)}" placeholder="empfaenger@beispiel.ch">
      </div>
      <div class="field mt-2">
        <label>Vorschau</label>
        <div style="max-height:200px;overflow-y:auto;background:var(--bg-secondary);padding:10px;border-radius:6px;font-size:12px;white-space:pre-wrap;line-height:1.5">${UI.esc(ta.value.substring(0,1000))}${ta.value.length>1000?'\n...':''}</div>
      </div>`,
      `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="EmailAgentView._sendDraft(${emailId})">📤 Jetzt senden</button>`
    );
  },

  async _sendDraft(emailId) {
    const to = document.getElementById('sd-to')?.value?.trim();
    if (!to) { UI.toast('Bitte Empfänger eingeben', 'error'); return; }
    const ta = document.getElementById('ea-draft-text');
    // Save current draft text first
    try { await API.put(`/api/email-agent/inbox/${emailId}/draft`, { draft: ta?.value }); } catch {}
    try {
      await API.post(`/api/email-agent/inbox/${emailId}/send-draft`, { to });
      UI.toast('E-Mail gesendet', 'success');
      UI.closeModal();
      EmailAgentView.renderDetail(emailId);
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },

  async _saveSettings() {
    const body = {
      email_inbox_path:         document.getElementById('ea-inbox-path')?.value.trim(),
      graph_tenant_id:          document.getElementById('ea-tenant')?.value.trim(),
      graph_client_id:          document.getElementById('ea-client-id')?.value.trim(),
      graph_client_secret:      document.getElementById('ea-client-secret')?.value,
      graph_mailbox:            document.getElementById('ea-mailbox')?.value.trim(),
      graph_folder:             document.getElementById('ea-folder')?.value.trim() || 'Inbox',
      graph_poll_interval:      document.getElementById('ea-interval')?.value.trim() || '300',
      graph_enabled:            document.getElementById('ea-graph-enabled')?.checked,
      email_agent_prompt:       document.getElementById('ea-prompt')?.value,
      email_agent_draft_prompt: document.getElementById('ea-draft-prompt')?.value,
    };
    try {
      const r = await API.post('/api/email-agent/settings', body);
      UI.toast(`Gespeichert – Watcher überwacht: ${r.inbox_dir || body.email_inbox_path || 'Standard-Ordner'}`, 'success', 5000);
      EmailAgentView.renderInbox();
    } catch(e) { UI.toast('Fehler: '+e.message, 'error'); }
  },
};
