"""Diagnose: Zeigt relevante Stellen in eml_parser.py und classifier.py"""
import pathlib, sys

BASE = pathlib.Path(__file__).parent.parent
SRC = BASE / "src"

def show_file_section(path, keywords, context=15):
    if not path.exists():
        print(f"FEHLT: {path}")
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    print(f"\n{'='*60}")
    print(f"FILE: {path.name} ({len(lines)} Zeilen)")
    print('='*60)
    shown = set()
    for i, line in enumerate(lines):
        if any(kw.lower() in line.lower() for kw in keywords):
            start = max(0, i - 3)
            end = min(len(lines), i + context)
            if start not in shown:
                print(f"\n  --- Zeile {start+1}-{end} ---")
                for j in range(start, end):
                    marker = ">>>" if j == i else "   "
                    print(f"  {marker} {j+1:4}: {lines[j]}")
                shown.update(range(start, end))

# eml_parser.py: ParsedEmail Klasse + body-Extraktion + Attachments
show_file_section(SRC / "eml_parser.py",
    ["class ParsedEmail", "body_plain", "attachments", "thread_messages",
     "full_content", "_extract_body", "_parse_thread", "dataclass"])

# classifier.py: wie der Prompt aufgebaut wird + was übergeben wird
show_file_section(SRC / "classifier.py",
    ["body_plain", "body_html", "full_content", "attachments",
     "prompt", "user_content", "nachricht", "betreff", "classify",
     "zusammenfassung", "def ", "body"])

# Zeige auch alle Methoden/Klassen
for fname in ["classifier.py", "eml_parser.py"]:
    p = SRC / fname
    if p.exists():
        lines = p.read_text(encoding="utf-8").splitlines()
        print(f"\n{'='*60}")
        print(f"STRUKTUR: {fname}")
        for i, l in enumerate(lines, 1):
            if l.strip().startswith(("def ", "class ", "async def ")):
                print(f"  {i:4}: {l}")
