const router = require('express').Router();
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

function genOrderNumber(db) {
  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`${year}-%`);
  const seq = last ? (parseInt(last.order_number.split('-')[1]) + 1) : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

function parseJSON(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

function formatOrder(o) {
  if (!o) return null;
  return {
    ...o,
    work_types:         parseJSON(o.work_types, []),
    executed_work:      parseJSON(o.executed_work, []),
    items_table:        parseJSON(o.items_table, []),
    additional_material:parseJSON(o.additional_material, []),
    rings_data:         parseJSON(o.rings_data, {}),
    keys_data:          parseJSON(o.keys_data, {}),
  };
}

// GET /api/orders
router.get('/', requireLogin, (req, res) => {
  const db = getDb();
  const { role, userId } = req.session;
  let orders;
  if (role === 'monteur') {
    orders = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name, c.name AS cust_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.assigned_to = ? AND o.status NOT IN ('archiviert')
      ORDER BY o.planned_date, o.sort_order
    `).all(userId);
  } else {
    orders = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name, c.name AS cust_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.status NOT IN ('archiviert')
      ORDER BY o.planned_date, o.sort_order
    `).all();
  }
  res.json(orders.map(formatOrder));
});

// GET /api/orders/:id
router.get('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const o = db.prepare(`
    SELECT o.*, u.full_name AS assigned_name, c.name AS cust_name,
           c.address AS cust_address, c.contact_name AS cust_contact,
           cb.full_name AS created_by_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.assigned_to
    LEFT JOIN users cb ON cb.id = o.created_by
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  // Role check for monteur
  if (req.session.role === 'monteur' && o.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(req.params.id);
  const photos = db.prepare('SELECT * FROM order_photos WHERE order_id = ?').all(req.params.id);

  res.json({ ...formatOrder(o), attachments, photos });
});

// POST /api/orders  (planer + admin)
router.post('/', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const b = req.body;
  const orderNumber = genOrderNumber(db);

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, status, customer_id, customer_name, customer_address,
      installation_address, orderer, on_site_contact, arrival_time,
      planned_date, latest_date, work_types, notes_planer,
      assigned_to, created_by, sort_order
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    orderNumber,
    b.status || 'geplant',
    b.customer_id || null,
    b.customer_name || null,
    b.customer_address || null,
    b.installation_address || null,
    b.orderer || null,
    b.on_site_contact || null,
    b.arrival_time || null,
    b.planned_date || null,
    b.latest_date || null,
    JSON.stringify(b.work_types || []),
    b.notes_planer || null,
    b.assigned_to || null,
    req.session.userId,
    b.sort_order || 0
  );

  res.status(201).json(formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid)));
});

// PUT /api/orders/:id
router.put('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  const { role, userId } = req.session;
  const b = req.body;

  // Monteur can only update their own orders and only monteur fields
  if (role === 'monteur') {
    if (order.assigned_to !== userId) return res.status(403).json({ error: 'Keine Berechtigung' });
    db.prepare(`
      UPDATE orders SET
        executed_work = ?, items_table = ?, additional_material = ?,
        notes_monteur = ?, rings_data = ?, keys_data = ?,
        work_date = ?, work_time_from = ?, work_time_to = ?,
        technician_name = ?, technician_block = ?, signature_data = ?,
        agb_accepted = ?, status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      JSON.stringify(b.executed_work || []),
      JSON.stringify(b.items_table || []),
      JSON.stringify(b.additional_material || []),
      b.notes_monteur || null,
      JSON.stringify(b.rings_data || {}),
      JSON.stringify(b.keys_data || {}),
      b.work_date || null,
      b.work_time_from || null,
      b.work_time_to || null,
      b.technician_name || null,
      b.technician_block || null,
      b.signature_data || null,
      b.agb_accepted ? 1 : 0,
      b.status || order.status,
      req.params.id
    );
  } else {
    // Planer / Admin can update all fields
    db.prepare(`
      UPDATE orders SET
        status = ?, customer_id = ?, customer_name = ?, customer_address = ?,
        installation_address = ?, orderer = ?, on_site_contact = ?,
        arrival_time = ?, planned_date = ?, latest_date = ?,
        work_types = ?, notes_planer = ?, assigned_to = ?, sort_order = ?,
        executed_work = ?, items_table = ?, additional_material = ?,
        notes_monteur = ?, rings_data = ?, keys_data = ?,
        work_date = ?, work_time_from = ?, work_time_to = ?,
        technician_name = ?, technician_block = ?, signature_data = ?,
        agb_accepted = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.status || order.status,
      b.customer_id ?? order.customer_id,
      b.customer_name ?? order.customer_name,
      b.customer_address ?? order.customer_address,
      b.installation_address ?? order.installation_address,
      b.orderer ?? order.orderer,
      b.on_site_contact ?? order.on_site_contact,
      b.arrival_time ?? order.arrival_time,
      b.planned_date ?? order.planned_date,
      b.latest_date ?? order.latest_date,
      JSON.stringify(b.work_types ?? parseJSON(order.work_types, [])),
      b.notes_planer ?? order.notes_planer,
      b.assigned_to ?? order.assigned_to,
      b.sort_order ?? order.sort_order,
      JSON.stringify(b.executed_work ?? parseJSON(order.executed_work, [])),
      JSON.stringify(b.items_table ?? parseJSON(order.items_table, [])),
      JSON.stringify(b.additional_material ?? parseJSON(order.additional_material, [])),
      b.notes_monteur ?? order.notes_monteur,
      JSON.stringify(b.rings_data ?? parseJSON(order.rings_data, {})),
      JSON.stringify(b.keys_data ?? parseJSON(order.keys_data, {})),
      b.work_date ?? order.work_date,
      b.work_time_from ?? order.work_time_from,
      b.work_time_to ?? order.work_time_to,
      b.technician_name ?? order.technician_name,
      b.technician_block ?? order.technician_block,
      b.signature_data ?? order.signature_data,
      b.agb_accepted !== undefined ? (b.agb_accepted ? 1 : 0) : order.agb_accepted,
      req.params.id
    );
  }

  res.json(formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)));
});

// PATCH /api/orders/reorder  – update sort_order for monteur day view
router.patch('/reorder', requireRole('admin', 'planer'), (req, res) => {
  const { items } = req.body; // [{ id, sort_order }]
  const db = getDb();
  const update = db.prepare('UPDATE orders SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => items.forEach(({ id, sort_order }) => update.run(sort_order, id)));
  tx();
  res.json({ ok: true });
});

// DELETE /api/orders/:id (admin only)
router.delete('/:id', requireRole('admin'), (req, res) => {
  getDb().prepare("UPDATE orders SET status = 'archiviert' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// POST /api/orders/import  – Excel import (planer + admin)
router.post('/import', requireRole('admin', 'planer'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const db = getDb();
    const inserted = [];

    const tx = db.transaction(() => {
      rows.forEach(row => {
        const orderNumber = genOrderNumber(db);
        // Map common Excel column names (flexible)
        const planned_date = row['Montagedatum'] || row['planned_date'] || row['Datum'] || null;
        const customer_name = row['Kunde'] || row['customer_name'] || row['Kundenname'] || null;
        const installation_address = row['Montageadresse'] || row['installation_address'] || null;
        const orderer = row['Besteller'] || row['orderer'] || null;
        const notes_planer = row['Bemerkungen'] || row['notes'] || null;

        const result = db.prepare(`
          INSERT INTO orders (order_number, status, customer_name, installation_address,
            orderer, planned_date, notes_planer, created_by, work_types)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(orderNumber, 'geplant', customer_name, installation_address, orderer, planned_date, notes_planer, req.session.userId, '[]');

        inserted.push({ id: result.lastInsertRowid, order_number: orderNumber, customer_name });
      });
    });
    tx();

    res.json({ imported: inserted.length, orders: inserted });
  } catch (e) {
    res.status(422).json({ error: `Import-Fehler: ${e.message}` });
  }
});

module.exports = router;
