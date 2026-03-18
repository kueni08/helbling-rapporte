/**
 * Email-Agent
 *
 * Verarbeitet eingehende E-Mails OHNE IMAP — zwei Methoden:
 *
 * 1. EML-Datei Upload (manuell oder Ordner-Watcher)
 *    - Nutzer exportiert E-Mail aus Outlook als .eml
 *    - Upload über Web-UI oder automatisch aus Ordner
 *
 * 2. Microsoft Graph API (automatisches Polling)
 *    - Funktioniert auch wenn IMAP gesperrt ist (nur HTTPS Port 443)
 *    - Benötigt Azure App-Registrierung mit Mail.Read Berechtigung
 *    - Setup: https://portal.azure.com → App-Registrierungen
 *
 * Klassifizierungskategorien (Claude KI):
 *   kundenanfrage, lieferschein, auftrag_info, intern, spam, sonstiges
 */

const { simpleParser } = require('mailparser');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const EMAIL_ATT_DIR   = path.join(UPLOADS_DIR, 'email-attachments');
const EMAIL_INBOX_DIR = path.join(UPLOADS_DIR, 'email-inbox');     // .eml Dateien zum Verarbeiten
const EMAIL_DONE_DIR  = path.join(UPLOADS_DIR, 'email-processed'); // verarbeitete .eml Dateien
const EMAIL_ERROR_DIR = path.join(UPLOADS_DIR, 'email-fehler');    // fehlerhafte .eml Dateien

let graphPollerTimer = null;

// ── Verzeichnisse anlegen ─────────────────────────────────────────────────────

function ensureDirs() {
  [EMAIL_ATT_DIR, EMAIL_INBOX_DIR, EMAIL_DONE_DIR, EMAIL_ERROR_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Microsoft Graph API Konfiguration ─────────────────────────────────────────

function getGraphConfig() {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  return {
    tenant_id:     get('graph_tenant_id')     || process.env.GRAPH_TENANT_ID     || '',
    client_id:     get('graph_client_id')     || process.env.GRAPH_CLIENT_ID     || '',
    client_secret: get('graph_client_secret') || process.env.GRAPH_CLIENT_SECRET || '',
    mailbox:       get('graph_mailbox')       || process.env.GRAPH_MAILBOX       || '',
    folder:        get('graph_folder')        || process.env.GRAPH_FOLDER        || 'Inbox',
    interval:      parseInt(get('graph_poll_interval') || process.env.GRAPH_POLL_INTERVAL || '300'),
    enabled:       (get('graph_enabled')      || process.env.GRAPH_ENABLED       || 'false') === 'true',
  };
}

function isGraphConfigured() {
  const c = getGraphConfig();
  return !!(c.tenant_id && c.client_id && c.client_secret && c.mailbox && c.enabled);
}

// ── Microsoft Graph API: OAuth2 Token holen ───────────────────────────────────

async function getGraphToken(cfg) {
  const url = `https://login.microsoftonline.com/${cfg.tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     cfg.client_id,
    client_secret: cfg.client_secret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph Auth Fehler: ${data.error_description || data.error}`);
  return data.access_token;
}

// ── Microsoft Graph API: Neue E-Mails abholen ─────────────────────────────────

async function fetchGraphEmails(cfg, token) {
  const db = getDb();
  const lastCheck = db.prepare("SELECT value FROM settings WHERE key = 'graph_last_check'").get()?.value;

  let filterParts = ['isRead eq false'];
  if (lastCheck) {
    filterParts.push(`receivedDateTime gt ${lastCheck}`);
  }

  const filter = encodeURIComponent(filterParts.join(' and '));
  const select = 'id,subject,from,toRecipients,receivedDateTime,body,hasAttachments,internetMessageId';
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/mailFolders/${cfg.folder}/messages?$filter=${filter}&$select=${select}&$top=50&$orderby=receivedDateTime asc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph Fehler: ${data.error?.message || res.status}`);

  return data.value || [];
}

// ── Graph API: Anhänge für eine Nachricht laden ───────────────────────────────

async function fetchGraphAttachments(cfg, token, messageId) {
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages/${messageId}/attachments`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.value || []).filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment');
}

// ── Graph API: Nachricht als gelesen markieren ────────────────────────────────

async function markGraphEmailRead(cfg, token, messageId) {
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages/${messageId}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  }).catch(() => {});
}

// ── Claude AI: E-Mail klassifizieren ──────────────────────────────────────────

const DEFAULT_CLASSIFICATION_PROMPT = `Du bist ein intelligenter E-Mail-Assistent für Helbling & Co. AG (Schlüsselboxen / SIBOX / FacetteStar Produkte, Schweiz).

Analysiere die folgende E-Mail und klassifiziere sie. Gib NUR valides JSON zurück, keinen anderen Text.

KATEGORIEN:
- "kundenanfrage"  → Kunde fragt nach Offerte, Montage, Reparatur, Service oder hat eine allgemeine Frage zu Produkten/Dienstleistungen
- "lieferschein"   → E-Mail enthält oder referenziert einen Lieferschein, eine Bestellbestätigung oder Lieferung
- "auftrag_info"   → Info zu einem bestehenden Auftrag (Terminbestätigung, Rückmeldung, Statusanfrage)
- "intern"         → Interne Kommunikation (von Mitarbeitenden, Lieferanten, Partnern)
- "spam"           → Werbung, unerwünschte E-Mail
- "sonstiges"      → Passt in keine andere Kategorie

PRIORITÄT:
- "hoch"    → Dringend, Beschwerde, Notfall, zeitkritisch
- "normal"  → Standard-Anfrage
- "niedrig" → Info, kein Handlungsbedarf

EXTRAHIERE folgende Felder soweit vorhanden:
- vorname, nachname, firma, email, telefon
- strasse, plz, ort
- art_der_arbeit (Montage/Reparatur/Service/Offerte/Sonstiges)
- anzahl_zylinder, anzahl_schluessel, anzahl_tueren (jeweils als Zahl)
- bestehendes_system (true/false)
- wunschtermin (YYYY-MM-DD falls erkennbar)
- bemerkungen (kurze Zusammenfassung des Anliegens)
- lieferschein_nr, auftrag_nr (falls erkennbar)
- empfohlene_aktion (max. 1 Satz Handlungsempfehlung)

Antworte mit JSON:
{
  "kategorie": "kundenanfrage",
  "prioritaet": "normal",
  "zusammenfassung": "Kunde möchte 2 Schlüsselboxen montieren lassen.",
  "empfohlene_aktion": "Anfrage in Formular umwandeln und Termin vereinbaren.",
  "daten": {
    "vorname": "Max", "nachname": "Muster", "firma": null,
    "email": "max@example.ch", "telefon": "044 123 45 67",
    "strasse": "Musterstrasse 1", "plz": "8000", "ort": "Zürich",
    "art_der_arbeit": "Montage",
    "anzahl_zylinder": null, "anzahl_schluessel": null, "anzahl_tueren": null,
    "bestehendes_system": false, "wunschtermin": null,
    "bemerkungen": "Möchte 2 Schlüsselboxen im Eingangsbereich montieren.",
    "lieferschein_nr": null, "auftrag_nr": null,
    "empfohlene_aktion": "Anfrage in Formular umwandeln."
  }
}

E-MAIL:
Betreff: {SUBJECT}
Von: {FROM}
Datum: {DATE}

{BODY}`;

async function classifyEmail(subject, from, date, body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nicht konfiguriert');

  const client = new Anthropic({ apiKey });
  const db = getDb();
  const customPrompt = db.prepare("SELECT value FROM settings WHERE key = 'email_agent_prompt'").get()?.value;
  const promptTemplate = customPrompt || DEFAULT_CLASSIFICATION_PROMPT;

  const truncatedBody = (body || '').substring(0, 6000) || '(kein Inhalt)';
  const prompt = promptTemplate
    .replace('{SUBJECT}', subject || '(kein Betreff)')
    .replace('{FROM}', from || '(unbekannt)')
    .replace('{DATE}', date || '')
    .replace('{BODY}', truncatedBody);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(raw);
}

// ── Anhänge auf Disk speichern ─────────────────────────────────────────────────

function saveAttachmentBuffer(emailDbId, buffer, originalName, contentType) {
  if (!fs.existsSync(EMAIL_ATT_DIR)) fs.mkdirSync(EMAIL_ATT_DIR, { recursive: true });
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  const filename = `${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(EMAIL_ATT_DIR, filename), buffer);

  const db = getDb();
  db.prepare(`INSERT INTO email_attachments (email_id, filename, original_name, content_type, file_size)
              VALUES (?, ?, ?, ?, ?)`)
    .run(emailDbId, filename, originalName || filename, contentType || 'application/octet-stream', buffer.length);
  return filename;
}

// ── Aus KI-Daten eine Kundenanfrage anlegen ────────────────────────────────────

function createInquiryFromEmail(emailDbId, aiResult) {
  const d = aiResult.daten || {};
  if (!d.vorname && !d.nachname && !d.email) return null;

  const db = getDb();
  const token = uuidv4().replace(/-/g, '');

  try {
    const result = db.prepare(`
      INSERT INTO customer_inquiries (
        token, status, firma, vorname, nachname, email, telefon,
        strasse, plz, ort, art_der_arbeit, anzahl_zylinder, anzahl_schluessel,
        anzahl_tueren, bestehendes_system, wunschtermin, bemerkungen
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      token, 'neu',
      d.firma || null,
      d.vorname || '',
      d.nachname || '',
      d.email || '',
      d.telefon || '',
      d.strasse || '',
      d.plz || '',
      d.ort || '',
      d.art_der_arbeit || null,
      d.anzahl_zylinder ? parseInt(d.anzahl_zylinder) : null,
      d.anzahl_schluessel ? parseInt(d.anzahl_schluessel) : null,
      d.anzahl_tueren ? parseInt(d.anzahl_tueren) : null,
      d.bestehendes_system ? 1 : 0,
      d.wunschtermin || null,
      d.bemerkungen || aiResult.zusammenfassung || null
    );

    db.prepare("UPDATE email_inbox SET linked_inquiry_id = ? WHERE id = ?")
      .run(result.lastInsertRowid, emailDbId);

    return result.lastInsertRowid;
  } catch (e) {
    console.error('[Email-Agent] Kundenanfrage erstellen fehlgeschlagen:', e.message);
    return null;
  }
}

// ── Haupt-Verarbeitungsfunktion: Parsed-Email → DB ────────────────────────────

async function processEmailData({ messageId, subject, fromAddr, fromName, toAddr, receivedAt, bodyText, bodyHtml, attachments = [] }) {
  const db = getDb();

  // Duplikate prüfen
  if (messageId) {
    const existing = db.prepare('SELECT id FROM email_inbox WHERE message_id = ?').get(messageId);
    if (existing) return { skipped: true, id: existing.id };
  }

  // In DB speichern
  const result = db.prepare(`
    INSERT INTO email_inbox (
      message_id, subject, from_addr, from_name, to_addr, received_at,
      body_text, body_html, has_attachments, status
    ) VALUES (?,?,?,?,?,?,?,?,?,'neu')
  `).run(
    messageId || null, subject, fromAddr, fromName, toAddr, receivedAt,
    (bodyText || '').substring(0, 50000),
    (bodyHtml || '').substring(0, 100000),
    attachments.length > 0 ? 1 : 0
  );
  const emailDbId = result.lastInsertRowid;

  // Anhänge speichern
  for (const att of attachments) {
    try { saveAttachmentBuffer(emailDbId, att.content, att.filename, att.contentType); }
    catch (e) { console.warn('[Email-Agent] Anhang-Fehler:', e.message); }
  }

  // Claude KI-Klassifizierung
  try {
    const plainBody = bodyText || (bodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const aiResult = await classifyEmail(
      subject,
      fromName ? `${fromName} <${fromAddr}>` : fromAddr,
      receivedAt,
      plainBody
    );

    db.prepare(`
      UPDATE email_inbox SET
        ai_kategorie = ?, ai_zusammenfassung = ?, ai_daten = ?,
        ai_aktion = ?, ai_prioritaet = ?,
        status = 'verarbeitet', processed_at = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.kategorie || 'sonstiges',
      aiResult.zusammenfassung || null,
      JSON.stringify(aiResult.daten || {}),
      aiResult.empfohlene_aktion || null,
      aiResult.prioritaet || 'normal',
      emailDbId
    );

    console.log(`[Email-Agent] ✅ ${aiResult.kategorie} (${aiResult.prioritaet}) – "${subject}"`);

    // Auto-Aktion bei Kundenanfrage
    if (aiResult.kategorie === 'kundenanfrage') {
      const inquiryId = createInquiryFromEmail(emailDbId, aiResult);
      if (inquiryId) console.log(`[Email-Agent] 📋 Kundenanfrage #${inquiryId} aus "${subject}"`);
    }

    return { emailDbId, kategorie: aiResult.kategorie, neu: true };
  } catch (e) {
    console.error('[Email-Agent] KI-Fehler:', e.message);
    db.prepare("UPDATE email_inbox SET status = 'fehler', error_message = ?, processed_at = datetime('now') WHERE id = ?")
      .run(e.message, emailDbId);
    return { emailDbId, error: e.message, neu: true };
  }
}

// ── EML-Datei verarbeiten ──────────────────────────────────────────────────────

async function processEmlFile(filePath, originalName) {
  const rawBuffer = fs.readFileSync(filePath);
  const parsed = await simpleParser(rawBuffer);

  const messageId   = parsed.messageId || `eml-${Date.now()}-${uuidv4()}`;
  const subject     = parsed.subject || '(kein Betreff)';
  const fromAddr    = parsed.from?.value?.[0]?.address || '';
  const fromName    = parsed.from?.value?.[0]?.name    || '';
  const toAddr      = parsed.to?.value?.[0]?.address   || '';
  const receivedAt  = parsed.date?.toISOString() || new Date().toISOString();
  const bodyText    = parsed.text  || '';
  const bodyHtml    = parsed.html  || '';

  const attachments = (parsed.attachments || []).map(a => ({
    filename: a.filename || 'attachment',
    content:  a.content,
    contentType: a.contentType || 'application/octet-stream',
  }));

  return processEmailData({ messageId, subject, fromAddr, fromName, toAddr, receivedAt, bodyText, bodyHtml, attachments });
}

// ── Graph API E-Mail verarbeiten ───────────────────────────────────────────────

async function processGraphMessage(graphMsg, attachmentList = []) {
  const messageId = graphMsg.internetMessageId || graphMsg.id;
  const subject   = graphMsg.subject || '(kein Betreff)';
  const fromAddr  = graphMsg.from?.emailAddress?.address || '';
  const fromName  = graphMsg.from?.emailAddress?.name    || '';
  const toAddr    = (graphMsg.toRecipients?.[0]?.emailAddress?.address) || '';
  const receivedAt = graphMsg.receivedDateTime || new Date().toISOString();
  const bodyHtml  = graphMsg.body?.contentType === 'html' ? (graphMsg.body?.content || '') : '';
  const bodyText  = graphMsg.body?.contentType === 'text' ? (graphMsg.body?.content || '') : '';

  const attachments = attachmentList.map(a => ({
    filename: a.name || 'attachment',
    content:  Buffer.from(a.contentBytes || '', 'base64'),
    contentType: a.contentType || 'application/octet-stream',
  }));

  return processEmailData({ messageId, subject, fromAddr, fromName, toAddr, receivedAt, bodyText, bodyHtml, attachments });
}

// ── Microsoft Graph API: Einmal pollen ────────────────────────────────────────

async function graphPollOnce() {
  const cfg = getGraphConfig();
  if (!isGraphConfigured()) return;

  console.log('[Email-Agent] Graph API: Prüfe Posteingang...');

  try {
    const token = await getGraphToken(cfg);
    const messages = await fetchGraphEmails(cfg, token);

    let newCount = 0;
    for (const msg of messages) {
      let attachments = [];
      if (msg.hasAttachments) {
        attachments = await fetchGraphAttachments(cfg, token, msg.id).catch(() => []);
      }

      const result = await processGraphMessage(msg, attachments);
      if (result.neu) {
        newCount++;
        // Als gelesen markieren damit wir sie beim nächsten Poll nicht nochmals holen
        await markGraphEmailRead(cfg, token, msg.id).catch(() => {});
      }
    }

    // Letzten Check-Zeitpunkt speichern
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('graph_last_check', ?)")
      .run(new Date().toISOString());

    if (newCount > 0) console.log(`[Email-Agent] Graph: ${newCount} neue E-Mail(s) verarbeitet`);
  } catch (e) {
    console.error('[Email-Agent] Graph API Fehler:', e.message);
  }
}

// ── Ordner-Watcher für .eml Dateien ───────────────────────────────────────────

let emlWatcherInstance = null;

function startEmlWatcher() {
  ensureDirs();
  if (!fs.existsSync(EMAIL_INBOX_DIR)) return;

  const chokidar = require('chokidar');
  emlWatcherInstance = chokidar.watch(EMAIL_INBOX_DIR, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
  });

  emlWatcherInstance.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.eml' && ext !== '.msg') return;

    const filename = path.basename(filePath);
    console.log(`[Email-Agent] EML erkannt: ${filename}`);

    setTimeout(async () => {
      try {
        await processEmlFile(filePath, filename);
        // Verarbeitet → verschieben
        const dest = path.join(EMAIL_DONE_DIR, filename);
        fs.renameSync(filePath, dest);
      } catch (e) {
        console.error(`[Email-Agent] EML Fehler ${filename}:`, e.message);
        try { fs.renameSync(filePath, path.join(EMAIL_ERROR_DIR, filename)); } catch {}
      }
    }, 1000);
  });

  console.log(`[Email-Agent] ✅ EML-Watcher aktiv: ${EMAIL_INBOX_DIR}`);
}

function stopEmlWatcher() {
  if (emlWatcherInstance) { emlWatcherInstance.close(); emlWatcherInstance = null; }
}

// ── Graph API Poller starten/stoppen ──────────────────────────────────────────

async function startGraphPoller() {
  if (!isGraphConfigured()) {
    console.log('[Email-Agent] Graph API nicht konfiguriert – automatisches Polling deaktiviert.');
    return;
  }

  const cfg = getGraphConfig();
  console.log(`[Email-Agent] ✅ Graph API Poller aktiv: ${cfg.mailbox} (alle ${cfg.interval}s)`);

  await graphPollOnce().catch(e => console.error('[Email-Agent] Initialer Graph Poll Fehler:', e.message));
  graphPollerTimer = setInterval(() => {
    graphPollOnce().catch(e => console.error('[Email-Agent] Graph Poll Fehler:', e.message));
  }, cfg.interval * 1000);
}

function stopGraphPoller() {
  if (graphPollerTimer) { clearInterval(graphPollerTimer); graphPollerTimer = null; }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function startAgent() {
  ensureDirs();
  startEmlWatcher();
  await startGraphPoller();
}

function stopAgent() {
  stopEmlWatcher();
  stopGraphPoller();
}

module.exports = {
  startAgent,
  stopAgent,
  processEmlFile,
  graphPollOnce,
  isGraphConfigured,
  getGraphConfig,
  classifyEmail,
  DEFAULT_CLASSIFICATION_PROMPT,
  EMAIL_ATT_DIR,
  EMAIL_INBOX_DIR,
};
