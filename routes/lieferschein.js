const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../lib/database');
const { requireRole } = require('../middleware/auth');
const { getInboxDir, processFile, confirmImport } = require('../lib/lieferschein-watcher');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, getInboxDir()),
    filename: (req, file, cb) => {
      // Originalname behalten, Konflikte mit Zeitstempel vermeiden
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `pending_${base}_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pdf') cb(null, true);
    else cb(new Error('Nur PDF-Dateien erlaubt'));
  },
});

// GET /api/lieferschein/status  – Watcher-Status und Inbox-Infos
router.get('/status', requireRole('admin', 'planer'), (req, res) => {
  const apiKeySet = !!process.env.ANTHROPIC_API_KEY;
  const inboxDir = getInboxDir();
  let inboxFiles = [];
  try {
    inboxFiles = fs.readdirSync(inboxDir)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => {
        const stat = fs.statSync(path.join(inboxDir, f));
        return { name: f, size: stat.size, mtime: stat.mtime };
      });
  } catch (_) {}

  res.json({ active: apiKeySet, inbox_dir: inboxDir, inbox_files: inboxFiles });
});

// GET /api/lieferschein/imports  – Import-History
router.get('/imports', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT li.*, o.order_number
    FROM lieferschein_imports li
    LEFT JOIN orders o ON o.id = li.order_id
    ORDER BY li.created_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

// POST /api/lieferschein/upload  – Manueller Upload (löst direkt Verarbeitung aus)
router.post('/upload', requireRole('admin', 'planer'), upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Keine Datei' });
  try {
    const previews = [];
    for (const file of req.files) previews.push(await processFile(file.path, file.originalname, null, { previewOnly: true }));
    res.json({ ok: true, previews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/confirm/:id', requireRole('admin', 'planer'), (req, res) => {
  try { res.json({ ok: true, ...confirmImport(parseInt(req.params.id), req.body?.allow_duplicate === true) }); }
  catch (e) { res.status(/Duplikat/.test(e.message) ? 409 : 400).json({ error: e.message }); }
});

// POST /api/lieferschein/retry/:id  – Fehlgeschlagenen Import erneut versuchen
router.post('/retry/:id', requireRole('admin', 'planer'), async (req, res) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM lieferschein_imports WHERE id = ?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Import nicht gefunden' });
  if (imp.status === 'processing') return res.status(409).json({ error: 'Wird bereits verarbeitet' });

  // PDF in Fehler-Ordner suchen
  const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  const fehlerPath = path.join(UPLOADS_DIR, 'lieferscheine-fehler', imp.filename);
  const inboxPath = path.join(getInboxDir(), imp.filename);

  let srcPath = null;
  if (fs.existsSync(fehlerPath)) srcPath = fehlerPath;
  else if (fs.existsSync(inboxPath)) srcPath = inboxPath;

  if (!srcPath) return res.status(404).json({ error: 'PDF-Datei nicht mehr vorhanden' });

  // Zurück in Inbox verschieben
  if (srcPath !== inboxPath) fs.copyFileSync(srcPath, inboxPath);

  // Alten Import-Eintrag löschen
  db.prepare('DELETE FROM lieferschein_imports WHERE id = ?').run(imp.id);

  try {
    await processFile(inboxPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lieferschein/drive-status  – Google Drive Poller Status
router.get('/drive-status', requireRole('admin', 'planer'), (req, res) => {
  const { getPollerStatus } = require('../lib/drive-poller');
  res.json(getPollerStatus());
});

// DELETE /api/lieferschein/imports/:id  – Import-Eintrag löschen
router.delete('/imports/:id', requireRole('admin', 'planer'), (req, res) => {
  getDb().prepare('DELETE FROM lieferschein_imports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
