const { Database } = require('node-sqlite3-wasm');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'db');
const DB_PATH = path.join(DB_DIR, 'email-agent.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
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
      role TEXT NOT NULL CHECK(role IN ('admin','planer')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS email_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      subject TEXT,
      from_addr TEXT,
      from_name TEXT,
      to_addr TEXT,
      received_at TEXT,
      body_text TEXT,
      body_html TEXT,
      has_attachments INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'neu'
        CHECK(status IN ('neu','verarbeitet','ignoriert','fehler')),
      ai_kategorie TEXT,
      ai_zusammenfassung TEXT,
      ai_daten TEXT,
      ai_aktion TEXT,
      ai_prioritaet TEXT DEFAULT 'normal',
      ai_draft TEXT,
      thread_json TEXT,
      attachment_texts TEXT,
      source_folder TEXT,
      raw_headers TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL REFERENCES email_inbox(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type TEXT,
      file_size INTEGER,
      extracted_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  runMigrations(db);
  seedDefaults(db);
  console.log('✅ Datenbank initialisiert');
}

function runMigrations(db) {
  // Ensure email attachment directory exists
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  [
    path.join(uploadsDir, 'email-attachments'),
    path.join(uploadsDir, 'email-processed'),
    path.join(uploadsDir, 'email-fehler'),
    path.join(uploadsDir, 'email-inbox'),
  ].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function seedDefaults(db) {
  const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role)
                VALUES ('admin', ?, 'Administrator', 'admin')`).run(hash);
    console.log('  👤 Standard-Admin erstellt: admin / admin123');
  }
}

module.exports = { getDb, initDatabase };
