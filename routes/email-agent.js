/**
 * Email-Agent API Routes
 */

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const agent = require('../lib/email-agent');

// Multer für EML-Upload
const emlStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(agent.EMAIL_INBOX_DIR)) fs.mkdirSync(agent.EMAIL_INBOX_DIR, { recursive: true });
    cb(null, agent.EMAIL_INBOX_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.eml';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const emlUpload = multer({
  storage: emlStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.eml', '.msg'].includes(ext));
  },
});

// ── GET /api/email-agent/status ──────────────────────────────────────────────
router.get('/status', requireLogin, (req, res) => {
  const db = getDb();
  const total  = db.prepare("SELECT COUNT(*) AS n FROM email_inbox").get()?.n || 0;
  const unread = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE status = 'neu'").get()?.n || 0;
  const errors = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE status = 'fehler'").get()?.n || 0;
  const high   = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE ai_prioritaet = 'hoch' AND status != 'ignoriert'").get()?.n || 0;
  const today  = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE DATE(created_at) = DATE('now')").get()?.n || 0;

  const graphCfg = agent.getGraphConfig();
  res.json({
    graph_configured: agent.isGraphConfigured(),
    graph_mailbox: graphCfg.mailbox || null,
    graph_enabled: graphCfg.enabled,
    stats: { total, unread, errors, high, today }
  });
});

// ── GET /api/email-agent/inbox ───────────────────────────────────────────────
router.get('/inbox', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const { status, kategorie, limit = 50, offset = 0 } = req.query;

  let where = '1=1';
  const params = [];
  if (status)    { where += ' AND status = ?';       params.push(status); }
  if (kategorie) { where += ' AND ai_kategorie = ?'; params.push(kategorie); }

  const rows = db.prepare(`
    SELECT
      id, subject, from_addr, from_name, received_at,
      status, ai_kategorie, ai_zusammenfassung, ai_aktion,
      ai_prioritaet, has_attachments, created_at
    FROM email_inbox
    WHERE ${where}
    ORDER BY
      CASE ai_prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      received_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`SELECT COUNT(*) AS n FROM email_inbox WHERE ${where}`).get(...params)?.n || 0;
  res.json({ emails: rows, total });
});

// ── GET /api/email-agent/inbox/:id ──────────────────────────────────────────
router.get('/inbox/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  const attachments = db.prepare('SELECT * FROM email_attachments WHERE email_id = ?').all(req.params.id);
  let aiDaten = null;
  try { aiDaten = JSON.parse(row.ai_daten || '{}'); } catch {}
  let threadJson = null;
  try { threadJson = JSON.parse(row.thread_json || 'null'); } catch {}
  let attachmentTexts = null;
  try { attachmentTexts = JSON.parse(row.attachment_texts || 'null'); } catch {}
  res.json({ ...row, ai_daten: aiDaten, thread: threadJson, attachment_texts_parsed: attachmentTexts, attachments });
});

// ── POST /api/email-agent/upload ─────────────────────────────────────────────
router.post('/upload', requireRole('admin', 'planer'), emlUpload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Keine .eml oder .msg Datei angegeben' });

  const results = [];
  for (const file of req.files) {
    const filePath = path.join(agent.EMAIL_INBOX_DIR, file.filename);
    try {
      const result = await agent.processEmlFile(filePath, file.originalname);
      const doneDir = path.join(path.dirname(agent.EMAIL_INBOX_DIR), 'email-processed');
      if (!fs.existsSync(doneDir)) fs.mkdirSync(doneDir, { recursive: true });
      fs.renameSync(filePath, path.join(doneDir, file.filename));
      results.push({ file: file.originalname, ...result });
    } catch (e) {
      console.error('[Email-Agent] Upload-Fehler:', e.message);
      results.push({ file: file.originalname, error: e.message });
    }
  }

  const ok = results.filter(r => !r.error && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  res.json({ ok: true, processed: ok, skipped, results });
});

// ── POST /api/email-agent/poll ───────────────────────────────────────────────
router.post('/poll', requireRole('admin', 'planer'), async (req, res) => {
  if (!agent.isGraphConfigured()) {
    return res.status(503).json({ error: 'Microsoft Graph API nicht konfiguriert oder nicht aktiviert' });
  }
  try {
    await agent.graphPollOnce();
    const db = getDb();
    const stats = db.prepare("SELECT COUNT(*) AS n FROM email_inbox WHERE DATE(created_at) = DATE('now')").get();
    res.json({ ok: true, today: stats?.n || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/email-agent/inbox/:id/status ────────────────────────────────────
router.put('/inbox/:id/status', requireRole('admin', 'planer'), (req, res) => {
  const { status } = req.body;
  if (!['neu', 'verarbeitet', 'ignoriert'].includes(status))
    return res.status(400).json({ error: 'Ungültiger Status' });
  getDb().prepare("UPDATE email_inbox SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// ── POST /api/email-agent/inbox/:id/reclassify ──────────────────────────────
router.post('/inbox/:id/reclassify', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const email = db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Nicht gefunden' });

  try {
    const body = email.body_text || (email.body_html || '').replace(/<[^>]+>/g, ' ');
    const aiResult = await agent.classifyEmail(
      email.subject,
      email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr,
      email.received_at,
      body
    );

    const fromDisplay = email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr;
    const draft = await agent.generateDraft({
      subject:           email.subject,
      from:              fromDisplay,
      date:              email.received_at,
      bodyText:          email.body_text || '',
      threadJson:        email.thread_json,
      attachmentTexts:   email.attachment_texts,
      aiKategorie:       aiResult.kategorie,
      aiPrioritaet:      aiResult.prioritaet,
      aiZusammenfassung: aiResult.zusammenfassung,
    });

    db.prepare(`
      UPDATE email_inbox SET
        ai_kategorie = ?, ai_zusammenfassung = ?, ai_daten = ?,
        ai_aktion = ?, ai_prioritaet = ?, ai_draft = ?,
        status = 'verarbeitet', processed_at = datetime('now')
      WHERE id = ?
    `).run(
      aiResult.kategorie || 'sonstiges',
      aiResult.zusammenfassung || null,
      JSON.stringify(aiResult.daten || {}),
      aiResult.empfohlene_aktion || null,
      aiResult.prioritaet || 'normal',
      draft || null,
      email.id
    );

    res.json({ ok: true, kategorie: aiResult.kategorie, prioritaet: aiResult.prioritaet, hasDraft: !!draft });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/email-agent/attachment/:filename ────────────────────────────────
router.get('/attachment/:filename', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM email_attachments WHERE filename = ?').get(req.params.filename);
  if (!att) return res.status(404).json({ error: 'Nicht gefunden' });
  const filePath = path.join(agent.EMAIL_ATT_DIR, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(filePath, att.original_name);
});

// ── PUT /api/email-agent/inbox/:id/draft ─────────────────────────────────────
router.put('/inbox/:id/draft', requireRole('admin', 'planer'), (req, res) => {
  const { draft } = req.body;
  getDb().prepare("UPDATE email_inbox SET ai_draft = ? WHERE id = ?").run(draft || null, req.params.id);
  res.json({ ok: true });
});

// ── POST /api/email-agent/inbox/:id/regenerate-draft ─────────────────────────
router.post('/inbox/:id/regenerate-draft', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const email = db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Nicht gefunden' });

  try {
    const fromDisplay = email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr;
    const draft = await agent.generateDraft({
      subject:           email.subject,
      from:              fromDisplay,
      date:              email.received_at,
      bodyText:          email.body_text || '',
      threadJson:        email.thread_json,
      attachmentTexts:   email.attachment_texts,
      aiKategorie:       email.ai_kategorie,
      aiPrioritaet:      email.ai_prioritaet,
      aiZusammenfassung: email.ai_zusammenfassung,
    });
    db.prepare("UPDATE email_inbox SET ai_draft = ? WHERE id = ?").run(draft || null, email.id);
    res.json({ ok: true, draft });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/email-agent/settings ───────────────────────────────────────────
router.get('/settings', requireRole('admin'), (req, res) => {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  res.json({
    email_inbox_path:         get('email_inbox_path') || '',
    graph_tenant_id:          get('graph_tenant_id'),
    graph_client_id:          get('graph_client_id'),
    graph_client_secret:      get('graph_client_secret') ? '••••••••' : null,
    graph_mailbox:            get('graph_mailbox'),
    graph_folder:             get('graph_folder') || 'Inbox',
    graph_poll_interval:      get('graph_poll_interval') || '300',
    graph_enabled:            get('graph_enabled') || 'false',
    email_agent_prompt:       get('email_agent_prompt') || agent.DEFAULT_CLASSIFICATION_PROMPT,
    email_agent_draft_prompt: get('email_agent_draft_prompt') || agent.DEFAULT_DRAFT_PROMPT,
    inbox_dir:                agent.EMAIL_INBOX_DIR,
  });
});

// ── POST /api/email-agent/settings ──────────────────────────────────────────
router.post('/settings', requireRole('admin'), (req, res) => {
  const db = getDb();
  const set = (k, v) => {
    if (v !== undefined && v !== null)
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(v));
  };

  const {
    email_inbox_path,
    graph_tenant_id, graph_client_id, graph_client_secret,
    graph_mailbox, graph_folder, graph_poll_interval,
    graph_enabled, email_agent_prompt, email_agent_draft_prompt,
  } = req.body;

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('email_inbox_path', email_inbox_path || '');
  set('graph_tenant_id',     graph_tenant_id);
  set('graph_client_id',     graph_client_id);
  if (graph_client_secret && graph_client_secret !== '••••••••')
    set('graph_client_secret', graph_client_secret);
  set('graph_mailbox',       graph_mailbox);
  set('graph_folder',        graph_folder || 'Inbox');
  set('graph_poll_interval', graph_poll_interval || '300');
  set('graph_enabled',       graph_enabled ? 'true' : 'false');
  if (email_agent_prompt)       set('email_agent_prompt',       email_agent_prompt);
  if (email_agent_draft_prompt) set('email_agent_draft_prompt', email_agent_draft_prompt);

  agent.stopAgent();
  agent.startAgent().catch(e => console.error('[Email-Agent] Neustart Fehler:', e.message));

  res.json({ ok: true, inbox_dir: agent.EMAIL_INBOX_DIR });
});

// ── DELETE /api/email-agent/inbox/:id ───────────────────────────────────────
router.delete('/inbox/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const atts = db.prepare('SELECT filename FROM email_attachments WHERE email_id = ?').all(req.params.id);
  atts.forEach(a => {
    const fp = path.join(agent.EMAIL_ATT_DIR, a.filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  });
  db.prepare('DELETE FROM email_inbox WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
