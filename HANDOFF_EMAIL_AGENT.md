# Handoff: helbling-email-agent Fixes

## Repo-Übersicht — WICHTIG

Es gibt **zwei separate Repos**. Änderungen am E-Mail-Agenten gehören **ausschliesslich** in `helbling-email-agent`:

| Repo | Zweck | Remote URL |
|------|-------|------------|
| `helbling-rapporte` | Dashboard / Rapport-Anzeige (Node.js) | `kueni08/helbling-rapporte` |
| `helbling-email-agent` | E-Mail-Verarbeitung, Flask-Dashboard (`web/app.py`) | `kueni08/helbling-email-agent` |

**Fehler bisher:** Fixes wurden in `helbling-rapporte` committed statt in `helbling-email-agent`.

---

## Offenes Problem: `web/app.py` in helbling-email-agent

Die Datei `web/app.py` hat zwei Bugs die behoben werden müssen:

### Bug 1 — `@app.errorhandler(404)` ausserhalb `create_app()` (Zeile ~498)

**Fehler:** `NameError: name 'app' is not defined`

`app` existiert nur innerhalb `create_app()`. Der 404-Handler muss vor `return app` eingerückt werden.

**Aktueller Zustand (fehlerhaft):**
```python
    return app


@app.errorhandler(404)          # ← ausserhalb der Funktion = NameError
def not_found(e):
    return jsonify({"error": "Nicht gefunden"}), 404
```

**Soll-Zustand:**
```python
    @app.errorhandler(404)      # ← 4 Leerzeichen Einrückung, innerhalb create_app()
    def not_found(e):
        return jsonify({"error": "Nicht gefunden"}), 404

    return app
```

### Bug 2 — `with open(...)` ohne Body (Zeile ~185)

**Fehler:** `IndentationError: expected an indented block after 'with' statement on line 185`

In der Funktion `api_email_detail` wurde ein Patch-Script angewendet das die Einrückung gebrochen hat.

**Aktueller Zustand (fehlerhaft):**
```python
        if result_path.exists():
            with open(result_path, encoding="utf-8") as f:
        return jsonify(json.load(f))   # ← 12 Leerzeichen statt 16
```

**Soll-Zustand:**
```python
        if result_path.exists():
            with open(result_path, encoding="utf-8") as f:
                return jsonify(json.load(f))   # ← 16 Leerzeichen
        # Fallback: Eintrag direkt aus all_results.json laden
        for r in get_all_results():
            if r.get("email_id") == email_id:
                return jsonify(r)
        return jsonify({"error": "Nicht gefunden"}), 404
```

---

## Fix-Anleitung

### Option A — Direkt in web/app.py editieren (empfohlen)

1. Öffne `helbling-email-agent/web/app.py` im Editor
2. Gehe zu Zeile ~185: `return jsonify(json.load(f))` → 4 Leerzeichen hinzufügen
3. Gehe zu Zeile ~495: `return app` suchen, danach den 404-Handler finden und **vor** `return app` verschieben + 4 Leerzeichen Einrückung auf alle Zeilen

### Option B — PowerShell-Script (auf Windows ausführen)

```powershell
# Bug 2: with-Block Einrückung
$f = "web\app.py"
$c = Get-Content $f -Raw -Encoding UTF8
# Zeile mit falsch eingerücktem return finden und korrigieren
$c2 = $c -replace '(?m)^( {12}with open\(result_path[^\n]*\) as f:)\n {12}(return jsonify\(json\.load\(f\)\))', '$1`n                $2'
Set-Content $f $c2 -Encoding UTF8

# Bug 1: 404-Handler in create_app() verschieben — manuell prüfen
```

### Option C — Python-Script direkt auf web/app.py anwenden

Das Script `scripts/fix_app_py.py` aus `helbling-rapporte` wurde bereits mehrfach angepasst. Es kann aus dem `helbling-rapporte`-Repo kopiert und in `helbling-email-agent/scripts/` abgelegt werden, dann:

```powershell
cd C:\Users\sibox\OneDrive - Helbling & Co. AG\helbling-email-agent
python scripts/fix_app_py.py
```

---

## Backup vorhanden

`web/app.py.bak` ist im helbling-email-agent Verzeichnis vorhanden (vor den Patches gespeichert).

Bei Totalschaden: `copy web\app.py.bak web\app.py` und sauber neu patchen.

---

## Branches

| Repo | Branch für Fixes |
|------|-----------------|
| `helbling-email-agent` | `main` oder feature-branch direkt |
| `helbling-rapporte` | `claude/email-processing-system-FgfmW` (nicht für email-agent Fixes!) |
