# Helbling E-Mail-Agent

Intelligentes E-Mail-Verarbeitungssystem für Helbling & Co. AG, Rapperswil-Jona.

Analysiert eingehende .eml-Dateien und generiert automatisch:
- **Antwortentwürfe** auf Schweizer Hochdeutsch (via Claude Sonnet)
- **Aufgaben** mit Priorität und Fälligkeitsdatum
- **Klassifikation** nach Geschäftsbereich (SIBOX / FACETTESTAR / Allgemein)

## Schnellstart

```bash
# 1. Abhängigkeiten installieren
pip install -r requirements.txt

# 2. API-Key konfigurieren
cp .env.example .env
# ANTHROPIC_API_KEY=sk-ant-... in .env eintragen

# 3. E-Mail verarbeiten
python -m src.main process --file inbox/anfrage.eml

# 4. Dashboard starten
python -m src.main dashboard
# → Browser öffnet http://localhost:5000
```

## CLI-Befehle

```bash
# Einzelne E-Mail verarbeiten
python -m src.main process --file inbox/beispiel.eml

# Alle E-Mails im Inbox verarbeiten
python -m src.main process --all

# Nur parsen (kein API-Call)
python -m src.main parse --file inbox/beispiel.eml

# Wissensdatenbank Status
python -m src.main knowledge --status

# Web-Quellen crawlen
python -m src.main knowledge --scrape

# Aufgaben anzeigen
python -m src.main tasks --list

# Watch-Modus (automatisch neue .eml verarbeiten)
python -m src.main watch

# Dashboard starten
python -m src.main dashboard
```

## Ordnerstruktur

```
email-agent/
├── src/                    # Python-Quellcode
├── knowledge_base/         # Wissensdatenbank (manuell befüllen)
│   ├── preislisten/       # CSV-Preislisten
│   ├── produkte/          # Produktbeschreibungen (.md)
│   ├── faq/               # Häufige Fragen (.md)
│   ├── vorlagen/          # E-Mail-Vorlagen (.md)
│   ├── firmeninfo/        # Firmendaten (.md)
│   ├── dokumente/         # PDFs, Datenblätter
│   └── web_cache/         # Auto-generiert vom Web-Scraper
├── inbox/                  # .eml-Dateien hier ablegen
├── output/                 # Ergebnisse (auto-generiert)
│   ├── drafts/            # Antwortentwürfe
│   ├── tasks/             # Aufgaben
│   ├── attachments/       # Extrahierte Anhänge
│   └── logs/              # Verarbeitungsprotokolle
├── web/                    # Flask-Dashboard
├── docs/                   # Dokumentation
│   ├── power_automate_setup.md
│   └── architektur.md
├── config.yaml             # Konfiguration
├── sources.yaml            # Wissensquellen
├── .env.example            # API-Key Vorlage
└── requirements.txt        # Python-Abhängigkeiten
```

## Wissensdatenbank befüllen

Die Wissensdatenbank ist der Kern des Systems. Je mehr Informationen vorhanden, desto besser die generierten Entwürfe.

**Preislisten:** Exportiere aus ERPNext als CSV oder pflege manuell in `knowledge_base/preislisten/`

**Produktinfos:** Schreibe Markdown-Dateien in `knowledge_base/produkte/`

**FAQ:** Sammle typische Kundenfragen in `knowledge_base/faq/`

**Vorlagen:** Lege E-Mail-Textbausteine in `knowledge_base/vorlagen/` an

**Dokumente:** Kopiere PDFs in `knowledge_base/dokumente/`

**Web-Quellen:** Konfiguriere URLs in `config.yaml` und crawle mit `python -m src.main knowledge --scrape`

## Power Automate Integration

Für die automatische E-Mail-Verarbeitung via Power Automate:
→ Anleitung: `docs/power_automate_setup.md`

## Technologie

- **Python 3.10+** — Lokale Anwendung
- **Claude Sonnet** (Anthropic API) — KI-Verarbeitung
- **Flask** — Web-Dashboard
- **BeautifulSoup** — HTML-Parsing
- **Watchdog** — Datei-Überwachung

## Konfiguration

Alle Einstellungen in `config.yaml`:
- Pfade, API-Modell, Keywords für Klassifikation
- Aufgaben-Standardwerte, E-Mail-Signatur
- Web-Scraping-Quellen, Dashboard-Port

## Architektur

→ Details: `docs/architektur.md`
