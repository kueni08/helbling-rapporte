'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');
const { formatSwissAddress } = require('../lib/address');
const { newCsrfToken, requireCustomer, requireCustomerCsrf, customerCanEdit } = require('../middleware/customer-portal-auth');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
const ALLOWED_FACADES = new Set(['mauerwerk_beton', 'isolation_verputz', 'blechfassade', 'unbekannt']);
const ALLOWED_UPDATE_FIELDS = new Set([
  'project_number', 'installation_name', 'installation_street', 'installation_postal_code', 'installation_city',
  'on_site_contact', 'on_site_contact_phone', 'on_site_contact_email', 'customer_term_option', 'customer_term_from',
  'customer_power_available', 'customer_power_notes', 'customer_parking_available',
  'customer_parking_permit_required', 'customer_access_permit_required', 'customer_restricted_hours',
  'customer_additional_boxes', 'facade_types', 'customer_notes'
]);
const FORBIDDEN_FIELDS = new Set([
  'customer_id', 'customer_name', 'status', 'assigned_to', 'sort_order', 'notes_planer', 'notes_monteur',
  'work_types', 'items_table', 'executed_work', 'signature_data', 'customer_edit_locked',
  'customer_portal_status', 'customer_portal_visible', 'customer_created_by', 'created_by'
]);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

function clean(value, max = 500) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function boolOrNull(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

function generatePortalOrderNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `KP-${year}-`;
  const last = db.prepare('SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`);
  const sequence = last ? (parseInt(last.order_number.slice(prefix.length), 10) || 0) + 1 : 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

function portalOrderWhere() {
  return `o.id=? AND o.customer_id=? AND o.customer_portal_visible=1 AND o.status!='archiviert'`;
}

function getPortalOrder(db, orderId, customerId) {
  return db.prepare(`SELECT o.* FROM orders o WHERE ${portalOrderWhere()}`).get(orderId, customerId);
}

function photoRows(db, orderId) {
  return db.prepare(`SELECT id, original_name, photo_type, created_at FROM order_photos
    WHERE order_id=? AND customer_visible=1 ORDER BY id`).all(orderId).map(p => ({
      id: p.id, original_name: p.original_name, photo_type: p.photo_type,
      created_at: p.created_at, url: `/api/kundenportal/orders/${orderId}/photos/${p.id}`,
    }));
}

function attachmentRows(db, orderId) {
  return db.prepare(`SELECT id, original_name, file_type, created_at FROM order_attachments
    WHERE order_id=? AND customer_visible=1 ORDER BY id`).all(orderId).map(a => ({
      id: a.id, original_name: a.original_name, file_type: a.file_type,
      created_at: a.created_at, url: `/api/kundenportal/orders/${orderId}/attachments/${a.id}`,
    }));
}

function portalOrderResponse(db, row, includeFiles = false) {
  const response = {
    id: row.id,
    order_number: row.order_number,
    portal_status: row.customer_portal_status || 'in_erfassung',
    editable: customerCanEdit(row),
    project_number: row.project_number || '',
    object_name: row.installation_name || '',
    street: row.installation_street || '',
    postal_code: row.installation_postal_code || '',
    city: row.installation_city || '',
    contact_name: row.on_site_contact || '',
    contact_phone: row.on_site_contact_phone || '',
    contact_email: row.on_site_contact_email || '',
    term_option: row.customer_term_option || '',
    term_from: row.customer_term_from || '',
    planned_date: row.planned_date || null,
    power_available: row.customer_power_available,
    power_notes: row.customer_power_notes || '',
    parking_available: row.customer_parking_available,
    parking_permit_required: row.customer_parking_permit_required,
    access_permit_required: row.customer_access_permit_required,
    restricted_hours: row.customer_restricted_hours || '',
    additional_boxes: row.customer_additional_boxes,
    facade_types: JSON.parse(row.facade_types_json || '[]'),
    notes: row.customer_notes || '',
    updated_at: row.updated_at,
  };
  if (includeFiles) {
    response.photos = photoRows(db, row.id);
    response.attachments = attachmentRows(db, row.id);
  }
  return response;
}

function logCustomerChange(db, orderId, portalUserId, changes, action = 'update') {
  if (!Object.keys(changes).length) return;
  db.prepare(`INSERT INTO order_change_log
    (order_id, portal_user_id, user_role, action, changes_json) VALUES (?,?,'kunde',?,?)`)
    .run(orderId, portalUserId, action, JSON.stringify(changes));
}

function editableOrderOr404(req, res) {
  const order = getPortalOrder(getDb(), req.params.id, req.session.customerId);
  if (!order) { res.status(404).json({ error: 'Auftrag nicht gefunden' }); return null; }
  if (!customerCanEdit(order)) { res.status(423).json({ error: 'Dieser Auftrag ist für die Bearbeitung gesperrt' }); return null; }
  return order;
}

router.post('/login', async (req, res) => {
  const email = clean(req.body.email, 200)?.toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'E-Mail-Adresse und Passwort erforderlich' });
  const key = `${req.ip}:${email}`;
  const recent = (loginAttempts.get(key) || []).filter(ts => Date.now() - ts < LOGIN_WINDOW_MS);
  if (recent.length >= 5) return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM customer_portal_users WHERE email=? COLLATE NOCASE').get(email);
  const locked = user?.locked_until && new Date(`${user.locked_until}Z`).getTime() > Date.now();
  const valid = user && user.active && !locked && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recent.push(Date.now()); loginAttempts.set(key, recent);
    if (user) {
      const failures = (user.failed_login_count || 0) + 1;
      const until = failures >= 5 ? new Date(Date.now() + LOGIN_WINDOW_MS).toISOString().slice(0, 19).replace('T', ' ') : null;
      db.prepare('UPDATE customer_portal_users SET failed_login_count=?, locked_until=? WHERE id=?').run(failures, until, user.id);
    }
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  loginAttempts.delete(key);
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.customerPortalUserId = user.id;
  req.session.customerId = user.customer_id;
  req.session.customerPortalCsrf = newCsrfToken();
  db.prepare("UPDATE customer_portal_users SET failed_login_count=0, locked_until=NULL, last_login_at=datetime('now') WHERE id=?").run(user.id);
  res.json({ ok: true, csrfToken: req.session.customerPortalCsrf, mustChangePassword: Boolean(user.must_change_password) });
});

router.post('/logout', requireCustomer, requireCustomerCsrf, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireCustomer, (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id, name FROM customers WHERE id=?').get(req.session.customerId);
  if (!req.session.customerPortalCsrf) req.session.customerPortalCsrf = newCsrfToken();
  const u = req.customerPortalUser;
  res.json({
    id: u.id, username: u.username, fullName: u.full_name, email: u.email, phone: u.phone,
    customer, mustChangePassword: Boolean(u.must_change_password), csrfToken: req.session.customerPortalCsrf,
  });
});

router.put('/password', requireCustomer, requireCustomerCsrf, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: 'Passwort: mindestens 12 Zeichen, Gross-/Kleinbuchstaben und Zahl' });
  }
  const hash = await bcrypt.hash(password, 12);
  getDb().prepare("UPDATE customer_portal_users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?")
    .run(hash, req.customerPortalUser.id);
  res.json({ ok: true });
});

router.get('/orders', requireCustomer, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT o.* FROM orders o WHERE o.customer_id=? AND o.customer_portal_visible=1
    AND o.status!='archiviert' ORDER BY o.updated_at DESC, o.id DESC`).all(req.session.customerId);
  res.json(rows.map(row => portalOrderResponse(db, row, false)));
});

router.post('/orders', requireCustomer, requireCustomerCsrf, (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(req.session.customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const user = req.customerPortalUser;
  const result = db.prepare(`INSERT INTO orders (
    order_number,status,customer_id,customer_name,customer_address,orderer,on_site_contact,on_site_contact_phone,
    on_site_contact_email,customer_portal_visible,customer_portal_status,customer_edit_locked,customer_created_by,
    work_types,items_table,created_by
  ) VALUES (?,'geplant',?,?,?,?,?,?,?,1,'in_erfassung',0,?,'[]','[]',NULL)`)
    .run(generatePortalOrderNumber(db), customer.id, customer.name, customer.address || null, user.full_name,
      user.full_name, user.phone, user.email, user.id);
  const order = getPortalOrder(db, result.lastInsertRowid, customer.id);
  logCustomerChange(db, order.id, user.id, { source: { label: 'Quelle', before: null, after: 'Kundenportal' } }, 'create');
  res.status(201).json(portalOrderResponse(db, order, true));
});

router.get('/orders/:id', requireCustomer, (req, res) => {
  const db = getDb();
  const order = getPortalOrder(db, req.params.id, req.session.customerId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  res.json(portalOrderResponse(db, order, true));
});

router.put('/orders/:id', requireCustomer, requireCustomerCsrf, (req, res) => {
  const order = editableOrderOr404(req, res); if (!order) return;
  const bodyKeys = Object.keys(req.body || {});
  if (bodyKeys.some(k => FORBIDDEN_FIELDS.has(k) || !ALLOWED_UPDATE_FIELDS.has(k))) {
    return res.status(400).json({ error: 'Nicht erlaubtes Feld in der Anfrage' });
  }
  const facades = Array.isArray(req.body.facade_types) ? [...new Set(req.body.facade_types)] : JSON.parse(order.facade_types_json || '[]');
  if (facades.some(v => !ALLOWED_FACADES.has(v)) || (facades.includes('unbekannt') && facades.length > 1)) {
    return res.status(400).json({ error: 'Ungültige Fassadenauswahl' });
  }

  const values = {
    project_number: clean(req.body.project_number ?? order.project_number, 100),
    installation_name: clean(req.body.installation_name ?? order.installation_name, 200),
    installation_street: clean(req.body.installation_street ?? order.installation_street, 200),
    installation_postal_code: clean(req.body.installation_postal_code ?? order.installation_postal_code, 10),
    installation_city: clean(req.body.installation_city ?? order.installation_city, 100),
    on_site_contact: clean(req.body.on_site_contact ?? order.on_site_contact, 150),
    on_site_contact_phone: clean(req.body.on_site_contact_phone ?? order.on_site_contact_phone, 50),
    on_site_contact_email: clean(req.body.on_site_contact_email ?? order.on_site_contact_email, 200),
    customer_term_option: clean(req.body.customer_term_option ?? order.customer_term_option, 50),
    customer_term_from: clean(req.body.customer_term_from ?? order.customer_term_from, 20),
    customer_power_available: req.body.customer_power_available === undefined ? order.customer_power_available : boolOrNull(req.body.customer_power_available),
    customer_power_notes: clean(req.body.customer_power_notes ?? order.customer_power_notes, 500),
    customer_parking_available: req.body.customer_parking_available === undefined ? order.customer_parking_available : boolOrNull(req.body.customer_parking_available),
    customer_parking_permit_required: req.body.customer_parking_permit_required === undefined ? order.customer_parking_permit_required : boolOrNull(req.body.customer_parking_permit_required),
    customer_access_permit_required: req.body.customer_access_permit_required === undefined ? order.customer_access_permit_required : boolOrNull(req.body.customer_access_permit_required),
    customer_restricted_hours: clean(req.body.customer_restricted_hours ?? order.customer_restricted_hours, 500),
    customer_additional_boxes: req.body.customer_additional_boxes === undefined ? order.customer_additional_boxes : Math.max(0, parseInt(req.body.customer_additional_boxes, 10) || 0),
    customer_notes: clean(req.body.customer_notes ?? order.customer_notes, 2000),
  };
  values.installation_address = formatSwissAddress({ name: values.installation_name, street: values.installation_street,
    postalCode: values.installation_postal_code, city: values.installation_city }) || null;
  const changes = {};
  for (const [key, value] of Object.entries(values)) {
    if (String(order[key] ?? '') !== String(value ?? '')) changes[key] = { label: key, before: order[key], after: value };
  }

  const db = getDb();
  db.prepare(`UPDATE orders SET project_number=?,installation_name=?,installation_street=?,installation_postal_code=?,
    installation_city=?,installation_address=?,on_site_contact=?,on_site_contact_phone=?,on_site_contact_email=?,
    customer_term_option=?,customer_term_from=?,customer_power_available=?,customer_power_notes=?,customer_parking_available=?,
    customer_parking_permit_required=?,customer_access_permit_required=?,customer_restricted_hours=?,customer_additional_boxes=?,
    facade_types_json=?,customer_notes=?,updated_at=datetime('now') WHERE id=? AND customer_id=?`)
    .run(values.project_number, values.installation_name, values.installation_street, values.installation_postal_code,
      values.installation_city, values.installation_address, values.on_site_contact, values.on_site_contact_phone,
      values.on_site_contact_email, values.customer_term_option, values.customer_term_from, values.customer_power_available,
      values.customer_power_notes, values.customer_parking_available, values.customer_parking_permit_required,
      values.customer_access_permit_required, values.customer_restricted_hours, values.customer_additional_boxes,
      JSON.stringify(facades), values.customer_notes, order.id, req.session.customerId);
  logCustomerChange(db, order.id, req.customerPortalUser.id, changes);
  res.json(portalOrderResponse(db, getPortalOrder(db, order.id, req.session.customerId), true));
});

router.post('/orders/:id/release', requireCustomer, requireCustomerCsrf, (req, res) => {
  const order = editableOrderOr404(req, res); if (!order) return;
  const missing = [];
  const required = [
    ['project_number', 'Anlagen-/Projektnummer'], ['installation_name', 'Objektbezeichnung'],
    ['installation_street', 'Strasse und Hausnummer'], ['installation_postal_code', 'PLZ'],
    ['installation_city', 'Ort'], ['on_site_contact', 'Kontaktperson vor Ort'],
    ['on_site_contact_phone', 'Telefon der Kontaktperson'],
  ];
  required.forEach(([field, label]) => { if (!clean(order[field])) missing.push({ field, label }); });
  const db = getDb();
  const photoCount = db.prepare(`SELECT COUNT(*) AS n FROM order_photos
    WHERE order_id=? AND customer_visible=1 AND photo_type='montageposition'`).get(order.id).n;
  if (!photoCount) missing.push({ field: 'photos', label: 'Foto der Montageposition' });
  if (missing.length) return res.status(422).json({ error: 'Pflichtangaben fehlen', missing });
  db.prepare(`UPDATE orders SET customer_portal_status='freigegeben',customer_released_at=datetime('now'),
    updated_at=datetime('now') WHERE id=? AND customer_id=?`).run(order.id, req.session.customerId);
  logCustomerChange(db, order.id, req.customerPortalUser.id,
    { customer_portal_status: { label: 'Kundenportal-Status', before: order.customer_portal_status, after: 'freigegeben' } }, 'release');
  res.json(portalOrderResponse(db, getPortalOrder(db, order.id, req.session.customerId), true));
});

router.post('/orders/:id/photos', requireCustomer, requireCustomerCsrf, imageUpload.array('photos', 10), async (req, res, next) => {
  try {
    const order = editableOrderOr404(req, res); if (!order) return;
    if (!req.files?.length) return res.status(400).json({ error: 'Kein Bild ausgewählt' });
    const db = getDb();
    const current = db.prepare('SELECT COUNT(*) AS n FROM order_photos WHERE order_id=? AND customer_visible=1').get(order.id).n;
    if (current + req.files.length > 10) return res.status(400).json({ error: 'Maximal 10 Bilder pro Auftrag' });
    const dirName = `customer-portal/${order.id}`;
    const targetDir = path.join(UPLOADS_DIR, dirName);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of req.files) {
      let metadata;
      try { metadata = await sharp(file.buffer, { failOn: 'error' }).metadata(); }
      catch { return res.status(415).json({ error: 'Datei ist kein gültiges Bild' }); }
      if (!['jpeg', 'png', 'webp', 'heif', 'tiff'].includes(metadata.format)) {
        return res.status(415).json({ error: 'Bildformat nicht unterstützt' });
      }
      const filename = `${uuidv4()}.jpg`;
      await sharp(file.buffer, { failOn: 'error' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(targetDir, filename));
      db.prepare(`INSERT INTO order_photos
        (order_id,filename,original_name,photo_type,uploaded_by,dir_name,customer_portal_user_id,customer_visible)
        VALUES (?,?,?,'montageposition',NULL,?,?,1)`)
        .run(order.id, filename, clean(file.originalname, 255) || 'Montageposition.jpg', dirName, req.customerPortalUser.id);
    }
    logCustomerChange(db, order.id, req.customerPortalUser.id,
      { photos: { label: 'Montagepositionsfoto', before: current, after: current + req.files.length } }, 'upload');
    res.status(201).json(photoRows(db, order.id));
  } catch (error) { next(error); }
});

router.get('/orders/:id/photos/:photoId', requireCustomer, (req, res) => {
  const db = getDb();
  const order = getPortalOrder(db, req.params.id, req.session.customerId);
  if (!order) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const photo = db.prepare('SELECT * FROM order_photos WHERE id=? AND order_id=? AND customer_visible=1').get(req.params.photoId, order.id);
  if (!photo) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const file = path.join(UPLOADS_DIR, photo.dir_name || String(order.id), path.basename(photo.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.type('image/jpeg').sendFile(file);
});

router.delete('/orders/:id/photos/:photoId', requireCustomer, requireCustomerCsrf, (req, res) => {
  const order = editableOrderOr404(req, res); if (!order) return;
  const db = getDb();
  const photo = db.prepare('SELECT * FROM order_photos WHERE id=? AND order_id=? AND customer_visible=1').get(req.params.photoId, order.id);
  if (!photo) return res.status(404).json({ error: 'Datei nicht gefunden' });
  db.prepare('DELETE FROM order_photos WHERE id=?').run(photo.id);
  const file = path.join(UPLOADS_DIR, photo.dir_name || String(order.id), path.basename(photo.filename));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  logCustomerChange(db, order.id, req.customerPortalUser.id,
    { photos: { label: 'Montagepositionsfoto gelöscht', before: photo.id, after: null } }, 'delete_file');
  res.json({ ok: true });
});

router.post('/orders/:id/attachments', requireCustomer, requireCustomerCsrf, attachmentUpload.array('attachments', 10), (req, res) => {
  const order = editableOrderOr404(req, res); if (!order) return;
  if (!req.files?.length) return res.status(400).json({ error: 'Keine Datei ausgewählt' });
  const db = getDb();
  const dirName = `customer-portal/${order.id}`;
  const targetDir = path.join(UPLOADS_DIR, dirName); fs.mkdirSync(targetDir, { recursive: true });
  for (const file of req.files) {
    const isPdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
    if (!isPdf) return res.status(415).json({ error: 'Als Dokument ist nur ein gültiges PDF erlaubt' });
    const filename = `${uuidv4()}.pdf`; fs.writeFileSync(path.join(targetDir, filename), file.buffer);
    db.prepare(`INSERT INTO order_attachments
      (order_id,filename,original_name,file_type,uploaded_by,dir_name,customer_portal_user_id,customer_visible)
      VALUES (?,?,?,'document',NULL,?,?,1)`)
      .run(order.id, filename, clean(file.originalname, 255) || 'Dokument.pdf', dirName, req.customerPortalUser.id);
  }
  res.status(201).json(attachmentRows(db, order.id));
});

router.get('/orders/:id/attachments/:attachmentId', requireCustomer, (req, res) => {
  const db = getDb();
  const order = getPortalOrder(db, req.params.id, req.session.customerId);
  if (!order) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const fileRow = db.prepare('SELECT * FROM order_attachments WHERE id=? AND order_id=? AND customer_visible=1')
    .get(req.params.attachmentId, order.id);
  if (!fileRow) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const file = path.join(UPLOADS_DIR, fileRow.dir_name || String(order.id), path.basename(fileRow.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(file, fileRow.original_name);
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Datei ist grösser als 15 MB' });
  }
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
  next(error);
});

module.exports = router;
