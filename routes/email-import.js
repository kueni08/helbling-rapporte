const router = require('express').Router();
const { requireRole } = require('../middleware/auth');

router.get('/status', requireRole('admin', 'planer'), (req, res) => {
  res.json({
    enabled: false,
    provider: null,
    credentials_configured: false,
    supported_providers: ['gmail', 'microsoft365'],
    pipeline: ['Nachrichten auflisten', 'PDF-Anhänge laden', 'Lieferschein-Vorschau erzeugen', 'Benutzerfreigabe', 'Nachricht archivieren'],
    message: 'Technische Schnittstelle vorbereitet; es ist bewusst kein Postfach verbunden.',
  });
});

module.exports = router;
