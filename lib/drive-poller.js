/**
 * Google Drive Lieferschein Poller
 * Überwacht einen Google Drive Unterordner auf neue PDFs und importiert sie automatisch.
 *
 * Struktur im Google Drive (unter GOOGLE_DRIVE_FOLDER_ID):
 *   Lieferscheine-Inbox/     ← PDFs hier ablegen
 *   Lieferscheine-Verarbeitet/ ← nach Verarbeitung verschoben
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getOrCreateFolder, listPdfFiles, downloadFileToPath, moveFile } = require('./drive');
const { processFile } = require('./lieferschein-watcher');
const { getDb } = require('./database');

const POLL_INTERVAL_MS  = 2 * 60 * 1000; // 2 Minuten
const INBOX_SUBFOLDER   = 'Lieferscheine-Inbox';
const DONE_SUBFOLDER    = 'Lieferscheine-Verarbeitet';

let pollerInterval    = null;
let driveInboxId      = null;
let driveDoneId       = null;
let pollerActive      = false;
let lastPollAt        = null;

async function initFolders() {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootId) return false;
  try {
    driveInboxId = await getOrCreateFolder(INBOX_SUBFOLDER, rootId);
    driveDoneId  = await getOrCreateFolder(DONE_SUBFOLDER,  rootId);
    return true;
  } catch (e) {
    console.error('[Drive-Poller] Ordner-Init fehlgeschlagen:', e.message);
    return false;
  }
}

async function pollDrive() {
  if (!driveInboxId) return;
  lastPollAt = new Date().toISOString();

  let files;
  try {
    files = await listPdfFiles(driveInboxId);
  } catch (e) {
    console.error('[Drive-Poller] Fehler beim Abrufen der Dateien:', e.message);
    return;
  }

  if (!files.length) return;

  const db = getDb();
  const processed = new Set(
    db.prepare('SELECT drive_file_id FROM lieferschein_imports WHERE drive_file_id IS NOT NULL')
      .all().map(r => r.drive_file_id)
  );

  for (const file of files) {
    if (processed.has(file.id)) continue;

    console.log(`[Drive-Poller] Neue Datei: ${file.name} (${file.id})`);
    const tmpPath = path.join(os.tmpdir(), `ls_drive_${file.id}.pdf`);

    try {
      await downloadFileToPath(file.id, tmpPath);
      await processFile(tmpPath, file.name, file.id);
      await moveFile(file.id, driveDoneId, driveInboxId);
      console.log(`[Drive-Poller] ✅ ${file.name} verarbeitet`);
    } catch (err) {
      console.error(`[Drive-Poller] ❌ Fehler bei ${file.name}:`, err.message);
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
}

async function startPoller() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Drive-Poller] ⚠️  ANTHROPIC_API_KEY fehlt – Poller deaktiviert.');
    return;
  }
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.log('[Drive-Poller] ⚠️  GOOGLE_DRIVE_FOLDER_ID fehlt – Poller deaktiviert.');
    return;
  }

  const ok = await initFolders();
  if (!ok) {
    console.log('[Drive-Poller] ⚠️  Google Drive nicht verfügbar – Poller deaktiviert.');
    return;
  }

  pollerActive = true;
  console.log(`[Drive-Poller] ✅ Aktiv – Inbox: "${INBOX_SUBFOLDER}" (${driveInboxId})`);
  console.log(`[Drive-Poller]    Abfrage alle ${POLL_INTERVAL_MS / 60000} Minuten`);

  await pollDrive();
  pollerInterval = setInterval(pollDrive, POLL_INTERVAL_MS);
}

function stopPoller() {
  if (pollerInterval) { clearInterval(pollerInterval); pollerInterval = null; }
  pollerActive = false;
}

function getPollerStatus() {
  return {
    active: pollerActive,
    inbox_folder_id: driveInboxId,
    done_folder_id: driveDoneId,
    inbox_subfolder: INBOX_SUBFOLDER,
    poll_interval_min: POLL_INTERVAL_MS / 60000,
    last_poll_at: lastPollAt,
  };
}

module.exports = { startPoller, stopPoller, getPollerStatus };
