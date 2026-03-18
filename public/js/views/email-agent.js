/**
 * Email-Agent View
 * Zeigt Posteingang, KI-Klassifizierungen, Aktionen und Einstellungen.
 */

const EmailAgentView = {

  currentFilter: { status: '', kategorie: '', page: 0 },
  PAGE_SIZE: 30,

  // ── Hauptansicht: Posteingang ──────────────────────────────────────────────

  async renderInbox() {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <h2>📧 E-Mail Posteingang</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select id="ea-filter-status" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border)">
          <option value="">Alle Status</option>
          <option value="neu">Neu</option>
          <option value="verarbeitet">Verarbeitet</option>
          <option value="ignoriert">Ignoriert</option>
          <option value="fehler">Fehler</option>
        </select>
        <select id="ea-filter-kategorie" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border)">
          <option value="">Alle Kategorien</option>
          <option value="kundenanfrage">Kundenanfrage</option>
          <option value="lieferschein">Lieferschein</option>
          <option value="auftrag_info">Auftrag-Info</option>
          <option value="intern">Intern</option>
          <option value="spam">Spam</option>
          <option value="sonstiges">Sonstiges</option>
        </select>
        <button class="btn btn-secondary" onclick="EmailAgentView.pollNow()">
          ↻ Jetzt abrufen
        </button>
        <button class="btn btn-secondary" onclick="EmailAgentView.renderSettings()">
          ⚙ Einstellungen
        </button>
      </div>
    </div>
    <div id="ea-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px"></div>
    <div id="ea-list">Lade...</div>
    <div id="ea-pagination" style="margin-top:16px;text-align:center"></div>`;

    document.getElementById('ea-filter-status').value = EmailAgentView.currentFilter.status;
    document.getElementById('ea-filter-kategorie').value = EmailAgentView.currentFilter.kategorie;
    document.getElementById('ea-filter-status').onchange = e => {
      EmailAgentView.currentFilter.status = e.target.value;
      EmailAgentView.currentFilter.page = 0;
      EmailAgentView._loadList();
    };
    document.getElementById('ea-filter-kategorie').onchange = e => {
      EmailAgentView.currentFilter.kategorie = e.target.value;
      EmailAgentView.currentFilter.page = 0;
      EmailAgentView._loadList();
    };

    await EmailAgentView._loadStats();
    await EmailAgentView._loadList();
  },

  async _loadStats() {
    try {
      const s = await API.get('/email-agent/status');
      const el = document.getElementById('ea-stats');
      if (!el) return;
      el.innerHTML = `
        <div class="stat-chip ${s.stats.high > 0 ? 'stat-danger' : ''}">
          <span>⚠</span> ${s.stats.high} hohe Priorität
        </div>
        <div class="stat-chip">
          <span>🔵</span> ${s.stats.unread} ungelesen
        </div>
        <div class="stat-chip">
          <span>📧</span> ${s.stats.total} gesamt
        </div>
        ${s.stats.errors > 0 ? `<div class="stat-chip stat-danger"><span>❌</span> ${s.stats.errors} Fehler</div>` : ''}
        <div class="stat-chip ${s.configured ? 'stat-ok' : 'stat-warn'}">
          ${s.configured ? `✅ Verbunden: ${s.user}` : '❌ IMAP nicht konfiguriert'}
        </div>`;
    } catch {}
  },

  async _loadList() {
    const el = document.getElementById('ea-list');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Lade...</div>';

    const { status, kategorie, page } = EmailAgentView.currentFilter;
    const params = new URLSearchParams({
      limit: EmailAgentView.PAGE_SIZE,
      offset: page * EmailAgentView.PAGE_SIZE,
    });
    if (status)    params.set('status', status);
    if (kategorie) params.set('kategorie', kategorie);

    try {
      const data = await API.get(`/email-agent/inbox?${params}`);
      if (!data.emails.length) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Keine E-Mails gefunden</div>';
        document.getElementById('ea-pagination').innerHTML = '';
        return;
      }

      el.innerHTML = `<div class="email-list">${data.emails.map(e => EmailAgentView._emailRow(e)).join('')}</div>`;

      // Pagination
      const totalPages = Math.ceil(data.total / EmailAgentView.PAGE_SIZE);
      if (totalPages > 1) {
        document.getElementById('ea-pagination').innerHTML = `
          <button class="btn btn-secondary" ${page === 0 ? 'disabled' : ''} onclick="EmailAgentView.currentFilter.page--;EmailAgentView._loadList()">← Zurück</button>
          <span style="margin:0 12px;color:var(--text-muted)">Seite ${page + 1} / ${totalPages}</span>
          <button class="btn btn-secondary" ${page >= totalPages - 1 ? 'disabled' : ''} onclick="EmailAgentView.currentFilter.page++;EmailAgentView._loadList()">Weiter →</button>`;
      } else {
        document.getElementById('ea-pagination').innerHTML = '';
      }
    } catch(e) {
      el.innerHTML = `<div class="alert alert-danger">Fehler: ${e.message}</div>`;
    }
  },

  _emailRow(e) {
    const kBadge = {
      kundenanfrage: 'badge-blue',
      lieferschein:  'badge-purple',
      auftrag_info:  'badge-teal',
      intern:        'badge-gray',
      spam:          'badge-red',
      sonstiges:     'badge-gray',
    };
    const pBadge = { hoch: '🔴', normal: '🟡', niedrig: '⚪' };
    const statusBadge = {
      neu:         '<span class="badge badge-blue">Neu</span>',
      verarbeitet: '<span class="badge badge-green">OK</span>',
      ignoriert:   '<span class="badge badge-gray">Ignoriert</span>',
      fehler:      '<span class="badge badge-red">Fehler</span>',
    };

    const catLabel = {
      kundenanfrage: 'Kundenanfrage',
      lieferschein:  'Lieferschein',
      auftrag_info:  'Auftrag-Info',
      intern:        'Intern',
      spam:          'Spam',
      sonstiges:     'Sonstiges',
    };

    const prio = pBadge[e.ai_prioritaet] || '⚪';
    const kat  = e.ai_kategorie ? `<span class="badge ${kBadge[e.ai_kategorie] || 'badge-gray'}">${catLabel[e.ai_kategorie] || e.ai_kategorie}</span>` : '';
    const linked = e.linked_inquiry_id
      ? `<span class="badge badge-teal" title="Anfrage #${e.linked_inquiry_id}">📋 Anfrage</span>`
      : e.linked_order_id
        ? `<span class="badge badge-purple">Auftrag ${e.order_number}</span>`
        : '';
    const att = e.has_attachments ? '<span title="Anhänge" style="font-size:12px">📎</span>' : '';

    const date = e.received_at ? new Date(e.received_at).toLocaleString('de-CH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';

    return `<div class="email-row ${e.status === 'neu' ? 'email-row-unread' : ''}" onclick="EmailAgentView.renderDetail(${e.id})">
      <div class="email-row-meta">
        <span class="email-prio">${prio}</span>
        ${statusBadge[e.status] || ''}
        ${kat}
        ${linked}
        ${att}
      </div>
      <div class="email-row-main">
        <span class="email-from">${UI.esc(e.from_name || e.from_addr || '?')}</span>
        <span class="email-subject">${UI.esc(e.subject || '(kein Betreff)')}</span>
        <span class="email-date">${date}</span>
      </div>
      ${e.ai_zusammenfassung ? `<div class="email-summary">${UI.esc(e.ai_zusammenfassung)}</div>` : ''}
      ${e.ai_aktion ? `<div class="email-action-hint">💡 ${UI.esc(e.ai_aktion)}</div>` : ''}
    </div>`;
  },

  // ── Detail-Ansicht einer E-Mail ────────────────────────────────────────────

  async renderDetail(id) {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>E-Mail Detail</h2>
    </div><div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const email = await API.get(`/email-agent/inbox/${id}`);

      const kColors = {
        kundenanfrage: '#1a3a6b', lieferschein: '#6b1a6b', auftrag_info: '#0a5c5c',
        intern: '#555', spam: '#8b0000', sonstiges: '#444'
      };
      const catLabel = {
        kundenanfrage: '👤 Kundenanfrage', lieferschein: '📦 Lieferschein',
        auftrag_info: '📋 Auftrag-Info', intern: '🏢 Intern',
        spam: '🚫 Spam', sonstiges: '📬 Sonstiges'
      };
      const pLabel = { hoch: '🔴 Hoch', normal: '🟡 Normal', niedrig: '⚪ Niedrig' };

      const aiDaten = email.ai_daten || {};
      const hasData  = Object.values(aiDaten).some(v => v !== null && v !== undefined && v !== '');

      main.innerHTML = `
      <div class="page-header">
        <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <h2>📧 E-Mail</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${email.status === 'neu' || email.status === 'fehler' ? `<button class="btn btn-primary" onclick="EmailAgentView._reclassify(${id})">🔄 Neu klassifizieren</button>` : ''}
          ${email.ai_kategorie === 'kundenanfrage' && !email.linked_inquiry_id ? `<button class="btn btn-success" onclick="EmailAgentView._convertToInquiry(${id})">📋 Als Anfrage anlegen</button>` : ''}
          <button class="btn btn-secondary" onclick="EmailAgentView._setStatus(${id},'ignoriert')">Ignorieren</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1100px">
        <!-- Linke Spalte: E-Mail Inhalt -->
        <div>
          <div class="card mb-3">
            <h3 style="margin:0 0 12px;font-size:15px">E-Mail Informationen</h3>
            <table style="width:100%;font-size:13px;border-collapse:collapse">
              <tr><td style="padding:4px 8px;color:var(--text-muted);white-space:nowrap">Von</td><td style="padding:4px 8px">${UI.esc(email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr || '–')}</td></tr>
              <tr><td style="padding:4px 8px;color:var(--text-muted)">An</td><td style="padding:4px 8px">${UI.esc(email.to_addr || '–')}</td></tr>
              <tr><td style="padding:4px 8px;color:var(--text-muted)">Betreff</td><td style="padding:4px 8px;font-weight:600">${UI.esc(email.subject || '–')}</td></tr>
              <tr><td style="padding:4px 8px;color:var(--text-muted)">Datum</td><td style="padding:4px 8px">${email.received_at ? new Date(email.received_at).toLocaleString('de-CH') : '–'}</td></tr>
              ${email.has_attachments ? `<tr><td style="padding:4px 8px;color:var(--text-muted)">Anhänge</td><td style="padding:4px 8px">${(email.attachments||[]).map(a => `<a href="/api/email-agent/attachment/${a.filename}" target="_blank" style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:4px;background:var(--bg-secondary);font-size:12px">📎 ${UI.esc(a.original_name)}</a>`).join('') || '–'}</td></tr>` : ''}
            </table>
          </div>

          <div class="card">
            <h3 style="margin:0 0 12px;font-size:15px">Nachrichtentext</h3>
            <div style="max-height:400px;overflow-y:auto;font-size:13px;line-height:1.6;white-space:pre-wrap;background:var(--bg-secondary);padding:12px;border-radius:6px">${UI.esc((email.body_text || '(kein Text)').substring(0, 5000))}</div>
          </div>
        </div>

        <!-- Rechte Spalte: KI-Analyse -->
        <div>
          <div class="card mb-3">
            <h3 style="margin:0 0 12px;font-size:15px">🤖 KI-Klassifizierung</h3>
            <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
              ${email.ai_kategorie ? `<span style="padding:4px 12px;border-radius:12px;background:${kColors[email.ai_kategorie] || '#444'};color:#fff;font-size:13px">${catLabel[email.ai_kategorie] || email.ai_kategorie}</span>` : '<span style="color:var(--text-muted)">Noch nicht klassifiziert</span>'}
              ${email.ai_prioritaet ? `<span style="padding:4px 12px;border-radius:12px;background:var(--bg-secondary);font-size:13px">${pLabel[email.ai_prioritaet] || email.ai_prioritaet}</span>` : ''}
            </div>
            ${email.ai_zusammenfassung ? `<div style="margin-bottom:10px"><strong style="font-size:12px;color:var(--text-muted)">ZUSAMMENFASSUNG</strong><p style="margin:4px 0;font-size:13px">${UI.esc(email.ai_zusammenfassung)}</p></div>` : ''}
            ${email.ai_aktion ? `<div style="padding:10px 12px;background:#fff8e1;border-radius:6px;border-left:3px solid #f57f17"><strong style="font-size:12px">💡 Empfehlung</strong><p style="margin:4px 0;font-size:13px">${UI.esc(email.ai_aktion)}</p></div>` : ''}
          </div>

          ${hasData ? `
          <div class="card mb-3">
            <h3 style="margin:0 0 12px;font-size:15px">📋 Extrahierte Daten</h3>
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              ${Object.entries(aiDaten).filter(([,v]) => v !== null && v !== '' && v !== undefined).map(([k,v]) => `
                <tr>
                  <td style="padding:3px 8px;color:var(--text-muted);white-space:nowrap;font-size:11px">${EmailAgentView._fieldLabel(k)}</td>
                  <td style="padding:3px 8px">${UI.esc(String(v))}</td>
                </tr>`).join('')}
            </table>
          </div>` : ''}

          ${email.linked_inquiry_id ? `
          <div class="card mb-3" style="border-left:3px solid #1a3a6b">
            <h3 style="margin:0 0 8px;font-size:14px">📋 Verknüpfte Anfrage</h3>
            <p style="margin:0;font-size:13px">${email.inquiry_name || ''} <a onclick="App.navigate('planer-anfragen')" style="cursor:pointer;color:var(--primary)">#${email.linked_inquiry_id} →</a></p>
          </div>` : ''}

          ${email.linked_order_id ? `
          <div class="card mb-3" style="border-left:3px solid #1a3a6b">
            <h3 style="margin:0 0 8px;font-size:14px">📌 Verknüpfter Auftrag</h3>
            <p style="margin:0;font-size:13px">Auftrag ${email.order_number || email.linked_order_id}</p>
          </div>` : ''}
        </div>
      </div>`;
    } catch(e) {
      main.innerHTML = `<button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button><div class="alert alert-danger mt-3">Fehler: ${e.message}</div>`;
    }
  },

  _fieldLabel(k) {
    const labels = {
      vorname:'Vorname', nachname:'Nachname', firma:'Firma', email:'E-Mail',
      telefon:'Telefon', strasse:'Strasse', plz:'PLZ', ort:'Ort',
      art_der_arbeit:'Art der Arbeit', anzahl_zylinder:'Zylinder (ca.)',
      anzahl_schluessel:'Schlüssel (ca.)', anzahl_tueren:'Türen (ca.)',
      bestehendes_system:'Bestehendes System', wunschtermin:'Wunschtermin',
      bemerkungen:'Bemerkungen', lieferschein_nr:'Lieferschein-Nr.',
      auftrag_nr:'Auftrag-Nr.', empfohlene_aktion:'Empfehlung',
    };
    return labels[k] || k;
  },

  async _reclassify(id) {
    if (!confirm('E-Mail durch Claude KI neu klassifizieren?')) return;
    try {
      UI.toast('Klassifiziere...', 'info');
      await API.post(`/email-agent/inbox/${id}/reclassify`, {});
      UI.toast('Erfolgreich neu klassifiziert', 'success');
      EmailAgentView.renderDetail(id);
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  async _setStatus(id, status) {
    try {
      await API.put(`/email-agent/inbox/${id}/status`, { status });
      UI.toast('Status gesetzt', 'success');
      EmailAgentView.renderInbox();
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  async _convertToInquiry(id) {
    try {
      const email = await API.get(`/email-agent/inbox/${id}`);
      const d = email.ai_daten || {};

      UI.modal('📋 Als Kundenanfrage anlegen', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field"><label>Vorname *</label><input id="ci-vorname" value="${UI.esc(d.vorname||'')}"></div>
          <div class="field"><label>Nachname *</label><input id="ci-nachname" value="${UI.esc(d.nachname||'')}"></div>
          <div class="field"><label>Firma</label><input id="ci-firma" value="${UI.esc(d.firma||'')}"></div>
          <div class="field"><label>E-Mail *</label><input id="ci-email" value="${UI.esc(d.email||email.from_addr||'')}"></div>
          <div class="field"><label>Telefon *</label><input id="ci-telefon" value="${UI.esc(d.telefon||'')}"></div>
          <div class="field"><label>Art der Arbeit</label>
            <select id="ci-arbeit">
              <option value="">–</option>
              ${['Neuinstallation','Erweiterung','Reparatur','Service/Wartung','Offerte'].map(a => `<option ${d.art_der_arbeit===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Strasse</label><input id="ci-strasse" value="${UI.esc(d.strasse||'')}"></div>
          <div class="field"><label>PLZ / Ort</label><div style="display:flex;gap:6px"><input id="ci-plz" value="${UI.esc(d.plz||'')}" style="width:80px"><input id="ci-ort" value="${UI.esc(d.ort||'')}"></div></div>
          <div class="field"><label>Wunschtermin</label><input type="date" id="ci-termin" value="${UI.esc(d.wunschtermin||'')}"></div>
          <div class="field"><label>Zylinder (ca.)</label><input type="number" id="ci-zyl" value="${d.anzahl_zylinder||''}"></div>
        </div>
        <div class="field mt-2"><label>Bemerkungen</label><textarea id="ci-bem" rows="3">${UI.esc(d.bemerkungen||email.ai_zusammenfassung||'')}</textarea></div>
      `,
      `<button class="btn btn-secondary" onclick="UI.closeModal()">Abbrechen</button>
       <button class="btn btn-primary" onclick="EmailAgentView._doConvertInquiry(${id})">Anlegen</button>`);
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  async _doConvertInquiry(id) {
    const body = {
      vorname:        document.getElementById('ci-vorname').value.trim(),
      nachname:       document.getElementById('ci-nachname').value.trim(),
      firma:          document.getElementById('ci-firma').value.trim() || null,
      email:          document.getElementById('ci-email').value.trim(),
      telefon:        document.getElementById('ci-telefon').value.trim(),
      strasse:        document.getElementById('ci-strasse').value.trim(),
      plz:            document.getElementById('ci-plz').value.trim(),
      ort:            document.getElementById('ci-ort').value.trim(),
      art_der_arbeit: document.getElementById('ci-arbeit').value || null,
      anzahl_zylinder: document.getElementById('ci-zyl').value || null,
      wunschtermin:   document.getElementById('ci-termin').value || null,
      bemerkungen:    document.getElementById('ci-bem').value.trim() || null,
    };
    try {
      await API.post(`/email-agent/inbox/${id}/convert-inquiry`, body);
      UI.toast('Kundenanfrage angelegt', 'success');
      UI.closeModal();
      EmailAgentView.renderDetail(id);
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  async pollNow() {
    try {
      UI.toast('Prüfe Posteingang...', 'info');
      const r = await API.post('/email-agent/poll', {});
      UI.toast(`Fertig – ${r.today} E-Mail(s) heute verarbeitet`, 'success');
      EmailAgentView.renderInbox();
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  // ── Einstellungen ──────────────────────────────────────────────────────────

  async renderSettings() {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-header">
      <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
      <h2>📧 Email-Agent Einstellungen</h2>
    </div><div style="padding:20px;color:var(--text-muted)">Lade...</div>`;

    try {
      const cfg = await API.get('/email-agent/settings');

      main.innerHTML = `
      <div class="page-header">
        <button class="btn btn-secondary" onclick="EmailAgentView.renderInbox()">← Zurück</button>
        <h2>📧 Email-Agent Einstellungen</h2>
      </div>
      <div style="max-width:700px">
        <div class="card mb-4">
          <h3 style="margin:0 0 16px;font-size:15px">IMAP Verbindung</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>IMAP Server *</label><input id="ea-imap-host" value="${UI.esc(cfg.imap_host||'')}"></div>
            <div class="field"><label>Port</label><input id="ea-imap-port" value="${UI.esc(cfg.imap_port||'993')}" type="number"></div>
            <div class="field"><label>Benutzername (E-Mail) *</label><input id="ea-imap-user" value="${UI.esc(cfg.imap_user||'')}"></div>
            <div class="field"><label>Passwort *</label><input id="ea-imap-pass" type="password" placeholder="${cfg.imap_pass ? 'gespeichert (leer lassen zum behalten)' : 'Passwort eingeben'}"></div>
            <div class="field"><label>SSL/TLS</label>
              <select id="ea-imap-secure">
                <option value="true" ${cfg.imap_secure!=='false'?'selected':''}>Ja (Port 993)</option>
                <option value="false" ${cfg.imap_secure==='false'?'selected':''}>Nein (Port 143)</option>
              </select>
            </div>
            <div class="field"><label>Postfach / Ordner</label><input id="ea-imap-folder" value="${UI.esc(cfg.imap_folder||'INBOX')}"></div>
            <div class="field"><label>Polling-Intervall (Sekunden)</label><input id="ea-imap-interval" type="number" value="${cfg.imap_poll_interval||'300'}"></div>
            <div class="field" style="display:flex;align-items:flex-end">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="ea-reset-uid"> Alle alten E-Mails neu einlesen
              </label>
            </div>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:12px 0 0">
            💡 Für Microsoft 365: IMAP_HOST = outlook.office365.com, Port 993, SSL: Ja<br>
            Für Gmail: imap.gmail.com, Port 993, SSL: Ja (App-Passwort verwenden)
          </p>
        </div>

        <div class="card mb-4">
          <h3 style="margin:0 0 12px;font-size:15px">Claude AI Klassifizierungs-Prompt</h3>
          <textarea id="ea-ai-prompt" rows="16" style="width:100%;font-family:monospace;font-size:12px">${UI.esc(cfg.email_agent_prompt||'')}</textarea>
          <p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">
            Variablen: {SUBJECT}, {FROM}, {DATE}, {BODY}
          </p>
        </div>

        <div style="display:flex;gap:10px">
          <button class="btn btn-primary" onclick="EmailAgentView._saveSettings()">Einstellungen speichern</button>
          <button class="btn btn-secondary" onclick="EmailAgentView.pollNow()">↻ Jetzt prüfen</button>
        </div>
      </div>`;
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },

  async _saveSettings() {
    const body = {
      imap_host:          document.getElementById('ea-imap-host').value.trim(),
      imap_port:          document.getElementById('ea-imap-port').value.trim(),
      imap_secure:        document.getElementById('ea-imap-secure').value,
      imap_user:          document.getElementById('ea-imap-user').value.trim(),
      imap_pass:          document.getElementById('ea-imap-pass').value,
      imap_folder:        document.getElementById('ea-imap-folder').value.trim() || 'INBOX',
      imap_poll_interval: document.getElementById('ea-imap-interval').value.trim() || '300',
      email_agent_prompt: document.getElementById('ea-ai-prompt').value,
      reset_uid:          document.getElementById('ea-reset-uid').checked,
    };
    try {
      await API.post('/email-agent/settings', body);
      UI.toast('Einstellungen gespeichert', 'success');
      EmailAgentView.renderInbox();
    } catch(e) {
      UI.toast('Fehler: ' + e.message, 'danger');
    }
  },
};
