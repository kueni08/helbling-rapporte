'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../lib/database');
const { requireRole } = require('../middleware/auth');

const VALID_PORTAL_STATUS = new Set(['in_erfassung', 'freigegeben', 'rueckfrage', 'uebernommen']);

function publicUser(row) {
  return {
    id: row.id, customer_id: row.customer_id, customer_name: row.customer_name,
    username: row.username, full_name: row.full_name, email: row.email, phone: row.phone,
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
  const username = String(req.body.username || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const temporaryPassword = String(req.body.password || '') || generatedPassword();
  if (!username || !fullName || !email || !phone) return res.status(400).json({ error: 'Alle Profildaten sind erforderlich' });
  if (!/^[a-z0-9._@+-]{3,100}$/i.test(username)) return res.status(400).json({ error: 'Ungültiger Benutzername' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  if (!validPassword(temporaryPassword)) return res.status(400).json({ error: 'Passwort erfüllt die Sicherheitsregeln nicht' });
  try {
    const hash = await bcrypt.hash(temporaryPassword, 12);
    const result = db.prepare(`INSERT INTO customer_portal_users
      (customer_id,username,password_hash,full_name,email,phone,active,must_change_password)
      VALUES (?,?,?,?,?,?,1,1)`).run(customerId, username, hash, fullName, email, phone);
    const row = db.prepare(`SELECT p.*,c.name AS customer_name FROM customer_portal_users p
      JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).get(result.lastInsertRowid);
    res.status(201).json({ ...publicUser(row), temporary_password: temporaryPassword });
  } catch (error) {
    if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
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
  db.prepare(`UPDATE customer_portal_users SET full_name=?,email=?,phone=?,active=?,updated_at=datetime('now') WHERE id=?`)
    .run(values.full_name, values.email, values.phone, values.active, row.id);
  const updated = db.prepare(`SELECT p.*,c.name AS customer_name FROM customer_portal_users p
    JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).get(row.id);
  res.json(publicUser(updated));
});

router.post('/users/:id/reset-password', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM customer_portal_users WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Portalzugang nicht gefunden' });
  const temporaryPassword = String(req.body.password || '') || generatedPassword();
  if (!validPassword(temporaryPassword)) return res.status(400).json({ error: 'Passwort erfüllt die Sicherheitsregeln nicht' });
  const hash = await bcrypt.hash(temporaryPassword, 12);
  db.prepare(`UPDATE customer_portal_users SET password_hash=?,must_change_password=1,failed_login_count=0,
    locked_until=NULL,updated_at=datetime('now') WHERE id=?`).run(hash, row.id);
  res.json({ ok: true, temporary_password: temporaryPassword });
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

module.exports = router;
