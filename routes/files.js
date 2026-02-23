const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');
const { requireLogin } = require('../middleware/auth');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const orderId = req.params.orderId;
    const dir = path.join(UPLOADS_DIR, String(orderId));
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

  const saved = req.files.map(f => {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.originalname);
    const result = db.prepare(`
      INSERT INTO order_attachments (order_id, filename, original_name, file_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.orderId, f.filename, f.originalname, isImage ? 'image' : 'document', req.session.userId);
    return { id: result.lastInsertRowid, filename: f.filename, original_name: f.originalname };
  });

  res.json(saved);
});

// POST /api/files/:orderId/photos
router.post('/:orderId/photos', requireLogin, upload.array('photos', 20), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  const saved = req.files.map(f => {
    const result = db.prepare(`
      INSERT INTO order_photos (order_id, filename, original_name, photo_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.orderId, f.filename, f.originalname, req.body.photo_type || 'standort', req.session.userId);
    return { id: result.lastInsertRowid, filename: f.filename, original_name: f.originalname };
  });

  res.json(saved);
});

// GET /api/files/:orderId/:filename  – serve file
router.get('/:orderId/:filename', requireLogin, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.orderId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.sendFile(filePath);
});

// DELETE /api/files/:orderId/attachments/:id
router.delete('/:orderId/attachments/:id', requireLogin, (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM order_attachments WHERE id = ? AND order_id = ?').get(req.params.id, req.params.orderId);
  if (!att) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM order_attachments WHERE id = ?').run(req.params.id);
  const fp = path.join(UPLOADS_DIR, String(req.params.orderId), att.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// DELETE /api/files/:orderId/photos/:id
router.delete('/:orderId/photos/:id', requireLogin, (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT * FROM order_photos WHERE id = ? AND order_id = ?').get(req.params.id, req.params.orderId);
  if (!photo) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM order_photos WHERE id = ?').run(req.params.id);
  const fp = path.join(UPLOADS_DIR, String(req.params.orderId), photo.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

module.exports = router;
