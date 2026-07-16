const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { parseSwissAddress } = require('./address');

const DB_DIR = path.join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'rapporte.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

    CREATE TABLE IF NOT EXISTS customer_portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      installation_name TEXT,
      installation_street TEXT,
      installation_postal_code TEXT,
      installation_city TEXT,
      on_site_contact_email TEXT,
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

      -- Kundenportal
      customer_portal_visible INTEGER NOT NULL DEFAULT 0,
      customer_portal_status TEXT,
      customer_edit_locked INTEGER NOT NULL DEFAULT 0,
      customer_created_by INTEGER REFERENCES customer_portal_users(id),
      customer_term_option TEXT,
      customer_term_from TEXT,
      customer_power_available INTEGER,
      customer_power_notes TEXT,
      customer_parking_available INTEGER,
      customer_parking_permit_required INTEGER,
      customer_access_permit_required INTEGER,
      customer_restricted_hours TEXT,
      customer_additional_boxes INTEGER,
      facade_types_json TEXT NOT NULL DEFAULT '[]',
      customer_notes TEXT,
      customer_released_at TEXT,

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

    CREATE TABLE IF NOT EXISTS customer_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'neu',
      token TEXT UNIQUE,

      -- Kontaktdaten
      firma TEXT,
      vorname TEXT NOT NULL,
      nachname TEXT NOT NULL,
      email TEXT NOT NULL,
      telefon TEXT NOT NULL,

      -- Montageadresse
      strasse TEXT NOT NULL,
      plz TEXT NOT NULL,
      ort TEXT NOT NULL,

      -- Objektinformation
      objektart TEXT,
      anzahl_tueren INTEGER,

      -- Sibox-Details
      art_der_arbeit TEXT,
      anzahl_zylinder INTEGER,
      anzahl_schluessel INTEGER,
      bestehendes_system INTEGER DEFAULT 0,

      -- Terminwunsch
      wunschtermin TEXT,
      alternativtermin TEXT,
      terminpraeferenz TEXT,

      -- Zusatzinfos
      bemerkungen TEXT,

      -- Verarbeitung
      converted_to_order_id INTEGER REFERENCES orders(id),
      linked_order_id INTEGER REFERENCES orders(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS anfrage_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER NOT NULL REFERENCES customer_inquiries(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS lieferschein_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','success','error')),
      lieferschein_nr TEXT,
      kunde TEXT,
      projekt_nr TEXT,
      lieferdatum TEXT,
      articles_imported INTEGER DEFAULT 0,
      order_id INTEGER REFERENCES orders(id),
      error_message TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      portal_user_id INTEGER REFERENCES customer_portal_users(id),
      user_role TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'update',
      changes_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_order_change_log_order ON order_change_log(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_portal_users_customer ON customer_portal_users(customer_id, active);
  `);

  // Migrations for existing databases
  runMigrations(db);

  seedDefaults(db);
  console.log('✅ Datenbank initialisiert');
}

function runMigrations(db) {
  const existingCols = db.prepare("PRAGMA table_info(customer_inquiries)").all().map(c => c.name);

  if (!existingCols.includes('token')) {
    try { db.exec("ALTER TABLE customer_inquiries ADD COLUMN token TEXT"); } catch(e) {}
  }
  if (!existingCols.includes('linked_order_id')) {
    try { db.exec("ALTER TABLE customer_inquiries ADD COLUMN linked_order_id INTEGER REFERENCES orders(id)"); } catch(e) {}
  }

  // New order fields for "Nicht auf LS" tracking
  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!orderCols.includes('extra_material')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN extra_material TEXT DEFAULT '[]'"); } catch(e) {}
  }
  if (!orderCols.includes('extra_aufwand')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN extra_aufwand REAL"); } catch(e) {}
  }
  if (!orderCols.includes('extra_argumentation')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN extra_argumentation TEXT"); } catch(e) {}
  }
  if (!orderCols.includes('travel_time')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN travel_time REAL"); } catch(e) {}
  }
  if (!orderCols.includes('travel_km')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN travel_km INTEGER"); } catch(e) {}
  }

  // Projektnummer-Feld
  if (!orderCols.includes('project_number')) {
    try { db.exec("ALTER TABLE orders ADD COLUMN project_number TEXT"); } catch(e) {}
  }

  const portalOrderColumns = {
    on_site_contact_email: 'TEXT',
    customer_portal_visible: 'INTEGER NOT NULL DEFAULT 0',
    customer_portal_status: 'TEXT',
    customer_edit_locked: 'INTEGER NOT NULL DEFAULT 0',
    customer_created_by: 'INTEGER REFERENCES customer_portal_users(id)',
    customer_term_option: 'TEXT',
    customer_term_from: 'TEXT',
    customer_power_available: 'INTEGER',
    customer_power_notes: 'TEXT',
    customer_parking_available: 'INTEGER',
    customer_parking_permit_required: 'INTEGER',
    customer_access_permit_required: 'INTEGER',
    customer_restricted_hours: 'TEXT',
    customer_additional_boxes: 'INTEGER',
    facade_types_json: "TEXT NOT NULL DEFAULT '[]'",
    customer_notes: 'TEXT',
    customer_released_at: 'TEXT',
  };
  for (const [column, definition] of Object.entries(portalOrderColumns)) {
    if (!orderCols.includes(column)) {
      try { db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`); } catch(e) {
        if (!e.message.includes('duplicate')) console.warn(`Migration ${column}:`, e.message);
      }
    }
  }

  for (const table of ['order_photos', 'order_attachments']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!columns.includes('customer_portal_user_id')) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN customer_portal_user_id INTEGER REFERENCES customer_portal_users(id)`); } catch(e) {}
    }
    if (!columns.includes('customer_visible')) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN customer_visible INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
    }
  }
  const logCols = db.prepare('PRAGMA table_info(order_change_log)').all().map(c => c.name);
  if (!logCols.includes('portal_user_id')) {
    try { db.exec('ALTER TABLE order_change_log ADD COLUMN portal_user_id INTEGER REFERENCES customer_portal_users(id)'); } catch(e) {}
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customer_portal_users_customer ON customer_portal_users(customer_id, active);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_portal ON orders(customer_id, customer_portal_visible, customer_portal_status);
  `);

  // Montageadresse getrennt speichern und bestehende Adressen einmalig aufteilen
  for (const column of ['installation_name', 'installation_street', 'installation_postal_code', 'installation_city']) {
    if (!orderCols.includes(column)) {
      try { db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`); } catch(e) {}
    }
  }
  const addressRows = db.prepare(`SELECT id, installation_address FROM orders
    WHERE installation_address IS NOT NULL AND installation_address != ''
      AND installation_street IS NULL AND installation_postal_code IS NULL`).all();
  const updateAddress = db.prepare(`UPDATE orders SET installation_name=?, installation_street=?,
    installation_postal_code=?, installation_city=? WHERE id=?`);
  db.transaction(rows => rows.forEach(row => {
    const parsed = parseSwissAddress(row.installation_address);
    updateAddress.run(parsed.name || null, parsed.street || null, parsed.postalCode || null, parsed.city || null, row.id);
  }))(addressRows);

  // anfrage_attachments upload dir
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  const anfrageDir = path.join(uploadsDir, 'anfragen');
  if (!fs.existsSync(anfrageDir)) fs.mkdirSync(anfrageDir, { recursive: true });

  try { db.exec("ALTER TABLE order_attachments ADD COLUMN dir_name TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE order_photos ADD COLUMN dir_name TEXT"); } catch(e) {}

  // Google Drive integration
  try { db.exec("ALTER TABLE order_attachments ADD COLUMN google_drive_file_id TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE order_attachments ADD COLUMN google_drive_web_url TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE order_photos ADD COLUMN google_drive_file_id TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE order_photos ADD COLUMN google_drive_web_url TEXT"); } catch(e) {}

  // Lieferschein drive_file_id for Google Drive polling
  try { db.exec("ALTER TABLE lieferschein_imports ADD COLUMN drive_file_id TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE lieferschein_imports ADD COLUMN file_hash TEXT"); } catch(e) {}

  // on_site_contact_phone für orders
  try { db.exec("ALTER TABLE orders ADD COLUMN on_site_contact_phone TEXT"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration on_site_contact_phone:', e.message); }

  // ls_number (Lieferscheinnummer) für orders
  try { db.exec("ALTER TABLE orders ADD COLUMN ls_number TEXT"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration ls_number:', e.message); }

  // earliest_delivery_date (Frühster Liefertermin Zylinder) für orders
  try { db.exec("ALTER TABLE orders ADD COLUMN earliest_delivery_date TEXT"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration earliest_delivery_date:', e.message); }

  // work_sessions (Mehrfach-Arbeitszeiten als JSON-Array) für orders
  try { db.exec("ALTER TABLE orders ADD COLUMN work_sessions TEXT DEFAULT '[]'"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration work_sessions:', e.message); }

  // zylinder_status für orders (bestellt / vorhanden / nicht_notwendig)
  try { db.exec("ALTER TABLE orders ADD COLUMN zylinder_status TEXT"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration zylinder_status:', e.message); }

  // updated_at für orders und customer_inquiries
  try { db.exec("ALTER TABLE orders ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration updated_at orders:', e.message); }
  try { db.exec("ALTER TABLE customer_inquiries ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration updated_at customer_inquiries:', e.message); }

  // SQLite erlaubt beim ALTER TABLE keinen nicht-konstanten Default.
  const articleCols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
  if (!articleCols.includes('updated_at')) {
    db.exec("ALTER TABLE articles ADD COLUMN updated_at TEXT");
    db.exec("UPDATE articles SET updated_at=datetime('now') WHERE updated_at IS NULL");
  }

  // email_sent_at: Zeitstempel wann Abschluss-Mail versendet wurde
  try { db.exec("ALTER TABLE orders ADD COLUMN email_sent_at TEXT"); } catch(e) { if (!e.message.includes('duplicate')) console.warn('Migration email_sent_at:', e.message); }

  // Migration: Add 'abgerechnet' status to orders
  const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get()?.sql || '';
  if (ordersSql && !ordersSql.includes("'abgerechnet'")) {
    try {
      const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
      const newTableSql = ordersSql
        .replace(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?orders"?/i, 'CREATE TABLE orders_v2')
        .replace(
          /CHECK\s*\(\s*status\s+IN\s*\([^)]+\)\s*\)/,
          "CHECK(status IN ('geplant','in_bearbeitung','abgeschlossen','abgerechnet','archiviert'))"
        );
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('DROP TABLE IF EXISTS orders_v2');
      db.exec(newTableSql);
      db.exec(`INSERT INTO orders_v2 (${cols.join(',')}) SELECT ${cols.join(',')} FROM orders`);
      db.exec('DROP TABLE orders');
      db.exec('ALTER TABLE orders_v2 RENAME TO orders');
      db.exec('PRAGMA foreign_keys = ON');
      console.log('  ✅ Status abgerechnet zur Datenbank hinzugefügt');
    } catch(e) {
      try { db.exec('PRAGMA foreign_keys = ON'); } catch {}
      console.warn('Migration abgerechnet status:', e.message);
    }
  }

  // Lieferschein inbox directories
  const uploadsDir2 = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  ['lieferscheine-inbox', 'lieferscheine-processed', 'lieferscheine-fehler'].forEach(d => {
    const p = path.join(uploadsDir2, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
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
    ['arbeit', 'montage',    'Montage',    1],
    ['arbeit', 'reparatur',  'Reparatur',  2],
    ['arbeit', 'service',    'Service',    3],
    ['arbeit', 'sonstiges',  'Sonstiges',  4],

    ['ausgefuehrte_arbeiten', 'montage_inkl_kern',  'Montage inkl. Kernbohrung',    1],
    ['ausgefuehrte_arbeiten', 'montage_exkl_kern',  'Montage exkl. Kernbohrung',    2],
    ['ausgefuehrte_arbeiten', 'mont_alarm',          'Mont. Alarm',                  3],
    ['ausgefuehrte_arbeiten', 'reparatur',           'Reparatur',                    4],
    ['ausgefuehrte_arbeiten', 'wartung_service',     'Wartung / Service',            5],

    ['zusatz_material', 'abdeckring',       'Abdeckring',         1],
    ['zusatz_material', 'koecher',          'Köcher D___ x ___',  2],
    ['zusatz_material', 'si_wetterschutz',  'Si- & Wetterschutz', 3],

    ['halteringe', 'abgegeben',        'Abgegeben',           1],
    ['halteringe', 'per_post',         'Per Post nachsenden', 2],

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
      ['Muster AG',              'Musterstrasse 1, 8000 Zürich',          'Hans Muster',     'hmuster@muster.ch',            '044 123 45 67'],
      ['Beispiel GmbH',          'Beispielweg 5, 3000 Bern',              'Anna Beispiel',   'a.beispiel@beispiel.ch',       '031 234 56 78'],
      ['Bachmann Immobilien AG', 'Bahnhofstrasse 12, 8001 Zürich',        'Peter Bachmann',  'p.bachmann@bachmann-immo.ch',  '044 200 11 22'],
      ['Klinik Sonnenhügel',     'Sonnenhügelweg 3, 8400 Winterthur',     'Dr. Eva Meier',   'e.meier@klinik-sh.ch',         '052 300 44 55'],
      ['Migros Verteilzentrum',  'Industriestrasse 88, 4600 Olten',       'Beat Frei',       'b.frei@migros.ch',             '062 311 22 33'],
      ['Gemeinde Küsnacht',      'Obere Dorfstrasse 32, 8700 Küsnacht',   'Urs Keller',      'u.keller@kueseacht.ch',        '044 913 11 00'],
      ['Hotel Bellevue',         'Seepromenade 1, 6006 Luzern',           'Sandra Brunner',  's.brunner@bellevue.ch',        '041 420 00 10'],
    ];
    const ic = db.prepare(`INSERT INTO customers (name, address, contact_name, contact_email, contact_phone) VALUES (?,?,?,?,?)`);
    customers.forEach(c => ic.run(...c));
  }

  // Demo monteure
  const monteureData = [
    { username: 'thomas.mueller', full_name: 'Thomas Müller',  email: 't.mueller@helbling.ch' },
    { username: 'stefan.weber',   full_name: 'Stefan Weber',    email: 's.weber@helbling.ch'   },
    { username: 'markus.huber',   full_name: 'Markus Huber',    email: 'm.huber@helbling.ch'   },
    { username: 'daniel.schmid',  full_name: 'Daniel Schmid',   email: 'd.schmid@helbling.ch'  },
  ];
  const monteureExist = db.prepare("SELECT id FROM users WHERE role = 'monteur' LIMIT 1").get();
  if (!monteureExist) {
    const monHash = bcrypt.hashSync('monteur123', 10);
    const iUser = db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role) VALUES (?,?,?,?,'monteur')`);
    for (const m of monteureData) iUser.run(m.username, monHash, m.full_name, m.email);
    console.log('  👷 Demo-Monteure erstellt (Passwort: monteur123)');
  }

  // Demo orders
  const ordersExist = db.prepare("SELECT id FROM orders LIMIT 1").get();
  if (!ordersExist) {
    const adminId   = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()?.id ?? 1;
    const customers = db.prepare("SELECT id, name FROM customers").all();
    const monteure  = db.prepare("SELECT id, full_name FROM users WHERE role='monteur'").all();

    function pad2(n) { return String(n).padStart(2, '0'); }
    function dateStr(offsetDays) {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    }
    function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    const installAddresses = [
      'Rosengartenstrasse 4, 8037 Zürich',      'Rebbergstrasse 17, 8049 Zürich',
      'Oberwiesenstrasse 9, 8400 Winterthur',   'Brühlgasse 22, 9000 St. Gallen',
      'Mühlegasse 3, 6300 Zug',                 'Austrasse 14, 4051 Basel',
      'Belpstrasse 33, 3007 Bern',              'Schlossgasse 8, 5000 Aarau',
      'Hauptstrasse 56, 8200 Schaffhausen',     'Löwenstrasse 11, 8001 Zürich',
      'Industriestrasse 7, 8952 Schlieren',     'Birmensdorferstrasse 201, 8003 Zürich',
      'Winterthurerstrasse 92, 8006 Zürich',    'Albisriederstrasse 5, 8047 Zürich',
      'Forchstrasse 55, 8032 Zürich',           'Seestrasse 123, 8703 Erlenbach',
      'Bergstrasse 44, 8810 Horgen',            'Zugerstrasse 18, 8810 Horgen',
      'Dorfstrasse 3, 8906 Bonstetten',         'Haldenstrasse 27, 8157 Dielsdorf',
    ];

    const workTypeOpts    = ['["montage"]','["service"]','["reparatur"]','["montage","service"]','["montage","reparatur"]'];
    const executedOpts    = ['["montage_inkl_kern"]','["montage_exkl_kern"]','["reparatur"]','["wartung_service"]','["montage_inkl_kern","mont_alarm"]'];
    const orderers        = ['Hans Muster','Anna Leuenberger','Beat Frei','Sandra Brunner'];
    const contacts        = ['Hausmeister Ruedi','Sekretariat','Herr Keller','Frau Müller'];
    const arrivals        = ['07:00','08:00','09:00','10:00','13:00','14:00'];
    const notesPlanerOpts = ['Bitte Ankunftszeit bestätigen.','Parkplatz vorhanden, Zufahrt über Hinterhof.','Schlüssel beim Hauswart abholen.',null,null];
    const timesFrom       = ['07:00','07:30','08:00','08:30','09:00'];
    const timesTo         = ['15:00','15:30','16:00','16:30','17:00'];

    const orderDefs = [
      { status:'geplant',         offset: 3,  withMonteur:false },
      { status:'geplant',         offset: 5,  withMonteur:false },
      { status:'geplant',         offset: 7,  withMonteur:false },
      { status:'geplant',         offset:10,  withMonteur:false },
      { status:'geplant',         offset:12,  withMonteur:false },
      { status:'geplant',         offset:14,  withMonteur:false },
      { status:'geplant',         offset:18,  withMonteur:false },
      { status:'geplant',         offset:21,  withMonteur:false },
      { status:'in_bearbeitung',  offset: 0,  withMonteur:true  },
      { status:'in_bearbeitung',  offset: 1,  withMonteur:true  },
      { status:'in_bearbeitung',  offset: 1,  withMonteur:true  },
      { status:'in_bearbeitung',  offset: 2,  withMonteur:true  },
      { status:'abgeschlossen',   offset: -1, withMonteur:true  },
      { status:'abgeschlossen',   offset: -2, withMonteur:true  },
      { status:'abgeschlossen',   offset: -3, withMonteur:true  },
      { status:'abgeschlossen',   offset: -5, withMonteur:true  },
      { status:'abgeschlossen',   offset: -7, withMonteur:true  },
      { status:'abgeschlossen',   offset: -9, withMonteur:true  },
      { status:'abgeschlossen',   offset:-12, withMonteur:true  },
      { status:'abgeschlossen',   offset:-15, withMonteur:true  },
    ];

    const iOrder = db.prepare(`
      INSERT INTO orders (
        order_number, status, sort_order,
        customer_id, customer_name,
        installation_address, orderer, on_site_contact,
        arrival_time, planned_date, latest_date,
        work_types, notes_planer,
        executed_work, work_date, work_time_from, work_time_to,
        technician_name, technician_block,
        assigned_to, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    orderDefs.forEach((def, i) => {
      const cust    = customers[i % customers.length];
      const monteur = def.withMonteur ? monteure[i % monteure.length] : null;
      const planned = dateStr(def.offset);
      const latest  = dateStr(def.offset + 5);
      iOrder.run(
        `H-${1001 + i}`, def.status, i + 1,
        cust.id, cust.name,
        installAddresses[i], rnd(orderers), rnd(contacts),
        rnd(arrivals), planned, latest,
        rnd(workTypeOpts), rnd(notesPlanerOpts),
        def.withMonteur ? rnd(executedOpts) : '[]',
        def.withMonteur ? planned : null,
        def.withMonteur ? rnd(timesFrom) : null,
        def.withMonteur ? rnd(timesTo)   : null,
        def.withMonteur ? monteur.full_name : null,
        def.withMonteur ? 'A' : null,
        monteur?.id ?? null,
        adminId
      );
    });
    console.log('  📋 20 Demo-Montagen erstellt (H-1001 bis H-1020)');
  }
}

module.exports = { getDb, initDatabase };
