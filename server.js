require('dotenv').config();
const express = require('express');
const session = require('express-session');
const BetterSqliteSessionStore = require('./lib/session-store');
const path = require('path');
const fs = require('fs');

const { initDatabase, getDb } = require('./lib/database');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.set('trust proxy', 1);

function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const unsafe = new Set([
    'helbling-secret-change-me',
    'change-customer-portal-session-secret',
    'bitte-aendern-langen-zufallsstring-einfuegen'
  ]);
  const secrets = [process.env.SESSION_SECRET, process.env.CUSTOMER_PORTAL_SESSION_SECRET];
  if (secrets.some(secret => !secret || secret.length < 32 || unsafe.has(secret))) {
    throw new Error('Produktion erfordert zwei unterschiedliche Session-Secrets mit mindestens 32 Zeichen.');
  }
  if (secrets[0] === secrets[1]) {
    throw new Error('SESSION_SECRET und CUSTOMER_PORTAL_SESSION_SECRET müssen unterschiedlich sein.');
  }
}

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
const sessionsDir = process.env.SESSIONS_DB_DIR || path.join(__dirname, 'db');

app.use(session({
  name: 'helbling.staff.sid',
  store: new BetterSqliteSessionStore({
    db: process.env.SESSIONS_DB_NAME || 'sessions.db',
    dir: sessionsDir,
    ttlMs: 1000 * 60 * 60 * 24
  }),
  secret: process.env.SESSION_SECRET || 'helbling-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'test' ? false : 'auto'
  }
}));

const customerPortalSession = session({
  name: 'helbling.kundenportal.sid',
  store: new BetterSqliteSessionStore({
    db: process.env.CUSTOMER_PORTAL_SESSIONS_DB_NAME || 'customer-portal-sessions.db',
    dir: sessionsDir,
    ttlMs: 1000 * 60 * 60 * 12
  }),
  secret: process.env.CUSTOMER_PORTAL_SESSION_SECRET || process.env.SESSION_SECRET || 'change-customer-portal-session-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'test' ? false : 'auto'
  }
});

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/files',    require('./routes/files'));
app.use('/api/email',    require('./routes/email'));
app.use('/api/export',   require('./routes/export'));
app.use('/api/anfrage',       require('./routes/anfrage'));      // public customer form submit
app.use('/api/anfragen',      require('./routes/anfrage'));      // admin list/manage
app.use('/api/lieferschein',  require('./routes/lieferschein')); // PDF auto-import
app.use('/api/email-import',  require('./routes/email-import')); // provider-neutral, currently disabled
app.use('/api/kundenportal', customerPortalSession, require('./routes/customer-portal'));
app.use('/api/customer-portal-admin', require('./routes/customer-portal-admin'));

// Public customer inquiry form (new submission + token-based edit)
app.get('/anfrage', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'anfrage.html'));
});
app.get('/anfrage/f/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'anfrage.html'));
});

app.get(['/kundenportal', '/kundenportal/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'views', 'kundenportal.html'));
});

app.get('/healthz', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Serve the SPA for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB then start server
assertProductionConfig();
initDatabase();
app.listen(PORT, HOST, () => {
  console.log(`\n✅ Helbling Rapporte läuft auf http://${HOST}:${PORT}`);
});
