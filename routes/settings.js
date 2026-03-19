const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const multer = require('multer');
const uploadMem = multer({ storage: multer.memoryStorage() });
const Anthropic = require('@anthropic-ai/sdk');
const { DEFAULT_EXTRACTION_PROMPT } = require('../lib/lieferschein-watcher');
const drive = require('../lib/drive');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

// GET /api/settings/options  – all active options grouped by field_name
router.get('/options', requireLogin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM multiselect_options WHERE active = 1 ORDER BY field_name, sort_order`).all();
  const grouped = {};
  rows.forEach(r => {
    if (!grouped[r.field_name]) grouped[r.field_name] = [];
    grouped[r.field_name].push({ id: r.id, key: r.option_key, label: r.option_label, sort_order: r.sort_order });
  });
  res.json(grouped);
});

// GET /api/settings/options/:fieldName – single field (admin)
router.get('/options/:fieldName', requireRole('admin'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM multiselect_options WHERE field_name = ? ORDER BY sort_order`).all(req.params.fieldName);
  res.json(rows);
});

// POST /api/settings/options  (admin only)
router.post('/options', requireRole('admin'), (req, res) => {
  const { field_name, option_key, option_label, sort_order } = req.body;
  if (!field_name || !option_key || !option_label) return res.status(400).json({ error: 'field_name, option_key, option_label erforderlich' });
  const db = getDb();
  try {
    const result = db.prepare(`INSERT INTO multiselect_options (field_name, option_key, option_label, sort_order) VALUES (?,?,?,?)`).run(field_name, option_key, option_label, sort_order || 0);
    res.status(201).json(db.prepare('SELECT * FROM multiselect_options WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Option bereits vorhanden' });
    throw e;
  }
});

// PUT /api/settings/options/:id  (admin only)
router.put('/options/:id', requireRole('admin'), (req, res) => {
  const { option_label, sort_order, active } = req.body;
  const db = getDb();
  if (option_label !== undefined) db.prepare('UPDATE multiselect_options SET option_label = ? WHERE id = ?').run(option_label, req.params.id);
  if (sort_order !== undefined) db.prepare('UPDATE multiselect_options SET sort_order = ? WHERE id = ?').run(sort_order, req.params.id);
  if (active !== undefined) db.prepare('UPDATE multiselect_options SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM multiselect_options WHERE id = ?').get(req.params.id));
});

// DELETE /api/settings/options/:id (admin only)
router.delete('/options/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM multiselect_options WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Articles ──────────────────────────────────────────────────────────────────
router.get('/articles', requireLogin, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM articles WHERE active = 1 ORDER BY name').all());
});

router.post('/articles', requireRole('admin'), (req, res) => {
  const { article_number, name, description, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const db = getDb();
  const r = db.prepare(`INSERT INTO articles (article_number, name, description, unit) VALUES (?,?,?,?)`).run(article_number || null, name, description || null, unit || 'Stk.');
  res.status(201).json(db.prepare('SELECT * FROM articles WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/articles/:id', requireRole('admin'), (req, res) => {
  const { article_number, name, description, unit, active } = req.body;
  const db = getDb();
  if (name)                db.prepare('UPDATE articles SET name = ? WHERE id = ?').run(name, req.params.id);
  if (article_number)      db.prepare('UPDATE articles SET article_number = ? WHERE id = ?').run(article_number, req.params.id);
  if (description)         db.prepare('UPDATE articles SET description = ? WHERE id = ?').run(description, req.params.id);
  if (unit)                db.prepare('UPDATE articles SET unit = ? WHERE id = ?').run(unit, req.params.id);
  if (active !== undefined) db.prepare('UPDATE articles SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id));
});

router.delete('/articles/:id', requireRole('admin'), (req, res) => {
  getDb().prepare('UPDATE articles SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/settings/articles/import  – Excel-Import (admin)
router.post('/articles/import', requireRole('admin'), uploadMem.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const db = getDb();
    let imported = 0, skipped = 0;

    const tx = db.transaction(() => {
      rows.forEach(row => {
        const article_number = String(row['Artikel-Code'] || row['Artikelnummer'] || row['article_number'] || '').trim();
        const name = String(row['Artikelname'] || row['Name'] || row['name'] || '').trim();
        const unit = String(row['Einheit'] || row['unit'] || 'Stk.').trim() || 'Stk.';
        const description = String(row['Beschreibung'] || row['description'] || '').trim() || null;

        if (!name) { skipped++; return; }

        // Check if article_number already exists
        if (article_number) {
          const existing = db.prepare('SELECT id FROM articles WHERE article_number = ? AND active = 1').get(article_number);
          if (existing) {
            db.prepare('UPDATE articles SET name = ?, unit = ?, description = ? WHERE id = ?')
              .run(name, unit, description, existing.id);
            imported++;
            return;
          }
        }

        db.prepare('INSERT INTO articles (article_number, name, description, unit) VALUES (?,?,?,?)')
          .run(article_number || null, name, description, unit);
        imported++;
      });
    });
    tx();

    res.json({ imported, skipped });
  } catch (e) {
    res.status(422).json({ error: `Import-Fehler: ${e.message}` });
  }
});

// ── SMTP / E-Mail Einstellungen ───────────────────────────────────────────────
router.get('/smtp', requireRole('admin'), (req, res) => {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  res.json({
    host: get('smtp_host') || process.env.SMTP_HOST || 'smtp.office365.com',
    port: get('smtp_port') || process.env.SMTP_PORT || '587',
    user: get('smtp_user') || process.env.SMTP_USER || '',
    pass: (get('smtp_pass') || process.env.SMTP_PASS) ? '***' : '',
    from: get('smtp_from') || '',
  });
});

router.put('/smtp', requireRole('admin'), (req, res) => {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const { host, port, user, pass, from } = req.body;
  if (host !== undefined) upsert.run('smtp_host', host);
  if (port !== undefined) upsert.run('smtp_port', String(port));
  if (user !== undefined) upsert.run('smtp_user', user);
  if (pass && pass !== '***') upsert.run('smtp_pass', pass);
  if (from !== undefined) upsert.run('smtp_from', from);
  res.json({ ok: true });
});

// ── KI-Extraktions-Prompt ─────────────────────────────────────────────────────
router.get('/extraction-prompt-default', requireRole('admin'), (req, res) => {
  res.json({ prompt: DEFAULT_EXTRACTION_PROMPT });
});

router.get('/extraction-prompt', requireRole('admin'), (req, res) => {
  const db = getDb();
  const saved = db.prepare('SELECT value FROM settings WHERE key = ?').get('extraction_prompt')?.value;
  res.json({ prompt: saved || DEFAULT_EXTRACTION_PROMPT });
});

router.put('/extraction-prompt', requireRole('admin'), (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt erforderlich' });
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('extraction_prompt', prompt);
  res.json({ ok: true });
});

router.post('/prompt-chat', requireRole('admin'), async (req, res) => {
  const { message, currentPrompt } = req.body;
  if (!message) return res.status(400).json({ error: 'message erforderlich' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY nicht konfiguriert' });

  const client = new Anthropic({ apiKey });

  const systemPrompt = `Du bist ein Experte für Prompt-Engineering, spezialisiert auf Datenextraktion aus Schweizer Lieferscheinen.
Du bekommst den aktuellen Extraktions-Prompt und eine Anfrage des Benutzers.
Passe den Prompt entsprechend an.

Antworte IMMER in diesem JSON-Format:
{
  "explanation": "Kurze Erklärung was du geändert hast (1-2 Sätze, auf Deutsch)",
  "newPrompt": "Der vollständige, aktualisierte Prompt"
}

Regeln:
- Behalte die Grundstruktur des Prompts bei
- Das JSON-Ausgabeformat im Prompt muss immer vollständig bleiben
- Antworte NUR mit dem JSON, kein weiterer Text`;

  const userMsg = `Aktueller Prompt:
\`\`\`
${currentPrompt}
\`\`\`

Anfrage: ${message}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    const raw = response.content[0].text.trim()
      .replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.explanation || !parsed.newPrompt) {
      return res.status(500).json({ error: 'Unerwartetes Antwortformat von Claude' });
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: `Claude API Fehler: ${e.message}` });
  }
});

// ── Import-Einstellungen (admin + planer) ─────────────────────────────────────
router.get('/import-defaults', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const monteurId = db.prepare("SELECT value FROM settings WHERE key = ?").get('default_import_monteur_id')?.value;
  res.json({ default_monteur_id: monteurId ? parseInt(monteurId) : null });
});

router.put('/import-defaults', requireRole('admin', 'planer'), (req, res) => {
  const { default_monteur_id } = req.body;
  const db = getDb();
  if (default_monteur_id) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('default_import_monteur_id', String(default_monteur_id));
  } else {
    db.prepare("DELETE FROM settings WHERE key = ?").run('default_import_monteur_id');
  }
  res.json({ ok: true });
});

// ── Customers ────────────────────────────────────────────────────────────────
router.get('/customers', requireLogin, (req, res) => {
  res.json(getDb().prepare('SELECT * FROM customers ORDER BY name').all());
});

router.post('/customers', requireRole('admin', 'planer'), (req, res) => {
  const { name, address, contact_name, contact_email, contact_phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const db = getDb();
  const r = db.prepare(`INSERT INTO customers (name, address, contact_name, contact_email, contact_phone) VALUES (?,?,?,?,?)`).run(name, address || null, contact_name || null, contact_email || null, contact_phone || null);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/customers/:id', requireRole('admin', 'planer'), (req, res) => {
  const { name, address, contact_name, contact_email, contact_phone } = req.body;
  const db = getDb();
  const fields = { name, address, contact_name, contact_email, contact_phone };
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined) db.prepare(`UPDATE customers SET ${k} = ? WHERE id = ?`).run(v, req.params.id);
  });
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

// GET /api/settings/drive-status  – Drive connection test (admin only)
router.get('/drive-status', requireRole('admin'), async (req, res) => {
  const enabled = drive.isDriveEnabled();
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!enabled) {
    return res.json({ enabled: false, message: 'Google Drive nicht konfiguriert (GOOGLE_SERVICE_ACCOUNT_JSON/FILE fehlt)' });
  }
  if (!rootFolderId) {
    return res.json({ enabled: true, folderConfigured: false, message: 'GOOGLE_DRIVE_FOLDER_ID nicht gesetzt' });
  }
  try {
    // Verify permissions by listing files in the root folder (result intentionally discarded)
    await drive.listPdfFiles(rootFolderId);
    // Also check recent failed uploads (no google_drive_file_id)
    const db = getDb();
    const failedAtts  = db.prepare('SELECT COUNT(*) as n FROM order_attachments WHERE google_drive_file_id IS NULL').get();
    const failedPhotos = db.prepare('SELECT COUNT(*) as n FROM order_photos WHERE google_drive_file_id IS NULL').get();
    res.json({
      enabled: true,
      folderConfigured: true,
      rootFolderId,
      message: 'Verbindung OK',
      pending_uploads: {
        attachments: failedAtts.n,
        photos: failedPhotos.n,
      },
    });
  } catch (e) {
    res.json({ enabled: true, folderConfigured: true, rootFolderId, message: 'Fehler: ' + e.message });
  }
});

// POST /api/settings/drive-retry  – retry failed Drive uploads (admin only)
router.post('/drive-retry', requireRole('admin'), async (req, res) => {
  if (!drive.isDriveEnabled()) {
    return res.status(400).json({ error: 'Drive nicht konfiguriert' });
  }

  const db = getDb();
  const atts   = db.prepare('SELECT * FROM order_attachments WHERE google_drive_file_id IS NULL').all();
  const photos = db.prepare('SELECT * FROM order_photos       WHERE google_drive_file_id IS NULL').all();

  let ok = 0, fail = 0;

  // Tag each record with its table to avoid ID collisions between the two tables
  const all = [
    ...atts.map(r => ({ ...r, _table: 'order_attachments' })),
    ...photos.map(r => ({ ...r, _table: 'order_photos' })),
  ];

  for (const rec of all) {
    const table = rec._table;
    const candidates = [];
    if (rec.dir_name) candidates.push(path.join(UPLOADS_DIR, rec.dir_name, rec.filename));
    candidates.push(path.join(UPLOADS_DIR, String(rec.order_id), rec.filename));
    const fp = candidates.find(p => fs.existsSync(p));
    if (!fp) { fail++; continue; }

    try {
      const driveFile = await drive.uploadFile(fp, rec.original_name, null, rec.dir_name);
      if (driveFile) {
        db.prepare(`UPDATE ${table} SET google_drive_file_id=?, google_drive_web_url=? WHERE id=?`)
          .run(driveFile.id, driveFile.webViewLink, rec.id);
        ok++;
      } else { fail++; }
    } catch { fail++; }
  }

  res.json({ ok, fail, total: atts.length + photos.length });
});

module.exports = router;
