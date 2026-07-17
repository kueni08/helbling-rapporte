# Infomaniak-Betrieb – Helbling Rapporte

## Trennung während der Vorbereitung

Der Heimserver bleibt bis zur ausdrücklich freigegebenen Umschaltung unverändert unter `rapporte.helbling.net` erreichbar. Das Infomaniak-System wird parallel mit einer isolierten Datenkopie geprüft. Zwischen beiden Datenbanken findet keine automatische Synchronisierung statt.

## Zielsystem

- Anwendung: `/opt/helbling-rapporte/current`
- persistente Datenbank und Sitzungen: `/srv/helbling-rapporte/db`
- persistente Uploads: `/srv/helbling-rapporte/uploads`
- lokale geprüfte Sicherungen: `/srv/helbling-rapporte/backups`
- geschützte Konfiguration: `/etc/helbling-rapporte/app.env`
- Dienst: `helbling-rapporte.service`
- Reverse Proxy: Caddy; Node lauscht ausschliesslich auf `127.0.0.1:3000`

## Bereitstellung

1. Ubuntu LTS aktualisieren und Node.js LTS, Caddy, Chromium, SQLite und rsync installieren.
2. Dienstkonto `helbling-rapporte` ohne interaktive Anmeldung anlegen.
3. Anwendung aus dem freigegebenen Git-Commit nach `/opt/helbling-rapporte/releases/<commit>` kopieren und `npm ci --omit=dev` ausführen.
4. Symlink `/opt/helbling-rapporte/current` atomar auf den geprüften Release setzen.
5. `deploy/infomaniak/app.env.example` nach `/etc/helbling-rapporte/app.env` kopieren, Geheimnisse erzeugen und Rechte auf `0640 root:helbling-rapporte` setzen.
6. systemd- und Caddy-Dateien installieren, Konfigurationen prüfen und Dienste starten.
7. Lokal `curl --fail http://127.0.0.1:3000/healthz` sowie die Funktions- und Sicherheitstests ausführen.

## Datentransfer

Vor jeder Datenübernahme wird auf dem Quellsystem eine konsistente SQLite-Sicherung erstellt. Zusätzlich werden die Datenbank inklusive aktuellem Integritätscheck und das vollständige Upload-Verzeichnis mit Anzahl, Gesamtgrösse und Prüfsummen verglichen. Sitzungsdaten werden nicht migriert; nach der Umschaltung ist eine Neuanmeldung erforderlich.

Die derzeitige lokale Exportkopie enthält eine integre Datenbank, aber keinen vollständigen Upload-Bestand. Sie genügt für Schema- und Oberflächentests, nicht für die endgültige produktive Umschaltung.

## Umschaltung und Rückfall

Unmittelbar vor der Umschaltung wird ein kurzes Schreibfenster vereinbart, eine letzte konsistente Daten- und Upload-Sicherung erstellt und auf Infomaniak geprüft. Danach wird ausschliesslich der A-Record `rapporte.helbling.net` auf die Infomaniak-IP geändert. Der bisherige Wert `157.143.81.37` bleibt als dokumentiertes Rückfallziel erhalten.

Bei einem Rückfall wird der A-Record auf `157.143.81.37` zurückgesetzt und der Heimserver weiterverwendet. Während des Umschaltfensters dürfen nicht gleichzeitig auf beide getrennten SQLite-Datenbanken neue Rapporte geschrieben werden.

## Sicherungen

`backup-local.sh` erstellt über die SQLite-Backupfunktion eine konsistente Datenbankkopie, kopiert die Uploads, erzeugt SHA-256-Prüfsummen und verwirft unvollständige Läufe. `verify-backup.sh` prüft Prüfsummen und Datenbankintegrität. Die lokale Sicherung ist zusätzlich täglich verschlüsselt auf Swiss Backup zu übertragen; ein separater Restore-Test ist vor der Umschaltung Pflicht.

## Abnahme

- interne Rollen und Anmeldung
- Kundenportal, Mandantentrennung, Autosave, Foto und Freigabe
- öffentliche Kundenanfrage und Token-Link
- Auftragsbearbeitung, Upload/Download und PDF-Erzeugung
- E-Mail nur mit produktiv freigegebener SMTP-Konfiguration
- automatischer Start nach Neustart
- von aussen nur TCP 22, 80 und 443; Port 3000 bleibt geschlossen
- geprüfte externe Sicherung und Wiederherstellung in ein separates Verzeichnis
