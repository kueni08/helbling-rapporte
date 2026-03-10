const router = require('express').Router();
const { getDb } = require('../lib/database');
const { requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── File Upload Setup ─────────────────────────────────────────────────────
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const anfrageDir = path.join(uploadsDir, 'anfragen');
if (!fs.existsSync(anfrageDir)) fs.mkdirSync(anfrageDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, anfrageDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf','.jpg','.jpeg','.png','.gif','.webp','.xlsx','.xls','.doc','.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── Helper ────────────────────────────────────────────────────────────────
function generateToken() { return uuidv4().replace(/-/g, ''); }

function formatInquiry(row) {
  if (!row) return null;
  return { ...row, bestehendes_system: Boolean(row.bestehendes_system) };
}

// ── POST /api/anfrage  – öffentliche Einreichung ──────────────────────────
router.post('/', upload.array('attachments', 10), (req, res) => {
  const b = req.body;

  const required = ['vorname', 'nachname', 'email', 'telefon', 'strasse', 'plz', 'ort'];
  for (const f of required) {
    if (!b[f] || !String(b[f]).trim()) {
      return res.status(400).json({ error: `Pflichtfeld fehlt: ${f}` });
    }
  }

  const db = getDb();
  const token = generateToken();

  const result = db.prepare(`
    INSERT INTO customer_inquiries (
      token,
      firma, vorname, nachname, email, telefon,
      strasse, plz, ort,
      objektart, anzahl_tueren,
      art_der_arbeit, anzahl_zylinder, anzahl_schluessel, bestehendes_system,
      wunschtermin, alternativtermin, terminpraeferenz,
      bemerkungen
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    token,
    b.firma || null,
    b.vorname.trim(),
    b.nachname.trim(),
    b.email.trim().toLowerCase(),
    b.telefon.trim(),
    b.strasse.trim(),
    b.plz.trim(),
    b.ort.trim(),
    b.objektart || null,
    b.anzahl_tueren ? parseInt(b.anzahl_tueren) : null,
    b.art_der_arbeit || null,
    b.anzahl_zylinder ? parseInt(b.anzahl_zylinder) : null,
    b.anzahl_schluessel ? parseInt(b.anzahl_schluessel) : null,
    b.bestehendes_system === 'true' || b.bestehendes_system === '1' || b.bestehendes_system === true ? 1 : 0,
    b.wunschtermin || null,
    b.alternativtermin || null,
    b.terminpraeferenz || null,
    b.bemerkungen || null
  );

  const inquiryId = result.lastInsertRowid;

  // Save uploaded attachments
  if (req.files && req.files.length > 0) {
    const insertAtt = db.prepare(
      'INSERT INTO anfrage_attachments (inquiry_id, filename, original_name, file_size) VALUES (?,?,?,?)'
    );
    req.files.forEach(f => insertAtt.run(inquiryId, f.filename, f.originalname, f.size));
  }

  res.status(201).json({ ok: true, id: inquiryId, token });
});

// ── GET /api/anfrage/token/:token  – öffentlicher Zugriff per Token ───────
router.get('/token/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customer_inquiries WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Formular nicht gefunden' });

  const attachments = db.prepare('SELECT id, original_name, file_size, created_at FROM anfrage_attachments WHERE inquiry_id = ?').all(row.id);

  // Get linked order status if exists
  let orderStatus = null;
  let orderDate = null;
  const linkedId = row.linked_order_id || row.converted_to_order_id;
  if (linkedId) {
    const order = db.prepare('SELECT status, planned_date FROM orders WHERE id = ?').get(linkedId);
    if (order) {
      orderStatus = order.status;
      orderDate = order.planned_date;
    }
  }

  res.json({ ...formatInquiry(row), attachments, orderStatus, orderDate });
});

// ── PUT /api/anfrage/token/:token  – Kunde bearbeitet eigenes Formular ────
router.put('/token/:token', upload.array('attachments', 10), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customer_inquiries WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Formular nicht gefunden' });
  if (row.status === 'erledigt') return res.status(400).json({ error: 'Formular bereits abgeschlossen' });

  const b = req.body;

  db.prepare(`
    UPDATE customer_inquiries SET
      firma = ?, vorname = ?, nachname = ?, email = ?, telefon = ?,
      strasse = ?, plz = ?, ort = ?,
      objektart = ?, anzahl_tueren = ?,
      art_der_arbeit = ?, anzahl_zylinder = ?, anzahl_schluessel = ?, bestehendes_system = ?,
      wunschtermin = ?, alternativtermin = ?, terminpraeferenz = ?,
      bemerkungen = ?,
      status = CASE WHEN status = 'versendet' THEN 'ausgefüllt' ELSE status END,
      updated_at = datetime('now')
    WHERE token = ?
  `).run(
    b.firma || null,
    (b.vorname || row.vorname).trim(),
    (b.nachname || row.nachname).trim(),
    (b.email || row.email).trim().toLowerCase(),
    (b.telefon || row.telefon).trim(),
    (b.strasse || row.strasse).trim(),
    (b.plz || row.plz).trim(),
    (b.ort || row.ort).trim(),
    b.objektart || null,
    b.anzahl_tueren ? parseInt(b.anzahl_tueren) : null,
    b.art_der_arbeit || null,
    b.anzahl_zylinder ? parseInt(b.anzahl_zylinder) : null,
    b.anzahl_schluessel ? parseInt(b.anzahl_schluessel) : null,
    b.bestehendes_system === 'true' || b.bestehendes_system === '1' || b.bestehendes_system === true ? 1 : 0,
    b.wunschtermin || null,
    b.alternativtermin || null,
    b.terminpraeferenz || null,
    b.bemerkungen || null,
    req.params.token
  );

  if (req.files && req.files.length > 0) {
    const insertAtt = db.prepare(
      'INSERT INTO anfrage_attachments (inquiry_id, filename, original_name, file_size) VALUES (?,?,?,?)'
    );
    req.files.forEach(f => insertAtt.run(row.id, f.filename, f.originalname, f.size));
  }

  res.json({ ok: true });
});

// ── GET /api/anfragen  – planer + admin (Liste) ───────────────────────────
router.get('/', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ci.*, o.status AS order_status, o.planned_date AS order_planned_date
    FROM customer_inquiries ci
    LEFT JOIN orders o ON o.id = COALESCE(ci.linked_order_id, ci.converted_to_order_id)
    ORDER BY CASE ci.status
      WHEN 'neu' THEN 0
      WHEN 'versendet' THEN 1
      WHEN 'ausgefüllt' THEN 2
      WHEN 'in_bearbeitung' THEN 3
      ELSE 4
    END, ci.created_at DESC
  `).all();
  res.json(rows);
});

// ── GET /api/anfragen/:id  – planer + admin (Detail) ─────────────────────
router.get('/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT ci.*, o.status AS order_status, o.planned_date AS order_planned_date, o.order_number
    FROM customer_inquiries ci
    LEFT JOIN orders o ON o.id = COALESCE(ci.linked_order_id, ci.converted_to_order_id)
    WHERE ci.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  const attachments = db.prepare('SELECT * FROM anfrage_attachments WHERE inquiry_id = ?').all(req.params.id);
  res.json({ ...formatInquiry(row), attachments });
});

// ── PUT /api/anfragen/:id  – Admin bearbeitet Anfrage ─────────────────────
router.put('/:id', requireRole('admin', 'planer'), (req, res) => {
  const b = req.body;
  const db = getDb();
  const row = db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  db.prepare(`
    UPDATE customer_inquiries SET
      firma = ?, vorname = ?, nachname = ?, email = ?, telefon = ?,
      strasse = ?, plz = ?, ort = ?,
      objektart = ?, anzahl_tueren = ?,
      art_der_arbeit = ?, anzahl_zylinder = ?, anzahl_schluessel = ?, bestehendes_system = ?,
      wunschtermin = ?, alternativtermin = ?, terminpraeferenz = ?,
      bemerkungen = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    b.firma ?? row.firma,
    (b.vorname ?? row.vorname),
    (b.nachname ?? row.nachname),
    (b.email ?? row.email),
    (b.telefon ?? row.telefon),
    (b.strasse ?? row.strasse),
    (b.plz ?? row.plz),
    (b.ort ?? row.ort),
    b.objektart ?? row.objektart,
    b.anzahl_tueren !== undefined ? (b.anzahl_tueren ? parseInt(b.anzahl_tueren) : null) : row.anzahl_tueren,
    b.art_der_arbeit ?? row.art_der_arbeit,
    b.anzahl_zylinder !== undefined ? (b.anzahl_zylinder ? parseInt(b.anzahl_zylinder) : null) : row.anzahl_zylinder,
    b.anzahl_schluessel !== undefined ? (b.anzahl_schluessel ? parseInt(b.anzahl_schluessel) : null) : row.anzahl_schluessel,
    b.bestehendes_system !== undefined ? (b.bestehendes_system ? 1 : 0) : row.bestehendes_system,
    b.wunschtermin ?? row.wunschtermin,
    b.alternativtermin ?? row.alternativtermin,
    b.terminpraeferenz ?? row.terminpraeferenz,
    b.bemerkungen ?? row.bemerkungen,
    req.params.id
  );

  res.json(formatInquiry(db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id)));
});

// ── PUT /api/anfragen/:id/status  – Status ändern ─────────────────────────
router.put('/:id/status', requireRole('admin', 'planer'), (req, res) => {
  const { status } = req.body;
  const valid = ['neu','versendet','ausgefüllt','in_bearbeitung','erledigt'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  const db = getDb();

  // Generate token if not present when sending
  if (status === 'versendet') {
    const row = db.prepare('SELECT token FROM customer_inquiries WHERE id = ?').get(req.params.id);
    if (!row.token) {
      db.prepare("UPDATE customer_inquiries SET token = ? WHERE id = ?").run(generateToken(), req.params.id);
    }
  }

  db.prepare(
    "UPDATE customer_inquiries SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, req.params.id);

  const updated = db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  res.json({ ok: true, token: updated.token });
});

// ── POST /api/anfragen/:id/generate-token  – Token generieren/zurückgeben ─
router.post('/:id/generate-token', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  let token = row.token;
  if (!token) {
    token = generateToken();
    db.prepare("UPDATE customer_inquiries SET token = ?, status = 'versendet', updated_at = datetime('now') WHERE id = ?").run(token, req.params.id);
  } else {
    db.prepare("UPDATE customer_inquiries SET status = CASE WHEN status = 'neu' THEN 'versendet' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  }

  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({ ok: true, token, url: `${baseUrl}/anfrage/f/${token}` });
});

// ── POST /api/anfragen/:id/link-order  – Anfrage mit Auftrag verknüpfen ───
router.post('/:id/link-order', requireRole('admin', 'planer'), (req, res) => {
  const { order_id } = req.body;
  const db = getDb();
  db.prepare(
    "UPDATE customer_inquiries SET linked_order_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(order_id || null, req.params.id);
  res.json({ ok: true });
});

// ── POST /api/anfragen/:id/convert  – Zu Auftrag konvertieren ────────────
router.post('/:id/convert', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const inquiry = db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  if (!inquiry) return res.status(404).json({ error: 'Anfrage nicht gefunden' });

  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${year}-%`);
  const seq = last ? (parseInt(last.order_number.split('-')[1]) + 1) : 1;
  const orderNumber = `${year}-${String(seq).padStart(4, '0')}`;

  const installAddress = `${inquiry.strasse}, ${inquiry.plz} ${inquiry.ort}`;
  const notesPlaner = [
    inquiry.objektart ? `Objektart: ${inquiry.objektart}` : null,
    inquiry.anzahl_tueren ? `Türen: ${inquiry.anzahl_tueren}` : null,
    inquiry.anzahl_zylinder ? `Zylinder (ca.): ${inquiry.anzahl_zylinder}` : null,
    inquiry.anzahl_schluessel ? `Schlüssel (ca.): ${inquiry.anzahl_schluessel}` : null,
    inquiry.bestehendes_system ? 'Bestehendes System: Ja' : null,
    inquiry.terminpraeferenz ? `Terminpräferenz: ${inquiry.terminpraeferenz}` : null,
    inquiry.bemerkungen ? `Kundennotiz: ${inquiry.bemerkungen}` : null,
  ].filter(Boolean).join('\n');

  const workTypeMap = {
    'Neuinstallation': 'montage',
    'Erweiterung': 'montage',
    'Reparatur': 'reparatur',
    'Service/Wartung': 'service',
  };
  const workTypes = inquiry.art_der_arbeit
    ? [workTypeMap[inquiry.art_der_arbeit] || 'sonstiges']
    : [];

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, status,
      customer_name, installation_address, orderer,
      on_site_contact, planned_date,
      work_types, notes_planer,
      created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    orderNumber, 'geplant',
    `${inquiry.vorname} ${inquiry.nachname}${inquiry.firma ? ` (${inquiry.firma})` : ''}`,
    installAddress,
    `${inquiry.vorname} ${inquiry.nachname}`,
    `${inquiry.vorname} ${inquiry.nachname} | ${inquiry.telefon} | ${inquiry.email}`,
    inquiry.wunschtermin || null,
    JSON.stringify(workTypes),
    notesPlaner || null,
    req.session.userId
  );

  db.prepare(
    "UPDATE customer_inquiries SET status = 'erledigt', converted_to_order_id = ?, linked_order_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.lastInsertRowid, result.lastInsertRowid, inquiry.id);

  res.json({ ok: true, order_id: result.lastInsertRowid, order_number: orderNumber });
});

// ── GET /api/anfragen/:id/attachment/:filename  – Anhang herunterladen ────
router.get('/:id/attachment/:filename', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM anfrage_attachments WHERE inquiry_id = ? AND filename = ?')
    .get(req.params.id, req.params.filename);
  if (!att) return res.status(404).json({ error: 'Datei nicht gefunden' });

  const filePath = path.join(anfrageDir, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  res.download(filePath, att.original_name);
});

// ── DELETE /api/anfragen/:id  – admin + planer ───────────────────────────
router.delete('/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  // Delete attached files
  const atts = db.prepare('SELECT filename FROM anfrage_attachments WHERE inquiry_id = ?').all(req.params.id);
  atts.forEach(a => {
    const fp = path.join(anfrageDir, a.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.prepare('DELETE FROM customer_inquiries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
