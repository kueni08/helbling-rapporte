# Installationsanleitung – Helbling Rapporte

Diese Anleitung beschreibt, wie du die Rapporte-App auf einem Windows-PC installierst und über das Internet sicher erreichbar machst.

**Ziel**: Die App läuft auf deinem PC zuhause und ist unter `https://rapporte.helbling.net` von aussen erreichbar – gesichert mit HTTPS und Passwort-Schutz.

---

## Voraussetzungen

### 1. Node.js installieren (Version 18 oder neuer)
- Herunterladen und installieren von [nodejs.org](https://nodejs.org)
- Prüfen ob es geklappt hat: Eingabeaufforderung öffnen und `node --version` eingeben

### 2. Git installieren
- Herunterladen und installieren von [git-scm.com](https://git-scm.com)

### 3. Caddy herunterladen
- Herunterladen von [caddyserver.com/download](https://caddyserver.com/download) → Windows, 64-bit
- Die Datei `caddy.exe` in den Projektordner legen (gleicher Ordner wie `server.js`)

---

## Installation

### Schritt 1: Repository klonen

Eingabeaufforderung öffnen (Win + R → `cmd`) und folgende Befehle eingeben:

```
git clone https://github.com/kueni08/helbling-rapporte.git
cd helbling-rapporte
npm install
```

### Schritt 2: Umgebungsvariablen konfigurieren

```
copy .env.example .env
```

Die Datei `.env` mit einem Texteditor öffnen und anpassen:

| Variable | Beschreibung |
|---|---|
| `SESSION_SECRET` | Langen Zufallsstring eingeben (min. 32 Zeichen) |
| `SMTP_HOST` | E-Mail-Server (optional, nur für Mailversand) |
| `SMTP_USER` | E-Mail-Benutzername (optional) |
| `SMTP_PASS` | E-Mail-Passwort (optional) |
| `ANTHROPIC_API_KEY` | Nur nötig für Lieferschein-Auto-Import |

### Schritt 3: Datenbank initialisieren

```
node scripts/seed.js
```

Erstellt die Datenbank mit einem ersten Admin-Benutzer:
- Benutzername: `admin`
- Passwort: `admin123`

> **Wichtig**: Dieses Passwort nach dem ersten Login sofort ändern!

### Schritt 4: Lokaler Test

```
node server.js
```

Browser öffnen: [http://localhost:3000](http://localhost:3000)

Wenn die App erscheint, funktioniert alles. Mit `Ctrl + C` beenden.

---

## HTTPS-Setup mit Caddy

### Schritt 5: Passwort für den Webzugang festlegen

In der Eingabeaufforderung im Projektordner:

```
caddy hash-password
```

Gewünschtes Passwort eingeben (wird nicht angezeigt), Enter drücken.  
Es erscheint ein Hash wie `$2a$14$abc123...` – diesen kopieren.

### Schritt 6: Caddyfile anpassen

Die Datei `Caddyfile` im Projektordner öffnen und den Platzhalter ersetzen:

```
rapporte.helbling.net {
    basicauth {
        admin $2a$14$DEIN_HASH_HIER_EINFÜGEN
    }
    reverse_proxy localhost:3000
}
```

Den kopierten Hash anstelle von `$2a$14$HASH_PLATZHALTER_BITTE_ERSETZEN` eintragen.

---

## DNS und Router einrichten

### Schritt 7: DNS-Eintrag bei Hostpoint setzen

Im [Hostpoint-Kundencenter](https://www.hostpoint.ch) einloggen:

1. → Domains → `helbling.net` → DNS-Zone bearbeiten
2. Neuen Eintrag hinzufügen:
   - **Typ**: A
   - **Name**: `rapporte`
   - **Wert**: Deine öffentliche IP-Adresse (unter [whatismyip.com](https://whatismyip.com) nachschauen)
3. Speichern

> DNS-Änderungen können 1–24 Stunden dauern, bis sie weltweit aktiv sind.

### Schritt 8: Router konfigurieren (Port-Weiterleitung)

Im Router-Interface (meist 192.168.1.1 oder 192.168.0.1):

| Port | Protokoll | Ziel |
|---|---|---|
| 80 | TCP | Heim-PC (für Let's Encrypt) |
| 443 | TCP | Heim-PC (HTTPS) |

> **Nicht öffnen**: Port 3000 darf **nicht** von aussen erreichbar sein!

Die IP-Adresse des Heim-PCs im Netzwerk findet man mit: `ipconfig` → IPv4-Adresse

> **Tipp**: Im Router dem Heim-PC eine feste lokale IP-Adresse zuweisen (DHCP-Reservierung), damit die Weiterleitung nach einem Neustart noch stimmt.

---

## App starten

### Schritt 9: App und Caddy starten

Doppelklick auf `start-rapporte.bat`

Es öffnen sich zwei Konsolenfenster:
- **Fenster 1**: Node.js App (Port 3000)
- **Fenster 2**: Caddy (holt automatisch das HTTPS-Zertifikat)

Dann öffnet sich der Browser mit `https://rapporte.helbling.net`.

Beim ersten Start holt Caddy das Let's Encrypt-Zertifikat – das dauert einige Sekunden.

---

## Sicherheitshinweise

1. **App-Passwort sofort ändern**: Nach dem ersten Login unter Einstellungen das `admin123`-Passwort ändern
2. **Port 3000 geschlossen lassen**: Nur Ports 80 und 443 im Router öffnen
3. **Standby deaktivieren**: Damit die App immer erreichbar ist:
   - Windows-Einstellungen → System → Netzbetrieb → Nie in den Ruhezustand versetzen
4. **Dynamische IP beachten**: Falls dein Internetanbieter die öffentliche IP regelmässig ändert, musst du den DNS-Eintrag aktualisieren oder einen DDNS-Dienst verwenden

---

## Problembehebung

| Problem | Lösung |
|---|---|
| `caddy.exe` nicht gefunden | `caddy.exe` in den Projektordner (gleich wie `server.js`) legen |
| HTTPS-Zertifikat schlägt fehl | Prüfen ob Port 80 im Router wirklich weitergeleitet wird |
| App nicht erreichbar | `node server.js` lokal testen → http://localhost:3000 |
| DNS noch nicht aktiv | Warten (bis 24h) oder mit `nslookup rapporte.helbling.net` prüfen |
| Login-Dialog erscheint nicht | Caddy läuft nicht – Konsolenfenster prüfen |
