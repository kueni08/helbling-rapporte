#!/usr/bin/env node
/**
 * Einmalige Einrichtung: Google Drive OAuth2-Token holen
 *
 * Voraussetzungen:
 *   1. Google Cloud Console öffnen: https://console.cloud.google.com/
 *   2. Projekt auswählen (oder neues anlegen)
 *   3. APIs & Dienste → Anmeldedaten → "+ Anmeldedaten erstellen" → OAuth-Client-ID
 *      - Anwendungstyp: "Desktop-App"
 *      - Name: z.B. "Helbling Rapporte"
 *   4. Client-ID und Client-Secret kopieren
 *   5. APIs & Dienste → Bibliothek → "Google Drive API" aktivieren
 *
 * Ausführen:
 *   node scripts/setup-drive-oauth.js
 *
 * Dann die angezeigten Werte in die .env-Datei eintragen.
 */

const { google } = require('googleapis');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n=== Google Drive OAuth2 Einrichtung ===\n');
  console.log('Voraussetzung: OAuth-Client-ID in Google Cloud Console anlegen');
  console.log('(Desktop-App, Google Drive API aktiviert)\n');

  const clientId     = (await ask('Client-ID:      ')).trim();
  const clientSecret = (await ask('Client-Secret:  ')).trim();

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent',
  });

  console.log('\n── Schritt 1 ─────────────────────────────────────────────────────');
  console.log('Öffne diese URL im Browser und melde dich mit dem Google-Account an,');
  console.log('in dessen Drive die Dateien gespeichert werden sollen:\n');
  console.log(authUrl);

  console.log('\n── Schritt 2 ─────────────────────────────────────────────────────');
  const code = (await ask('\nAutorisierungscode eingeben: ')).trim();

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error('\nFehler: Kein Refresh-Token erhalten.');
      console.error('Lösung: App-Zugriff unter https://myaccount.google.com/permissions widerrufen,');
      console.error('dann dieses Script erneut ausführen.');
      process.exit(1);
    }

    console.log('\n── Schritt 3: In .env eintragen ──────────────────────────────────');
    console.log('\nFolgende Zeilen in die .env-Datei kopieren:\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nGOOGLE_DRIVE_FOLDER_ID=<Ordner-ID aus Drive-URL>');
    console.log('\nHinweis: GOOGLE_SERVICE_ACCOUNT_FILE / GOOGLE_SERVICE_ACCOUNT_JSON');
    console.log('können danach aus der .env entfernt werden.');
    console.log('\nFolger-ID ermitteln: Den Ziel-Ordner in drive.google.com öffnen,');
    console.log('die ID ist der letzte Teil der URL nach /folders/\n');
  } catch (e) {
    console.error('\nFehler beim Token-Austausch:', e.message);
    process.exit(1);
  }

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
