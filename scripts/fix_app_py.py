"""
Patcht web/app.py im helbling-email-agent:
  1. encoding="utf-8" zu allen open()-Aufrufen (behebt Hieroglyphen/Zeichensalat)
  2. 404-Fallback in api_email_detail (behebt 404 bei neuen E-Mails)

Ausführen aus dem helbling-email-agent Verzeichnis:
    python scripts/fix_app_py.py
"""

import re
import sys
from pathlib import Path

TARGET = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("web/app.py")

if not TARGET.exists():
    print(f"FEHLER: {TARGET} nicht gefunden.")
    print("Dieses Script muss aus dem helbling-email-agent Verzeichnis ausgefuehrt werden.")
    sys.exit(1)

src = TARGET.read_text(encoding="utf-8")
original = src
changes = []

# ── Fix 1: open() ohne encoding → open(..., encoding="utf-8") ──────────────
# Findet alle open(…) Aufrufe (keine verschachtelten Klammern in den Args)
# und ergänzt encoding="utf-8" wenn nicht vorhanden und kein Binary-Mode.
def patch_open(m):
    full = m.group(0)
    if "encoding" in full:          # bereits gefixt
        return full
    if re.search(r'"[rw]?b"', full): # binary mode -> nicht anfassen
        return full
    inner = full[5:-1]              # Inhalt zwischen open( und )
    return f"open({inner}, encoding=\"utf-8\")"

new_src = re.sub(r'open\([^()]+\)', patch_open, src)
count = new_src.count('encoding="utf-8"') - src.count('encoding="utf-8"')
if count > 0:
    changes.append(f"encoding=\"utf-8\" zu {count} open()-Aufrufen ergaenzt")
    src = new_src

# ── Fix 2: json.dump ohne ensure_ascii=False ───────────────────────────────
def patch_dump(m):
    full = m.group(0)
    if "ensure_ascii" in full:
        return full
    inner = full[9:-1]
    return f"json.dump({inner}, ensure_ascii=False)"

new_src = re.sub(r'json\.dump\([^()]+\)', patch_dump, src)
count2 = new_src.count("ensure_ascii=False") - src.count("ensure_ascii=False")
if count2 > 0:
    changes.append(f"ensure_ascii=False zu {count2} json.dump()-Aufrufen ergaenzt")
    src = new_src

# ── Fix 3: 404-Fallback in api_email_detail ────────────────────────────────
# Ersetzt den gesamten alten if-not-exists-Block in einem einzigen Regex-Schritt,
# damit die Einrückung der return-Zeile korrekt angepasst wird.

if "# Fallback: Eintrag direkt aus all_results.json laden" in src:
    changes.append("404-Fallback bereits vorhanden (uebersprungen)")
else:
    pattern_404 = (
        r'([ ]*)if not result_path\.exists\(\):\n'
        r'\1    return jsonify\(\{"error": "Nicht gefunden"\}\), 404\n'
        r'\1with (open\(result_path[^\n]*\)) as f:\n'
        r'\1    return jsonify\(json\.load\(f\)\)'
    )

    def _replace_404_block(m):
        ind = m.group(1)
        open_call = m.group(2)
        return (
            f'{ind}if result_path.exists():\n'
            f'{ind}    with {open_call} as f:\n'
            f'{ind}        return jsonify(json.load(f))\n'
            f'{ind}# Fallback: Eintrag direkt aus all_results.json laden\n'
            f'{ind}for r in get_all_results():\n'
            f'{ind}    if r.get("email_id") == email_id:\n'
            f'{ind}        return jsonify(r)\n'
            f'{ind}return jsonify({{"error": "Nicht gefunden"}}), 404'
        )

    new_src, n = re.subn(pattern_404, _replace_404_block, src, count=1)
    if n:
        src = new_src
        changes.append("404-Fallback in api_email_detail eingefuegt")
    else:
        changes.append("INFO: 404-Block nicht im erwarteten Format – bitte web/app.py manuell pruefen")

# ── Ergebnis ───────────────────────────────────────────────────────────────
if src == original:
    print("Keine Aenderungen noetig – alle Fixes sind bereits vorhanden.")
    sys.exit(0)

backup = TARGET.with_suffix(".py.bak")
backup.write_text(original, encoding="utf-8")
TARGET.write_text(src, encoding="utf-8")

print(f"web/app.py erfolgreich gepatcht:")
for c in changes:
    print(f"  + {c}")
print(f"  Backup: {backup}")
