#!/usr/bin/env node
/**
 * Seed-Script: 4 Monteure + 20 Montagen
 * Aufruf: node scripts/seed.js
 */

require('dotenv').config();
const { Database } = require('node-sqlite3-wasm');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db', 'rapporte.db');
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── 1. Monteure ────────────────────────────────────────────────────────────

const monteure = [
  { username: 'thomas.mueller',  full_name: 'Thomas Müller',   email: 't.mueller@helbling.ch' },
  { username: 'stefan.weber',    full_name: 'Stefan Weber',     email: 's.weber@helbling.ch'   },
  { username: 'markus.huber',    full_name: 'Markus Huber',     email: 'm.huber@helbling.ch'   },
  { username: 'daniel.schmid',   full_name: 'Daniel Schmid',    email: 'd.schmid@helbling.ch'  },
];

console.log('\n👤 Erstelle Monteure...');
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role)
  VALUES (?, ?, ?, ?, 'monteur')
`);
const hash = bcrypt.hashSync('monteur123', 10);
for (const m of monteure) {
  const info = insertUser.run(m.username, hash, m.full_name, m.email);
  if (info.changes) console.log(`  ✅ ${m.full_name} (${m.username} / monteur123)`);
  else              console.log(`  ⏭  ${m.full_name} bereits vorhanden`);
}

// IDs abrufen
const monteureRows = db.prepare(`SELECT id, full_name FROM users WHERE role = 'monteur'`).all();
const adminRow     = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
const adminId      = adminRow?.id ?? 1;

// ─── 2. Kunden (ergänzen) ───────────────────────────────────────────────────

const extraCustomers = [
  ['Bachmann Immobilien AG',  'Bahnhofstrasse 12, 8001 Zürich',         'Peter Bachmann',  'p.bachmann@bachmann-immo.ch',  '044 200 11 22'],
  ['Klinik Sonnenhügel',      'Sonnenhügelweg 3, 8400 Winterthur',      'Dr. Eva Meier',   'e.meier@klinik-sh.ch',         '052 300 44 55'],
  ['Migros Verteilzentrum',   'Industriestrasse 88, 4600 Olten',        'Beat Frei',       'b.frei@migros.ch',             '062 311 22 33'],
  ['Gemeinde Küsnacht',       'Obere Dorfstrasse 32, 8700 Küsnacht',    'Urs Keller',      'u.keller@kueseacht.ch',        '044 913 11 00'],
  ['Hotel Bellevue',          'Seepromenade 1, 6006 Luzern',            'Sandra Brunner',  's.brunner@bellevue.ch',        '041 420 00 10'],
];

const insertCust = db.prepare(`
  INSERT OR IGNORE INTO customers (name, address, contact_name, contact_email, contact_phone)
  VALUES (?, ?, ?, ?, ?)
`);
for (const c of extraCustomers) insertCust.run(...c);

const allCustomers = db.prepare(`SELECT id, name FROM customers`).all();

// ─── 3. Montagen ────────────────────────────────────────────────────────────

const workTypeOptions = [
  '["montage"]',
  '["service"]',
  '["reparatur"]',
  '["montage","service"]',
  '["montage","reparatur"]',
];

const executedWorkOptions = [
  '["montage_inkl_kern"]',
  '["montage_exkl_kern"]',
  '["reparatur"]',
  '["wartung_service"]',
  '["montage_inkl_kern","mont_alarm"]',
];

const statuses = ['geplant', 'geplant', 'geplant', 'in_bearbeitung', 'in_bearbeitung', 'abgeschlossen'];

const installAddresses = [
  'Rosengartenstrasse 4, 8037 Zürich',
  'Rebbergstrasse 17, 8049 Zürich',
  'Oberwiesenstrasse 9, 8400 Winterthur',
  'Brühlgasse 22, 9000 St. Gallen',
  'Mühlegasse 3, 6300 Zug',
  'Austrasse 14, 4051 Basel',
  'Belpstrasse 33, 3007 Bern',
  'Schlossgasse 8, 5000 Aarau',
  'Hauptstrasse 56, 8200 Schaffhausen',
  'Löwenstrasse 11, 8001 Zürich',
  'Industriestrasse 7, 8952 Schlieren',
  'Birmensdorferstrasse 201, 8003 Zürich',
  'Winterthurerstrasse 92, 8006 Zürich',
  'Albisriederstrasse 5, 8047 Zürich',
  'Forchstrasse 55, 8032 Zürich',
  'Seestrasse 123, 8703 Erlenbach',
  'Bergstrasse 44, 8810 Horgen',
  'Zugerstrasse 18, 8810 Horgen',
  'Dorfstrasse 3, 8906 Bonstetten',
  'Haldenstrasse 27, 8157 Dielsdorf',
];

const notesPlanerOptions = [
  'Bitte Ankunftszeit bestätigen.',
  'Parkplatz vorhanden, Zufahrt über Hinterhof.',
  'Schlüssel beim Hauswart abholen.',
  'Zugang nur werktags 07:00–17:00.',
  null,
  null,
];

const arrivals = ['07:00', '08:00', '09:00', '10:00', '13:00', '14:00'];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const insertOrder = db.prepare(`
  INSERT INTO orders (
    order_number, status, sort_order,
    customer_id, customer_name, customer_address,
    installation_address, orderer, on_site_contact,
    arrival_time, planned_date, latest_date,
    work_types, notes_planer,
    executed_work, work_date, work_time_from, work_time_to,
    technician_name, technician_block,
    assigned_to, created_by
  ) VALUES (
    ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?, ?
  )
`);

console.log('\n📋 Erstelle Montagen...');

// Bestehende Auftragsnummern abfragen
const existingNrs = new Set(
  db.prepare(`SELECT order_number FROM orders WHERE order_number IS NOT NULL`).all().map(r => r.order_number)
);

let created = 0;
let nr = 1001;

const orderData = [
  // geplant (zukünftig)
  { statusIdx: 0, dateOffset: 3,  withMonteur: false },
  { statusIdx: 0, dateOffset: 5,  withMonteur: false },
  { statusIdx: 0, dateOffset: 7,  withMonteur: false },
  { statusIdx: 0, dateOffset: 10, withMonteur: false },
  { statusIdx: 0, dateOffset: 12, withMonteur: false },
  { statusIdx: 0, dateOffset: 14, withMonteur: false },
  { statusIdx: 0, dateOffset: 18, withMonteur: false },
  { statusIdx: 0, dateOffset: 21, withMonteur: false },
  // in_bearbeitung (heute / morgen)
  { statusIdx: 3, dateOffset: 0,  withMonteur: true  },
  { statusIdx: 3, dateOffset: 1,  withMonteur: true  },
  { statusIdx: 3, dateOffset: 1,  withMonteur: true  },
  { statusIdx: 3, dateOffset: 2,  withMonteur: true  },
  // abgeschlossen (Vergangenheit)
  { statusIdx: 5, dateOffset: -1, withMonteur: true  },
  { statusIdx: 5, dateOffset: -2, withMonteur: true  },
  { statusIdx: 5, dateOffset: -3, withMonteur: true  },
  { statusIdx: 5, dateOffset: -5, withMonteur: true  },
  { statusIdx: 5, dateOffset: -7, withMonteur: true  },
  { statusIdx: 5, dateOffset: -9, withMonteur: true  },
  { statusIdx: 5, dateOffset:-12, withMonteur: true  },
  { statusIdx: 5, dateOffset:-15, withMonteur: true  },
];

for (let i = 0; i < orderData.length; i++) {
  const { statusIdx, dateOffset, withMonteur } = orderData[i];
  const status   = statuses[statusIdx];
  const cust     = rnd(allCustomers);
  const monteur  = withMonteur ? rnd(monteureRows) : null;
  const plannedDate = dateStr(dateOffset);
  const latestDate  = dateStr(dateOffset + 5);

  // Eindeutige Nummer finden
  while (existingNrs.has(`H-${nr}`)) nr++;
  const orderNumber = `H-${nr}`;
  existingNrs.add(orderNumber);
  nr++;

  const workTimeFrom = rnd(['07:00','07:30','08:00','08:30','09:00']);
  const workTimeTo   = rnd(['15:00','15:30','16:00','16:30','17:00']);

  insertOrder.run(
    orderNumber,
    status,
    i + 1,
    cust.id,
    cust.name,
    null,                         // customer_address (aus Kunde)
    installAddresses[i],
    rnd(['Hans Muster','Anna Leuenberger','Beat Frei','Sandra Brunner']),
    rnd(['Hausmeister Ruedi','Sekretariat','Herr Keller','Frau Müller']),
    rnd(arrivals),
    plannedDate,
    latestDate,
    rnd(workTypeOptions),
    rnd(notesPlanerOptions),
    // Monteur-Felder
    withMonteur ? rnd(executedWorkOptions) : '[]',
    withMonteur ? plannedDate : null,
    withMonteur ? workTimeFrom : null,
    withMonteur ? workTimeTo   : null,
    withMonteur ? monteur.full_name : null,
    withMonteur ? 'A' : null,
    monteur?.id ?? null,
    adminId
  );

  console.log(`  ✅ ${orderNumber} | ${status.padEnd(16)} | ${cust.name.substring(0,25).padEnd(25)} | ${installAddresses[i].substring(0,35)}`);
  created++;
}

console.log(`\n✅ ${created} Montagen erstellt.\n`);
console.log('🔑 Login Monteure: <username> / monteur123\n');
db.close();
