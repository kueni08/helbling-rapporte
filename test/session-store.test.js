'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const BetterSqliteSessionStore = require('../lib/session-store');

test('Alte Sitzungsdatenbank wird kontrolliert ersetzt', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helbling-session-'));

  const databasePath = path.join(dir, 'sessions.db');
  const legacyDatabase = new Database(databasePath);
  legacyDatabase.exec(`CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    expired INTEGER,
    sess TEXT
  )`);
  legacyDatabase.close();

  const store = new BetterSqliteSessionStore({ dir, db: 'sessions.db', ttlMs: 60_000 });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const columns = store.database.prepare('PRAGMA table_info(sessions)').all().map(column => column.name);
  assert.deepEqual(columns, ['sid', 'sess', 'expires_at']);

  const sessionData = { cookie: {}, userId: 42 };
  await new Promise((resolve, reject) => store.set('test-session', sessionData, error => error ? reject(error) : resolve()));
  const stored = await new Promise((resolve, reject) => store.get('test-session', (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(stored.userId, 42);
});
