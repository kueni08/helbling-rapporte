/**
 * Lieferschein-Watcher
 * Überwacht einen Ordner auf neue PDF-Dateien (Helbling-Lieferscheine).
 * Extrahiert Daten via Claude API, erstellt Aufträge und importiert Artikel.
 */

const chokidar = require('chokidar');
const { PDFParse } = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const INBOX_DIR       = path.join(UPLOADS_DIR, 'lieferscheine-inbox');
const PROCESSED_DIR   = path.join(UPLOADS_DIR, 'lieferscheine-processed');
const FEHLER_DIR      = path.join(UPLOADS_DIR, 'lieferscheine-fehler');

let watcherInstance = null;

// ── Standard-Extraktions-Prompt (exportiert für Settings-Route) ───────────────
const DEFAULT_EXTRACTION_PROMPT = `Du analysierst einen Schweizer Lieferschein (Helbling & Co. AG, SIBOX/FacetteStar Produkte).
Extrahiere alle relevanten Daten und gib sie als valides JSON zurück.

WICHTIG:
- Gib NUR das JSON zurück, keinen weiteren Text
- Behalte alle Originalwerte aus dem Dokument
- Menge als Zahl (float), nicht als String
- Datum im Format YYYY-MM-DD
- Fehlende Felder als null

FELDDEFINITIONEN:
- "montagetermin": Das geplante Montagedatum / Lieferdatum (z.B. "Vorgesehener Montagetermin", "Lieferdatum", "Termin")
- "iz": IZ-Feld = Besteller / Initiator / "IZ" (Initialzeichen der bestellenden Person)
- "uz": UZ-Feld = Unser Zeichen / Bearbeiter / "UZ" (Name des zuständigen Sachbearbeiters bei Helbling)
- "projekt_nr": Projektnummer
- "montage_adresse": Montageadresse / Einbauadresse, NUR wenn im Dokument klar ausgewiesen (z.B. "Montageadresse:", "Einbauort:")
- "kontaktperson_vor_ort": Kontaktperson am Montageort, NUR wenn eindeutig genannt (z.B. "Ansprechperson:", "Kontakt vor Ort:", "Ansprechpartner:")
- Artikel mit "Montage Schlüsselbox" in der Beschreibung: "ist_schluessebox_montage": true, Durchmesser aus Beschreibung extrahieren (z.B. "Ø80" → "80")
- "ist_fremdfabrikat": true, wenn der Artikel KEIN Helbling/SIBOX/FacetteStar Produkt ist (Fremdmarke, Zubehör von Drittherstellern)

Erwartetes JSON-Format:
{
  "lieferschein_nr": "LS2603004",
  "montagetermin": "2026-03-20",
  "bestell_nr": null,
  "projekt_nr": "9826-031",
  "iz": "MU",
  "uz": "CH",
  "montage_adresse": null,
  "kontaktperson_vor_ort": null,
  "kunde": {
    "name": "Sictech GmbH",
    "strasse": "Heimstrasse 46",
    "plz": "8953",
    "ort": "Dietikon",
    "land": "Schweiz",
    "kunden_nr": "K4527 / KK2-1 SIBOX",
    "kontakt": "Carmen Helbling"
  },
  "artikel": [
    {
      "artikel_nr": "Z1500000",
      "beschreibung": "Montage Schlüsselbox SIBOX 105, Ø80",
      "menge": 2.0,
      "einheit": "Stk.",
      "ist_schluessebox_montage": true,
      "durchmesser": "80",
      "ist_fremdfabrikat": false
    },
    {
      "artikel_nr": "F9900001",
      "beschreibung": "Unterputzdose Fremdmarke",
      "menge": 1.0,
      "einheit": "Stk.",
      "ist_schluessebox_montage": false,
      "durchmesser": null,
      "ist_fremdfabrikat": true
    }
  ]
}

Lieferschein-Text:
{TEXT}`;

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function genOrderNumber(db) {
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${year}-%`);
  const seq = last ? (parseInt(last.order_number.split('-')[1]) + 1) : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

function ensureDirs() {
  [INBOX_DIR, PROCESSED_DIR, FEHLER_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Claude API: PDF-Text analysieren ─────────────────────────────────────────

async function extractLieferscheinData(pdfText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY nicht konfiguriert. Bitte in .env eintragen.');
  }

  const client = new Anthropic({ apiKey });

  // Prompt aus DB laden (falls vorhanden), sonst Standard verwenden
  const db = getDb();
  const savedPromptTemplate = db.prepare('SELECT value FROM settings WHERE key = ?').get('extraction_prompt')?.value;
  const promptTemplate = savedPromptTemplate || DEFAULT_EXTRACTION_PROMPT;
  const prompt = promptTemplate.replace('{TEXT}', pdfText);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  // Robustes JSON-Parsing: entfernt Code-Fences falls vorhanden
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr);
}

// ── Artikel upserten ─────────────────────────────────────────────────────────

function upsertArticles(db, artikelList) {
  let count = 0;
  for (const a of artikelList) {
    if (!a.artikel_nr && !a.beschreibung) continue;
    const existing = a.artikel_nr
      ? db.prepare('SELECT id FROM articles WHERE article_number = ? AND active = 1').get(a.artikel_nr)
      : null;

    if (existing) {
      safeUpdateArticle(db).run(a.beschreibung || a.artikel_nr, a.einheit || 'Stk.', existing.id);
    } else {
      db.prepare(`INSERT INTO articles (article_number, name, unit, active) VALUES (?,?,?,1)`)
        .run(a.artikel_nr || null, a.beschreibung, a.einheit || 'Stk.');
    }
    count++;
  }
  return count;
}

// Wir fügen updated_at nur ein falls vorhanden (Migration-safe)
function safeUpdateArticle(db) {
  const cols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
  if (cols.includes('updated_at')) {
    return db.prepare(`UPDATE articles SET name = ?, unit = ?, updated_at = datetime('now') WHERE id = ?`);
  }
  return db.prepare(`UPDATE articles SET name = ?, unit = ? WHERE id = ?`);
}

// ── Auftrag erstellen ─────────────────────────────────────────────────────────

function createOrder(db, data, importId) {
  const orderNumber = genOrderNumber(db);

  // Briefkopf: Kundenname + Kundenadresse
  const customerName = data.kunde?.name || null;
  const customerAddress = data.kunde
    ? [data.kunde.name, data.kunde.strasse, `${data.kunde.plz} ${data.kunde.ort}`.trim(), data.kunde.land]
        .filter(Boolean).join('\n')
    : null;

  // Montageadresse (nur wenn explizit im Dokument deklariert)
  const installationAddress = data.montage_adresse || null;

  const items = (data.artikel || []).map(a => ({
    quantity: a.menge || 1,
    name: a.beschreibung || a.artikel_nr || '',
    unit: a.einheit || 'Stk.',
    article_number: a.artikel_nr || null,
  }));

  // Arbeit: Montage anwählen wenn Montage Schlüsselbox Artikel vorhanden
  const hasSchlüsselboxMontage = (data.artikel || []).some(a => a.ist_schluessebox_montage);
  const workTypes = hasSchlüsselboxMontage ? JSON.stringify(['montage']) : '[]';

  // Bemerkungen Planer aufbauen
  const notesParts = [];

  // UZ (Unser Zeichen) als erste Zeile
  if (data.uz) notesParts.push(`UZ: ${data.uz}`);

  // Zusammenfassung Montagen Schlüsselbox mit Durchmesser
  const schlüsselboxArtikel = (data.artikel || []).filter(a => a.ist_schluessebox_montage);
  if (schlüsselboxArtikel.length > 0) {
    // Gruppieren nach Durchmesser
    const perDurchmesser = {};
    for (const a of schlüsselboxArtikel) {
      const key = a.durchmesser ? `Ø${a.durchmesser}` : 'unbekannter Durchmesser';
      perDurchmesser[key] = (perDurchmesser[key] || 0) + (a.menge || 1);
    }
    const summary = Object.entries(perDurchmesser)
      .map(([dm, qty]) => `${qty}x Montage Schlüsselbox ${dm}`)
      .join(', ');
    notesParts.push(summary);
  }

  // Anzahl Fremdfabrikate
  const fremdfabrikate = (data.artikel || []).filter(a => a.ist_fremdfabrikat);
  if (fremdfabrikate.length > 0) {
    const totalQty = fremdfabrikate.reduce((sum, a) => sum + (a.menge || 1), 0);
    notesParts.push(`${totalQty}x Fremdfabrikat${totalQty !== 1 ? 'e' : ''}`);
  }

  // Zusatzinfos (Lieferschein-Nr., Bestell-Nr., Kunden-Nr., Kontakt)
  if (data.lieferschein_nr)  notesParts.push(`Lieferschein-Nr.: ${data.lieferschein_nr}`);
  if (data.bestell_nr)       notesParts.push(`Bestell-Nr.: ${data.bestell_nr}`);
  if (data.kunde?.kunden_nr) notesParts.push(`Kunden-Nr.: ${data.kunde.kunden_nr}`);
  if (data.kunde?.kontakt)   notesParts.push(`Kontakt: ${data.kunde.kontakt}`);

  const result = db.prepare(`
    INSERT INTO orders (
      order_number, status, customer_name, customer_address,
      installation_address, planned_date, notes_planer,
      items_table, work_types, project_number, orderer, on_site_contact, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    orderNumber,
    'geplant',
    customerName,
    customerAddress,
    installationAddress,
    data.montagetermin || null,
    notesParts.join('\n') || null,
    JSON.stringify(items),
    workTypes,
    data.projekt_nr || null,
    data.iz || null,
    data.kontaktperson_vor_ort || null,
    null  // system-Import (kein user)
  );

  return { orderId: result.lastInsertRowid, orderNumber };
}

// ── PDF als Anhang zum Auftrag speichern ──────────────────────────────────────

function savePdfAsAttachment(db, orderId, orderNumber, sourcePdfPath, originalName) {
  const order = db.prepare('SELECT work_date, planned_date FROM orders WHERE id = ?').get(orderId);
  const rawDate = (order && (order.work_date || order.planned_date)) || '';
  const dateStr = rawDate.replace(/\//g, '-').split('T')[0] || new Date().toISOString().split('T')[0];
  const safeNum = orderNumber.replace(/[^a-zA-Z0-9._-]/g, '-');
  const dirName = `${safeNum}_${dateStr}`;
  const destDir = path.join(UPLOADS_DIR, dirName);
  fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(originalName).toLowerCase() || '.pdf';
  const newFilename = `${uuidv4()}${ext}`;
  const destPath = path.join(destDir, newFilename);
  fs.copyFileSync(sourcePdfPath, destPath);

  db.prepare(`
    INSERT INTO order_attachments (order_id, filename, original_name, file_type, dir_name)
    VALUES (?, ?, ?, 'document', ?)
  `).run(orderId, newFilename, originalName, dirName);

  return { filename: newFilename, dirName };
}

// ── Hauptverarbeitung eines PDF ───────────────────────────────────────────────

async function processFile(filePath, originalName, driveFileId) {
  const db = getDb();
  const filename = path.basename(filePath);
  const displayName = originalName || filename;

  console.log(`[LS-Watcher] Verarbeite: ${displayName}`);

  // Import-Eintrag anlegen
  const importResult = db.prepare(`
    INSERT INTO lieferschein_imports (filename, original_name, status, drive_file_id)
    VALUES (?, ?, 'processing', ?)
  `).run(filename, displayName, driveFileId || null);
  const importId = importResult.lastInsertRowid;

  try {
    // 1. PDF-Text extrahieren
    const pdfBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: pdfBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const pdfText = pdfData.text;

    if (!pdfText || pdfText.trim().length < 50) {
      throw new Error('PDF enthält zu wenig Text (möglicherweise ein gescanntes Bild ohne OCR).');
    }

    // 2. Claude API: Daten extrahieren
    const data = await extractLieferscheinData(pdfText);

    // 3. Artikel upserten
    const articlesImported = upsertArticles(db, data.artikel || []);

    // 4. Auftrag erstellen
    const { orderId, orderNumber } = createOrder(db, data, importId);

    // 5. PDF als Anhang speichern
    savePdfAsAttachment(db, orderId, orderNumber, filePath, filename);

    // 6. Import-Eintrag aktualisieren
    db.prepare(`
      UPDATE lieferschein_imports SET
        status = 'success',
        lieferschein_nr = ?,
        kunde = ?,
        projekt_nr = ?,
        lieferdatum = ?,
        articles_imported = ?,
        order_id = ?,
        raw_json = ?,
        processed_at = datetime('now')
      WHERE id = ?
    `).run(
      data.lieferschein_nr || null,
      data.kunde?.name || null,
      data.projekt_nr || null,
      data.lieferdatum || null,
      articlesImported,
      orderId,
      JSON.stringify(data),
      importId
    );

    // 7. PDF in verarbeiteten Ordner verschieben
    const destPath = path.join(PROCESSED_DIR, filename);
    fs.renameSync(filePath, destPath);

    console.log(`[LS-Watcher] ✅ ${filename} → Auftrag ${orderNumber}, ${articlesImported} Artikel`);

  } catch (err) {
    console.error(`[LS-Watcher] ❌ Fehler bei ${filename}:`, err.message);

    db.prepare(`
      UPDATE lieferschein_imports SET
        status = 'error',
        error_message = ?,
        processed_at = datetime('now')
      WHERE id = ?
    `).run(err.message, importId);

    // PDF in Fehler-Ordner verschieben
    try {
      const destPath = path.join(FEHLER_DIR, filename);
      fs.renameSync(filePath, destPath);
    } catch (_) {}
  }
}

// ── Watcher starten ───────────────────────────────────────────────────────────

function startWatcher() {
  ensureDirs();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[LS-Watcher] ⚠️  ANTHROPIC_API_KEY nicht gesetzt – Watcher deaktiviert.');
    console.log('              Trage ANTHROPIC_API_KEY in die .env-Datei ein, um den Auto-Import zu aktivieren.');
    return null;
  }

  watcherInstance = chokidar.watch(INBOX_DIR, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcherInstance.on('add', async (filePath) => {
    if (path.extname(filePath).toLowerCase() !== '.pdf') return;
    // Kurze Verzögerung damit das File vollständig geschrieben ist
    setTimeout(() => processFile(filePath), 1000);
  });

  watcherInstance.on('error', err => console.error('[LS-Watcher] Fehler:', err));

  console.log(`[LS-Watcher] ✅ Überwache: ${INBOX_DIR}`);
  return watcherInstance;
}

function stopWatcher() {
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
  }
}

function getInboxDir() {
  return INBOX_DIR;
}

module.exports = { startWatcher, stopWatcher, getInboxDir, processFile, DEFAULT_EXTRACTION_PROMPT };
