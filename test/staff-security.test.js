'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().unref(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

async function waitFor(url, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(output.join(''));
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Testserver nicht erreichbar\n${output.join('')}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  return { response, data: await response.json().catch(() => ({})) };
}

function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

test('Mitarbeiter-Login, Sessions und Auftragsdateien sind produktionsnah abgesichert', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'helbling-staff-security-'));
  const dbPath = path.join(temp, 'staff-security.db');
  const uploads = path.join(temp, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });

  const seed = spawnSync(process.execPath, ['-e', "require('./lib/database').initDatabase()"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, UPLOADS_DIR: uploads },
    encoding: 'utf8'
  });
  assert.equal(seed.status, 0, seed.stderr);

  const db = new Database(dbPath);
  const monteurPassword = 'MonteurTest7Pass!';
  const planerPassword = 'PlanerTest8Pass!';
  const monteurA = db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,'monteur')")
    .run('monteur.a', bcrypt.hashSync(monteurPassword, 4), 'Monteur A').lastInsertRowid;
  const monteurB = db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,'monteur')")
    .run('monteur.b', bcrypt.hashSync(monteurPassword, 4), 'Monteur B').lastInsertRowid;
  db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,'planer')")
    .run('planer.test', bcrypt.hashSync(planerPassword, 4), 'Planer Test');
  const orderA = db.prepare("INSERT INTO orders (order_number,status,assigned_to,work_types,items_table) VALUES (?,'geplant',?,'[]','[]')")
    .run('SEC-A', monteurA).lastInsertRowid;
  const orderB = db.prepare("INSERT INTO orders (order_number,status,assigned_to,work_types,items_table) VALUES (?,'geplant',?,'[]','[]')")
    .run('SEC-B', monteurB).lastInsertRowid;
  const orderDir = path.join(uploads, String(orderB)); fs.mkdirSync(orderDir, { recursive: true });
  fs.writeFileSync(path.join(orderDir, 'beleg.pdf'), 'nur-fuer-monteur-b');
  const attachmentId = db.prepare("INSERT INTO order_attachments (order_id,filename,original_name,file_type) VALUES (?,?,?,'document')")
    .run(orderB, 'beleg.pdf', 'Beleg.pdf').lastInsertRowid;
  db.close();

  const port = await freePort(); const base = `http://127.0.0.1:${port}`; const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', DISABLE_WATCHERS: '1', HOST: '127.0.0.1', PORT: String(port),
      DB_PATH: dbPath, UPLOADS_DIR: uploads, SESSIONS_DB_DIR: temp, SESSIONS_DB_NAME: 'staff-sessions.db',
      CUSTOMER_PORTAL_SESSIONS_DB_NAME: 'portal-sessions.db',
      SESSION_SECRET: 'staff-test-secret-1234567890-abcdefghijk',
      CUSTOMER_PORTAL_SESSION_SECRET: 'portal-test-secret-abcdefghij-1234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => output.push(data.toString())); child.stderr.on('data', data => output.push(data.toString()));
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitFor(`${base}/healthz`, child, output);

  const login = (username, password, cookie = '') => requestJson(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ username, password })
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login('admin', 'falsch')).response.status, 401);
  }
  assert.equal((await login('admin', 'admin123')).response.status, 401, 'Konto muss nach fünf Fehlversuchen gesperrt sein');

  const liveDb = new Database(dbPath);
  assert.ok(liveDb.prepare("SELECT locked_until FROM users WHERE username='admin'").get().locked_until);
  liveDb.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL WHERE username='admin'").run();
  liveDb.close();

  const adminLogin = await login('admin', 'admin123', 'helbling.staff.sid=vorhersehbar');
  assert.equal(adminLogin.response.status, 200);
  const setCookie = adminLogin.response.headers.get('set-cookie') || '';
  assert.match(setCookie, /^helbling\.staff\.sid=/);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; HttpOnly/i);
  assert.doesNotMatch(setCookie, /vorhersehbar/);

  const monteurALogin = await login('monteur.a', monteurPassword);
  const cookieA = sessionCookie(monteurALogin.response);
  assert.equal(monteurALogin.response.status, 200);
  assert.equal((await fetch(`${base}/api/files/${orderB}/beleg.pdf`, { headers: { cookie: cookieA } })).status, 403);
  assert.equal((await fetch(`${base}/api/files/${orderB}/attachments/${attachmentId}`, { method: 'DELETE', headers: { cookie: cookieA } })).status, 403);
  assert.equal((await fetch(`${base}/api/email/config-status`, { headers: { cookie: cookieA } })).status, 403);
  assert.equal((await fetch(`${base}/api/files/${orderA}/zip`, { headers: { cookie: cookieA } })).status, 200);

  const monteurBLogin = await login('monteur.b', monteurPassword);
  const cookieB = sessionCookie(monteurBLogin.response);
  const ownFile = await fetch(`${base}/api/files/${orderB}/beleg.pdf`, { headers: { cookie: cookieB } });
  assert.equal(ownFile.status, 200);
  assert.equal(await ownFile.text(), 'nur-fuer-monteur-b');

  const planerLogin = await login('planer.test', planerPassword);
  assert.equal((await fetch(`${base}/api/email/config-status`, { headers: { cookie: sessionCookie(planerLogin.response) } })).status, 200);
});
