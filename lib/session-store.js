'use strict';

const session = require('express-session');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class BetterSqliteSessionStore extends session.Store {
  constructor({ dir, db, ttlMs }) {
    super();
    fs.mkdirSync(dir, { recursive: true });
    this.ttlMs = ttlMs;
    this.database = new Database(path.join(dir, db));
    this.database.pragma('journal_mode = WAL');
    const sessionColumns = this.database.prepare('PRAGMA table_info(sessions)').all().map(column => column.name);
    const expectedColumns = ['sid', 'sess', 'expires_at'];
    if (sessionColumns.length && expectedColumns.some(column => !sessionColumns.includes(column))) {
      // Sessions are intentionally disposable. Drop the legacy connect-sqlite3
      // table so an upgrade cannot prevent the application from starting.
      this.database.exec('DROP TABLE sessions');
    }
    this.database.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);`);
    this.cleanupTimer = setInterval(() => this.cleanup(), 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  expiry(sessionData) {
    const cookieExpiry = sessionData?.cookie?.expires ? new Date(sessionData.cookie.expires).getTime() : 0;
    return Number.isFinite(cookieExpiry) && cookieExpiry > Date.now() ? cookieExpiry : Date.now() + this.ttlMs;
  }

  get(sid, callback) {
    try {
      const row = this.database.prepare('SELECT sess,expires_at FROM sessions WHERE sid=?').get(sid);
      if (!row || row.expires_at <= Date.now()) {
        if (row) this.database.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      this.database.prepare(`INSERT INTO sessions (sid,sess,expires_at) VALUES (?,?,?)
        ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at`)
        .run(sid, JSON.stringify(sessionData), this.expiry(sessionData));
      callback(null);
    } catch (error) { callback(error); }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      this.database.prepare('UPDATE sessions SET expires_at=? WHERE sid=?').run(this.expiry(sessionData), sid);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { this.database.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(null); }
    catch (error) { callback(error); }
  }

  clear(callback = () => {}) {
    try { this.database.prepare('DELETE FROM sessions').run(); callback(null); }
    catch (error) { callback(error); }
  }

  length(callback) {
    try { callback(null, this.database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at>?').get(Date.now()).count); }
    catch (error) { callback(error); }
  }

  cleanup() {
    try { this.database.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); }
    catch (error) { console.warn('[Session] Bereinigung fehlgeschlagen:', error.message); }
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.database.close();
  }
}

module.exports = BetterSqliteSessionStore;
