'use strict';

const crypto = require('crypto');
const { getDb } = require('../lib/database');

function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireCustomer(req, res, next) {
  const id = req.session?.customerPortalUserId;
  const customerId = req.session?.customerId;
  if (!id || !customerId) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const user = getDb().prepare(`SELECT id, customer_id, username, full_name, email, phone, active,
    must_change_password FROM customer_portal_users WHERE id=? AND customer_id=?`).get(id, customerId);
  if (!user || !user.active) {
    req.session?.destroy(() => {});
    return res.status(401).json({ error: 'Nicht eingeloggt' });
  }
  req.customerPortalUser = user;
  if (user.must_change_password && !['/me', '/password', '/logout'].includes(req.path)) {
    return res.status(428).json({ error: 'Bitte zuerst das temporäre Passwort ändern' });
  }
  next();
}

function requireCustomerCsrf(req, res, next) {
  const sent = String(req.get('x-csrf-token') || '');
  const expected = String(req.session?.customerPortalCsrf || '');
  if (!sent || !expected || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Ungültige Sicherheitsprüfung' });
  }
  next();
}

function customerCanEdit(order) {
  return Boolean(order && !order.customer_edit_locked &&
    !['in_bearbeitung', 'abgeschlossen', 'abgerechnet', 'archiviert'].includes(order.status) &&
    order.customer_portal_status !== 'uebernommen');
}

module.exports = { newCsrfToken, requireCustomer, requireCustomerCsrf, customerCanEdit };
