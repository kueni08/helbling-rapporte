'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Lieferschein: korrigierte Vorschau wird in den Auftrag übernommen', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helbling-ls-preview-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(tempDir, 'rapporte-test.db');
  process.env.UPLOADS_DIR = path.join(tempDir, 'uploads');

  const { initDatabase, getDb } = require('../lib/database');
  const { confirmImport, getInboxDir } = require('../lib/lieferschein-watcher');
  initDatabase();
  const db = getDb();
  fs.mkdirSync(getInboxDir(), { recursive: true });

  t.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filename = 'pending_test-lieferschein.pdf';
  fs.writeFileSync(path.join(getInboxDir(), filename), Buffer.from('%PDF-1.4 test'));
  const original = {
    lieferschein_nr: 'LS-ALT',
    projekt_nr: 'P-ALT',
    montagetermin: '2026-07-20',
    kunde: { name: 'Falsch AG', strasse: 'Altweg 1', plz: '8000', ort: 'Zürich' },
    montage_objekt: 'Altes Objekt',
    montage_strasse: 'Altweg 1',
    montage_plz: '8000',
    montage_ort: 'Zürich',
    artikel: [{ artikel_nr: 'ALT', beschreibung: 'Alter Artikel', menge: 1, einheit: 'Stk.' }],
  };
  const inserted = db.prepare(`INSERT INTO lieferschein_imports
    (filename, original_name, status, lieferschein_nr, kunde, projekt_nr, lieferdatum, raw_json, file_hash)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`).run(
      filename, 'Test Lieferschein.pdf', original.lieferschein_nr, original.kunde.name,
      original.projekt_nr, original.montagetermin, JSON.stringify(original), 'test-hash'
    );

  const edited = {
    lieferschein_nr: 'LS-KORRIGIERT',
    projekt_nr: 'P-2245',
    montagetermin: '2026-07-25',
    iz: 'MK',
    uz: 'HE',
    kunde: { name: 'Privera AG', strasse: 'Täfernstrasse 16', plz: '5405', ort: 'Baden-Dättwil', land: 'Schweiz' },
    montage_objekt: 'Spital Grabs',
    montage_strasse: 'Spitalstrasse 44',
    montage_plz: '9472',
    montage_ort: 'Grabs',
    kontaktperson_vor_ort: 'Max Muster',
    kontaktperson_vor_ort_telefon: '079 111 22 33',
    artikel: [{
      artikel_nr: 'Z1500000', beschreibung: 'Montage Schlüsselbox SIBOX 105', menge: '2',
      einheit: 'Stk.', ist_schluessebox_montage: true, durchmesser: '80', ist_fremdfabrikat: false,
    }],
  };

  const result = confirmImport(Number(inserted.lastInsertRowid), false, edited);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(result.orderId);
  assert.equal(order.customer_name, 'Privera AG');
  assert.equal(order.project_number, 'P-2245');
  assert.equal(order.planned_date, '2026-07-25');
  assert.equal(order.installation_address, 'Spital Grabs, Spitalstrasse 44, 9472 Grabs');
  assert.equal(order.on_site_contact, 'Max Muster');
  assert.equal(order.on_site_contact_phone, '079 111 22 33');
  assert.match(order.notes_planer, /Lieferschein-Nr\.: LS-KORRIGIERT/);
  const items = JSON.parse(order.items_table);
  assert.deepEqual(items[0], {
    quantity: 2,
    name: 'Montage Schlüsselbox SIBOX 105',
    unit: 'Stk.',
    article_number: 'Z1500000',
  });
  assert.deepEqual(JSON.parse(order.work_types), ['montage']);
});
