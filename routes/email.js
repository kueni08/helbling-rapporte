const router = require('express').Router();
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../lib/database');
const { requireLogin } = require('../middleware/auth');
const drive = require('../lib/drive');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

function getSmtpConfig() {
  const db = getDb();
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  return {
    host: get('smtp_host') || process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(get('smtp_port') || process.env.SMTP_PORT || '587'),
    user: get('smtp_user') || process.env.SMTP_USER,
    pass: get('smtp_pass') || process.env.SMTP_PASS,
    from: get('smtp_from') || '',
  };
}

function getTransporter() {
  const cfg = getSmtpConfig();
  return nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.port === 465,
    auth:   { user: cfg.user, pass: cfg.pass },
    tls:    { ciphers: 'SSLv3' }
  });
}

function buildHtmlReport(order, attachments, photos) {
  const fmt = v => v || '–';
  const fmtArr = v => Array.isArray(v) ? v.join(', ') : fmt(v);

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:20px}
  h1{font-size:18px;color:#1a3a6b;border-bottom:2px solid #1a3a6b;padding-bottom:6px}
  h2{font-size:14px;color:#1a3a6b;margin-top:20px;border-bottom:1px solid #ccc;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  td{padding:5px 8px;border:1px solid #ddd;vertical-align:top}
  td:first-child{font-weight:bold;width:35%;background:#f5f7ff;white-space:nowrap}
  .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;background:#e8f0fe;color:#1a3a6b}
</style></head><body>
<h1>Montagerapport Nr. ${fmt(order.order_number)}</h1>

<h2>Auftragsinformation</h2>
<table>
  <tr><td>Status</td><td><span class="badge">${fmt(order.status)}</span></td></tr>
  <tr><td>Kunde</td><td>${fmt(order.customer_name)}</td></tr>
  <tr><td>Kundenadresse</td><td>${fmt(order.customer_address)}</td></tr>
  <tr><td>Montageadresse</td><td>${fmt(order.installation_address)}</td></tr>
  <tr><td>Besteller</td><td>${fmt(order.orderer)}</td></tr>
  <tr><td>Kontaktperson vor Ort</td><td>${fmt(order.on_site_contact)}</td></tr>
  <tr><td>Kommunizierte Ankunftszeit</td><td>${fmt(order.arrival_time)}</td></tr>
  <tr><td>Vorgesehenes Montagedatum</td><td>${fmt(order.planned_date)}</td></tr>
  <tr><td>Spätestes Montagedatum</td><td>${fmt(order.latest_date)}</td></tr>
  <tr><td>Arbeit</td><td>${fmtArr(order.work_types)}</td></tr>
  ${order.notes_planer ? `<tr><td>Bemerkungen (Planer)</td><td>${fmt(order.notes_planer)}</td></tr>` : ''}
</table>

<h2>Ausgeführte Arbeiten</h2>
<table>
  <tr><td>Ausgeführte Arbeiten</td><td>${fmtArr(order.executed_work)}</td></tr>
  ${order.notes_monteur ? `<tr><td>Bemerkungen</td><td>${fmt(order.notes_monteur)}</td></tr>` : ''}
  <tr><td>Datum</td><td>${fmt(order.work_date)}</td></tr>
  <tr><td>Arbeitszeit (von – bis)</td><td>${fmt(order.work_time_from)} – ${fmt(order.work_time_to)}</td></tr>
  <tr><td>Techniker</td><td>${fmt(order.technician_name)}</td></tr>
  <tr><td>Blockschrift</td><td>${fmt(order.technician_block)}</td></tr>
</table>

${order.items_table && order.items_table.length ? `
<h2>Material / Positionen</h2>
<table>
  <tr><td style="background:#e8f0fe;font-weight:bold">Artikel</td><td style="background:#e8f0fe;font-weight:bold">Menge</td><td style="background:#e8f0fe;font-weight:bold">Einheit</td></tr>
  ${order.items_table.map(i => `<tr><td>${i.name||''}</td><td>${i.quantity||''}</td><td>${i.unit||''}</td></tr>`).join('')}
</table>` : ''}

${order.additional_material && order.additional_material.length ? `
<h2>Zusätzliches Material</h2>
<p>${fmtArr(order.additional_material)}</p>` : ''}

<h2>Halteringe & Schlüssel</h2>
<table>
  <tr><td>Halteringe</td><td>${fmt(order.rings_data?.type)} ${order.rings_data?.count ? `– ${order.rings_data.count} Stk.` : ''} ${order.rings_data?.note || ''}</td></tr>
  <tr><td>Schlüssel</td><td>${fmt(order.keys_data?.type)} ${order.keys_data?.count ? `– ${order.keys_data.count} Stk.` : ''} ${order.keys_data?.id ? `Nr. ${order.keys_data.id}` : ''} ${order.keys_data?.note || ''}</td></tr>
</table>

${order.signature_data ? `
<h2>Unterschrift</h2>
<p><img src="${order.signature_data}" style="border:1px solid #ccc;max-width:300px;max-height:150px"></p>` : ''}

<p style="margin-top:30px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:10px">
  Es gelten unsere AGB's. | Erstellt: ${new Date().toLocaleString('de-CH')}
</p>
</body></html>`;
}

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
      rings_data:          JSON.parse(order.rings_data || '{}'),
      keys_data:           JSON.parse(order.keys_data || '{}'),
    };

    const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(orderId);

    const mailAttachments = attachments.map(att => {
      const candidates = [];
      if (att.dir_name) candidates.push(path.join(UPLOADS_DIR, att.dir_name, att.filename));
      candidates.push(path.join(UPLOADS_DIR, String(orderId), att.filename));
      const fp = candidates.find(p => fs.existsSync(p));
      if (fp) return { filename: att.original_name, path: fp };
      return null;
    }).filter(Boolean);

    const htmlReport = buildHtmlReport(parsedOrder, attachments, []);

    const transporter = getTransporter();
    await transporter.sendMail({
      from:    `"Helbling Rapporte" <${smtpCfg.from || smtpCfg.user}>`,
      to,
      subject: subject || `Montagerapport ${order.order_number} – ${order.customer_name || ''}`,
      html:    htmlReport,
      attachments: mailAttachments
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
