# Systemarchitektur — Helbling E-Mail-Verarbeitungssystem

## Überblick

Das System ist eine lokale Python-Anwendung, die .eml-Dateien einliest, analysiert und automatisch Antwortentwürfe und Aufgaben generiert.

```
E-Mail (Outlook)
      ↓
Power Automate Flow
      ↓ .eml-Datei
OneDrive (Cloud)
      ↓ Sync
inbox/ (lokal)
      ↓
E-Mail-Verarbeitungssystem (Python)
  ├─ eml_parser.py        → Parst .eml (Header, Body, Thread, Anhänge)
  ├─ thread_analyzer.py   → Analysiert Thread-Verlauf (Claude API)
  ├─ classifier.py        → Klassifiziert E-Mail (Claude API)
  ├─ knowledge.py         → Lädt Wissensdatenbank (lokal + web_cache)
  ├─ web_scraper.py       → Crawlt Web-Quellen → web_cache/
  ├─ drafter.py           → Generiert Antwortentwurf (Claude API)
  ├─ tasker.py            → Erstellt Aufgaben (Claude API)
  └─ processor.py         → Orchestriert Pipeline
      ↓                        ↓                    ↓
output/drafts/         output/tasks/          output/logs/
      ↓
Flask Dashboard (localhost:5000)
```

## Module

### `eml_parser.py`
- RFC 5322 / MIME Parsing via Python `email`-Bibliothek
- Erkennt Thread-Verlauf aus Outlook/Gmail-Quoting
- Extrahiert Anhänge und Metadaten
- Encoding-Erkennung via `chardet`

### `thread_analyzer.py`
- Sendet Thread-Verlauf an Claude API
- Gibt strukturierte Analyse zurück (Zusammenfassung, offene Punkte, Tonalität)
- Fallback auf einfache Analyse wenn kein Thread vorhanden

### `classifier.py`
- Klassifiziert E-Mail nach Bereich (SIBOX/FACETTESTAR/ALLGEMEIN)
- Klassifiziert Aktionstyp (ANFRAGE/ANGEBOT_ANFRAGE/etc.)
- Keyword-Fallback ohne API-Call

### `knowledge.py`
- Lädt alle Dateien aus `knowledge_base/` rekursiv
- Unterstützt: .md, .txt, .csv, .json, .pdf
- TF-IDF-ähnliches Keyword-Matching für Retrieval
- `retrieve(query, top_k)` liefert relevante Chunks

### `web_scraper.py`
- Crawlt konfigurierte URLs aus `config.yaml`
- Konvertiert HTML → Markdown via `markdownify`
- Speichert gecrawlte Seiten in `knowledge_base/web_cache/`
- Refresh-Intervall konfigurierbar (Standard: 7 Tage)

### `drafter.py`
- Generiert Antwortentwürfe auf Schweizer Hochdeutsch
- Thread-bewusst: Bezieht sich auf Verlauf, wiederholt nichts
- Markiert unsichere Stellen mit `[PRÜFEN: ...]`
- Nutzt Wissensdatenbank für Preise und Produktinfos

### `tasker.py`
- Erkennt Handlungsaufforderungen aus E-Mails
- Erstellt strukturierte Aufgaben (JSON + Markdown)
- Berechnet Fälligkeitsdatum basierend auf Typ und Priorität

### `processor.py`
- Orchestriert die gesamte Pipeline
- Idempotenz: Jede E-Mail wird nur einmal verarbeitet
- Speichert alle Ergebnisse in `output/`

### `web/app.py`
- Flask-Dashboard auf localhost:5000
- REST API für alle Daten
- 5 Tabs: Inbox, Entwürfe, Aufgaben, Wissensdatenbank, Statistik

## Konfiguration

Alle Einstellungen in `config.yaml`:
- Pfade (inbox, knowledge_base, output)
- Claude API (Modell, max_tokens, temperature)
- Klassifikation (Keywords für SIBOX/FACETTESTAR)
- Aufgaben (Standard-Zuweisungen, Prioritäten)
- Entwürfe (Signatur, Stil)
- Web-Scraping (URLs, Intervalle)
- Dashboard (Port, Auto-Refresh)

## Dateisystem-Ausgaben

```
output/
├── drafts/
│   ├── {email_id}_draft.md      # Lesbarer Entwurf
│   └── {email_id}_draft.json    # Maschinenlesbarer Entwurf
├── tasks/
│   ├── TASK-{datum}-{nr}.md     # Lesbare Aufgabe
│   └── TASK-{datum}-{nr}.json   # Maschinenlesbare Aufgabe
├── attachments/
│   └── {email_id}/              # Extrahierte Anhänge
└── logs/
    ├── {email_id}.json          # Einzelnes Verarbeitungsergebnis
    ├── all_results.json         # Alle Ergebnisse (für Dashboard)
    └── processed_emails.json   # Idempotenz-Log
```

## Erweiterbarkeit

### Phase 2 (geplant)
- Watch-Modus mit `watchdog` (automatische Verarbeitung)
- ERPNext-Integration (Aufgaben direkt anlegen)
- Besseres Retrieval (Embeddings/Vektordatenbank)
- WebSocket für Live-Updates im Dashboard

### Phase 3 (geplant)
- Multi-User-Support
- Feedback-Loop (Entwürfe bewerten)
- Erweiterte Statistiken (API-Kosten, Trends)
