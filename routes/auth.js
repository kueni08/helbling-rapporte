const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  req.session.userId   = user.id;
  req.session.userRole = user.role;
  req.session.fullName = user.full_name;

  res.json({
    id:       user.id,
    username: user.username,
    fullName: user.full_name,
    role:     user.role,
    email:    user.email
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get('/me', requireLogin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, full_name, email, role FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  res.json({ id: user.id, username: user.username, fullName: user.full_name, email: user.email, role: user.role });
});

// POST /api/auth/change-password  (own password)
router.post('/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Ungültige Eingabe (min. 6 Zeichen für neues Passwort)' });
  }
  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
