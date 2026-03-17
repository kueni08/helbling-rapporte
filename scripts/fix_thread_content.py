"""
Fix: thread_messages in Classifier-Inhalt einbauen

Problem:
  content = truncate_text(parsed_email.body_plain, 2000)
  → Nur der Rohtext der aktuellen Mail, OHNE den eingebetteten Verlauf

Fix:
  Vollständiger Text = body_plain + alle thread_messages.body
  → Claude sieht den gesamten Inhalt der Weiterleitung

Ausführen:
  python scripts/fix_thread_content.py
"""

import pathlib, sys, re

BASE = pathlib.Path(".").resolve()
CLASSIFIER = BASE / "src" / "classifier.py"

content = CLASSIFIER.read_text(encoding="utf-8")

OLD = '        # E-Mail-Content kürzen\n        content = truncate_text(parsed_email.body_plain, 2000)'
NEW = (
    '        # Vollständiger Inhalt: body_plain + eingebettete Thread-Nachrichten\n'
    '        _parts = [parsed_email.body_plain or ""]\n'
    '        for _tm in (parsed_email.thread_messages or []):\n'
    '            if _tm.body and _tm.body.strip():\n'
    '                _header = f"--- Von: {_tm.sender} ---" if _tm.sender else "--- Weitergeleitet ---"\n'
    '                _parts.append(_header)\n'
    '                _parts.append(_tm.body.strip())\n'
    '        _full = "\\n\\n".join(p for p in _parts if p.strip())\n'
    '        content = truncate_text(_full, 4000)'
)

# Fallback: Windows-Zeilenenden
OLD_CRLF = OLD.replace('\n', '\r\n')
NEW_CRLF = NEW.replace('\n', '\r\n')

if OLD in content:
    CLASSIFIER.write_text(content.replace(OLD, NEW), encoding="utf-8")
    print("✓ classifier.py gepatcht (LF)")
elif OLD_CRLF in content:
    CLASSIFIER.write_text(content.replace(OLD_CRLF, NEW_CRLF), encoding="utf-8")
    print("✓ classifier.py gepatcht (CRLF)")
elif "thread_messages or []" in content:
    print("  bereits gepatcht")
else:
    # Zeige Kontext zur manuellen Diagnose
    lines = content.splitlines()
    for i, l in enumerate(lines):
        if "truncate_text" in l and "body_plain" in l:
            print(f"✗ Pattern nicht exakt. Gefunden in Zeile {i+1}:")
            for j in range(max(0,i-2), min(len(lines),i+4)):
                print(f"  {j+1}: {repr(lines[j])}")
            break
    sys.exit(1)

print("✓ Fertig. Neu verarbeiten mit:")
print('  python -m src.main process --all')
