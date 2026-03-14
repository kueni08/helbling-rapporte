const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

let _drive = null;

function getDrive() {
  if (_drive) return _drive;

  let credentials = null;

  // Option 1: JSON als Umgebungsvariable (base64 oder direkt)
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    try {
      const raw = Buffer.from(jsonEnv, 'base64').toString('utf8');
      credentials = JSON.parse(raw);
    } catch {
      try {
        credentials = JSON.parse(jsonEnv);
      } catch (e) {
        console.error('[Drive] GOOGLE_SERVICE_ACCOUNT_JSON ungültig:', e.message);
        return null;
      }
    }
  }

  // Option 2: Dateipfad (für lokale Entwicklung)
  if (!credentials) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!keyFile) return null;
    const resolved = path.resolve(keyFile);
    if (!fs.existsSync(resolved)) {
      console.warn('[Drive] Service account file not found:', resolved);
      return null;
    }
    try {
      credentials = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('[Drive] Datei lesen fehlgeschlagen:', e.message);
      return null;
    }
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    _drive = google.drive({ version: 'v3', auth });
    return _drive;
  } catch (e) {
    console.error('[Drive] Auth init error:', e.message);
    return null;
  }
}

function isDriveEnabled() {
  return !!getDrive();
}

async function getOrCreateFolder(folderName, parentId) {
  const drive = getDrive();
  const safe = folderName.replace(/['"\\]/g, '_');
  const res = await drive.files.list({
    q: `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: {
      name: safe,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return folder.data.id;
}

// filePath: absoluter Pfad zur lokalen Datei
// displayName: Dateiname wie er in Drive erscheint
// mimeType: MIME-Typ der Datei
// subfolderName: Unterordner-Name (z.B. "2025-0001_2026-03-14"), optional
// Gibt { id, webViewLink } zurück oder null bei Fehler
async function uploadFile(filePath, displayName, mimeType, subfolderName) {
  const drive = getDrive();
  if (!drive) return null;
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    console.warn('[Drive] GOOGLE_DRIVE_FOLDER_ID not set');
    return null;
  }
  try {
    const folderId = subfolderName
      ? await getOrCreateFolder(subfolderName, rootFolderId)
      : rootFolderId;
    const res = await drive.files.create({
      requestBody: {
        name: displayName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });
    console.log('[Drive] Uploaded:', displayName, '->', res.data.id);
    return { id: res.data.id, webViewLink: res.data.webViewLink };
  } catch (e) {
    console.error('[Drive] Upload error:', e.message);
    return null;
  }
}

async function deleteFile(fileId) {
  const drive = getDrive();
  if (!drive || !fileId) return;
  try {
    await drive.files.delete({ fileId });
    console.log('[Drive] Deleted:', fileId);
  } catch (e) {
    console.error('[Drive] Delete error:', e.message);
  }
}

module.exports = { uploadFile, deleteFile, isDriveEnabled };
