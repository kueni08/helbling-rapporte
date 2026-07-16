'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const { getDb } = require('../lib/database');
const { requireRole } = require('../middleware/auth');
const { sendPortalAccessEmail } = require('../lib/mailer');
const { parseSwissAddress, formatSwissAddress } = require('../lib/address');

const VALID_PORTAL_STATUS = new Set(['in_erfassung', 'freigegeben', 'rueckfrage', 'uebernommen']);
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

function cleanText(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizedHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\u00df/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

function rowValue(row, aliases) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizedHeader(alias));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function excelDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const swiss = text.match(/^(\d{1,2})[.\/]\s*(\d{1,2})[.\/]\s*(\d{4})$/);
  if (swiss) return `${swiss[3]}-${swiss[2].padStart(2, '0')}-${swiss[1].padStart(2, '0')}`;
  return null;
}

function normalizeImportRow(row, index) {
  const fullAddress = cleanText(rowValue(row, ['Montageadresse', 'Adresse Montage', 'Installationsadresse', 'Adresse']), 500);
  const parsed = parseSwissAddress(fullAddress);
  const objectName = cleanText(rowValue(row, ['Objekt', 'Objektbezeichnung', 'Anlage', 'Liegenschaft', 'Gebäude']), 200) || parsed.name || null;
  const street = cleanText(rowValue(row, ['Strasse / Nr.', 'Strasse', 'Straße', 'Montagestrasse', 'Strasse Nr']), 200) || parsed.street || null;
  const postalCode = cleanText(rowValue(row, ['PLZ', 'Postleitzahl']), 10) || parsed.postalCode || null;
  const city = cleanText(rowValue(row, ['Ort', 'Stadt', 'Gemeinde']), 100) || parsed.city || null;
  const installationAddress = formatSwissAddress({ name: objectName, street, postalCode, city }) || fullAddress;
  return {
    row_number: index + 2,
    project_number: cleanText(rowValue(row, ['Anlagen-/Projektnummer', 'Anlagennummer', 'Anlage Nr', 'Projektnummer', 'Projekt', 'Projekt Nr']), 100),
    object_name: objectName,
    street, postal_code: postalCode, city,
    installation_address: installationAddress,
    contact_name: cleanText(rowValue(row, ['Kontaktperson vor Ort', 'Kontakt vor Ort', 'Kontaktperson', 'Kontakt']), 150),
    contact_phone: cleanText(rowValue(row, ['Telefon Kontaktperson', 'Telefon', 'Mobil', 'Handy']), 50),
    contact_email: cleanText(rowValue(row, ['E-Mail Kontaktperson', 'E-Mail', 'Email']), 200)?.toLowerCase() || null,
    planned_date: excelDate(rowValue(row, ['Montagetermin', 'Montagedatum', 'Termin', 'Datum'])),
    arrival_time: cleanText(rowValue(row, ['Kommunizierte Zeit', 'Ankunftszeit', 'Zeit', 'Zeitfenster']), 100),
    notes: cleanText(rowValue(row, ['Bemerkungen', 'Hinweise', 'Notiz', 'Kommentar']), 2000),
  };
}

function findDuplicate(db, customerId, row) {
  if (row.project_number && db.prepare(`SELECT id,order_number FROM orders WHERE customer_id=? AND project_number=? COLLATE NOCASE AND status!='archiviert' LIMIT 1`).get(customerId, row.project_number)) return true;
  return Boolean(row.installation_address && db.prepare(`SELECT id FROM orders WHERE customer_id=? AND installation_address=? COLLATE NOCASE AND status!='archiviert' LIMIT 1`).get(customerId, row.installation_address));
}

function nextImportSequence(db) {
  const year = new Date().getFullYear();
  const prefix = `KI-${year}-`;
  const last = db.prepare('SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1').get(`${prefix}%`);
  return { prefix, value: last ? (parseInt(last.order_number.slice(prefix.length), 10) || 0) + 1 : 1 };
}

function publicUser(row) {
  return {
    id: row.id, customer_id: row.customer_id, customer_name: row.customer_name,
    full_name: row.full_name, email: row.email, phone: row.phone,
    active: Boolean(row.active), must_change_password: Boolean(row.must_change_password),
    last_login_at: row.last_login_at, created_at: row.created_at,
  };
}

function generatedPassword() {
  return `He!${crypto.randomBytes(12).toString('base64url')}7a`;
}

function validPassword(password) {
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

router.get('/users', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const customerId = req.query.customer_id ? parseInt(req.query.customer_id, 10) : null;
  const rows = db.prepare(`SELECT p.*, c.name AS customer_name FROM customer_portal_users p
    JOIN customers c ON c.id=p.customer_id ${customerId ? 'WHERE p.customer_id=?' : ''}
    ORDER BY c.name,p.full_name`).all(...(customerId ? [customerId] : []));
  res.json(rows.map(publicUser));
});

router.post('/users', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const customerId = parseInt(req.body.customer_id, 10);
  const customer = db.prepare('SELECT id,name FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(400).json({ error: 'Gültiger Kunde erforderlich' });
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const temporaryPassword = String(req.body.password || '') || generatedPassword();
  if (!fullName || !email || !phone) return res.status(400).json({ error: 'Alle Profildaten sind erforderlich' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  if (!validPassword(temporaryPassword)) return res.status(400).json({ error: 'Passwort erfüllt die Sicherheitsregeln nicht' });
  try {
    const hash = await bcrypt.hash(temporaryPassword, 12);
    const result = db.prepare(`INSERT INTO customer_portal_users
      (customer_id,username,password_hash,full_name,email,phone,active,must_change_password)
      VALUES (?,?,?,?,?,?,1,1)`).run(customerId, email, hash, fullName, email, phone);
    try {
      await sendPortalAccessEmail({ to: email, fullName, customerName: customer.name, temporaryPassword });
    } catch (mailError) {
      db.prepare('DELETE FROM customer_portal_users WHERE id=?').run(result.lastInsertRowid);
      return res.status(mailError.code === 'SMTP_NOT_CONFIGURED' ? 503 : 502).json({ error: mailError.message || 'Zugangs-E-Mail konnte nicht gesendet werden' });
    }
    const row = db.prepare(`SELECT p.*,c.name AS customer_name FROM customer_portal_users p
      JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).get(result.lastInsertRowid);
    res.status(201).json({ ...publicUser(row), email_sent: true });
  } catch (error) {
    if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Für diese E-Mail-Adresse besteht bereits ein Portalzugang' });
    throw error;
  }
});

router.put('/users/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customer_portal_users WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Portalzugang nicht gefunden' });
  const values = {
    full_name: req.body.full_name === undefined ? row.full_name : String(req.body.full_name).trim(),
    email: req.body.email === undefined ? row.email : String(req.body.email).trim().toLowerCase(),
    phone: req.body.phone === undefined ? row.phone : String(req.body.phone).trim(),
    active: req.body.active === undefined ? row.active : (req.body.active ? 1 : 0),
  };
  if (!values.full_name || !values.email || !values.phone) return res.status(400).json({ error: 'Profildaten dürfen nicht leer sein' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  try {
    db.prepare(`UPDATE customer_portal_users SET username=?,full_name=?,email=?,phone=?,active=?,updated_at=datetime('now') WHERE id=?`)
      .run(values.email, values.full_name, values.email, values.phone, values.active, row.id);
  } catch (error) {
    if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Für diese E-Mail-Adresse besteht bereits ein Portalzugang' });
    throw error;
  }
  const updated = db.prepare(`SELECT p.*,c.name AS customer_name FROM customer_portal_users p
    JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).get(row.id);
  res.json(publicUser(updated));
});

router.post('/users/:id/reset-password', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT p.*,c.name AS customer_name FROM customer_portal_users p
    JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Portalzugang nicht gefunden' });
  const temporaryPassword = String(req.body.password || '') || generatedPassword();
  if (!validPassword(temporaryPassword)) return res.status(400).json({ error: 'Passwort erfüllt die Sicherheitsregeln nicht' });
  const hash = await bcrypt.hash(temporaryPassword, 12);
  db.prepare(`UPDATE customer_portal_users SET password_hash=?,must_change_password=1,failed_login_count=0,
    locked_until=NULL,updated_at=datetime('now') WHERE id=?`).run(hash, row.id);
  try {
    await sendPortalAccessEmail({ to: row.email, fullName: row.full_name, customerName: row.customer_name, temporaryPassword });
  } catch (mailError) {
    db.prepare(`UPDATE customer_portal_users SET password_hash=?,must_change_password=?,failed_login_count=?,
      locked_until=?,updated_at=datetime('now') WHERE id=?`)
      .run(row.password_hash, row.must_change_password, row.failed_login_count, row.locked_until, row.id);
    return res.status(mailError.code === 'SMTP_NOT_CONFIGURED' ? 503 : 502).json({ error: mailError.message || 'Zugangs-E-Mail konnte nicht gesendet werden' });
  }
  res.json({ ok: true, email_sent: true, email: row.email });
});

router.post('/customers/:customerId/order-import/preview', requireRole('admin', 'planer'), excelUpload.single('file'), (req, res) => {
  const db = getDb();
  const customerId = parseInt(req.params.customerId, 10);
  const customer = db.prepare('SELECT id,name FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  if (!req.file) return res.status(400).json({ error: 'Excel-Datei erforderlich' });
  if (!/\.(xlsx|xls)$/i.test(req.file.originalname || '')) return res.status(415).json({ error: 'Nur Excel-Dateien (.xlsx oder .xls) sind erlaubt' });
  let workbook;
  try { workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true }); }
  catch { return res.status(400).json({ error: 'Excel-Datei konnte nicht gelesen werden' }); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }) : [];
  if (!rawRows.length) return res.status(400).json({ error: 'Die erste Tabelle enthält keine Aufträge' });
  if (rawRows.length > 500) return res.status(400).json({ error: 'Maximal 500 Aufträge pro Import' });
  const rows = rawRows.map((row, index) => {
    const normalized = normalizeImportRow(row, index);
    const missing = [];
    if (!normalized.project_number) missing.push('Projekt/Anlage');
    if (!normalized.street || !normalized.postal_code || !normalized.city) missing.push('vollständige Montageadresse');
    return { ...normalized, duplicate: findDuplicate(db, customerId, normalized), warnings: missing };
  });
  res.json({ customer, sheet: workbook.SheetNames[0], rows });
});

router.post('/customers/:customerId/order-import/confirm', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const customerId = parseInt(req.params.customerId, 10);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  if (!Array.isArray(req.body.rows) || !req.body.rows.length || req.body.rows.length > 500) return res.status(400).json({ error: 'Keine gültige Importauswahl' });
  const normalizedRows = req.body.rows.map((row, index) => normalizeImportRow({
    'Anlagen-/Projektnummer': row.project_number, 'Objekt': row.object_name, 'Strasse': row.street,
    'PLZ': row.postal_code, 'Ort': row.city, 'Kontaktperson': row.contact_name, 'Telefon': row.contact_phone,
    'E-Mail': row.contact_email, 'Montagetermin': row.planned_date, 'Kommunizierte Zeit': row.arrival_time,
    'Bemerkungen': row.notes,
  }, index));
  const sequence = nextImportSequence(db);
  const insert = db.prepare(`INSERT INTO orders
    (order_number,status,customer_id,customer_name,customer_address,orderer,project_number,installation_name,
     installation_street,installation_postal_code,installation_city,installation_address,on_site_contact,
     on_site_contact_phone,on_site_contact_email,planned_date,arrival_time,customer_notes,customer_portal_visible,
     customer_portal_status,customer_edit_locked,work_types,items_table,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const result = db.transaction(rows => {
    let imported = 0; let skippedDuplicates = 0;
    for (const row of rows) {
      if (findDuplicate(db, customerId, row)) { skippedDuplicates++; continue; }
      const orderNumber = `${sequence.prefix}${String(sequence.value++).padStart(4, '0')}`;
      insert.run(orderNumber, 'geplant', customer.id, customer.name, customer.address || null, customer.contact_name || 'Excel-Import',
        row.project_number, row.object_name, row.street, row.postal_code, row.city, row.installation_address,
        row.contact_name, row.contact_phone, row.contact_email, row.planned_date, row.arrival_time, row.notes,
        1, 'in_erfassung', 0, '[]', '[]', req.session.userId);
      imported++;
    }
    return { imported, skipped_duplicates: skippedDuplicates };
  })(normalizedRows);
  res.status(201).json(result);
});

router.put('/orders/:id', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  const visible = req.body.visible === undefined ? order.customer_portal_visible : (req.body.visible ? 1 : 0);
  let portalStatus = req.body.portal_status === undefined ? order.customer_portal_status : req.body.portal_status;
  let locked = req.body.locked === undefined ? order.customer_edit_locked : (req.body.locked ? 1 : 0);
  if (visible && !order.customer_id) return res.status(400).json({ error: 'Vor der Portalfreigabe muss ein Kunde zugeordnet sein' });
  if (visible && !portalStatus) portalStatus = 'in_erfassung';
  if (portalStatus && !VALID_PORTAL_STATUS.has(portalStatus)) return res.status(400).json({ error: 'Ungültiger Portalstatus' });
  if (portalStatus === 'rueckfrage') locked = 0;
  if (portalStatus === 'uebernommen') locked = 1;
  db.prepare(`UPDATE orders SET customer_portal_visible=?,customer_portal_status=?,customer_edit_locked=?,
    updated_at=datetime('now') WHERE id=?`).run(visible, portalStatus || null, locked, order.id);
  const changes = {
    customer_portal_visible: { label: 'Im Kundenportal sichtbar', before: order.customer_portal_visible, after: visible },
    customer_portal_status: { label: 'Kundenportal-Status', before: order.customer_portal_status, after: portalStatus },
    customer_edit_locked: { label: 'Kundenbearbeitung gesperrt', before: order.customer_edit_locked, after: locked },
  };
  db.prepare(`INSERT INTO order_change_log (order_id,user_id,user_role,action,changes_json)
    VALUES (?,?,?,'portal_control',?)`).run(order.id, req.session.userId, req.session.userRole, JSON.stringify(changes));
  res.json({ id: order.id, visible: Boolean(visible), portal_status: portalStatus, locked: Boolean(locked) });
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Excel-Datei ist grösser als 8 MB' });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
  next(error);
});

module.exports = router;
