const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./database');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

const SIBOX_EMAIL = 'sibox@helbling.net';

async function generatePdf(htmlContent) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

const PDF_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

async function generatePdfSafe(order, attachments, photos) {
  const html = buildHtmlReport(order, attachments, photos);
  const pdf = await generatePdf(html);
  if (pdf.length > PDF_MAX_BYTES) {
    console.warn(`[PDF] Dokument zu gross (${Math.round(pdf.length / 1024 / 1024)} MB), generiere ohne Fotos`);
    const htmlNoPhotos = buildHtmlReport(order, attachments, photos, { embedPhotos: false });
    return await generatePdf(htmlNoPhotos);
  }
  return pdf;
}

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
    host:       cfg.host,
    port:       cfg.port,
    secure:     cfg.port === 465,
    requireTLS: cfg.port === 587,
    auth:       { user: cfg.user, pass: cfg.pass },
    tls:        { ciphers: 'SSLv3', rejectUnauthorized: false }
  });
}

function buildHtmlReport(order, attachments, photos, opts = {}) {
  const embedPhotos = opts.embedPhotos !== false;
  const fmt = v => v || '–';
  const fmtArr = v => Array.isArray(v) ? v.join(', ') : fmt(v);
  const hasVal = v => v != null && v !== '' && v !== '–' && !(Array.isArray(v) && v.length === 0);

  // Load letterhead image as base64 if available
  let headerImgHtml = '';
  const letterheadPath = path.join(__dirname, '..', 'public', 'images', 'letterhead.png');
  if (fs.existsSync(letterheadPath)) {
    const imgBase64 = fs.readFileSync(letterheadPath).toString('base64');
    headerImgHtml = `<img src="data:image/png;base64,${imgBase64}" style="max-width:100%;height:auto;display:block;margin-bottom:16px" alt="Helbling & Co. AG">`;
  }

  // Conditional row helper – skips row if value is empty
  const row = (label, val) => hasVal(val) ? `<tr><td>${label}</td><td>${val}</td></tr>` : '';

  // Build article number → short name lookup from articles table
  const db = getDb();
  const articleRows = db.prepare('SELECT article_number, name FROM articles WHERE active = 1').all();
  const artLookup = new Map(articleRows.map(a => [a.article_number, a.name]));

  // Rings section – only show if filled
  const ringsData = order.rings_data || {};
  const ringsVal = [ringsData.type, ringsData.count ? `${ringsData.count} Stk.` : null, ringsData.note]
    .filter(Boolean).join(' – ');
  const ringsRow = ringsVal ? `<tr><td>Halteringe abgegeben</td><td>${ringsVal}</td></tr>` : '';

  // Keys section – only show if filled
  const keysData = order.keys_data || {};
  const keysVal = [keysData.type, keysData.count ? `${keysData.count} Stk.` : null,
    keysData.id ? `Nr. ${keysData.id}` : null, keysData.note].filter(Boolean).join(' – ');
  const keysRow = keysVal ? `<tr><td>Schlüssel</td><td>${keysVal}</td></tr>` : '';

  // Only show rings/keys section if at least one has data
  const ringsKeysSection = (ringsRow || keysRow) ? `
<h2>Halteringe & Schlüssel</h2>
<table>${ringsRow}${keysRow}</table>` : '';

  // Extra material (Nicht auf LS) – highlighted in amber
  const extraMaterialSection = (order.extra_material && order.extra_material.length) ? `
<h2 style="color:#b45309;border-bottom-color:#d48a00">⚠️ Zusätzliches Material (nicht auf LS)</h2>
<table style="border:2px solid #d48a00">
  <tr><td style="background:#fff3cd;font-weight:bold;border-color:#d48a00">Artikel</td><td style="background:#fff3cd;font-weight:bold;width:80px;border-color:#d48a00">Menge</td><td style="background:#fff3cd;font-weight:bold;width:70px;border-color:#d48a00">Einheit</td></tr>
  ${order.extra_material.map(i => {
    const dispName = (i.article_number && artLookup.get(i.article_number)) || i.name || '';
    return `<tr><td style="border-color:#d48a00">${dispName}</td><td style="border-color:#d48a00">${i.quantity||''}</td><td style="border-color:#d48a00">${i.unit||''}</td></tr>`;
  }).join('')}
</table>` : '';

  // Mehraufwände
  const mehrauffwandSection = (order.extra_aufwand || order.extra_argumentation) ? `
<h2>Mehraufwand</h2>
<table>
  ${order.extra_aufwand ? `<tr><td>Mehraufwand</td><td>${order.extra_aufwand} Std.</td></tr>` : ''}
  ${order.extra_argumentation ? `<tr><td>Begründung</td><td>${order.extra_argumentation}</td></tr>` : ''}
</table>` : '';

  // Photo gallery – only technician (monteur) photos, 3 per row at ~50mm width
  // Build set of photo IDs uploaded by monteur-role users
  const monteurPhotoIds = order.id
    ? new Set(
        db.prepare(`
          SELECT p.id FROM order_photos p
          JOIN users u ON u.id = p.uploaded_by
          WHERE p.order_id = ? AND u.role = 'monteur'
        `).all(order.id).map(r => r.id)
      )
    : null; // null = no filtering possible (include all)
  const rapportPhotos = monteurPhotoIds
    ? (photos || []).filter(p => monteurPhotoIds.has(p.id))
    : (photos || []);

  let photosSection = '';
  if (embedPhotos && rapportPhotos.length) {
    const photoImgs = rapportPhotos.map(p => {
      const candidates = [];
      if (p.dir_name) candidates.push(path.join(UPLOADS_DIR, p.dir_name, p.filename));
      candidates.push(path.join(UPLOADS_DIR, String(order.id), p.filename));
      const fp = candidates.find(c => fs.existsSync(c));
      if (!fp) return null;
      try {
        const ext = path.extname(p.filename).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        const b64 = fs.readFileSync(fp).toString('base64');
        return `<div style="width:calc(33.333% - 6px);box-sizing:border-box"><img src="data:${mime};base64,${b64}" style="width:100%;max-height:120px;object-fit:cover;border:1px solid #ddd;border-radius:4px" alt="Foto"></div>`;
      } catch { return null; }
    }).filter(Boolean);

    if (photoImgs.length) {
      photosSection = `
<h2>Fotos</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px">${photoImgs.join('')}</div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:20px}
  h1{font-size:18px;color:#1a3a6b;border-bottom:2px solid #1a3a6b;padding-bottom:6px}
  h2{font-size:14px;color:#1a3a6b;margin-top:20px;border-bottom:1px solid #ccc;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  td{padding:5px 8px;border:1px solid #ddd;vertical-align:top}
  td:first-child{font-weight:bold;width:35%;background:#f5f7ff;white-space:nowrap}
  .footer{margin-top:30px;font-size:11px;color:#555;border-top:2px solid #1a3a6b;padding-top:12px}
</style></head><body>

${headerImgHtml}

<h1>Installationsrapport Nr. ${fmt(order.order_number)}</h1>

<h2>Auftragsinformation</h2>
<table>
  ${row('Kunde', order.customer_name)}
  ${row('Kundenadresse', order.customer_address)}
  ${row('Montageadresse', order.installation_address)}
  ${row('Besteller', order.orderer)}
  ${row('Kontaktperson vor Ort', order.on_site_contact)}
  ${row('Lieferschein-Nr.', order.ls_number)}
  ${row('Montagedatum', order.planned_date)}
  ${row('Arbeit', fmtArr(order.work_types))}
  ${order.notes_planer ? row('Bemerkungen (Planer)', order.notes_planer) : ''}
</table>

<h2>Ausgeführte Arbeiten</h2>
<table>
  ${row('Ausgeführte Arbeiten', fmtArr(order.executed_work))}
  ${order.notes_monteur ? row('Bemerkungen', order.notes_monteur) : ''}
  ${row('Datum', order.work_date)}
  ${row('Techniker', order.technician_name)}
  ${order.technician_block ? row('Blockschrift', order.technician_block) : ''}
</table>

${order.items_table && order.items_table.length ? `
<h2>Material / Positionen</h2>
<table>
  <tr><td style="background:#e8f0fe;font-weight:bold">Artikel</td><td style="background:#e8f0fe;font-weight:bold;width:80px">Menge</td><td style="background:#e8f0fe;font-weight:bold;width:70px">Einheit</td></tr>
  ${order.items_table.map(i => {
    const s = i._deleted ? 'text-decoration:line-through;opacity:0.5;color:#999' : '';
    const displayName = (i.article_number && artLookup.get(i.article_number)) || i.name || '';
    return `<tr style="${s}"><td>${displayName}</td><td>${i.quantity||''}</td><td>${i.unit||''}</td></tr>`;
  }).join('')}
</table>` : ''}

${extraMaterialSection}
${mehrauffwandSection}
${ringsKeysSection}
${photosSection}

${order.signature_data ? `
<h2>Unterschrift</h2>
<p><img src="${order.signature_data}" style="border:1px solid #ccc;max-width:300px;max-height:150px"></p>` : ''}

<div class="footer">
  Es gelten unsere AGB's (siehe www.helbling.net)<br>
  Die Arbeiten sind innert 5 Tagen zu prüfen.<br>
  Reklamationen nach dieser Frist können wir nicht mehr berücksichtigen.<br>
  <span style="color:#aaa">Erstellt: ${new Date().toLocaleString('de-CH')}</span>
</div>
</body></html>`;
}

function buildTagesuebersichtHtml(orders, date, technicianName) {
  const fmt = v => v != null ? v : '–';

  const statusBadge = s => {
    const colors = {
      abgeschlossen: 'background:#e8f5e9;color:#2e7d32',
      in_bearbeitung: 'background:#fff8e1;color:#f57f17',
      geplant: 'background:#e8f0fe;color:#1a3a6b',
    };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;${colors[s]||'background:#eee;color:#555'}">${s}</span>`;
  };

  let totalWork = 0, totalTravel = 0, totalKm = 0;
  orders.forEach(o => {
    if (o.duration_h) totalWork += o.duration_h;
    if (o.travel_time) totalTravel += parseFloat(o.travel_time) || 0;
    if (o.travel_km) totalKm += parseInt(o.travel_km) || 0;
  });

  const rows = orders.map(o => `
    <tr>
      <td style="font-weight:bold">${fmt(o.order_number)}</td>
      <td>${fmt(o.customer_name)}<br><span style="font-size:11px;color:#666">${fmt(o.installation_address)}</span></td>
      <td style="white-space:nowrap">${fmt(o.work_time_from)} – ${fmt(o.work_time_to)}</td>
      <td style="text-align:right">${o.duration_h != null ? o.duration_h + ' h' : '–'}</td>
      <td style="text-align:right">${o.travel_time != null ? parseFloat(o.travel_time) + ' h' : '–'}</td>
      <td style="text-align:right">${o.travel_km != null ? o.travel_km + ' km' : '–'}</td>
      <td>${Array.isArray(o.executed_work) ? o.executed_work.join(', ') : fmt(o.executed_work)}</td>
      <td>${statusBadge(o.status)}</td>
    </tr>`).join('');

  return `
<h2 style="font-family:Arial,sans-serif;font-size:14px;color:#1a3a6b;margin-top:30px;border-bottom:1px solid #ccc;padding-bottom:4px">
  Tagesübersicht – ${technicianName} – ${date}
</h2>
<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;margin-bottom:12px">
  <thead>
    <tr style="background:#1a3a6b;color:#fff">
      <th style="padding:6px 8px;text-align:left;white-space:nowrap">Auftrag</th>
      <th style="padding:6px 8px;text-align:left">Kunde / Adresse</th>
      <th style="padding:6px 8px;text-align:left;white-space:nowrap">Arbeitszeit</th>
      <th style="padding:6px 8px;text-align:right;white-space:nowrap">Dauer</th>
      <th style="padding:6px 8px;text-align:right;white-space:nowrap">Fahrzeit</th>
      <th style="padding:6px 8px;text-align:right">km</th>
      <th style="padding:6px 8px;text-align:left">Ausgeführte Arbeiten</th>
      <th style="padding:6px 8px;text-align:left">Status</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
  <tfoot>
    <tr style="background:#f5f7ff;font-weight:bold;border-top:2px solid #1a3a6b">
      <td colspan="3" style="padding:6px 8px;border:1px solid #ddd">Total</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${Math.round(totalWork * 100) / 100} h</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${Math.round(totalTravel * 100) / 100} h</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${totalKm} km</td>
      <td colspan="2" style="padding:6px 8px;border:1px solid #ddd"></td>
    </tr>
  </tfoot>
</table>`;
}

function parseJSON(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

// Automatically called when an order is set to "abgeschlossen"
async function sendCompletionEmail(orderId) {
  const db = getDb();
  const smtpCfg = getSmtpConfig();
  const smtpConfigured = !!(smtpCfg.user && smtpCfg.pass);

  const order = db.prepare(`
    SELECT o.*, u.full_name AS assigned_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.assigned_to
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return;

  const parsedOrder = {
    ...order,
    work_types:          parseJSON(order.work_types, []),
    executed_work:       parseJSON(order.executed_work, []),
    items_table:         parseJSON(order.items_table, []),
    additional_material: parseJSON(order.additional_material, []),
    extra_material:      parseJSON(order.extra_material, []),
    rings_data:          parseJSON(order.rings_data, {}),
    keys_data:           parseJSON(order.keys_data, {}),
  };

  const attachments = db.prepare('SELECT * FROM order_attachments WHERE order_id = ?').all(orderId);
  const photos      = db.prepare('SELECT * FROM order_photos      WHERE order_id = ?').all(orderId);

  const resolveFile = row => {
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

  // Build Montagerapport (also used for PDF – built separately via generatePdfSafe)
  const rapportHtml = buildHtmlReport(parsedOrder, attachments, photos);

  // Build Tagesübersicht for this technician on this day
  const dayDate = order.work_date || order.planned_date;
  let tagesHtml = '';
  if (dayDate && order.assigned_to) {
    const dayOrders = db.prepare(`
      SELECT o.*, u.full_name AS assigned_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE o.assigned_to = ?
        AND (o.work_date = ? OR o.planned_date = ?)
        AND o.status != 'archiviert'
      ORDER BY o.work_time_from, o.sort_order
    `).all(order.assigned_to, dayDate, dayDate);

    const dayRows = dayOrders.map(o => {
      let duration_h = null;
      if (o.work_time_from && o.work_time_to) {
        const [fh, fm] = o.work_time_from.split(':').map(Number);
        const [th, tm] = o.work_time_to.split(':').map(Number);
        duration_h = Math.round(((th * 60 + tm) - (fh * 60 + fm)) / 60 * 100) / 100;
      }
      return {
        order_number:         o.order_number,
        customer_name:        o.customer_name,
        installation_address: o.installation_address,
        work_time_from:       o.work_time_from,
        work_time_to:         o.work_time_to,
        duration_h,
        travel_time:          o.travel_time,
        travel_km:            o.travel_km,
        executed_work:        parseJSON(o.executed_work, []),
        status:               o.status,
      };
    });

    const techName = order.assigned_name || order.technician_name || 'Techniker';
    tagesHtml = buildTagesuebersichtHtml(dayRows, dayDate, techName);
  }

  // Combine both sections into one email
  const fullHtml = rapportHtml.replace('</body></html>', tagesHtml + '</body></html>');

  // Generate PDF attachment (with 25 MB limit – falls back to no-photo version if too large)
  let pdfAttachment = null;
  try {
    const pdfBuffer = await generatePdfSafe(parsedOrder, attachments, photos);
    pdfAttachment = {
      filename: `Installationsrapport_${order.order_number || orderId}.pdf`,
      content:  pdfBuffer,
      contentType: 'application/pdf',
    };
  } catch (pdfErr) {
    console.warn('[Mailer] PDF-Generierung fehlgeschlagen:', pdfErr.message);
  }

  if (smtpConfigured) {
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from:    `"Helbling Rapporte" <${smtpCfg.from || smtpCfg.user}>`,
        to:      SIBOX_EMAIL,
        subject: `Installationsrapport ${order.order_number} – ${order.customer_name || ''} – abgeschlossen`,
        html:    fullHtml,
        attachments: [...mailAttachments, ...(pdfAttachment ? [pdfAttachment] : [])],
      });
      console.log(`[Mailer] Abschluss-Mail gesendet: Auftrag ${order.order_number} → ${SIBOX_EMAIL}`);
      // Versandzeitpunkt speichern
      db.prepare("UPDATE orders SET email_sent_at = datetime('now') WHERE id = ?").run(orderId);
    } catch (e) {
      console.error('[Mailer] Abschluss-Mail Fehler:', e.message);
    }
  } else {
    console.warn('[Mailer] SMTP nicht konfiguriert – Abschluss-Mail wird nicht gesendet');
  }

}

module.exports = { getSmtpConfig, getTransporter, buildHtmlReport, generatePdf, generatePdfSafe, sendCompletionEmail };
