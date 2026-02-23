# Helbling Rapporte v2.0

Digitale Montagerapport-Verwaltung mit Rollen, Auftragsplanung und E-Mail-Versand.

---

## Funktionsübersicht

### Rollen
| Rolle | Berechtigungen |
|-------|---------------|
| **Admin** | Benutzerverwaltung, Auswahlfelder konfigurieren, Artikel verwalten, alle Aufträge |
| **Planer** | Aufträge erfassen (manuell + Excel-Import), Techniker zuweisen, Rapport per Mail versenden |
| **Monteur** | Eigene Aufträge einsehen, ausgefüllte Rapporte speichern, Unterschrift einholen |

---

## Installation

### Voraussetzungen
- [Node.js](https://nodejs.org) Version 18 oder höher

### Schritt 1: Projekt klonen / herunterladen
```bash
git clone <repository-url>
cd helbling-rapporte
```

### Schritt 2: Abhaengigkeiten installieren
```bash
npm install
```

### Schritt 3: Konfiguration erstellen
```bash
cp .env.example .env
```
Dann `.env` mit einem Texteditor oeffnen und anpassen:
- `SESSION_SECRET`: Beliebigen langen Zufallsstring eingeben
- SMTP-Einstellungen fuer E-Mail-Versand (optional)
- `UPLOADS_DIR`: Pfad zum Upload-Ordner (optional, fuer Google Drive)

### Schritt 4: Starten
```bash
npm start
```

Die Anwendung laeuft auf **http://localhost:3000**

**Standard-Login:** `admin` / `admin123` *(bitte sofort aendern!)*

---

## Google Drive Integration

Die einfachste Methode, Daten auf Google Drive zu speichern:

1. **Google Drive Desktop** installieren: https://drive.google.com/drive/downloads
2. Einen Ordner in Google Drive erstellen, z.B. `Helbling/uploads`
3. Den vollstaendigen lokalen Pfad dieses Ordners in der `.env` eintragen:
   ```
   UPLOADS_DIR=C:\Users\Max\Google Drive\Helbling\uploads
   ```
4. Alle hochgeladenen Dateien werden automatisch mit Google Drive synchronisiert.

---

## E-Mail-Konfiguration (Outlook / Microsoft 365)

In der `.env` Datei:
```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=rapport@ihre-firma.ch
SMTP_PASS=ihr-passwort
```

> **Hinweis**: Bei Microsoft 365 mit aktivierter Multi-Faktor-Authentifizierung ein **App-Passwort** verwenden.

---

## Bedienung

### Als Planer
1. **Neuer Auftrag**: `Auftraege` > `+ Neuer Auftrag`
   - Kunde auswaehlen oder neu anlegen
   - Pflichtfelder ausfuellen (Kunde, Besteller, Montageadresse, Datum, Arbeit)
   - Monteur zuweisen und Reihenfolge festlegen
   - Anhaenge und Fotos hochladen
2. **Excel-Import**: `Excel Import`
   - Spalten: `Kunde`, `Montagedatum`, `Montageadresse`, `Besteller`, `Bemerkungen`
3. **Rapport versenden**: Auftrag oeffnen > `Per E-Mail`

### Als Monteur
1. Auftraege erscheinen sortiert nach Datum und Reihenfolge
2. Auftrag oeffnen > Arbeiten, Material, Zeiten ausfuellen
3. Kundenunterschrift auf dem Bildschirm unterschreiben lassen
4. `Speichern und Abschicken`

### Als Admin
- **Benutzer**: Neue Benutzer anlegen, Passwoerter setzen, Rollen vergeben
- **Einstellungen**:
  - **Auswahlfelder**: Optionen fuer Arbeit, Ausgefuehrte Arbeiten, Material, Halteringe, Schluessel verwalten
  - **Artikel**: Artikelstamm pflegen
  - **Kunden**: Kundenstamm verwalten

---

## Datensicherung

Die SQLite-Datenbank liegt unter `db/rapporte.db`. Diese Datei regelmaessig sichern!

```bash
cp db/rapporte.db db/rapporte_backup_$(date +%Y%m%d).db
```
