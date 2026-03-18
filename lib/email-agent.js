/**
 * Email-Agent
 *
 * Verbindet sich per IMAP mit dem Posteingang, liest neue Mails,
 * klassifiziert sie mit Claude AI und speichert die Ergebnisse in der DB.
 *
 * Kategorien:
 *   - kundenanfrage   → customer_inquiry anlegen
 *   - lieferschein    → an lieferschein-watcher weiterleiten
 *   - auftrag_info    → Info zu bestehendem Auftrag
 *   - intern          → interne Nachricht
 *   - spam            → ignorieren
 *   - sonstiges       → nur loggen
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const EMAIL_ATT_DIR = path.join(UPLOADS_DIR, 'email-attachments');

let pollerTimer = null;
let isRunning = false;

// ── IMAP-Konfiguration aus DB/Env laden ──────────────────────────────────────

function getImapConfig() {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  return {
    host:     get('imap_host')     || process.env.IMAP_HOST     || '',
    port:     parseInt(get('imap_port')     || process.env.IMAP_PORT     || '993'),
    secure:   (get('imap_secure')  || process.env.IMAP_SECURE   || 'true') !== 'false',
    user:     get('imap_user')     || process.env.IMAP_USER     || '',
    pass:     get('imap_pass')     || process.env.IMAP_PASS     || '',
    folder:   get('imap_folder')   || process.env.IMAP_FOLDER   || 'INBOX',
    interval: parseInt(get('imap_poll_interval') || process.env.IMAP_POLL_INTERVAL || '300'),
  };
}

// ── Claude AI: E-Mail klassifizieren & Daten extrahieren ─────────────────────

const CLASSIFICATION_PROMPT = `Du bist ein intelligenter E-Mail-Assistent für Helbling & Co. AG (Schlüsselboxen / SIBOX / FacetteStar Produkte, Schweiz).

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
- anzahl_zylinder (Zahl), anzahl_schluessel (Zahl), anzahl_tueren (Zahl)
- bestehendes_system (true/false)
- wunschtermin (YYYY-MM-DD falls erkennbar)
- bemerkungen (kurze Zusammenfassung des Anliegens auf Deutsch)
- lieferschein_nr (falls Lieferschein-Nummer erkennbar)
- auftrag_nr (falls Auftragsnummer erkennbar)
- empfohlene_aktion (kurze Handlungsempfehlung für den Disponenten, max. 1 Satz)

Antworte mit JSON:
{
  "kategorie": "kundenanfrage",
  "prioritaet": "normal",
  "zusammenfassung": "Kunde möchte 2 Schlüsselboxen montieren lassen.",
  "empfohlene_aktion": "Anfrage in Formular umwandeln und Termin vereinbaren.",
  "daten": {
    "vorname": "Max",
    "nachname": "Muster",
    "firma": null,
    "email": "max@example.ch",
    "telefon": "044 123 45 67",
    "strasse": "Musterstrasse 1",
    "plz": "8000",
    "ort": "Zürich",
    "art_der_arbeit": "Montage",
    "anzahl_zylinder": null,
    "anzahl_schluessel": null,
    "anzahl_tueren": null,
    "bestehendes_system": false,
    "wunschtermin": null,
    "bemerkungen": "Möchte 2 Schlüsselboxen im Eingangsbereich montieren.",
    "lieferschein_nr": null,
    "auftrag_nr": null,
    "empfohlene_aktion": "Anfrage in Formular umwandeln und Termin vereinbaren."
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
  const promptTemplate = customPrompt || CLASSIFICATION_PROMPT;

  const truncatedBody = body?.substring(0, 6000) || '(kein Inhalt)';
  const prompt = promptTemplate
    .replace('{SUBJECT}', subject || '(kein Betreff)')
    .replace('{FROM}', from || '(unbekannt)')
    .replace('{DATE}', date || '(kein Datum)')
    .replace('{BODY}', truncatedBody);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr);
}

// ── Anhänge auf Disk speichern ────────────────────────────────────────────────

function saveAttachment(emailDbId, attachment) {
  if (!fs.existsSync(EMAIL_ATT_DIR)) fs.mkdirSync(EMAIL_ATT_DIR, { recursive: true });

  const ext = path.extname(attachment.filename || '').toLowerCase() || '.bin';
  const filename = `${uuidv4()}${ext}`;
  const filePath = path.join(EMAIL_ATT_DIR, filename);

  fs.writeFileSync(filePath, attachment.content);

  const db = getDb();
  db.prepare(`
    INSERT INTO email_attachments (email_id, filename, original_name, content_type, file_size)
    VALUES (?, ?, ?, ?, ?)
  `).run(emailDbId, filename, attachment.filename || filename, attachment.contentType || 'application/octet-stream', attachment.size || 0);

  return filename;
}

// ── Aus KI-Daten eine Kundenanfrage erstellen ─────────────────────────────────

function createInquiryFromEmail(emailDbId, aiResult) {
  const d = aiResult.daten || {};
  if (!d.vorname && !d.nachname && !d.email) return null;

  const db = getDb();
  const token = uuidv4().replace(/-/g, '');

  try {
    const result = db.prepare(`
      INSERT INTO customer_inquiries (
        token, status,
        firma, vorname, nachname, email, telefon,
        strasse, plz, ort,
        art_der_arbeit, anzahl_zylinder, anzahl_schluessel, anzahl_tueren,
        bestehendes_system, wunschtermin, bemerkungen
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

    db.prepare(
      "UPDATE email_inbox SET linked_inquiry_id = ? WHERE id = ?"
    ).run(result.lastInsertRowid, emailDbId);

    return result.lastInsertRowid;
  } catch (e) {
    console.error('[Email-Agent] Kundenanfrage erstellen fehlgeschlagen:', e.message);
    return null;
  }
}

// ── Einzelne E-Mail verarbeiten ───────────────────────────────────────────────

async function processEmail(rawMessage, uid, folder) {
  const db = getDb();

  // Parse E-Mail
  const parsed = await simpleParser(rawMessage);

  const messageId = parsed.messageId || `no-id-${uid}-${Date.now()}`;
  const subject   = parsed.subject || '(kein Betreff)';
  const fromAddr  = parsed.from?.value?.[0]?.address || '';
  const fromName  = parsed.from?.value?.[0]?.name || '';
  const toAddr    = parsed.to?.value?.[0]?.address || '';
  const receivedAt = parsed.date?.toISOString() || new Date().toISOString();
  const bodyText  = parsed.text || '';
  const bodyHtml  = parsed.html || '';
  const hasAttachments = (parsed.attachments?.length || 0) > 0 ? 1 : 0;

  // Bereits verarbeitet?
  const existing = db.prepare('SELECT id FROM email_inbox WHERE message_id = ?').get(messageId);
  if (existing) return null;

  console.log(`[Email-Agent] Verarbeite: ${subject} (von: ${fromAddr})`);

  // In DB einspeichern
  const insertResult = db.prepare(`
    INSERT INTO email_inbox (
      message_id, imap_uid, imap_folder,
      subject, from_addr, from_name, to_addr, received_at,
      body_text, body_html, has_attachments, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'neu')
  `).run(messageId, uid, folder, subject, fromAddr, fromName, toAddr, receivedAt,
         bodyText.substring(0, 50000), bodyHtml.substring(0, 100000), hasAttachments);

  const emailDbId = insertResult.lastInsertRowid;

  // Anhänge speichern
  if (parsed.attachments?.length) {
    for (const att of parsed.attachments) {
      try { saveAttachment(emailDbId, att); } catch (e) {
        console.warn('[Email-Agent] Anhang speichern fehlgeschlagen:', e.message);
      }
    }
  }

  // Claude KI: Klassifizierung
  try {
    const aiResult = await classifyEmail(subject, `${fromName} <${fromAddr}>`, receivedAt, bodyText || bodyHtml.replace(/<[^>]+>/g, ' '));

    db.prepare(`
      UPDATE email_inbox SET
        ai_kategorie    = ?,
        ai_zusammenfassung = ?,
        ai_daten        = ?,
        ai_aktion       = ?,
        ai_prioritaet   = ?,
        status          = 'verarbeitet',
        processed_at    = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.kategorie        || 'sonstiges',
      aiResult.zusammenfassung  || null,
      JSON.stringify(aiResult.daten || {}),
      aiResult.empfohlene_aktion || aiResult.daten?.empfohlene_aktion || null,
      aiResult.prioritaet       || 'normal',
      emailDbId
    );

    console.log(`[Email-Agent] ✅ Klassifiziert: ${aiResult.kategorie} (${aiResult.prioritaet}) – "${subject}"`);

    // Auto-Aktion: Kundenanfrage anlegen
    if (aiResult.kategorie === 'kundenanfrage') {
      const inquiryId = createInquiryFromEmail(emailDbId, aiResult);
      if (inquiryId) {
        console.log(`[Email-Agent] 📋 Kundenanfrage #${inquiryId} erstellt aus E-Mail "${subject}"`);
      }
    }

    return { emailDbId, kategorie: aiResult.kategorie };
  } catch (e) {
    console.error('[Email-Agent] KI-Fehler:', e.message);
    db.prepare(
      "UPDATE email_inbox SET status = 'fehler', error_message = ?, processed_at = datetime('now') WHERE id = ?"
    ).run(e.message, emailDbId);
    return { emailDbId, error: e.message };
  }
}

// ── IMAP-Polling ─────────────────────────────────────────────────────────────

async function pollOnce() {
  if (isRunning) return;
  isRunning = true;

  const cfg = getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    isRunning = false;
    return;
  }

  const client = new ImapFlow({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   { user: cfg.user, pass: cfg.pass },
    logger: false,
    tls:    { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const lock = await client.getMailboxLock(cfg.folder);
    try {
      // Letzte gesehene UID aus DB laden
      const db = getDb();
      const lastUidRow = db.prepare("SELECT value FROM settings WHERE key = 'imap_last_uid'").get();
      const lastUid = lastUidRow ? parseInt(lastUidRow.value) || 0 : 0;

      // Neue Nachrichten abrufen
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
      let maxUid = lastUid;
      let newCount = 0;

      for await (const msg of client.fetch(range, { uid: true, source: true })) {
        if (msg.uid <= lastUid) continue;
        if (msg.uid > maxUid) maxUid = msg.uid;

        try {
          await processEmail(msg.source, msg.uid, cfg.folder);
          newCount++;
        } catch (e) {
          console.error(`[Email-Agent] Fehler bei UID ${msg.uid}:`, e.message);
        }
      }

      // Letzte UID speichern
      if (maxUid > lastUid) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('imap_last_uid', ?)").run(String(maxUid));
      }

      if (newCount > 0) {
        console.log(`[Email-Agent] ${newCount} neue E-Mail(s) verarbeitet`);
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (e) {
    console.error('[Email-Agent] IMAP-Fehler:', e.message);
  } finally {
    isRunning = false;
  }
}

// ── Poller starten / stoppen ──────────────────────────────────────────────────

async function startPoller() {
  const cfg = getImapConfig();

  if (!cfg.host || !cfg.user || !cfg.pass) {
    console.log('[Email-Agent] ⚠️  IMAP nicht konfiguriert – Agent deaktiviert.');
    console.log('              Trage IMAP_HOST, IMAP_USER, IMAP_PASS in .env ein.');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Email-Agent] ⚠️  ANTHROPIC_API_KEY fehlt – KI-Klassifizierung deaktiviert.');
  }

  console.log(`[Email-Agent] ✅ Starte Polling alle ${cfg.interval}s → ${cfg.user}@${cfg.host}`);

  // Sofort einmal ausführen
  await pollOnce().catch(e => console.error('[Email-Agent] Initialer Poll Fehler:', e.message));

  // Danach regelmäßig
  pollerTimer = setInterval(() => {
    pollOnce().catch(e => console.error('[Email-Agent] Poll-Fehler:', e.message));
  }, cfg.interval * 1000);
}

function stopPoller() {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}

function isConfigured() {
  const cfg = getImapConfig();
  return !!(cfg.host && cfg.user && cfg.pass);
}

module.exports = {
  startPoller,
  stopPoller,
  pollOnce,
  isConfigured,
  getImapConfig,
  CLASSIFICATION_PROMPT,
  EMAIL_ATT_DIR,
};
