/**
 * Email-Agent
 *
 * Verarbeitet eingehende E-Mails OHNE IMAP — zwei Methoden:
 *
 * 1. Ordner-Watcher (Haupt-Methode)
 *    - Konfigurierbarer lokaler Ordner wird überwacht
 *    - Nutzer speichert/verschiebt E-Mails als .eml in den Ordner
 *    - Werden sofort automatisch verarbeitet
 *
 * 2. Microsoft Graph API (automatisches Polling)
 *    - Funktioniert auch wenn IMAP gesperrt ist (nur HTTPS Port 443)
 *    - Benötigt Azure App-Registrierung mit Mail.Read Berechtigung
 *
 * Was wird analysiert:
 *   - Vollständiger E-Mail-Inhalt (Text + HTML)
 *   - Gesamter Gesprächsverlauf (AW:/WG:/Fw: ketten)
 *   - Anhänge (PDF, DOCX, XLSX → Text wird extrahiert)
 *   - KI-Klassifizierung + Antwortentwurf
 */

const { simpleParser } = require('mailparser');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const EMAIL_ATT_DIR   = path.join(UPLOADS_DIR, 'email-attachments');
const EMAIL_DONE_DIR  = path.join(UPLOADS_DIR, 'email-processed');
const EMAIL_ERROR_DIR = path.join(UPLOADS_DIR, 'email-fehler');

// Standard-Inbox-Ordner (überschreibbar per Einstellungen)
const DEFAULT_INBOX_DIR = path.join(UPLOADS_DIR, 'email-inbox');

let graphPollerTimer = null;
let emlWatcherInstance = null;

// ── Verzeichnisse anlegen ─────────────────────────────────────────────────────

function ensureDirs(inboxDir) {
  [inboxDir || DEFAULT_INBOX_DIR, EMAIL_ATT_DIR, EMAIL_DONE_DIR, EMAIL_ERROR_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Konfigurierter Inbox-Pfad ─────────────────────────────────────────────────

function getInboxDir() {
  const db = getDb();
  const custom = db.prepare("SELECT value FROM settings WHERE key = 'email_inbox_path'").get()?.value;
  if (custom && custom.trim()) return custom.trim();
  return DEFAULT_INBOX_DIR;
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

// ── Microsoft Graph API Funktionen ───────────────────────────────────────────

async function getGraphToken(cfg) {
  const url = `https://login.microsoftonline.com/${cfg.tenant_id}/oauth2/v2.0/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
      scope:         'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph Auth Fehler: ${data.error_description || data.error}`);
  return data.access_token;
}

async function fetchGraphEmails(cfg, token) {
  const db = getDb();
  const lastCheck = db.prepare("SELECT value FROM settings WHERE key = 'graph_last_check'").get()?.value;
  let filterParts = ['isRead eq false'];
  if (lastCheck) filterParts.push(`receivedDateTime gt ${lastCheck}`);

  const filter = encodeURIComponent(filterParts.join(' and '));
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/mailFolders/${cfg.folder}/messages?$filter=${filter}&$select=id,subject,from,toRecipients,receivedDateTime,body,hasAttachments,internetMessageId&$top=50&$orderby=receivedDateTime asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph Fehler: ${data.error?.message || res.status}`);
  return data.value || [];
}

async function fetchGraphAttachments(cfg, token, messageId) {
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages/${messageId}/attachments`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.value || []).filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment');
}

async function markGraphEmailRead(cfg, token, messageId) {
  const url = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages/${messageId}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  }).catch(() => {});
}

// ── Thread-Parser ─────────────────────────────────────────────────────────────
// Extrahiert den vollständigen Gesprächsverlauf aus WG:/AW:/Fw:/Re: E-Mails

/**
 * Gibt ein Array von Nachrichten zurück: [{from, to, date, subject, body}]
 * Index 0 = älteste, letzter Index = neueste Nachricht
 */
function parseEmailThread(subject, fromAddr, fromName, date, bodyText, bodyHtml) {
  const messages = [];

  // Hauptnachricht zuerst
  const mainBody = stripHtml(bodyHtml) || bodyText || '';

  // Für Plain-Text: Gesprächsverlauf anhand typischer Trennmuster aufteilen
  const textMessages = parseThreadFromText(mainBody, subject, fromAddr, fromName, date);
  if (textMessages.length > 0) return textMessages;

  // Kein Verlauf erkannt → nur die Hauptnachricht
  return [{
    from:    fromName ? `${fromName} <${fromAddr}>` : fromAddr,
    to:      '',
    date:    date || '',
    subject: subject || '',
    body:    mainBody.substring(0, 8000),
  }];
}

function parseThreadFromText(fullText, topSubject, topFrom, topFromName, topDate) {
  // Muster für Outlook und Standard E-Mail Clients
  const SEPARATORS = [
    // Outlook DE/EN
    /(-{3,}\s*Ursprüngliche Nachricht\s*-{3,})/gi,
    /(-{3,}\s*Original Message\s*-{3,})/gi,
    /(-{3,}\s*Weitergeleitete Nachricht\s*-{3,})/gi,
    /(-{3,}\s*Forwarded Message\s*-{3,})/gi,
    // Outlook Zeilentrennungen
    /^Von:\s+.+\nGesendet:\s+.+\nAn:\s+/gm,
    /^From:\s+.+\nSent:\s+.+\nTo:\s+/gm,
  ];

  let parts = [fullText];
  for (const sep of SEPARATORS) {
    const newParts = [];
    for (const part of parts) {
      const split = part.split(sep);
      newParts.push(...split);
    }
    parts = newParts;
  }

  // Mehrere Teile → Verlauf erkannt
  const messages = [];
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i].trim();
    if (!chunk || chunk.length < 10) continue;

    // Metadaten aus Chunk-Anfang extrahieren
    const meta = extractHeadersFromChunk(chunk);
    messages.push({
      from:    i === 0 ? (topFromName ? `${topFromName} <${topFrom}>` : topFrom) : (meta.from || ''),
      to:      meta.to || '',
      date:    i === 0 ? (topDate || '') : (meta.date || ''),
      subject: meta.subject || topSubject || '',
      body:    chunk.substring(0, 6000),
    });
  }

  return messages;
}

function extractHeadersFromChunk(text) {
  const lines = text.split('\n').slice(0, 15);
  const headers = {};
  for (const line of lines) {
    const m = line.match(/^(Von|From|An|To|Datum|Date|Gesendet|Sent|Betreff|Subject):\s*(.+)/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (['von','from'].includes(key))       headers.from    = val;
    if (['an','to'].includes(key))          headers.to      = val;
    if (['datum','date','gesendet','sent'].includes(key)) headers.date = val;
    if (['betreff','subject'].includes(key)) headers.subject = val;
  }
  return headers;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Anhang-Text-Extraktion ────────────────────────────────────────────────────

async function extractTextFromAttachment(buffer, filename, contentType) {
  const ext = path.extname(filename || '').toLowerCase();
  const mime = (contentType || '').toLowerCase();

  // PDF
  if (ext === '.pdf' || mime.includes('pdf')) {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer, { max: 5 });
      return (data.text || '').substring(0, 4000).trim();
    } catch { return '(PDF nicht lesbar)'; }
  }

  // DOCX / DOC
  if (['.docx', '.doc'].includes(ext) || mime.includes('word') || mime.includes('openxmlformats-officedocument.wordprocessingml')) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').substring(0, 4000).trim();
    } catch { return '(Word-Dokument nicht lesbar)'; }
  }

  // XLSX / XLS
  if (['.xlsx', '.xls'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      for (const sheetName of wb.SheetNames.slice(0, 3)) {
        const ws = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws);
        text += `[${sheetName}]\n${csv}\n`;
        if (text.length > 3000) break;
      }
      return text.substring(0, 4000).trim();
    } catch { return '(Excel-Datei nicht lesbar)'; }
  }

  // Textdateien
  if (['.txt', '.csv', '.md', '.log'].includes(ext) || mime.startsWith('text/')) {
    try { return buffer.toString('utf-8').substring(0, 4000).trim(); }
    catch { return '(Textdatei nicht lesbar)'; }
  }

  // Bilder
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'].includes(ext) || mime.startsWith('image/')) {
    return `(Bild-Anhang: ${filename})`;
  }

  return null; // Keine Textextraktion möglich
}

// ── Claude AI: Klassifizieren + Antwortentwurf ────────────────────────────────

const DEFAULT_CLASSIFICATION_PROMPT = `Du bist ein intelligenter E-Mail-Assistent für Helbling & Co. AG (Schlüsselboxen / SIBOX / FacetteStar, Schweiz).

Analysiere die folgende E-Mail (inkl. vollständiger Konversationshistorie und Anhang-Inhalte) und klassifiziere sie.
Gib NUR valides JSON zurück, keinen anderen Text.

KATEGORIEN:
- "kundenanfrage"   → Kunde fragt nach Offerte, Montage, Reparatur, Service oder Produkt
- "lieferschein"    → E-Mail enthält oder referenziert einen Lieferschein / Lieferbestätigung
- "auftrag_info"    → Info zu bestehendem Auftrag (Terminbestätigung, Statusanfrage, Rückmeldung)
- "intern"          → Interne Kommunikation (Mitarbeitende, Lieferanten, Partner)
- "spam"            → Werbung, unerwünschte E-Mail
- "sonstiges"       → Passt in keine andere Kategorie

PRIORITÄT:
- "hoch"    → Dringend, Beschwerde, Notfall, Frist
- "normal"  → Standard-Anfrage
- "niedrig" → Info, kein Handlungsbedarf

EXTRAHIERE diese Felder (soweit erkennbar):
vorname, nachname, firma, email, telefon, strasse, plz, ort,
art_der_arbeit (Montage/Reparatur/Service/Offerte/Sonstiges),
anzahl_zylinder, anzahl_schluessel, anzahl_tueren (Zahl),
bestehendes_system (true/false), wunschtermin (YYYY-MM-DD),
bemerkungen (kurze Zusammenfassung), lieferschein_nr, auftrag_nr

Antworte mit JSON:
{
  "kategorie": "kundenanfrage",
  "prioritaet": "normal",
  "zusammenfassung": "Kurze Zusammenfassung des Anliegens.",
  "empfohlene_aktion": "1 Satz Handlungsempfehlung.",
  "daten": { "vorname": "Max", "nachname": "Muster", "firma": null, "email": "...", ... }
}

E-MAIL:
Betreff: {SUBJECT}
Von: {FROM}
Datum: {DATE}

=== NEUESTE NACHRICHT ===
{BODY}

{THREAD_SECTION}
{ATTACHMENT_SECTION}`;

const DEFAULT_DRAFT_PROMPT = `Du bist ein professioneller E-Mail-Assistent für Helbling & Co. AG (Schlüsselboxen / SIBOX / FacetteStar, Schweiz).

Verfasse einen professionellen Antwortentwurf auf die folgende E-Mail auf Deutsch.

Richtlinien:
- Höflich, professionell, klar und knapp (max. 3-4 Absätze)
- Schweizerdeutscher Geschäftsstil (kein "Mit freundlichen Grüßen" → "Mit freundlichen Grüssen")
- Beziehe dich auf den konkreten Inhalt der Anfrage
- Bei Kundenanfragen: bestätige Eingang, kläre fehlende Infos (z.B. genaue Adresse) und nenne nächste Schritte
- Bei Informationsmails: danke für die Info und bestätige Erhalt
- Unterschreibe mit: "Freundliche Grüsse\nHelbling & Co. AG"
- Gib NUR den E-Mail-Text zurück, keine Erklärungen

KI-Einschätzung: {AI_KATEGORIE} | {AI_PRIORITAET}
Zusammenfassung: {AI_ZUSAMMENFASSUNG}

E-MAIL:
Von: {FROM}
Betreff: {SUBJECT}
Datum: {DATE}

{BODY}

{THREAD_SECTION}
{ATTACHMENT_SECTION}`;

async function classifyEmail({ subject, from, date, bodyText, threadJson, attachmentTexts }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nicht konfiguriert');

  const client = new Anthropic({ apiKey });
  const db = getDb();
  const customPrompt = db.prepare("SELECT value FROM settings WHERE key = 'email_agent_prompt'").get()?.value;
  const promptTemplate = customPrompt || DEFAULT_CLASSIFICATION_PROMPT;

  const threadSection = buildThreadSection(threadJson);
  const attSection    = buildAttachmentSection(attachmentTexts);

  const prompt = promptTemplate
    .replace('{SUBJECT}',          subject || '(kein Betreff)')
    .replace('{FROM}',             from    || '(unbekannt)')
    .replace('{DATE}',             date    || '')
    .replace('{BODY}',             (bodyText || '').substring(0, 4000))
    .replace('{THREAD_SECTION}',   threadSection)
    .replace('{ATTACHMENT_SECTION}', attSection);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(raw);
}

async function generateDraft({ subject, from, date, bodyText, threadJson, attachmentTexts, aiKategorie, aiPrioritaet, aiZusammenfassung }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Für Spam oder interne Mails keinen Entwurf erstellen
  if (['spam', 'intern'].includes(aiKategorie)) return null;

  const client = new Anthropic({ apiKey });
  const db = getDb();
  const customPrompt = db.prepare("SELECT value FROM settings WHERE key = 'email_agent_draft_prompt'").get()?.value;
  const promptTemplate = customPrompt || DEFAULT_DRAFT_PROMPT;

  const threadSection = buildThreadSection(threadJson);
  const attSection    = buildAttachmentSection(attachmentTexts);

  const prompt = promptTemplate
    .replace('{SUBJECT}',          subject || '(kein Betreff)')
    .replace('{FROM}',             from    || '(unbekannt)')
    .replace('{DATE}',             date    || '')
    .replace('{BODY}',             (bodyText || '').substring(0, 3000))
    .replace('{THREAD_SECTION}',   threadSection)
    .replace('{ATTACHMENT_SECTION}', attSection)
    .replace('{AI_KATEGORIE}',     aiKategorie || '')
    .replace('{AI_PRIORITAET}',    aiPrioritaet || '')
    .replace('{AI_ZUSAMMENFASSUNG}', aiZusammenfassung || '');

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    return message.content[0].text.trim();
  } catch (e) {
    console.warn('[Email-Agent] Draft-Generierung fehlgeschlagen:', e.message);
    return null;
  }
}

function buildThreadSection(threadJson) {
  if (!threadJson) return '';
  let messages;
  try { messages = JSON.parse(threadJson); } catch { return ''; }
  if (!Array.isArray(messages) || messages.length <= 1) return '';

  const older = messages.slice(0, -1); // Alle ausser der neuesten
  if (!older.length) return '';

  let section = '\n=== GESPRÄCHSVERLAUF (ältere Nachrichten) ===\n';
  for (const m of older) {
    section += `\n--- Von: ${m.from || '?'} | Datum: ${m.date || '?'} ---\n`;
    if (m.subject && m.subject !== older[0]?.subject) section += `Betreff: ${m.subject}\n`;
    section += `${(m.body || '').substring(0, 2000)}\n`;
  }
  return section;
}

function buildAttachmentSection(attachmentTexts) {
  if (!attachmentTexts) return '';
  let texts;
  try { texts = JSON.parse(attachmentTexts); } catch { return ''; }
  const entries = Object.entries(texts).filter(([, v]) => v && v.length > 10 && !v.startsWith('('));
  if (!entries.length) return '';

  let section = '\n=== ANHANG-INHALT ===\n';
  for (const [name, text] of entries) {
    section += `\n[Anhang: ${name}]\n${text.substring(0, 2000)}\n`;
  }
  return section;
}

// ── Anhänge auf Disk speichern ─────────────────────────────────────────────────

async function saveAttachmentBuffer(emailDbId, buffer, originalName, contentType) {
  if (!fs.existsSync(EMAIL_ATT_DIR)) fs.mkdirSync(EMAIL_ATT_DIR, { recursive: true });
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  const filename = `${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(EMAIL_ATT_DIR, filename), buffer);

  // Text extrahieren
  const extractedText = await extractTextFromAttachment(buffer, originalName, contentType);

  const db = getDb();
  db.prepare(`INSERT INTO email_attachments (email_id, filename, original_name, content_type, file_size, extracted_text)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(emailDbId, filename, originalName || filename, contentType || 'application/octet-stream', buffer.length, extractedText || null);

  return { filename, extractedText };
}

// ── Kundenanfrage aus KI-Daten anlegen ────────────────────────────────────────

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
      token, 'neu', d.firma || null, d.vorname || '', d.nachname || '',
      d.email || '', d.telefon || '', d.strasse || '', d.plz || '', d.ort || '',
      d.art_der_arbeit || null,
      d.anzahl_zylinder  ? parseInt(d.anzahl_zylinder)  : null,
      d.anzahl_schluessel? parseInt(d.anzahl_schluessel): null,
      d.anzahl_tueren    ? parseInt(d.anzahl_tueren)    : null,
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

// ── Haupt-Verarbeitungsfunktion ───────────────────────────────────────────────

async function processEmailData({
  messageId, subject, fromAddr, fromName, toAddr, receivedAt,
  bodyText, bodyHtml, attachments = [], sourceFolder = null,
}) {
  const db = getDb();

  // Duplikate prüfen
  if (messageId) {
    const existing = db.prepare('SELECT id FROM email_inbox WHERE message_id = ?').get(messageId);
    if (existing) return { skipped: true, id: existing.id };
  }

  // Gesprächsverlauf parsen
  const threadMessages = parseEmailThread(subject, fromAddr, fromName, receivedAt, bodyText, bodyHtml);
  const threadJson = JSON.stringify(threadMessages);

  // Haupttext: neueste Nachricht (letztes Element)
  const latestMessage = threadMessages[threadMessages.length - 1] || {};
  const mainBody = latestMessage.body || bodyText || stripHtml(bodyHtml) || '';

  // In DB speichern
  const result = db.prepare(`
    INSERT INTO email_inbox (
      message_id, subject, from_addr, from_name, to_addr, received_at,
      body_text, body_html, has_attachments, thread_json, source_folder, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,'neu')
  `).run(
    messageId || null, subject, fromAddr, fromName, toAddr, receivedAt,
    mainBody.substring(0, 50000),
    (bodyHtml || '').substring(0, 100000),
    attachments.length > 0 ? 1 : 0,
    threadJson,
    sourceFolder || null
  );
  const emailDbId = result.lastInsertRowid;

  // Anhänge speichern + Text extrahieren
  const attachmentTextsObj = {};
  for (const att of attachments) {
    try {
      const { extractedText } = await saveAttachmentBuffer(emailDbId, att.content, att.filename, att.contentType);
      if (extractedText) attachmentTextsObj[att.filename] = extractedText;
    } catch (e) {
      console.warn('[Email-Agent] Anhang-Fehler:', e.message);
    }
  }
  const attachmentTexts = Object.keys(attachmentTextsObj).length > 0
    ? JSON.stringify(attachmentTextsObj) : null;

  if (attachmentTexts) {
    db.prepare("UPDATE email_inbox SET attachment_texts = ? WHERE id = ?").run(attachmentTexts, emailDbId);
  }

  // KI-Klassifizierung
  const fromDisplay = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
  let aiResult;
  try {
    aiResult = await classifyEmail({
      subject, from: fromDisplay, date: receivedAt,
      bodyText: mainBody, threadJson, attachmentTexts,
    });
  } catch (e) {
    console.error('[Email-Agent] Klassifizierung fehlgeschlagen:', e.message);
    db.prepare("UPDATE email_inbox SET status = 'fehler', error_message = ?, processed_at = datetime('now') WHERE id = ?")
      .run(e.message, emailDbId);
    return { emailDbId, error: e.message, neu: true };
  }

  console.log(`[Email-Agent] ✅ ${aiResult.kategorie} (${aiResult.prioritaet}) – "${subject}"`);

  // Antwortentwurf generieren
  const draft = await generateDraft({
    subject, from: fromDisplay, date: receivedAt,
    bodyText: mainBody, threadJson, attachmentTexts,
    aiKategorie:        aiResult.kategorie,
    aiPrioritaet:       aiResult.prioritaet,
    aiZusammenfassung:  aiResult.zusammenfassung,
  });

  // KI-Ergebnis + Entwurf in DB
  db.prepare(`
    UPDATE email_inbox SET
      ai_kategorie = ?, ai_zusammenfassung = ?, ai_daten = ?,
      ai_aktion = ?, ai_prioritaet = ?, ai_draft = ?,
      status = 'verarbeitet', processed_at = datetime('now')
    WHERE id = ?
  `).run(
    aiResult.kategorie     || 'sonstiges',
    aiResult.zusammenfassung || null,
    JSON.stringify(aiResult.daten || {}),
    aiResult.empfohlene_aktion || null,
    aiResult.prioritaet    || 'normal',
    draft || null,
    emailDbId
  );

  // Auto-Aktion bei Kundenanfrage
  if (aiResult.kategorie === 'kundenanfrage') {
    const inquiryId = createInquiryFromEmail(emailDbId, aiResult);
    if (inquiryId) console.log(`[Email-Agent] 📋 Kundenanfrage #${inquiryId} aus "${subject}"`);
  }

  return { emailDbId, kategorie: aiResult.kategorie, hasDraft: !!draft, neu: true };
}

// ── EML-Datei verarbeiten ──────────────────────────────────────────────────────

async function processEmlFile(filePath, originalName, sourceFolder) {
  const rawBuffer = fs.readFileSync(filePath);
  const parsed = await simpleParser(rawBuffer, { skipHtmlToText: false });

  const messageId  = parsed.messageId || `eml-${Date.now()}-${uuidv4()}`;
  const subject    = parsed.subject || '(kein Betreff)';
  const fromAddr   = parsed.from?.value?.[0]?.address || '';
  const fromName   = parsed.from?.value?.[0]?.name    || '';
  const toAddr     = parsed.to?.value?.[0]?.address   || '';
  const receivedAt = parsed.date?.toISOString() || new Date().toISOString();
  const bodyText   = parsed.text  || '';
  const bodyHtml   = parsed.html  || '';

  const attachments = (parsed.attachments || [])
    .filter(a => !a.related) // Inline-Bilder überspringen
    .map(a => ({
      filename:    a.filename || 'attachment',
      content:     a.content,
      contentType: a.contentType || 'application/octet-stream',
    }));

  return processEmailData({
    messageId, subject, fromAddr, fromName, toAddr, receivedAt,
    bodyText, bodyHtml, attachments,
    sourceFolder: sourceFolder || null,
  });
}

// ── Graph API E-Mail verarbeiten ───────────────────────────────────────────────

async function processGraphMessage(graphMsg, attachmentList = []) {
  const messageId  = graphMsg.internetMessageId || graphMsg.id;
  const subject    = graphMsg.subject || '(kein Betreff)';
  const fromAddr   = graphMsg.from?.emailAddress?.address || '';
  const fromName   = graphMsg.from?.emailAddress?.name    || '';
  const toAddr     = graphMsg.toRecipients?.[0]?.emailAddress?.address || '';
  const receivedAt = graphMsg.receivedDateTime || new Date().toISOString();
  const bodyHtml   = graphMsg.body?.contentType === 'html' ? (graphMsg.body?.content || '') : '';
  const bodyText   = graphMsg.body?.contentType === 'text' ? (graphMsg.body?.content || '') : '';

  const attachments = attachmentList.map(a => ({
    filename:    a.name || 'attachment',
    content:     Buffer.from(a.contentBytes || '', 'base64'),
    contentType: a.contentType || 'application/octet-stream',
  }));

  return processEmailData({
    messageId, subject, fromAddr, fromName, toAddr, receivedAt,
    bodyText, bodyHtml, attachments, sourceFolder: 'graph-api',
  });
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
        await markGraphEmailRead(cfg, token, msg.id).catch(() => {});
      }
    }

    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('graph_last_check', ?)")
      .run(new Date().toISOString());

    if (newCount > 0) console.log(`[Email-Agent] Graph: ${newCount} neue E-Mail(s) verarbeitet`);
  } catch (e) {
    console.error('[Email-Agent] Graph API Fehler:', e.message);
  }
}

// ── Ordner-Watcher ────────────────────────────────────────────────────────────

function startEmlWatcher() {
  const inboxDir = getInboxDir();
  ensureDirs(inboxDir);

  if (!fs.existsSync(inboxDir)) {
    console.warn(`[Email-Agent] Inbox-Ordner nicht gefunden: ${inboxDir}`);
    return;
  }

  const chokidar = require('chokidar');
  emlWatcherInstance = chokidar.watch(inboxDir, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  emlWatcherInstance.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.eml', '.msg'].includes(ext)) return;

    const filename = path.basename(filePath);
    console.log(`[Email-Agent] Neue E-Mail erkannt: ${filename}`);

    setTimeout(async () => {
      try {
        const result = await processEmlFile(filePath, filename, inboxDir);
        // Verschieben nach verarbeitet
        const dest = path.join(EMAIL_DONE_DIR, `${Date.now()}_${filename}`);
        fs.renameSync(filePath, dest);
        if (result.skipped) {
          console.log(`[Email-Agent] Übersprungen (Duplikat): ${filename}`);
        } else {
          console.log(`[Email-Agent] Verarbeitet: ${filename} → ${result.kategorie}${result.hasDraft ? ' + Entwurf' : ''}`);
        }
      } catch (e) {
        console.error(`[Email-Agent] Fehler bei ${filename}:`, e.message);
        try { fs.renameSync(filePath, path.join(EMAIL_ERROR_DIR, `${Date.now()}_${filename}`)); } catch {}
      }
    }, 1000);
  });

  console.log(`[Email-Agent] ✅ Ordner-Watcher aktiv: ${inboxDir}`);
}

function stopEmlWatcher() {
  if (emlWatcherInstance) { emlWatcherInstance.close(); emlWatcherInstance = null; }
}

// ── Graph API Poller ──────────────────────────────────────────────────────────

async function startGraphPoller() {
  if (!isGraphConfigured()) return;
  const cfg = getGraphConfig();
  console.log(`[Email-Agent] ✅ Graph API Poller aktiv: ${cfg.mailbox} (alle ${cfg.interval}s)`);
  await graphPollOnce().catch(e => console.error('[Email-Agent] Initialer Poll Fehler:', e.message));
  graphPollerTimer = setInterval(() => {
    graphPollOnce().catch(e => console.error('[Email-Agent] Poll Fehler:', e.message));
  }, cfg.interval * 1000);
}

function stopGraphPoller() {
  if (graphPollerTimer) { clearInterval(graphPollerTimer); graphPollerTimer = null; }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

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
  getInboxDir,
  classifyEmail,
  generateDraft,
  DEFAULT_CLASSIFICATION_PROMPT,
  DEFAULT_DRAFT_PROMPT,
  EMAIL_ATT_DIR,
  get EMAIL_INBOX_DIR() { return getInboxDir(); },
};
