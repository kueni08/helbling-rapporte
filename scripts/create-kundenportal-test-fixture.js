'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || '');
if (process.env.NODE_ENV !== 'test' || !/(test|acceptance|abnahme)/i.test(dbPath)) {
  throw new Error('Dieses Skript darf nur mit NODE_ENV=test und einer klar bezeichneten Testdatenbank ausgeführt werden.');
}

const { initDatabase, getDb } = require('../lib/database');
initDatabase();
const db = getDb();
const username = process.env.PORTAL_TEST_USERNAME || 'privera.abnahme';
const password = `He!${crypto.randomBytes(12).toString('base64url')}7a`;

let customer = db.prepare('SELECT * FROM customers WHERE name=?').get('Privera AG');
if (!customer) {
  const id = db.prepare('INSERT INTO customers (name,address,contact_name,contact_email,contact_phone) VALUES (?,?,?,?,?)')
    .run('Privera AG', 'Talacker 1, 8001 Zürich', 'Petra Privera', 'portal-abnahme@example.test', '044 555 11 22').lastInsertRowid;
  customer = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
}

db.prepare('DELETE FROM customer_portal_users WHERE username=?').run(username);
const portalUserId = db.prepare(`INSERT INTO customer_portal_users
  (customer_id,username,password_hash,full_name,email,phone,active,must_change_password)
  VALUES (?,?,?,?,?,?,1,1)`).run(customer.id, username, bcrypt.hashSync(password, 12), 'Petra Privera',
  'portal-abnahme@example.test', '044 555 11 22').lastInsertRowid;

db.prepare("DELETE FROM orders WHERE order_number IN ('TEST-KP-0001','TEST-KP-0002')").run();
const insert = db.prepare(`INSERT INTO orders
  (order_number,status,customer_id,customer_name,customer_address,orderer,customer_portal_visible,
   customer_portal_status,customer_edit_locked,customer_created_by,project_number,installation_name,
   installation_street,installation_postal_code,installation_city,installation_address,on_site_contact,
   on_site_contact_phone,work_types,items_table,customer_notes)
  VALUES (?,'geplant',?,?,?,?,1,?,0,?,?,?,?,?,?,?,?,?,'[]','[]',?)`);
insert.run('TEST-KP-0001', customer.id, customer.name, customer.address, 'Petra Privera', 'in_erfassung', portalUserId,
  'TEST-ANLAGE-01', 'Testobjekt Zürich', 'Talacker 1', '8001', 'Zürich', 'Testobjekt Zürich, Talacker 1, 8001 Zürich',
  'Max Muster', '079 123 45 67', 'Eindeutiger Testauftrag zum Ergänzen');
insert.run('TEST-KP-0002', customer.id, customer.name, customer.address, 'Petra Privera', 'rueckfrage', portalUserId,
  'TEST-ANLAGE-02', 'Testobjekt St. Gallen', 'Marktgasse 2', '9000', 'St. Gallen', 'Testobjekt St. Gallen, Marktgasse 2, 9000 St. Gallen',
  'Anna Beispiel', '078 222 33 44', 'Eindeutiger Testauftrag für Rückfrage');

console.log(JSON.stringify({ customer: customer.name, username, temporary_password: password, orders: ['TEST-KP-0001', 'TEST-KP-0002'] }));
