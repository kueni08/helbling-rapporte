const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireRole, requireLogin } = require('../middleware/auth');

const FIELDS = 'id, username, full_name, email, role, active, created_at';

// GET /api/users  (admin only)
router.get('/', requireRole('admin'), (req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT ${FIELDS} FROM users ORDER BY role, full_name`).all();
  res.json(users);
});

// GET /api/users/monteure  (planer + admin – for order assignment)
router.get('/monteure', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const monteure = db.prepare(`SELECT id, full_name, username FROM users WHERE role = 'monteur' AND active = 1 ORDER BY full_name`).all();
  res.json(monteure);
});

// POST /api/users  (admin only)
router.post('/', requireRole('admin'), (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Pflichtfelder: username, password, full_name, role' });
  }
  if (!['admin','planer','monteur'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
  }
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?,?,?,?,?)`).run(username, hash, full_name, email || null, role);
    const user = db.prepare(`SELECT ${FIELDS} FROM users WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    throw e;
  }
});

// PUT /api/users/:id  (admin only)
router.put('/:id', requireRole('admin'), (req, res) => {
  const { full_name, email, role, active, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  if (full_name) db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name, req.params.id);
  if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.params.id);
  if (role && ['admin','planer','monteur'].includes(role)) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  if (password && password.length >= 6) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  }

  res.json(db.prepare(`SELECT ${FIELDS} FROM users WHERE id = ?`).get(req.params.id));
});

// DELETE /api/users/:id  (admin only – soft delete)
router.delete('/:id', requireRole('admin'), (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Eigener Account kann nicht gelöscht werden' });
  }
  const db = getDb();
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
