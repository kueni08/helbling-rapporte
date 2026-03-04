require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('./lib/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'helbling-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/files',    require('./routes/files'));
app.use('/api/email',    require('./routes/email'));
app.use('/api/anfrage',  require('./routes/anfrage'));  // public customer form submit
app.use('/api/anfragen', require('./routes/anfrage'));  // admin list/manage

// Public customer inquiry form
app.get('/anfrage', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'anfrage.html'));
});

// Serve the SPA for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB then start server
initDatabase();
app.listen(PORT, () => {
  console.log(`\n✅ Helbling Rapporte läuft auf http://localhost:${PORT}`);
  console.log(`   Standard-Login: admin / admin123\n`);
});
