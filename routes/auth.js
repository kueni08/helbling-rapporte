'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../lib/database');
const { requireLogin } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rate-limit');

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const loginRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
const dummyPasswordHash = bcrypt.hashSync('kein-gueltiges-passwort', 10);

function isLocked(user) {
  if (!user?.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

router.post('/login', loginRateLimit, (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').get(username);
  const passwordMatches = bcrypt.compareSync(password, user?.password_hash || dummyPasswordHash);
  if (!user || isLocked(user) || !passwordMatches) {
    if (user && !isLocked(user)) {
      const failures = Number(user.failed_login_count || 0) + 1;
      const lockedUntil = failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;
      db.prepare('UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?').run(failures, lockedUntil, user.id);
    }
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  req.session.regenerate(error => {
    if (error) return next(error);
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.fullName = user.full_name;
    db.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=datetime('now') WHERE id=?").run(user.id);
    req.session.save(saveError => {
      if (saveError) return next(saveError);
      res.json({ id: user.id, username: user.username, fullName: user.full_name, role: user.role, email: user.email });
    });
  });
});

router.post('/logout', requireLogin, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('helbling.staff.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireLogin, (req, res) => {
  const user = getDb().prepare('SELECT id,username,full_name,email,role FROM users WHERE id=? AND active=1').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json({ id: user.id, username: user.username, fullName: user.full_name, email: user.email, role: user.role });
});

router.post('/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !validPassword(newPassword)) {
    return res.status(400).json({ error: 'Neues Passwort: mindestens 12 Zeichen, Gross-/Kleinbuchstaben und eine Zahl.' });
  }
  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id=? AND active=1').get(req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  }
  db.prepare("UPDATE users SET password_hash=?,password_changed_at=datetime('now'),failed_login_count=0,locked_until=NULL WHERE id=?")
    .run(bcrypt.hashSync(newPassword, 12), req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
