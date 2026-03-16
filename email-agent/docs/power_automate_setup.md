# Power Automate Setup — E-Mail → .eml → OneDrive → Inbox

## Überblick

Dieser Flow exportiert eingehende E-Mails automatisch als .eml-Dateien in einen OneDrive-Ordner, der lokal synchronisiert wird. Das Python-System überwacht den lokalen Ordner und verarbeitet neue Dateien automatisch.

```
Outlook Postfach → Power Automate Flow → OneDrive → Lokaler Sync → email-agent/inbox/
```

---

## Voraussetzungen

- Microsoft 365 Lizenz mit Power Automate
- OneDrive for Business
- OneDrive Desktop-App auf dem lokalen PC
- Python-System lokal installiert

---

## Flow erstellen

### Schritt 1: Neuen Flow anlegen

1. Öffnen Sie [make.powerautomate.com](https://make.powerautomate.com)
2. Klicken Sie auf **+ Erstellen** → **Automatisierter Cloud-Flow**
3. Name: `Helbling E-Mail zu EML`
4. Trigger: **When a new email arrives (V3)** — Office 365 Outlook

### Schritt 2: Trigger konfigurieren

```
Trigger: When a new email arrives (V3)
  Postfach: [Ihr Postfach oder Shared Mailbox]
  Ordner: Posteingang
  Mit Anlagen: Ja (optional, für vollständige E-Mails)
  Nur mit Anlagen: Nein
```

**Optionaler Filter** (um nur externe E-Mails zu verarbeiten):
- Absenderadresse enthält NICHT `@helbling.ch`

### Schritt 3: E-Mail-Inhalt als .eml exportieren

**Methode A: Über Microsoft Graph API (empfohlen)**

Fügen Sie eine Aktion hinzu: **HTTP**
```
Methode: GET
URI: https://graph.microsoft.com/v1.0/me/messages/@{triggerOutputs()?['body/id']}/$value
Authentifizierung: Active Directory OAuth
Tenant: [Ihre Tenant-ID]
Client-ID: [App-Registrierung Client-ID]
Geheimnis: [App-Registrierung Secret]
```

**Methode B: Vereinfacht (Plain + HTML)**

Falls Graph API nicht verfügbar, können Sie den E-Mail-Inhalt direkt zusammensetzen:
- Verwenden Sie `triggerOutputs()?['body/body/content']` für den Body
- Konstruieren Sie einen vereinfachten MIME-Header

### Schritt 4: Datei in OneDrive speichern

Fügen Sie eine Aktion hinzu: **Create file** (OneDrive for Business)
```
Site Address: [Ihre SharePoint-URL oder OneDrive]
Folder Path: /HelblingStar/email-agent/inbox

File Name: @{formatDateTime(triggerOutputs()?['body/receivedDateTime'], 'yyyyMMdd_HHmmss')}_@{replace(triggerOutputs()?['body/from/emailAddress/address'], '@', '_at_')}.eml

File Content: @{outputs('HTTP')['body']}
```

**Dateiname-Beispiel:** `20260316_094200_h_muller_at_immobilien-mueller_ch.eml`

### Schritt 5: Optional — Benachrichtigung senden

Fügen Sie eine Teams/E-Mail-Benachrichtigung hinzu:
```
An: kueni@helbling.ch
Betreff: [Email Agent] Neue E-Mail von @{triggerOutputs()?['body/from/emailAddress/address']}
Text: Neue E-Mail wird verarbeitet: @{triggerOutputs()?['body/subject']}
```

---

## OneDrive Lokaler Sync einrichten

1. Öffnen Sie die OneDrive Desktop-App
2. Klicken Sie auf **Einstellungen** → **Konto**
3. Wählen Sie **Ordner auswählen**
4. Aktivieren Sie den Ordner `/HelblingStar/email-agent/`
5. Synchronisierter lokaler Pfad: `C:\Users\Kueni\OneDrive\HelblingStar\email-agent\`

---

## config.yaml anpassen

```yaml
paths:
  # Lokaler OneDrive-Sync-Ordner (Windows)
  inbox: "C:/Users/Kueni/OneDrive/HelblingStar/email-agent/inbox"

  # Oder relativer Pfad wenn direkt im Projektordner
  # inbox: "./inbox"
```

---

## Watch-Modus starten

Nach dem Einrichten startet den Watch-Modus so, dass neue .eml-Dateien sofort verarbeitet werden:

```bash
cd C:\helbling-email-agent
python -m src.main watch
```

Oder als Windows-Dienst / Autostart konfigurieren.

---

## Testen

1. Senden Sie eine Test-E-Mail an das konfigurierte Postfach
2. Prüfen Sie ob die .eml-Datei in OneDrive erscheint (ca. 1-2 Minuten)
3. Prüfen Sie ob die lokale Synchronisation die Datei im `inbox/` Ordner anlegt
4. Der Watch-Modus sollte die Datei automatisch verarbeiten

---

## Troubleshooting

**Problem:** E-Mail erscheint nicht in OneDrive
- Power Automate Flow-Ausführungshistorie prüfen
- Berechtigungen des Flow auf OneDrive prüfen

**Problem:** .eml-Datei enthält keinen vollständigen MIME-Inhalt
- Methode A (Graph API) verwenden
- App-Registrierung in Azure AD mit `Mail.Read` Berechtigung anlegen

**Problem:** Dateikodierung fehlerhaft (Umlaute)
- Content-Transfer-Encoding in Flow auf UTF-8 sicherstellen
- `chardet` im Python-System erkennt Encoding automatisch
