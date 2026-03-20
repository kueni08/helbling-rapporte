const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const archiver = require('archiver');
const { getDb }         = require('../lib/database');
const { requireRole }   = require('../middleware/auth');
const { buildHtmlReport, generatePdfSafe } = require('../lib/mailer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

function parseJSON(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

function sanitize(s) {
  return String(s || '').replace(/[/\\:*?"<>|]/g, '_').trim();
}

// Helper: build query for filtered orders
function queryOrders(db, { status, from, to }) {
  let sql = `
    SELECT o.* FROM orders o
    WHERE o.status != 'archiviert'
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (from)   { sql += ' AND (o.planned_date >= ? OR o.work_date >= ?)'; params.push(from, from); }
  if (to)     { sql += ' AND (o.planned_date <= ? OR o.work_date <= ?)'; params.push(to, to); }
  sql += ' ORDER BY o.planned_date, o.order_number';
  return db.prepare(sql).all(...params);
}

// ── GET /api/export/fotos-zip ───────────────────────────────────────────────
// Download all photos for matching orders as a ZIP file.
// Photos are renamed: {order_number}_{original_name}
router.get('/fotos-zip', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const { status, from, to } = req.query;

  const orders = queryOrders(db, { status, from, to });
  if (!orders.length) return res.status(404).json({ error: 'Keine Aufträge gefunden' });

  const orderIds = orders.map(o => o.id);
  const placeholders = orderIds.map(() => '?').join(',');
  const photos = db.prepare(
    `SELECT p.*, o.order_number FROM order_photos p
     JOIN orders o ON o.id = p.order_id
     WHERE p.order_id IN (${placeholders})
     ORDER BY o.order_number, p.created_at`
  ).all(...orderIds);

  const label = status ? `_${status}` : '';
  const dateLabel = from ? `_ab_${from}` : '';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Fotos${label}${dateLabel}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error('[Export] ZIP error:', err); res.end(); });
  archive.pipe(res);

  // Counter per order to handle duplicate original_names
  const seenNames = new Map();

  photos.forEach(p => {
    const candidates = [];
    if (p.dir_name) candidates.push(path.join(UPLOADS_DIR, p.dir_name, p.filename));
    candidates.push(path.join(UPLOADS_DIR, String(p.order_id), p.filename));
    const fp = candidates.find(c => fs.existsSync(c));
    if (!fp) return;

    const ext = path.extname(p.original_name || p.filename) || path.extname(p.filename);
    const baseName = path.basename(p.original_name || p.filename, ext);
    const orderNum = sanitize(p.order_number);
    let entryName = `${orderNum}_${sanitize(baseName)}${ext}`;

    // Deduplicate within the ZIP
    if (seenNames.has(entryName)) {
      const n = seenNames.get(entryName) + 1;
      seenNames.set(entryName, n);
      entryName = `${orderNum}_${sanitize(baseName)}_${n}${ext}`;
    } else {
      seenNames.set(entryName, 1);
    }

    archive.file(fp, { name: entryName });
  });

  archive.finalize();
});

// ── GET /api/export/rapporte-zip ───────────────────────────────────────────
// Download rapports for matching orders as a ZIP of PDFs.
// Note: PDF generation is sequential and can be slow for large sets.
router.get('/rapporte-zip', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const { status, from, to } = req.query;

  const orders = queryOrders(db, { status, from, to });
  if (!orders.length) return res.status(404).json({ error: 'Keine Aufträge gefunden' });

  if (orders.length > 50) {
    return res.status(400).json({ error: `Zu viele Aufträge (${orders.length}). Bitte Filter (Status / Datum) verwenden um auf max. 50 zu reduzieren.` });
  }

  const label    = status ? `_${status}` : '';
  const dateLabel = from  ? `_ab_${from}` : '';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Rapporte${label}${dateLabel}.zip"`);

  const archive = archiver('zip', { zlib: { level: 4 } });
  archive.on('error', err => { console.error('[Export] ZIP error:', err); res.end(); });
  archive.pipe(res);

  for (const order of orders) {
    try {
      const parsedOrder = {
        ...order,
        work_types:          parseJSON(order.work_types, []),
        executed_work:       parseJSON(order.executed_work, []),
        items_table:         parseJSON(order.items_table, []),
        additional_material: parseJSON(order.additional_material, []),
        extra_material:      parseJSON(order.extra_material, []),
        rings_data:          parseJSON(order.rings_data, {}),
        keys_data:           parseJSON(order.keys_data, {}),
      };
      const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(order.id);
      const photos      = db.prepare('SELECT * FROM order_photos      WHERE order_id = ?').all(order.id);

      const pdfBuf  = await generatePdfSafe(parsedOrder, attachments, photos);

      const orderNum   = sanitize(order.order_number);
      const custName   = sanitize(order.customer_name || '');
      const entryName  = `${orderNum}_${custName}.pdf`;
      archive.append(pdfBuf, { name: entryName });
    } catch (err) {
      console.warn(`[Export] PDF für Auftrag ${order.order_number} fehlgeschlagen:`, err.message);
    }
  }

  await archive.finalize();
});

module.exports = router;
