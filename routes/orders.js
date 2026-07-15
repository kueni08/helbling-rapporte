const router = require('express').Router();
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../lib/database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { sendCompletionEmail } = require('../lib/mailer');
const { FIELD_DEFINITIONS, allowedFields } = require('../lib/order-fields');

const upload = multer({ storage: multer.memoryStorage() });

function genOrderNumber(db) {
  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`${year}-%`);
  const seq = last ? (parseInt(last.order_number.split('-')[1]) + 1) : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

// Strip HTML tags from address fields (e.g. <br> → ", ") and normalize newlines
function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n|\r|\n/g, ', ')
    .replace(/,\s*,/g, ', ')
    .replace(/,\s*$/, '')
    .replace(/^\s*,\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Parse Swiss address "Strasse NR, PLZ ORT" → { strasse, plz, ort }
function parseAddress(raw) {
  const addr = stripHtml(raw);
  if (!addr) return { strasse: '', plz: '', ort: '' };
  // Look for 4-digit Swiss PLZ
  const m = addr.match(/(.+?),?\s*(\d{4})\s+([A-ZÄÖÜa-zäöü][^\n,]+)/);
  if (m) return { strasse: m[1].trim(), plz: m[2], ort: m[3].replace(/,.*$/, '').trim() };
  return { strasse: addr, plz: '', ort: '' };
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
    extra_material:     parseJSON(o.extra_material, []),
    rings_data:         parseJSON(o.rings_data, {}),
    keys_data:          parseJSON(o.keys_data, {}),
    work_sessions:      parseJSON(o.work_sessions, []),
  };
}

// ── Tagesübersicht ────────────────────────────────────────────────────────
// GET /api/orders/tagesuebersicht?date=YYYY-MM-DD[&technicianId=ID]
router.get('/tagesuebersicht', requireLogin, (req, res) => {
  const db = getDb();
  const { userRole: role, userId } = req.session;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  let rows;
  if (role === 'monteur') {
    rows = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE o.assigned_to = ?
        AND (o.work_date = ? OR o.planned_date = ?)
        AND o.status != 'archiviert'
      ORDER BY o.work_time_from, o.sort_order
    `).all(userId, date, date);
  } else {
    const techId = req.query.technicianId ? parseInt(req.query.technicianId) : null;
    let sql = `
      SELECT o.*, u.full_name AS assigned_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE (o.work_date = ? OR o.planned_date = ?)
        AND o.status != 'archiviert'`;
    const params = [date, date];
    if (techId) { sql += ' AND o.assigned_to = ?'; params.push(techId); }
    sql += ' ORDER BY u.full_name, o.work_time_from, o.sort_order';
    rows = db.prepare(sql).all(...params);
  }

  const technicians = db.prepare("SELECT id, full_name FROM users WHERE role='monteur' AND active=1 ORDER BY full_name").all();

  const result = rows.map(o => {
    const workFrom = o.work_time_from || null;
    const workTo   = o.work_time_to   || null;
    let durationH  = null;
    if (workFrom && workTo) {
      const [fh, fm] = workFrom.split(':').map(Number);
      const [th, tm] = workTo.split(':').map(Number);
      durationH = Math.round(((th * 60 + tm) - (fh * 60 + fm)) / 60 * 100) / 100;
    }
    return {
      id:               o.id,
      order_number:     o.order_number,
      status:           o.status,
      customer_name:    o.customer_name,
      installation_address: o.installation_address,
      technician_name:  o.assigned_name || o.technician_name,
      work_date:        o.work_date     || o.planned_date,
      work_time_from:   workFrom,
      work_time_to:     workTo,
      duration_h:       durationH,
      travel_time:      o.travel_time,
      travel_km:        o.travel_km,
      executed_work:    parseJSON(o.executed_work, []),
      notes_monteur:    o.notes_monteur,
    };
  });

  res.json({ date, rows: result, technicians });
});

// GET /api/orders/tagesuebersicht/export  – Excel
router.get('/tagesuebersicht/export', requireLogin, (req, res) => {
  const db = getDb();
  const { userRole: role, userId } = req.session;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  let rows;
  if (role === 'monteur') {
    rows = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE o.assigned_to = ? AND (o.work_date = ? OR o.planned_date = ?)
        AND o.status != 'archiviert' ORDER BY o.work_time_from, o.sort_order
    `).all(userId, date, date);
  } else {
    const techId = req.query.technicianId ? parseInt(req.query.technicianId) : null;
    let sql = `SELECT o.*, u.full_name AS assigned_name FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE (o.work_date = ? OR o.planned_date = ?) AND o.status != 'archiviert'`;
    const params = [date, date];
    if (techId) { sql += ' AND o.assigned_to = ?'; params.push(techId); }
    sql += ' ORDER BY u.full_name, o.work_time_from, o.sort_order';
    rows = db.prepare(sql).all(...params);
  }
  const data = rows.map(o => {
    const workFrom = o.work_time_from;
    const workTo   = o.work_time_to;
    let durationH  = null;
    if (workFrom && workTo) {
      const [fh, fm] = workFrom.split(':').map(Number);
      const [th, tm] = workTo.split(':').map(Number);
      durationH = Math.round(((th*60+tm)-(fh*60+fm))/60*100)/100;
    }
    return {
      'Techniker':         o.assigned_name || o.technician_name || '',
      'Datum':             o.work_date || o.planned_date || '',
      'Auftragsnummer':    o.order_number || '',
      'Kunde':             o.customer_name || '',
      'Montageadresse':    o.installation_address || '',
      'Von':               workFrom || '',
      'Bis':               workTo   || '',
      'Dauer (Std.)':      durationH || '',
      'Fahrzeit (Std.)':   o.travel_time || '',
      'Kilometer':         o.travel_km   || '',
      'Ausgeführte Arbeiten': (parseJSON(o.executed_work,[])).join(', '),
      'Bemerkungen':       o.notes_monteur || '',
      'Status':            o.status,
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, `Tag_${date}`);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tagesuebersicht_${date}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ── Excel Export ─────────────────────────────────────────────────────────
// GET /api/orders/export  (planer + admin)
router.get('/export', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const { status, from, to } = req.query;
  let sql = `SELECT o.*, u.full_name AS assigned_name FROM orders o
             LEFT JOIN users u ON u.id = o.assigned_to
             WHERE o.status != 'archiviert'`;
  const params = [];
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  if (from)   { sql += ` AND o.planned_date >= ?`; params.push(from); }
  if (to)     { sql += ` AND o.planned_date <= ?`; params.push(to); }
  sql += ` ORDER BY o.planned_date DESC`;
  const rows = db.prepare(sql).all(...params);

  const data = rows.map(o => ({
    'Auftragsnummer':     o.order_number,
    'Projektnummer':      o.project_number || '',
    'Status':             o.status,
    'Kunde':              o.customer_name,
    'Kundenadresse':      o.customer_address,
    'Montageadresse':     o.installation_address,
    'Besteller':          o.orderer,
    'Kontakt vor Ort':    o.on_site_contact,
    'Montagedatum':       o.planned_date,
    'Sp\u00e4testes Datum':     o.latest_date,
    'Arbeit':             (parseJSON(o.work_types, [])).join(', '),
    'Techniker':          o.assigned_name || o.technician_name,
    'Arbeitsdatum':       o.work_date,
    'Arbeitszeit von':    o.work_time_from,
    'Arbeitszeit bis':    o.work_time_to,
    'Fahrzeit (Std.)':    o.travel_time,
    'Kilometer':          o.travel_km,
    'Bemerkungen Planer': o.notes_planer,
    'Bemerkungen Monteur':o.notes_monteur,
    'Material':           (parseJSON(o.items_table, [])).map(i => `${i.quantity}x ${i.name}`).join('; '),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Auftr\u00e4ge');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="auftraege_export.xlsx"');
  res.send(Buffer.from(buf));
});

// GET /api/orders/import-template  (planer + admin)
// ?format=standard für einfaches Format, default = ERPNext Lieferschein-Format
router.get('/import-template', requireRole('admin', 'planer'), (req, res) => {
  const wb = XLSX.utils.book_new();

  if (req.query.format === 'standard') {
    // ── Standard-Format Vorlage ────────────────────────────────────────
    const headers = [
      'Kunde', 'Montageadresse', 'Besteller', 'Datum', 'Reihenfolge',
      'Bemerkungen Planer', 'Ausz\u00fchrende Arbeiten', 'Techniker', 'Projekt'
    ];
    const example = [
      'Muster GmbH', 'Musterstrasse 1, 8001 Z\u00fcrich', 'Max Muster',
      '15.06.2025', '1', 'Zylinder mitbringen', 'montage', 'Hans M\u00fcller', 'P-001'
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    XLSX.utils.book_append_sheet(wb, ws, 'Standard');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="import_standard_vorlage.xlsx"');
    return res.send(Buffer.from(buf));
  }

  // ── ERPNext Lieferschein-Format Vorlage ──────────────────────────────
  const headers = [
    'ID', 'Nummernkreis', 'Kunde', 'Abteilung', 'Datum', 'Buchungszeit',
    'Unternehmen', 'W\u00e4hrung', 'Wechselkurs', 'Preisliste', 'Preislistenw\u00e4hrung',
    'Preislisten-Wechselkurs', 'Kontaktperson des Unternehmens', 'Status',
    'Rechnungsadresse', 'Anweisungen', 'Projekt',
    'Bemerkungen Planer', 'Ausz\u00fchrende Arbeiten', 'Techniker', 'Reihenfolge',
    'ID (Lieferschein-Artikel)', 'Anzahl (Lieferschein-Artikel)',
    'Artikel-Code (Lieferschein-Artikel)', 'Artikelname (Lieferschein-Artikel)',
    'Einheit (Lieferschein-Artikel)', 'Lagerma\u00dfeinheit (Lieferschein-Artikel)',
    'Ma\u00dfeinheit-Umrechnungsfaktor (Lieferschein-Artikel)'
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, 'Vorlage');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="import_vorlage.xlsx"');
  res.send(Buffer.from(buf));
});

// GET /api/orders
router.get('/', requireLogin, (req, res) => {
  const db = getDb();
  const { userRole: role, userId } = req.session;
  let orders;
  if (role === 'monteur') {
    orders = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name, c.name AS cust_name,
        (SELECT COUNT(*) FROM order_attachments WHERE order_id = o.id) AS attachment_count,
        (SELECT COUNT(*) FROM order_photos WHERE order_id = o.id) AS photo_count
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.assigned_to = ? AND o.status NOT IN ('archiviert')
      ORDER BY o.planned_date, o.sort_order
    `).all(userId);
  } else {
    orders = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name, c.name AS cust_name,
        (SELECT COUNT(*) FROM order_attachments WHERE order_id = o.id) AS attachment_count,
        (SELECT COUNT(*) FROM order_photos WHERE order_id = o.id) AS photo_count
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
  if (req.session.userRole === 'monteur' && o.assigned_to !== req.session.userId) {
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
      installation_address, orderer, on_site_contact, on_site_contact_phone, arrival_time,
      planned_date, latest_date, work_types, notes_planer,
      assigned_to, created_by, sort_order, project_number, zylinder_status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    orderNumber,
    b.status || 'geplant',
    b.customer_id || null,
    b.customer_name || null,
    b.customer_address || null,
    b.installation_address || null,
    b.orderer || null,
    b.on_site_contact || null,
    b.on_site_contact_phone || null,
    b.arrival_time || null,
    b.planned_date || null,
    b.latest_date || null,
    JSON.stringify(b.work_types || []),
    b.notes_planer || null,
    b.assigned_to || null,
    req.session.userId,
    b.sort_order || 0,
    b.project_number || null,
    b.zylinder_status || null
  );

  res.status(201).json(formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid)));
});

// PUT /api/orders/:id
router.put('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  const { userRole: role, userId } = req.session;
  const b = req.body;
  const permitted = allowedFields(role);
  const forbidden = Object.keys(b).filter(key => FIELD_DEFINITIONS[key] && !permitted.has(key));
  if (forbidden.length) return res.status(403).json({ error: `Keine Berechtigung für: ${forbidden.join(', ')}` });

  // Monteur can only update their own orders and only monteur fields
  if (role === 'monteur') {
    if (order.assigned_to !== userId) return res.status(403).json({ error: 'Keine Berechtigung' });
    // Use !== undefined so partial updates (e.g. timer-only saves) don't overwrite other fields
    db.prepare(`
      UPDATE orders SET
        executed_work = ?, items_table = ?, additional_material = ?,
        extra_material = ?, extra_aufwand = ?, extra_argumentation = ?,
        notes_monteur = ?, rings_data = ?, keys_data = ?,
        work_date = ?, work_time_from = ?, work_time_to = ?,
        work_sessions = ?,
        travel_time = ?, travel_km = ?,
        technician_name = ?, technician_block = ?, signature_data = ?,
        agb_accepted = ?, status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.executed_work !== undefined ? JSON.stringify(b.executed_work) : order.executed_work,
      b.items_table !== undefined ? JSON.stringify(b.items_table) : order.items_table,
      b.additional_material !== undefined ? JSON.stringify(b.additional_material) : order.additional_material,
      b.extra_material !== undefined ? JSON.stringify(b.extra_material) : order.extra_material,
      b.extra_aufwand !== undefined ? (b.extra_aufwand != null ? parseFloat(b.extra_aufwand) || null : null) : order.extra_aufwand,
      b.extra_argumentation !== undefined ? (b.extra_argumentation || null) : order.extra_argumentation,
      b.notes_monteur !== undefined ? (b.notes_monteur || null) : order.notes_monteur,
      b.rings_data !== undefined ? JSON.stringify(b.rings_data) : order.rings_data,
      b.keys_data !== undefined ? JSON.stringify(b.keys_data) : order.keys_data,
      b.work_date !== undefined ? (b.work_date || null) : order.work_date,
      b.work_time_from !== undefined ? (b.work_time_from || null) : order.work_time_from,
      b.work_time_to !== undefined ? (b.work_time_to || null) : order.work_time_to,
      b.work_sessions !== undefined ? JSON.stringify(b.work_sessions) : order.work_sessions,
      b.travel_time !== undefined ? (b.travel_time != null ? parseFloat(b.travel_time) || null : null) : order.travel_time,
      b.travel_km !== undefined ? (b.travel_km != null ? parseInt(b.travel_km) || null : null) : order.travel_km,
      b.technician_name !== undefined ? (b.technician_name || null) : order.technician_name,
      b.technician_block !== undefined ? (b.technician_block || null) : order.technician_block,
      b.signature_data !== undefined ? (b.signature_data || null) : order.signature_data,
      b.agb_accepted !== undefined ? (b.agb_accepted ? 1 : 0) : order.agb_accepted,
      b.status !== undefined ? (b.status || order.status) : order.status,
      req.params.id
    );
  } else {
    // Planer / Admin can update all fields
    db.prepare(`
      UPDATE orders SET
        status = ?, customer_id = ?, customer_name = ?, customer_address = ?,
        installation_address = ?, orderer = ?, on_site_contact = ?, on_site_contact_phone = ?,
        arrival_time = ?, planned_date = ?, latest_date = ?, earliest_delivery_date = ?, zylinder_status = ?,
        work_types = ?, notes_planer = ?, assigned_to = ?, sort_order = ?,
        project_number = ?, ls_number = ?,
        executed_work = ?, items_table = ?, additional_material = ?,
        extra_material = ?, extra_aufwand = ?, extra_argumentation = ?,
        notes_monteur = ?, rings_data = ?, keys_data = ?,
        work_date = ?, work_time_from = ?, work_time_to = ?,
        work_sessions = ?,
        travel_time = ?, travel_km = ?,
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
      b.on_site_contact_phone !== undefined ? b.on_site_contact_phone || null : order.on_site_contact_phone,
      b.arrival_time ?? order.arrival_time,
      b.planned_date ?? order.planned_date,
      b.latest_date ?? order.latest_date,
      b.earliest_delivery_date !== undefined ? b.earliest_delivery_date || null : order.earliest_delivery_date,
      b.zylinder_status !== undefined ? b.zylinder_status || null : order.zylinder_status,
      JSON.stringify(b.work_types ?? parseJSON(order.work_types, [])),
      b.notes_planer ?? order.notes_planer,
      b.assigned_to ?? order.assigned_to,
      b.sort_order ?? order.sort_order,
      b.project_number !== undefined ? b.project_number || null : order.project_number,
      b.ls_number !== undefined ? b.ls_number || null : order.ls_number,
      JSON.stringify(b.executed_work ?? parseJSON(order.executed_work, [])),
      JSON.stringify(b.items_table ?? parseJSON(order.items_table, [])),
      JSON.stringify(b.additional_material ?? parseJSON(order.additional_material, [])),
      JSON.stringify(b.extra_material ?? parseJSON(order.extra_material, [])),
      b.extra_aufwand != null ? parseFloat(b.extra_aufwand) || null : order.extra_aufwand,
      b.extra_argumentation !== undefined ? b.extra_argumentation || null : order.extra_argumentation,
      b.notes_monteur ?? order.notes_monteur,
      JSON.stringify(b.rings_data ?? parseJSON(order.rings_data, {})),
      JSON.stringify(b.keys_data ?? parseJSON(order.keys_data, {})),
      b.work_date ?? order.work_date,
      b.work_time_from ?? order.work_time_from,
      b.work_time_to ?? order.work_time_to,
      JSON.stringify(b.work_sessions ?? parseJSON(order.work_sessions, [])),
      b.travel_time != null ? parseFloat(b.travel_time) || null : order.travel_time,
      b.travel_km != null ? parseInt(b.travel_km) || null : order.travel_km,
      b.technician_name ?? order.technician_name,
      b.technician_block ?? order.technician_block,
      order.signature_data,
      b.agb_accepted !== undefined ? (b.agb_accepted ? 1 : 0) : order.agb_accepted,
      req.params.id
    );
  }

  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const changes = {};
  for (const [key, value] of Object.entries(b)) {
    if (!FIELD_DEFINITIONS[key]) continue;
    const before = order[key];
    const after = updatedOrder[key];
    if (String(before ?? '') !== String(after ?? '')) changes[key] = { label: FIELD_DEFINITIONS[key].label, before, after };
  }
  if (Object.keys(changes).length) db.prepare(`INSERT INTO order_change_log (order_id,user_id,user_role,changes_json) VALUES (?,?,?,?)`)
    .run(req.params.id, userId, role, JSON.stringify(changes));
  res.json(formatOrder(updatedOrder));

  // Abschluss-Mail automatisch versenden wenn Status neu auf "abgeschlossen" gesetzt
  const newStatus = (role === 'monteur' ? b.status : b.status) || order.status;
  if (newStatus === 'abgeschlossen' && order.status !== 'abgeschlossen') {
    sendCompletionEmail(req.params.id).catch(e =>
      console.error('[Mailer] sendCompletionEmail Fehler:', e.message)
    );
  }

});

// PATCH /api/orders/bulk-status  – set status for multiple orders (planer + admin only)
router.patch('/bulk-status', requireRole('admin', 'planer'), (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || !ids.length || !status) {
    return res.status(400).json({ error: 'ids (Array) und status erforderlich' });
  }
  const allowed = ['geplant','in_bearbeitung','abgeschlossen','abgerechnet','archiviert'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
  ).run(status, ...ids);
  res.json({ ok: true, updated: result.changes });
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

// PATCH /api/orders/:id/notes  – append nachtrag to monteur notes (all roles)
router.patch('/:id/notes', requireLogin, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  if (req.session.userRole === 'monteur' && order.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  db.prepare("UPDATE orders SET notes_monteur = ?, updated_at = datetime('now') WHERE id = ?")
    .run(req.body.notes_monteur || null, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/signature', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT signature_data FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  db.prepare("UPDATE orders SET signature_data=NULL, agb_accepted=0, updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.prepare(`INSERT INTO order_change_log (order_id,user_id,user_role,action,changes_json) VALUES (?,?,?,?,?)`)
    .run(req.params.id, req.session.userId, req.session.userRole, 'signature_deleted', JSON.stringify({ signature_data: { label: 'Kundenunterschrift', before: '[vorhanden]', after: null } }));
  res.json({ ok: true });
});

router.get('/:id/history', requireRole('admin', 'planer'), (req, res) => {
  const rows = getDb().prepare(`SELECT l.*, u.full_name AS user_name FROM order_change_log l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.order_id=? ORDER BY l.created_at DESC, l.id DESC`).all(req.params.id);
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes_json || '{}') })));
});

// DELETE /api/orders/:id (admin + planer)
router.delete('/:id', requireRole('admin', 'planer'), (req, res) => {
  getDb().prepare("UPDATE orders SET status = 'archiviert' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// POST /api/orders/:id/customer-form  – Kunden-Link für Auftrag generieren
router.post('/:id/customer-form', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  // Check if already linked inquiry exists
  const existing = db.prepare(
    'SELECT id, token FROM customer_inquiries WHERE linked_order_id = ? OR converted_to_order_id = ? LIMIT 1'
  ).get(order.id, order.id);

  if (existing && existing.token) {
    const baseUrl = req.protocol + '://' + req.get('host');
    return res.json({ ok: true, token: existing.token, url: `${baseUrl}/anfrage/f/${existing.token}`, inquiry_id: existing.id });
  }

  // Parse customer_name into vorname/nachname
  const nameParts = (order.customer_name || 'Kunde').trim().split(/\s+/);
  const vorname = nameParts.length > 1 ? nameParts[0] : '';
  const nachname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0];

  // Parse installation_address
  const { strasse, plz, ort } = parseAddress(order.installation_address || '');
  const token = uuidv4().replace(/-/g, '');

  const result = db.prepare(`
    INSERT INTO customer_inquiries (
      token, status,
      vorname, nachname, email, telefon,
      strasse, plz, ort,
      linked_order_id,
      bemerkungen
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    token, 'versendet',
    vorname, nachname, '', '',
    strasse || order.installation_address || '', plz || '', ort || '',
    order.id,
    `Auftrag: ${order.order_number || order.id}`
  );

  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({ ok: true, token, url: `${baseUrl}/anfrage/f/${token}`, inquiry_id: result.lastInsertRowid });
});

// POST /api/orders/import  – Excel import (planer + admin)
// Unterstützt Standard-Format und Lieferschein-Format (ERPNext)
router.post('/import', requireRole('admin', 'planer'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const db = getDb();
    const inserted = [];

    // Detect Lieferschein-Format: has column "ID (Lieferschein-Artikel)" or "Artikel-Code (Lieferschein-Artikel)"
    const isLS = rows.length > 0 && (
      'ID (Lieferschein-Artikel)' in rows[0] ||
      'Artikel-Code (Lieferschein-Artikel)' in rows[0]
    );

    // Datum-Parsing: unterstützt YYYY-MM-DD, dd.mm.yyyy und Excel-Zahlen
    function parseImportDate(rawDate) {
      if (!rawDate) return null;
      if (typeof rawDate === 'number') {
        const d = XLSX.SSF.parse_date_code(rawDate);
        return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      }
      const s = String(rawDate).trim().substring(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      return null;
    }

    // Techniker-Name → user.id Lookup (cached)
    const techLookupCache = {};
    function resolveTechnician(name) {
      if (!name) return null;
      const key = name.trim().toLowerCase();
      if (key in techLookupCache) return techLookupCache[key];
      const user = db.prepare("SELECT id FROM users WHERE lower(full_name) = ? AND role = 'monteur' AND active = 1").get(key);
      techLookupCache[key] = user?.id || null;
      return techLookupCache[key];
    }

    const tx = db.transaction(() => {
      if (isLS) {
        // ── Lieferschein-Format (ERPNext) ────────────────────────────────
        const orders = [];
        let current = null;

        rows.forEach(row => {
          const orderId = String(row['ID'] || '').trim();

          if (orderId) {
            // New order header row
            const workTypesRaw = String(row['Auszuführende Arbeiten'] || row['Arbeit'] || '').trim();
            current = {
              source_id: orderId,
              customer_name: String(row['Kunde'] || row['Kundenname'] || row['Unternehmen'] || '').trim() || null,
              orderer: String(row['Kontaktperson des Unternehmens'] || '').trim() || null,
              on_site_contact: String(row['Kontakt'] || '').trim() || null,
              installation_address: stripHtml(row['Anweisungen'] || row['Lieferadresse'] || ''),
              customer_address: stripHtml(row['Rechnungsadresse'] || ''),
              planned_date: parseImportDate(row['Datum']),
              abteilung: String(row['Abteilung'] || '').trim(),
              project_number: String(row['Projekt'] || '').trim() || null,
              notes_planer: String(row['Bemerkungen Planer'] || row['Notizen'] || '').trim() || null,
              work_types: workTypesRaw ? workTypesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
              assigned_to: resolveTechnician(row['Techniker'] || ''),
              sort_order: parseInt(row['Reihenfolge']) || 0,
              items: []
            };
            orders.push(current);
          }

          if (!current) return; // No header yet, skip

          // Collect article from this row (present in both header and continuation rows)
          const artCode = String(row['Artikel-Code (Lieferschein-Artikel)'] || '').trim();
          const artName = String(row['Artikelname (Lieferschein-Artikel)'] || '').trim();
          const qty = parseFloat(String(row['Anzahl (Lieferschein-Artikel)']).replace(',', '.')) || 1;
          const unit = String(row['Einheit (Lieferschein-Artikel)'] || 'Stk.').trim() || 'Stk.';

          if (artCode || artName) {
            current.items.push({
              name: artName || artCode,
              article_number: artCode || null,
              quantity: qty,
              unit,
              _source: 'planer'
            });
          }
        });

        orders.forEach(orderData => {
          const orderNumber = genOrderNumber(db);

          const result = db.prepare(`
            INSERT INTO orders (
              order_number, status, customer_name, customer_address,
              installation_address, orderer, on_site_contact,
              planned_date, notes_planer, items_table, created_by, work_types,
              project_number, ls_number, assigned_to, sort_order
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            orderNumber, 'geplant',
            orderData.customer_name,
            orderData.customer_address || null,
            orderData.installation_address || null,
            orderData.orderer || null,
            orderData.on_site_contact || null,
            orderData.planned_date,
            orderData.notes_planer,
            JSON.stringify(orderData.items),
            req.session.userId,
            JSON.stringify(orderData.work_types),
            orderData.project_number,
            orderData.source_id || null,
            orderData.assigned_to,
            orderData.sort_order
          );
          inserted.push({ id: result.lastInsertRowid, order_number: orderNumber, project_number: orderData.project_number, customer_name: orderData.customer_name, items: orderData.items.length });
        });

      } else {
        // ── Standard-Format ─────────────────────────────────────────────
        rows.forEach(row => {
          const orderNumber = genOrderNumber(db);
          const planned_date = parseImportDate(row['Datum'] || row['Montagedatum'] || row['planned_date'] || null);
          const customer_name = row['Kunde'] || row['customer_name'] || row['Kundenname'] || null;
          const installation_address = row['Montageadresse'] || row['Anweisungen'] || row['installation_address'] || null;
          const orderer = row['Besteller'] || row['orderer'] || null;
          const notes_planer = row['Bemerkungen Planer'] || row['Bemerkungen'] || row['notes'] || null;
          const project_number = row['Projekt'] || row['Projektnummer'] || null;
          const sort_order = parseInt(row['Reihenfolge']) || 0;
          const workTypesRaw = String(row['Auszuführende Arbeiten'] || row['Arbeit'] || '').trim();
          const work_types = workTypesRaw ? workTypesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
          const assigned_to = resolveTechnician(row['Techniker'] || '');

          const result = db.prepare(`
            INSERT INTO orders (order_number, status, customer_name, installation_address,
              orderer, planned_date, notes_planer, created_by, work_types, project_number,
              assigned_to, sort_order)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(orderNumber, 'geplant', customer_name, installation_address, orderer,
            planned_date, notes_planer, req.session.userId, JSON.stringify(work_types),
            project_number || null, assigned_to, sort_order);

          inserted.push({ id: result.lastInsertRowid, order_number: orderNumber, customer_name });
        });
      }
    });
    tx();

    res.json({ imported: inserted.length, orders: inserted });
  } catch (e) {
    res.status(422).json({ error: `Import-Fehler: ${e.message}` });
  }
});

module.exports = router;
