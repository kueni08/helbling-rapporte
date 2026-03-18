/**
 * Email-Agent API Routes
 * GET/POST /api/email-agent/...
 */

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const {
  pollOnce, isConfigured, getImapConfig, startPoller, stopPoller, EMAIL_ATT_DIR, CLASSIFICATION_PROMPT
} = require('../lib/email-agent');

// ── GET /api/email-agent/status ──────────────────────────────────────────────
router.get('/status', requireLogin, (req, res) => {
  const cfg = getImapConfig();
  const db = getDb();
  const total  = db.prepare("SELECT COUNT(*) AS n FROM email_inbox").get()?.n || 0;
  const unread = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE status = 'neu'").get()?.n || 0;
  const errors = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE status = 'fehler'").get()?.n || 0;
  const high   = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE ai_prioritaet = 'hoch' AND status != 'ignoriert'").get()?.n || 0;

  res.json({
    configured: isConfigured(),
    host: cfg.host || null,
    user: cfg.user || null,
    folder: cfg.folder,
    interval: cfg.interval,
    stats: { total, unread, errors, high }
  });
});

// ── GET /api/email-agent/inbox ───────────────────────────────────────────────
router.get('/inbox', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const { status, kategorie, limit = 50, offset = 0 } = req.query;

  let where = '1=1';
  const params = [];

  if (status) {
    where += ' AND e.status = ?';
    params.push(status);
  }
  if (kategorie) {
    where += ' AND e.ai_kategorie = ?';
    params.push(kategorie);
  }

  const rows = db.prepare(`
    SELECT
      e.id, e.subject, e.from_addr, e.from_name, e.received_at,
      e.status, e.ai_kategorie, e.ai_zusammenfassung, e.ai_aktion,
      e.ai_prioritaet, e.has_attachments,
      e.linked_inquiry_id, e.linked_order_id,
      ci.vorname || ' ' || ci.nachname AS inquiry_name,
      o.order_number
    FROM email_inbox e
    LEFT JOIN customer_inquiries ci ON ci.id = e.linked_inquiry_id
    LEFT JOIN orders o ON o.id = e.linked_order_id
    WHERE ${where}
    ORDER BY
      CASE e.ai_prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      e.received_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`SELECT COUNT(*) AS n FROM email_inbox e WHERE ${where}`).get(...params)?.n || 0;

  res.json({ emails: rows, total });
});

// ── GET /api/email-agent/inbox/:id ──────────────────────────────────────────
router.get('/inbox/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT e.*,
      ci.vorname || ' ' || ci.nachname AS inquiry_name, ci.token AS inquiry_token,
      o.order_number
    FROM email_inbox e
    LEFT JOIN customer_inquiries ci ON ci.id = e.linked_inquiry_id
    LEFT JOIN orders o ON o.id = e.linked_order_id
    WHERE e.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  const attachments = db.prepare('SELECT * FROM email_attachments WHERE email_id = ?').all(req.params.id);
  let aiDaten = null;
  try { aiDaten = JSON.parse(row.ai_daten || '{}'); } catch {}

  res.json({ ...row, ai_daten: aiDaten, attachments });
});

// ── PUT /api/email-agent/inbox/:id/status ────────────────────────────────────
router.put('/inbox/:id/status', requireRole('admin', 'planer'), (req, res) => {
  const { status } = req.body;
  const valid = ['neu', 'verarbeitet', 'ignoriert'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

  const db = getDb();
  db.prepare("UPDATE email_inbox SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// ── POST /api/email-agent/inbox/:id/convert-inquiry ─────────────────────────
router.post('/inbox/:id/convert-inquiry', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const email = db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Nicht gefunden' });

  // Manuell übergebene Felder haben Vorrang
  const b = req.body;
  let aiDaten = {};
  try { aiDaten = JSON.parse(email.ai_daten || '{}'); } catch {}

  const token = require('uuid').v4().replace(/-/g, '');

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
      b.firma    ?? aiDaten.firma    ?? null,
      b.vorname  ?? aiDaten.vorname  ?? '',
      b.nachname ?? aiDaten.nachname ?? '',
      b.email    ?? aiDaten.email    ?? email.from_addr ?? '',
      b.telefon  ?? aiDaten.telefon  ?? '',
      b.strasse  ?? aiDaten.strasse  ?? '',
      b.plz      ?? aiDaten.plz      ?? '',
      b.ort      ?? aiDaten.ort      ?? '',
      b.art_der_arbeit ?? aiDaten.art_der_arbeit ?? null,
      b.anzahl_zylinder ? parseInt(b.anzahl_zylinder) : (aiDaten.anzahl_zylinder ? parseInt(aiDaten.anzahl_zylinder) : null),
      b.anzahl_schluessel ? parseInt(b.anzahl_schluessel) : (aiDaten.anzahl_schluessel ? parseInt(aiDaten.anzahl_schluessel) : null),
      b.anzahl_tueren ? parseInt(b.anzahl_tueren) : (aiDaten.anzahl_tueren ? parseInt(aiDaten.anzahl_tueren) : null),
      b.bestehendes_system !== undefined ? (b.bestehendes_system ? 1 : 0) : (aiDaten.bestehendes_system ? 1 : 0),
      b.wunschtermin ?? aiDaten.wunschtermin ?? null,
      b.bemerkungen  ?? aiDaten.bemerkungen  ?? email.ai_zusammenfassung ?? null
    );

    db.prepare("UPDATE email_inbox SET linked_inquiry_id = ?, status = 'verarbeitet' WHERE id = ?")
      .run(result.lastInsertRowid, email.id);

    res.json({ ok: true, inquiry_id: result.lastInsertRowid, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/email-agent/inbox/:id/link-order ──────────────────────────────
router.post('/inbox/:id/link-order', requireRole('admin', 'planer'), (req, res) => {
  const { order_id } = req.body;
  const db = getDb();
  db.prepare("UPDATE email_inbox SET linked_order_id = ? WHERE id = ?").run(order_id || null, req.params.id);
  res.json({ ok: true });
});

// ── GET /api/email-agent/attachment/:filename ────────────────────────────────
router.get('/attachment/:filename', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM email_attachments WHERE filename = ?').get(req.params.filename);
  if (!att) return res.status(404).json({ error: 'Nicht gefunden' });

  const filePath = path.join(EMAIL_ATT_DIR, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  res.download(filePath, att.original_name);
});

// ── POST /api/email-agent/poll ───────────────────────────────────────────────
router.post('/poll', requireRole('admin', 'planer'), async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'IMAP nicht konfiguriert' });
  }
  try {
    await pollOnce();
    const db = getDb();
    const stats = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE DATE(created_at) = DATE('now')").get();
    res.json({ ok: true, today: stats?.n || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET/POST /api/email-agent/settings ──────────────────────────────────────
router.get('/settings', requireRole('admin'), (req, res) => {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  res.json({
    imap_host:          get('imap_host'),
    imap_port:          get('imap_port') || '993',
    imap_secure:        get('imap_secure') ?? 'true',
    imap_user:          get('imap_user'),
    imap_pass:          get('imap_pass') ? '••••••••' : null,
    imap_folder:        get('imap_folder') || 'INBOX',
    imap_poll_interval: get('imap_poll_interval') || '300',
    email_agent_prompt: get('email_agent_prompt') || CLASSIFICATION_PROMPT,
  });
});

router.post('/settings', requireRole('admin'), (req, res) => {
  const db = getDb();
  const set = (k, v) => {
    if (v !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
    }
  };

  const { imap_host, imap_port, imap_secure, imap_user, imap_pass, imap_folder, imap_poll_interval, email_agent_prompt } = req.body;

  set('imap_host',          imap_host);
  set('imap_port',          imap_port);
  set('imap_secure',        imap_secure);
  set('imap_user',          imap_user);
  if (imap_pass && imap_pass !== '••••••••') set('imap_pass', imap_pass);
  set('imap_folder',        imap_folder);
  set('imap_poll_interval', imap_poll_interval);
  if (email_agent_prompt)   set('email_agent_prompt', email_agent_prompt);

  // Poller neu starten damit neue Einstellungen gelten
  stopPoller();
  startPoller().catch(e => console.error('[Email-Agent] Neustart Fehler:', e.message));

  // Letzte UID zurücksetzen damit alte Mails neu eingelesen werden können
  if (req.body.reset_uid) {
    db.prepare("DELETE FROM settings WHERE key = 'imap_last_uid'").run();
  }

  res.json({ ok: true });
});

// ── POST /api/email-agent/inbox/:id/reclassify ──────────────────────────────
router.post('/inbox/:id/reclassify', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const email = db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Nicht gefunden' });

  try {
    const { classifyEmail: classify } = require('../lib/email-agent');
    // Re-import the function inline since it's not exported
    const Anthropic = require('@anthropic-ai/sdk');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY fehlt' });

    const { CLASSIFICATION_PROMPT: prompt } = require('../lib/email-agent');
    const client = new Anthropic({ apiKey });
    const customPrompt = db.prepare("SELECT value FROM settings WHERE key = 'email_agent_prompt'").get()?.value;
    const promptTemplate = customPrompt || prompt;

    const body = email.body_text || email.body_html?.replace(/<[^>]+>/g, ' ') || '';
    const filled = promptTemplate
      .replace('{SUBJECT}', email.subject || '')
      .replace('{FROM}', `${email.from_name} <${email.from_addr}>`)
      .replace('{DATE}', email.received_at || '')
      .replace('{BODY}', body.substring(0, 6000));

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: filled }],
    });

    const raw = message.content[0].text.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
    const aiResult = JSON.parse(raw);

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
      email.id
    );

    res.json({ ok: true, kategorie: aiResult.kategorie, prioritaet: aiResult.prioritaet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/email-agent/inbox/:id ───────────────────────────────────────
router.delete('/inbox/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const atts = db.prepare('SELECT filename FROM email_attachments WHERE email_id = ?').all(req.params.id);
  atts.forEach(a => {
    const fp = path.join(EMAIL_ATT_DIR, a.filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  });
  db.prepare('DELETE FROM email_inbox WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
