const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../lib/database');
const { requireLogin } = require('../middleware/auth');
const drive = require('../lib/drive');
const { getSmtpConfig, getTransporter, buildHtmlReport, generatePdf } = require('../lib/mailer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

// POST /api/email/send
router.post('/send', requireLogin, async (req, res) => {
  const { orderId, to, subject } = req.body;
  if (!orderId || !to) return res.status(400).json({ error: 'orderId und to erforderlich' });

  const smtpCfg = getSmtpConfig();
  if (!smtpCfg.user || !smtpCfg.pass) {
    return res.status(503).json({ error: 'E-Mail nicht konfiguriert – bitte SMTP-Einstellungen in Einstellungen → E-Mail speichern' });
  }

  const db = getDb();
  const order = db.prepare(`
    SELECT o.*, c.name AS cust_name FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });

  try {
    const parsedOrder = {
      ...order,
      work_types:          JSON.parse(order.work_types || '[]'),
      executed_work:       JSON.parse(order.executed_work || '[]'),
      items_table:         JSON.parse(order.items_table || '[]'),
      additional_material: JSON.parse(order.additional_material || '[]'),
      extra_material:      JSON.parse(order.extra_material || '[]'),
      rings_data:          JSON.parse(order.rings_data || '{}'),
      keys_data:           JSON.parse(order.keys_data || '{}'),
    };

    const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(orderId);
    const photos      = db.prepare('SELECT * FROM order_photos      WHERE order_id = ?').all(orderId);

    const resolveFile = (row) => {
      const candidates = [];
      if (row.dir_name) candidates.push(path.join(UPLOADS_DIR, row.dir_name, row.filename));
      candidates.push(path.join(UPLOADS_DIR, String(orderId), row.filename));
      const fp = candidates.find(p => fs.existsSync(p));
      return fp ? { filename: row.original_name, path: fp } : null;
    };

    const mailAttachments = [
      ...attachments.map(resolveFile),
      ...photos.map(resolveFile),
    ].filter(Boolean);

    const htmlReport = buildHtmlReport(parsedOrder, attachments, photos);

    // Generate PDF
    let pdfAttachment = null;
    try {
      const pdfBuffer = await generatePdf(htmlReport);
      pdfAttachment = {
        filename: `Installationsrapport_${order.order_number || orderId}.pdf`,
        content:  pdfBuffer,
        contentType: 'application/pdf',
      };
    } catch (pdfErr) {
      console.warn('[Email] PDF-Generierung fehlgeschlagen:', pdfErr.message);
    }

    const transporter = getTransporter();
    await transporter.sendMail({
      from:    `"Helbling Rapporte" <${smtpCfg.from || smtpCfg.user}>`,
      to,
      subject: subject || `Installationsrapport ${order.order_number} – ${order.customer_name || ''}`,
      html:    htmlReport,
      attachments: [...mailAttachments, ...(pdfAttachment ? [pdfAttachment] : [])],
    });

    // Rapport als HTML in Drive speichern
    if (drive.isDriveEnabled()) {
      const tmpFile = path.join(require('os').tmpdir(), `rapport_${order.order_number || orderId}_${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlReport, 'utf8');
      const dirName = (() => {
        const att = db.prepare('SELECT dir_name FROM order_attachments WHERE order_id = ? AND dir_name IS NOT NULL LIMIT 1').get(orderId);
        const ph  = db.prepare('SELECT dir_name FROM order_photos    WHERE order_id = ? AND dir_name IS NOT NULL LIMIT 1').get(orderId);
        return (att || ph)?.dir_name || null;
      })();
      drive.uploadFile(tmpFile, `Rapport_${order.order_number || orderId}.html`, 'text/html', dirName)
        .then(() => { try { fs.unlinkSync(tmpFile); } catch {} })
        .catch(e => { console.error('[Drive] Rapport upload error:', e.message); try { fs.unlinkSync(tmpFile); } catch {} });
    }

    res.json({ ok: true, message: `E-Mail an ${to} gesendet` });
  } catch (e) {
    console.error('E-Mail Fehler:', e);
    res.status(500).json({ error: `E-Mail konnte nicht gesendet werden: ${e.message}` });
  }
});

// GET /api/email/rapport/:orderId – returns rapport HTML for print/preview
router.get('/rapport/:orderId', requireLogin, (req, res) => {
  const db = getDb();
  const orderId = parseInt(req.params.orderId);
  const order = db.prepare(`SELECT o.*, c.name AS cust_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`).get(orderId);
  if (!order) return res.status(404).send('Auftrag nicht gefunden');

  const parsedOrder = {
    ...order,
    work_types:          JSON.parse(order.work_types || '[]'),
    executed_work:       JSON.parse(order.executed_work || '[]'),
    items_table:         JSON.parse(order.items_table || '[]'),
    additional_material: JSON.parse(order.additional_material || '[]'),
    extra_material:      JSON.parse(order.extra_material || '[]'),
    rings_data:          JSON.parse(order.rings_data || '{}'),
    keys_data:           JSON.parse(order.keys_data || '{}'),
  };
  const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(orderId);
  const photos      = db.prepare('SELECT * FROM order_photos      WHERE order_id = ?').all(orderId);
  const html = buildHtmlReport(parsedOrder, attachments, photos);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /api/email/config-status
router.get('/config-status', requireLogin, (req, res) => {
  const cfg = getSmtpConfig();
  res.json({
    configured: !!(cfg.user && cfg.pass),
    host: cfg.host,
    user: cfg.user || null
  });
});

module.exports = router;
