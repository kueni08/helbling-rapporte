const router = require('express').Router();
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const multer = require('multer');
const uploadMem = multer({ storage: multer.memoryStorage() });

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

module.exports = router;
