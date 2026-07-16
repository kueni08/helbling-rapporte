'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const XLSX = require('xlsx');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().unref(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

async function waitFor(url, child, output) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(output.join(''));
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Testserver nicht erreichbar\n${output.join('')}`);
}

function cookie(response) { return response.headers.get('set-cookie')?.split(';')[0]; }
async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  return { response, data };
}

test('Kundenportal: Authentifizierung, Mandantentrennung, Freigabe, Dateien und Administration', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'helbling-portal-'));
  const dbPath = path.join(temp, 'portal-test.db'); const uploads = path.join(temp, 'uploads');
  const port = await freePort(); const base = `http://127.0.0.1:${port}`; const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DISABLE_WATCHERS: '1', PORT: String(port), DB_PATH: dbPath,
      UPLOADS_DIR: uploads, SESSIONS_DB_DIR: temp, SESSIONS_DB_NAME: 'internal-sessions.db',
      CUSTOMER_PORTAL_SESSIONS_DB_NAME: 'portal-sessions.db', SESSION_SECRET: 'isolated-internal-secret',
      CUSTOMER_PORTAL_SESSION_SECRET: 'isolated-portal-secret', PORTAL_MAIL_TRANSPORT: 'json', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => output.push(data.toString())); child.stderr.on('data', data => output.push(data.toString()));
  let db;
  t.after(async () => {
    if (db?.open) db.close();
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitFor(`${base}/kundenportal`, child, output);

  db = new Database(dbPath);
  const customerA = db.prepare('INSERT INTO customers (name,address) VALUES (?,?)').run('Privera AG', 'Talacker 1, 8001 Zürich').lastInsertRowid;
  const customerB = db.prepare('INSERT INTO customers (name,address) VALUES (?,?)').run('Andere AG', 'Markt 2, 9000 St. Gallen').lastInsertRowid;
  const passwordA = 'PortalTest7Pass!'; const passwordB = 'PortalTest8Pass!';
  const userA = db.prepare(`INSERT INTO customer_portal_users (customer_id,username,password_hash,full_name,email,phone,active,must_change_password) VALUES (?,?,?,?,?,?,1,0)`)
    .run(customerA, 'privera.test', bcrypt.hashSync(passwordA, 4), 'Patricia Privera', 'patricia@example.test', '044 555 11 22').lastInsertRowid;
  db.prepare(`INSERT INTO customer_portal_users (customer_id,username,password_hash,full_name,email,phone,active,must_change_password) VALUES (?,?,?,?,?,?,1,0)`)
    .run(customerB, 'andere.test', bcrypt.hashSync(passwordB, 4), 'Anton Andere', 'anton@example.test', '071 555 11 22');
  db.prepare(`INSERT INTO customer_portal_users (customer_id,username,password_hash,full_name,email,phone,active,must_change_password) VALUES (?,?,?,?,?,?,0,0)`)
    .run(customerA, 'inaktiv.test', bcrypt.hashSync(passwordA, 4), 'Inaktiv Test', 'inaktiv@example.test', '044 555 00 00');

  assert.equal((await jsonFetch(`${base}/api/kundenportal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'patricia@example.test', password: 'falsch' }) })).response.status, 401);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'inaktiv@example.test', password: passwordA }) })).response.status, 401);
  const loginA = await jsonFetch(`${base}/api/kundenportal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'patricia@example.test', password: passwordA }) });
  assert.equal(loginA.response.status, 200); const cookieA = cookie(loginA.response); const csrfA = loginA.data.csrfToken;

  const created = await jsonFetch(`${base}/api/kundenportal/orders`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(created.response.status, 201); const orderA = created.data.id;
  const orderB = db.prepare(`INSERT INTO orders (order_number,status,customer_id,customer_name,customer_portal_visible,customer_portal_status,work_types,items_table) VALUES (?,'geplant',?,?,1,'in_erfassung','[]','[]')`)
    .run('KP-TEST-B', customerB, 'Andere AG').lastInsertRowid;

  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { headers: { cookie: cookieA } })).response.status, 200);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderB}`, { headers: { cookie: cookieA } })).response.status, 404);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderB}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ project_number: 'VERBOTEN' }) })).response.status, 404);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderB}/photos/1`, { headers: { cookie: cookieA } })).response.status, 404);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ customer_id: customerB, status: 'abgeschlossen', assigned_to: 1 }) })).response.status, 400);

  const incomplete = await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ project_number: 'PR-100', customer_notes: 'Autosave ohne Pflichtfelder' }) });
  assert.equal(incomplete.response.status, 200);
  const releaseIncomplete = await jsonFetch(`${base}/api/kundenportal/orders/${orderA}/release`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(releaseIncomplete.response.status, 422); assert.ok(releaseIncomplete.data.missing.some(item => item.field === 'photos'));

  const invalidFacade = await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ facade_types: ['unbekannt', 'mauerwerk_beton'] }) });
  assert.equal(invalidFacade.response.status, 400);
  const fake = new FormData(); fake.append('photos', new Blob(['not-an-image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}/photos`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA }, body: fake })).response.status, 415);
  const oversized = new FormData(); oversized.append('photos', new Blob([Buffer.alloc(15 * 1024 * 1024 + 1)], { type: 'image/png' }), 'gross.png');
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}/photos`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA }, body: oversized })).response.status, 413);
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#1C1B78' } }).png().toBuffer();
  const valid = new FormData(); valid.append('photos', new Blob([png], { type: 'image/png' }), 'montage.png');
  const photoUpload = await jsonFetch(`${base}/api/kundenportal/orders/${orderA}/photos`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA }, body: valid });
  assert.equal(photoUpload.response.status, 201); assert.equal(photoUpload.data.length, 1);

  const completed = await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ project_number: 'PR-100', installation_name: 'Testobjekt', installation_street: 'Talacker 1', installation_postal_code: '8001', installation_city: 'Zürich', on_site_contact: 'Max Muster', on_site_contact_phone: '079 123 45 67', facade_types: ['mauerwerk_beton'] }) });
  assert.equal(completed.response.status, 200);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}/release`, { method: 'POST', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: '{}' })).response.status, 200);
  assert.ok(db.prepare("SELECT 1 FROM order_change_log WHERE order_id=? AND portal_user_id=? AND user_role='kunde'").get(orderA, userA));

  db.prepare("UPDATE orders SET status='in_bearbeitung' WHERE id=?").run(orderA);
  assert.equal((await jsonFetch(`${base}/api/kundenportal/orders/${orderA}`, { method: 'PUT', headers: { cookie: cookieA, 'x-csrf-token': csrfA, 'content-type': 'application/json' }, body: JSON.stringify({ customer_notes: 'nicht erlaubt' }) })).response.status, 423);

  const adminLogin = await jsonFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(adminLogin.response.status, 200); const adminCookie = cookie(adminLogin.response);
  const internalOrder = await jsonFetch(`${base}/api/orders`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({
    customer_id: customerA, customer_name: 'Privera AG', customer_address: 'Talacker 1, 8001 Zürich', orderer: 'Planer Test',
    installation_address: 'Test intern, Talacker 1, 8001 Zürich', on_site_contact: 'Max Muster',
    on_site_contact_phone: '079 123 45 67', on_site_contact_email: 'max@example.test', planned_date: '2026-08-01', work_types: ['montage']
  }) });
  assert.equal(internalOrder.response.status, 201); assert.equal(internalOrder.data.customer_id, customerA); assert.equal(internalOrder.data.on_site_contact_email, 'max@example.test');
  const adminCreated = await jsonFetch(`${base}/api/customer-portal-admin/users`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ customer_id: customerA, full_name: 'Privera Zwei', email: 'zwei@example.test', phone: '044 555 22 22' }) });
  assert.equal(adminCreated.response.status, 201); assert.equal(adminCreated.data.email_sent, true); assert.equal(adminCreated.data.email, 'zwei@example.test'); assert.equal(adminCreated.data.temporary_password, undefined); assert.equal(adminCreated.data.must_change_password, true);
  const reset = await jsonFetch(`${base}/api/customer-portal-admin/users/${adminCreated.data.id}/reset-password`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(reset.response.status, 200); assert.equal(reset.data.email_sent, true); assert.equal(reset.data.temporary_password, undefined);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    { 'Anlagen-/Projektnummer': 'PR-100', Objekt: 'Bereits vorhanden', Montageadresse: 'Talacker 1, 8001 Zürich', Kontaktperson: 'Max Muster', Telefon: '079 111 22 33' },
    { 'Anlagen-/Projektnummer': 'EXCEL-200', Objekt: 'Excel Objekt', Strasse: 'Bahnhofstrasse 9', PLZ: '8001', Ort: 'Zürich', Kontaktperson: 'Erika Excel', Telefon: '078 555 66 77', Montagetermin: '15.09.2026', 'Kommunizierte Zeit': '08:00 - 10:00' },
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Montageliste');
  const excelForm = new FormData(); excelForm.append('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'montageliste.xlsx');
  const preview = await jsonFetch(`${base}/api/customer-portal-admin/customers/${customerA}/order-import/preview`, { method: 'POST', headers: { cookie: adminCookie }, body: excelForm });
  assert.equal(preview.response.status, 200); assert.equal(preview.data.rows.length, 2); assert.equal(preview.data.rows[0].duplicate, true); assert.equal(preview.data.rows[1].duplicate, false); assert.equal(preview.data.rows[1].postal_code, '8001'); assert.equal(preview.data.rows[1].planned_date, '2026-09-15');
  const confirmedImport = await jsonFetch(`${base}/api/customer-portal-admin/customers/${customerA}/order-import/confirm`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ rows: [preview.data.rows[1]] }) });
  assert.equal(confirmedImport.response.status, 201); assert.equal(confirmedImport.data.imported, 1);
  const importedOrder = db.prepare("SELECT * FROM orders WHERE customer_id=? AND project_number='EXCEL-200'").get(customerA);
  assert.ok(importedOrder); assert.equal(importedOrder.customer_portal_visible, 1); assert.equal(importedOrder.installation_postal_code, '8001');
  const adminControl = await jsonFetch(`${base}/api/customer-portal-admin/orders/${orderA}`, { method: 'PUT', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ visible: true, portal_status: 'rueckfrage', locked: false }) });
  assert.equal(adminControl.response.status, 200); assert.equal(adminControl.data.portal_status, 'rueckfrage'); assert.equal(adminControl.data.locked, false);
});
