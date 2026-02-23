const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'rapporte.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','planer','monteur')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'geplant'
        CHECK(status IN ('geplant','in_bearbeitung','abgeschlossen','archiviert')),
      sort_order INTEGER DEFAULT 0,

      -- Planer fields
      customer_id INTEGER REFERENCES customers(id),
      customer_name TEXT,
      customer_address TEXT,
      installation_address TEXT,
      orderer TEXT,
      on_site_contact TEXT,
      arrival_time TEXT,
      planned_date TEXT,
      latest_date TEXT,
      work_types TEXT DEFAULT '[]',
      notes_planer TEXT,

      -- Monteur fields
      executed_work TEXT DEFAULT '[]',
      items_table TEXT DEFAULT '[]',
      additional_material TEXT DEFAULT '[]',
      notes_monteur TEXT,
      rings_data TEXT DEFAULT '{}',
      keys_data TEXT DEFAULT '{}',
      work_date TEXT,
      work_time_from TEXT,
      work_time_to TEXT,
      technician_name TEXT,
      technician_block TEXT,
      signature_data TEXT,
      agb_accepted INTEGER DEFAULT 0,

      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      photo_type TEXT DEFAULT 'standort',
      uploaded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS multiselect_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_name TEXT NOT NULL,
      option_key TEXT NOT NULL,
      option_label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(field_name, option_key)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_number TEXT,
      name TEXT NOT NULL,
      description TEXT,
      unit TEXT DEFAULT 'Stk.',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  seedDefaults(db);
  console.log('✅ Datenbank initialisiert');
}

function seedDefaults(db) {
  // Default admin user
  const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role)
                VALUES ('admin', ?, 'Administrator', 'admin')`).run(hash);
    console.log('  👤 Standard-Admin erstellt: admin / admin123');
  }

  // Default multiselect options
  const opts = [
    // Arbeit (work types for planer)
    ['arbeit', 'montage',    'Montage',    1],
    ['arbeit', 'reparatur',  'Reparatur',  2],
    ['arbeit', 'service',    'Service',    3],
    ['arbeit', 'sonstiges',  'Sonstiges',  4],

    // Ausgeführte Arbeiten (executed work for monteur)
    ['ausgefuehrte_arbeiten', 'montage_inkl_kern',  'Montage inkl. Kernbohrung',    1],
    ['ausgefuehrte_arbeiten', 'montage_exkl_kern',  'Montage exkl. Kernbohrung',    2],
    ['ausgefuehrte_arbeiten', 'mont_alarm',          'Mont. Alarm',                  3],
    ['ausgefuehrte_arbeiten', 'reparatur',           'Reparatur',                    4],
    ['ausgefuehrte_arbeiten', 'wartung_service',     'Wartung / Service',            5],

    // Zusätzliches Material
    ['zusatz_material', 'abdeckring',       'Abdeckring',         1],
    ['zusatz_material', 'koecher',          'Köcher D___ x ___',  2],
    ['zusatz_material', 'si_wetterschutz',  'Si- & Wetterschutz', 3],

    // Halteringe
    ['halteringe', 'abgegeben',        'Abgegeben',           1],
    ['halteringe', 'per_post',         'Per Post nachsenden', 2],

    // Schlüssel
    ['schluessel', 'abgegeben',        'Abgegeben',           1],
    ['schluessel', 'per_post',         'Per Post nachsenden', 2],
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO multiselect_options (field_name, option_key, option_label, sort_order)
    VALUES (?, ?, ?, ?)
  `);
  opts.forEach(([field, key, label, order]) => insert.run(field, key, label, order));

  // Default customers
  const custExists = db.prepare("SELECT id FROM customers LIMIT 1").get();
  if (!custExists) {
    const customers = [
      ['Muster AG', 'Musterstrasse 1, 8000 Zürich', 'Hans Muster', 'hmuster@muster.ch', '044 123 45 67'],
      ['Beispiel GmbH', 'Beispielweg 5, 3000 Bern', 'Anna Beispiel', 'a.beispiel@beispiel.ch', '031 234 56 78'],
    ];
    const ic = db.prepare(`INSERT INTO customers (name, address, contact_name, contact_email, contact_phone) VALUES (?,?,?,?,?)`);
    customers.forEach(c => ic.run(...c));
  }
}

module.exports = { getDb, initDatabase };
