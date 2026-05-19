const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { buildHtmlReport } = require('../lib/mailer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const orderId = req.params.orderId;
    const db = getDb();
    const order = db.prepare('SELECT order_number, work_date, planned_date FROM orders WHERE id = ?').get(orderId);
    const rawDate = (order && (order.work_date || order.planned_date)) || '';
    const dateStr = rawDate.replace(/\//g, '-').split('T')[0] || 'kein-datum';
    const safeNum = ((order && order.order_number) || String(orderId)).replace(/[^a-zA-Z0-9._-]/g, '-');
    req._uploadDir = `${safeNum}_${dateStr}`;
    const dir = path.join(UPLOADS_DIR, req._uploadDir);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.xlsx', '.xls', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Dateityp ${ext} nicht erlaubt`));
  }
});

// POST /api/files/:orderId/attachments
router.post('/:orderId/attachments', requireLogin, upload.array('files', 20), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  const dirName = req._uploadDir || null;
  const saved = req.files.map(f => {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.originalname);
    const result = db.prepare(`
      INSERT INTO order_attachments (order_id, filename, original_name, file_type, uploaded_by, dir_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.orderId, f.filename, f.originalname, isImage ? 'image' : 'document', req.session.userId, dirName);
    const insertId = result.lastInsertRowid;

    return { id: insertId, filename: f.filename, original_name: f.originalname };
  });

  res.json(saved);
});

// POST /api/files/:orderId/photos
router.post('/:orderId/photos', requireLogin, upload.array('photos', 20), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  const dirName = req._uploadDir || null;
  const saved = req.files.map(f => {
    const result = db.prepare(`
      INSERT INTO order_photos (order_id, filename, original_name, photo_type, uploaded_by, dir_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.orderId, f.filename, f.originalname, req.body.photo_type || 'standort', req.session.userId, dirName);
    const insertId = result.lastInsertRowid;

    return { id: insertId, filename: f.filename, original_name: f.originalname };
  });

  res.json(saved);
});

// GET /api/files/:orderId/zip  – download all files + rapport as ZIP
// MUST be before /:orderId/:filename to avoid route conflict
router.get('/:orderId/zip', requireLogin, (req, res) => {
  const db = getDb();
  const orderId = parseInt(req.params.orderId);
  const order = db.prepare(`
    SELECT o.*, c.name AS cust_name
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  // Role check for monteur
  if (req.session.role === 'monteur' && order.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(orderId);
  const photos      = db.prepare('SELECT * FROM order_photos      WHERE order_id = ?').all(orderId);

  // Build rapport HTML
  const parsedOrder = {
    ...order,
    work_types:          JSON.parse(order.work_types || '[]'),
    executed_work:       JSON.parse(order.executed_work || '[]'),
    items_table:         JSON.parse(order.items_table || '[]'),
    additional_material: JSON.parse(order.additional_material || '[]'),
    extra_material:      JSON.parse(order.extra_material || '[]'),
    rings_data:          JSON.parse(order.rings_data || '{}'),
    keys_data:           JSON.parse(order.keys_data || '{}'),
  };
  const rapportHtml = buildHtmlReport(parsedOrder, attachments, photos);

  // ZIP filename: {order_number}-LS{project_number}-KD-Nr.{customer_id}.zip
  const orderNum  = (order.order_number || String(orderId)).replace(/[^a-zA-Z0-9._-]/g, '-');
  const lsPart    = order.project_number ? `-LS${order.project_number.replace(/[^a-zA-Z0-9._-]/g, '-')}` : '';
  const kdPart    = order.customer_id ? `-KD-Nr.${order.customer_id}` : '';
  const zipName   = `${orderNum}${lsPart}${kdPart}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error('[ZIP]', err); res.end(); });
  archive.pipe(res);

  // Add rapport HTML
  archive.append(Buffer.from(rapportHtml, 'utf8'), { name: `Rapport_${orderNum}.html` });

  // Resolve file path helper
  const resolveFile = row => {
    const candidates = [];
    if (row.dir_name) candidates.push(path.join(UPLOADS_DIR, row.dir_name, row.filename));
    candidates.push(path.join(UPLOADS_DIR, String(orderId), row.filename));
    return candidates.find(p => fs.existsSync(p)) || null;
  };

  // Add photos (in subfolder Fotos/)
  photos.forEach(p => {
    const fp = resolveFile(p);
    if (fp) archive.file(fp, { name: `Fotos/${p.original_name}` });
  });

  // Add attachments (in subfolder Anhaenge/)
  attachments.forEach(a => {
    const fp = resolveFile(a);
    if (fp) archive.file(fp, { name: `Anhaenge/${a.original_name}` });
  });

  archive.finalize();
});

// GET /api/files/:orderId/:filename  – serve file
router.get('/:orderId/:filename', requireLogin, (req, res) => {
  const db = getDb();
  const filename = path.basename(req.params.filename); // path traversal protection

  const att = db.prepare('SELECT dir_name FROM order_attachments WHERE order_id = ? AND filename = ?')
    .get(req.params.orderId, filename);
  const photo = !att && db.prepare('SELECT dir_name FROM order_photos WHERE order_id = ? AND filename = ?')
    .get(req.params.orderId, filename);
  const record = att || photo;

  const candidates = [];
  if (record && record.dir_name) candidates.push(path.join(UPLOADS_DIR, record.dir_name, filename));
  candidates.push(path.join(UPLOADS_DIR, String(req.params.orderId), filename));

  const filePath = candidates.find(p => fs.existsSync(p));
  if (!filePath) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.sendFile(filePath);
});

// DELETE /api/files/:orderId/attachments/:id
router.delete('/:orderId/attachments/:id', requireLogin, (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM order_attachments WHERE id = ? AND order_id = ?')
    .get(req.params.id, req.params.orderId);
  if (!att) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM order_attachments WHERE id = ?').run(req.params.id);

  const candidates = [];
  if (att.dir_name) candidates.push(path.join(UPLOADS_DIR, att.dir_name, att.filename));
  candidates.push(path.join(UPLOADS_DIR, String(req.params.orderId), att.filename));
  const fp = candidates.find(p => fs.existsSync(p));
  if (fp) fs.unlinkSync(fp);

  res.json({ ok: true });
});

// DELETE /api/files/:orderId/photos/:id
router.delete('/:orderId/photos/:id', requireLogin, (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT * FROM order_photos WHERE id = ? AND order_id = ?')
    .get(req.params.id, req.params.orderId);
  if (!photo) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM order_photos WHERE id = ?').run(req.params.id);

  const candidates = [];
  if (photo.dir_name) candidates.push(path.join(UPLOADS_DIR, photo.dir_name, photo.filename));
  candidates.push(path.join(UPLOADS_DIR, String(req.params.orderId), photo.filename));
  const fp = candidates.find(p => fs.existsSync(p));
  if (fp) fs.unlinkSync(fp);

  res.json({ ok: true });
});

// DELETE /api/files/cleanup?days=60  – delete files older than N days (planer + admin)
router.delete('/cleanup', requireRole('admin', 'planer'), (req, res) => {
  const days = parseInt(req.query.days) || 60;
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19);

  const oldAtts   = db.prepare(`SELECT * FROM order_attachments WHERE created_at < ?`).all(cutoffStr);
  const oldPhotos = db.prepare(`SELECT * FROM order_photos      WHERE created_at < ?`).all(cutoffStr);

  let deleted = 0;

  const deleteFile = (row, orderId) => {
    const candidates = [];
    if (row.dir_name) candidates.push(path.join(UPLOADS_DIR, row.dir_name, row.filename));
    candidates.push(path.join(UPLOADS_DIR, String(orderId), row.filename));
    const fp = candidates.find(p => fs.existsSync(p));
    if (fp) { try { fs.unlinkSync(fp); } catch {} }
  };

  oldAtts.forEach(a => {
    deleteFile(a, a.order_id);
    db.prepare('DELETE FROM order_attachments WHERE id = ?').run(a.id);
    deleted++;
  });
  oldPhotos.forEach(p => {
    deleteFile(p, p.order_id);
    db.prepare('DELETE FROM order_photos WHERE id = ?').run(p.id);
    deleted++;
  });

  res.json({ ok: true, deleted, days });
});

module.exports = router;
