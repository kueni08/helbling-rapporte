'use strict';

const { initDatabase, getDb } = require('../lib/database');

if (!process.env.DB_PATH) throw new Error('DB_PATH muss auf eine Testkopie zeigen.');
initDatabase();
const db = getDb();
const required = ['customer_portal_visible', 'customer_portal_status', 'customer_edit_locked', 'facade_types_json'];
const columns = db.prepare('PRAGMA table_info(orders)').all().map(column => column.name);
const portalUsers = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_portal_users'").get());
const emailLoginIndex = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_customer_portal_users_email'").get());
console.log(JSON.stringify({ integrity: db.pragma('integrity_check', { simple: true }), portalUsers, emailLoginIndex, columns: required.every(column => columns.includes(column)) }));
