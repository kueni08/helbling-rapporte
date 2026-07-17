'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Testserver wurde vorzeitig beendet.\n${output.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Testserver nicht erreichbar.\n${output.join('')}`);
}

test('Kundenanfrage: Absenden, Foto, Token-Bearbeitung und Admin-Liste', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helbling-anfrage-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: 'isolierter-kundenanfrage-test',
      DB_PATH: path.join(tempDir, 'rapporte-test.db'),
      SESSIONS_DB_DIR: tempDir,
      SESSIONS_DB_NAME: 'sessions-test.db',
      UPLOADS_DIR: path.join(tempDir, 'uploads'),
      ANTHROPIC_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await waitForServer(`${baseUrl}/anfrage`, child, output);

  const form = new FormData();
  form.set('firma', 'Privera AG');
  form.set('vorname', 'Janis');
  form.set('nachname', 'Keller');
  form.set('email', 'janis.keller@example.test');
  form.set('telefon', '071 272 31 97');
  form.set('strasse', 'Spitalstrasse 58');
  form.set('plz', '9472');
  form.set('ort', 'Grabs');
  form.set('objektart', 'Mehrfamilienhaus');
  form.set('bemerkungen', 'Montageposition gemäss Foto');
  form.append('attachments', new Blob(['test-image'], { type: 'image/png' }), 'montageposition.png');

  const createResponse = await fetch(`${baseUrl}/api/anfrage`, { method: 'POST', body: form });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.ok, true);
  assert.match(created.token, /^[a-f0-9]{32}$/);

  const invalidFileForm = new FormData();
  for (const [key, value] of [['vorname','Datei'],['nachname','Test'],['email','datei@example.test'],['telefon','079 111 22 33'],['strasse','Testweg 1'],['plz','8000'],['ort','Zürich']]) invalidFileForm.set(key, value);
  invalidFileForm.append('attachments', new Blob(['nicht erlaubt']), 'schadcode.exe');
  assert.equal((await fetch(`${baseUrl}/api/anfrage`, { method: 'POST', body: invalidFileForm })).status, 415);

  for (let index = 0; index < 3; index += 1) {
    const limitedForm = new FormData();
    for (const [key, value] of [['vorname','Rate'],['nachname',`Test${index}`],['email',`rate${index}@example.test`],['telefon','079 111 22 33'],['strasse','Testweg 1'],['plz','8000'],['ort','Zürich']]) limitedForm.set(key, value);
    assert.equal((await fetch(`${baseUrl}/api/anfrage`, { method: 'POST', body: limitedForm })).status, 201);
  }
  const blockedForm = new FormData();
  for (const [key, value] of [['vorname','Rate'],['nachname','Blockiert'],['email','blockiert@example.test'],['telefon','079 111 22 33'],['strasse','Testweg 1'],['plz','8000'],['ort','Zürich']]) blockedForm.set(key, value);
  assert.equal((await fetch(`${baseUrl}/api/anfrage`, { method: 'POST', body: blockedForm })).status, 429);

  const tokenResponse = await fetch(`${baseUrl}/api/anfrage/token/${created.token}`);
  assert.equal(tokenResponse.status, 200);
  const inquiry = await tokenResponse.json();
  assert.equal(inquiry.firma, 'Privera AG');
  assert.equal(inquiry.attachments.length, 1);
  assert.equal(inquiry.attachments[0].original_name, 'montageposition.png');

  const oversized = new FormData();
  oversized.append('attachments', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)]), 'zu-gross.pdf');
  assert.equal((await fetch(`${baseUrl}/api/anfrage/token/${created.token}`, { method: 'PUT', body: oversized })).status, 413);

  const update = new FormData();
  update.set('vorname', 'Janis');
  update.set('nachname', 'Keller');
  update.set('email', 'janis.keller@example.test');
  update.set('telefon', '071 272 31 97');
  update.set('strasse', 'Spitalstrasse 60');
  update.set('plz', '9472');
  update.set('ort', 'Grabs');
  update.set('bemerkungen', 'Montageposition vor Ort bestätigt');
  const updateResponse = await fetch(`${baseUrl}/api/anfrage/token/${created.token}`, { method: 'PUT', body: update });
  assert.equal(updateResponse.status, 200);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie');
  assert.ok(cookie);

  const listResponse = await fetch(`${baseUrl}/api/anfragen`, { headers: { cookie } });
  assert.equal(listResponse.status, 200);
  const inquiries = await listResponse.json();
  const saved = inquiries.find(item => item.id === created.id);
  assert.ok(saved);
  assert.equal(saved.strasse, 'Spitalstrasse 60');
  assert.equal(saved.bemerkungen, 'Montageposition vor Ort bestätigt');
});
