require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('./lib/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
  store: new FileStore({ path: path.join(__dirname, 'db', 'sessions'), ttl: 86400 * 7, retries: 0 }),
  secret: process.env.SESSION_SECRET || 'email-agent-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/email-agent', require('./routes/email-agent'));

// Serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB then start server
initDatabase();
app.listen(PORT, () => {
  console.log(`\n✅ Helbling Email-Agent läuft auf http://localhost:${PORT}`);
  console.log(`   Standard-Login: admin / admin123`);

  // Email-Agent starten (EML-Watcher + optional Microsoft Graph API)
  const emailAgent = require('./lib/email-agent');
  emailAgent.startAgent().catch(e => console.error('[Email-Agent] Start fehlgeschlagen:', e.message));
  const graphOk = emailAgent.isGraphConfigured();
  console.log(`\n📧 Email-Agent: ✅ EML-Watcher aktiv | Graph API: ${graphOk ? '✅ aktiv' : '⚠️  nicht konfiguriert'}`);
  if (graphOk) {
    const cfg = emailAgent.getGraphConfig();
    console.log(`   → Postfach: ${cfg.mailbox}`);
  }
  console.log('');
});
