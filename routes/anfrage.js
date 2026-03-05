const router = require('express').Router();
const { getDb } = require('../lib/database');
const { requireRole } = require('../middleware/auth');

// POST /api/anfrage  – öffentlich, kein Login nötig
router.post('/', (req, res) => {
  const b = req.body;

  // Pflichtfelder prüfen
  const required = ['vorname', 'nachname', 'email', 'telefon', 'strasse', 'plz', 'ort'];
  for (const f of required) {
    if (!b[f] || !String(b[f]).trim()) {
      return res.status(400).json({ error: `Pflichtfeld fehlt: ${f}` });
    }
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO customer_inquiries (
      firma, vorname, nachname, email, telefon,
      strasse, plz, ort,
      objektart, anzahl_tueren,
      art_der_arbeit, anzahl_zylinder, anzahl_schluessel, bestehendes_system,
      wunschtermin, alternativtermin, terminpraeferenz,
      bemerkungen
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    b.firma || null,
    b.vorname.trim(),
    b.nachname.trim(),
    b.email.trim().toLowerCase(),
    b.telefon.trim(),
    b.strasse.trim(),
    b.plz.trim(),
    b.ort.trim(),
    b.objektart || null,
    b.anzahl_tueren ? parseInt(b.anzahl_tueren) : null,
    b.art_der_arbeit || null,
    b.anzahl_zylinder ? parseInt(b.anzahl_zylinder) : null,
    b.anzahl_schluessel ? parseInt(b.anzahl_schluessel) : null,
    b.bestehendes_system ? 1 : 0,
    b.wunschtermin || null,
    b.alternativtermin || null,
    b.terminpraeferenz || null,
    b.bemerkungen || null
  );

  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

// GET /api/anfragen  – planer + admin
router.get('/', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM customer_inquiries
    ORDER BY CASE status WHEN 'neu' THEN 0 WHEN 'in_bearbeitung' THEN 1 ELSE 2 END,
             created_at DESC
  `).all();
  res.json(rows);
});

// GET /api/anfragen/:id  – planer + admin
router.get('/:id', requireRole('admin', 'planer'), (req, res) => {
  const row = getDb().prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(row);
});

// PUT /api/anfragen/:id/status  – planer + admin
router.put('/:id/status', requireRole('admin', 'planer'), (req, res) => {
  const { status } = req.body;
  if (!['neu', 'in_bearbeitung', 'erledigt'].includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  getDb().prepare(
    "UPDATE customer_inquiries SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, req.params.id);
  res.json({ ok: true });
});

// POST /api/anfragen/:id/convert  – planer + admin
// Erstellt einen neuen Auftrag aus der Anfrage und verknüpft ihn
router.post('/:id/convert', requireRole('admin', 'planer'), (req, res) => {
  const db = getDb();
  const inquiry = db.prepare('SELECT * FROM customer_inquiries WHERE id = ?').get(req.params.id);
  if (!inquiry) return res.status(404).json({ error: 'Anfrage nicht gefunden' });

  // Auftragsnummer generieren
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${year}-%`);
  const seq = last ? (parseInt(last.order_number.split('-')[1]) + 1) : 1;
  const orderNumber = `${year}-${String(seq).padStart(4, '0')}`;

  const installAddress = `${inquiry.strasse}, ${inquiry.plz} ${inquiry.ort}`;
  const notesPlaner = [
    inquiry.objektart ? `Objektart: ${inquiry.objektart}` : null,
    inquiry.anzahl_tueren ? `Türen: ${inquiry.anzahl_tueren}` : null,
    inquiry.anzahl_zylinder ? `Zylinder (ca.): ${inquiry.anzahl_zylinder}` : null,
    inquiry.anzahl_schluessel ? `Schlüssel (ca.): ${inquiry.anzahl_schluessel}` : null,
    inquiry.bestehendes_system ? 'Bestehendes System: Ja' : null,
    inquiry.terminpraeferenz ? `Terminpräferenz: ${inquiry.terminpraeferenz}` : null,
    inquiry.bemerkungen ? `Kundennotiz: ${inquiry.bemerkungen}` : null,
  ].filter(Boolean).join('\n');

  // Arbeit aus art_der_arbeit mappen
  const workTypeMap = {
    'Neuinstallation': 'montage',
    'Erweiterung': 'montage',
    'Reparatur': 'reparatur',
    'Service/Wartung': 'service',
  };
  const workTypes = inquiry.art_der_arbeit
    ? [workTypeMap[inquiry.art_der_arbeit] || 'sonstiges']
    : [];

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, status,
      customer_name, installation_address, orderer,
      on_site_contact, planned_date,
      work_types, notes_planer,
      created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    orderNumber, 'geplant',
    `${inquiry.vorname} ${inquiry.nachname}${inquiry.firma ? ` (${inquiry.firma})` : ''}`,
    installAddress,
    `${inquiry.vorname} ${inquiry.nachname}`,
    `${inquiry.vorname} ${inquiry.nachname} | ${inquiry.telefon} | ${inquiry.email}`,
    inquiry.wunschtermin || null,
    JSON.stringify(workTypes),
    notesPlaner || null,
    req.session.userId
  );

  // Anfrage als erledigt markieren und Order-ID speichern
  db.prepare(
    "UPDATE customer_inquiries SET status = 'erledigt', converted_to_order_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.lastInsertRowid, inquiry.id);

  res.json({ ok: true, order_id: result.lastInsertRowid, order_number: orderNumber });
});

// DELETE /api/anfragen/:id  – admin only
router.delete('/:id', requireRole('admin'), (req, res) => {
  getDb().prepare('DELETE FROM customer_inquiries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
