"""
Fix: Vollständiger Inhalt + Anhänge im Classifier

Probleme:
1. Classifier analysiert nur den aktuellen Nachrichtentext (body_plain),
   nicht den eingebetteten Verlauf (weitergeleitete/ältere Nachrichten)
2. Anhänge werden nirgends erwähnt (weder in Zusammenfassung noch in Keywords)

Lösung:
- classifier.py: Prompt erhält vollständigen Text (body + Thread-Nachrichten + Anhänge)
- classifier.py: Attachment-Liste explizit im Prompt übergeben
- eml_parser.py: full_content Property die alles zusammenfasst

Ausführen:
  python scripts/fix_vollstaendiger_inhalt.py
  python scripts/fix_vollstaendiger_inhalt.py --diagnose   (nur anzeigen, nichts ändern)
"""

import pathlib
import sys
import re
import textwrap

DIAGNOSE_ONLY = "--diagnose" in sys.argv
BASE = pathlib.Path(__file__).parent.parent  # helbling-email-agent root

SRC = BASE / "src"
CLASSIFIER_PATH = SRC / "classifier.py"
PARSER_PATH = SRC / "eml_parser.py"

YELLOW = "\033[93m"
GREEN  = "\033[92m"
RED    = "\033[91m"
CYAN   = "\033[96m"
RESET  = "\033[0m"

def show(label, text, max_lines=20):
    print(f"\n{CYAN}── {label} ──{RESET}")
    lines = text.splitlines()
    for i, l in enumerate(lines[:max_lines], 1):
        print(f"  {i:3}: {l}")
    if len(lines) > max_lines:
        print(f"  ... ({len(lines) - max_lines} weitere Zeilen)")

def patch(path, old, new, label):
    content = path.read_text(encoding="utf-8")
    if old in content:
        if not DIAGNOSE_ONLY:
            path.write_text(content.replace(old, new), encoding="utf-8")
            print(f"{GREEN}✓ {label}{RESET}")
        else:
            print(f"{YELLOW}~ {label} (--diagnose: nicht angewendet){RESET}")
        return True
    elif new.strip() in content or (len(new) > 40 and new[:40] in content):
        print(f"  {label}: bereits gepatcht")
        return True
    else:
        print(f"{RED}✗ {label}: Pattern nicht gefunden{RESET}")
        return False

# ─────────────────────────────────────────────────────────────────────────────
# DIAGNOSE: Zeige wie der Classifier aufgerufen wird
# ─────────────────────────────────────────────────────────────────────────────

if CLASSIFIER_PATH.exists():
    clf = CLASSIFIER_PATH.read_text(encoding="utf-8")
    lines = clf.splitlines()

    # Zeige den Bereich wo body/content an den Prompt übergeben wird
    for i, l in enumerate(lines):
        if any(kw in l for kw in ["body", "content", "text", "nachricht", "prompt", "user_content"]):
            if any(kw in l.lower() for kw in ["body", "body_plain", "full_content", "nachrichtentext"]):
                context_start = max(0, i - 3)
                context_end = min(len(lines), i + 8)
                show(f"classifier.py Zeile {i+1} (body/content Übergabe)",
                     "\n".join(lines[context_start:context_end]), 15)
                break

    # Zeige den Prompt-Template Bereich
    for i, l in enumerate(lines):
        if "prompt" in l.lower() and ("="""" in l or '= f"' in l or "= (" in l):
            context_start = max(0, i - 1)
            context_end = min(len(lines), i + 30)
            show(f"classifier.py Zeile {i+1} (Prompt)",
                 "\n".join(lines[context_start:context_end]), 30)
            break
else:
    print(f"{RED}✗ {CLASSIFIER_PATH} nicht gefunden{RESET}")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: eml_parser.py – full_content Property auf ParsedEmail
# Kombiniert: body_plain + alle Thread-Nachrichten + Anhangsliste
# ─────────────────────────────────────────────────────────────────────────────

if PARSER_PATH.exists():
    parser = PARSER_PATH.read_text(encoding="utf-8")

    # Suche ParsedEmail Klasse / dataclass
    lines = parser.splitlines()
    for i, l in enumerate(lines):
        if "class ParsedEmail" in l or ("dataclass" in l and "Email" in "".join(lines[i:i+3])):
            show(f"eml_parser.py Zeile {i+1} (ParsedEmail)",
                 "\n".join(lines[i:i+30]), 30)
            break

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: Sicherstellen dass ParsedEmail ein full_content Property hat
# ─────────────────────────────────────────────────────────────────────────────

parser = PARSER_PATH.read_text(encoding="utf-8")

# Suche nach @dataclass / ParsedEmail und füge full_content Property hinzu
# falls noch nicht vorhanden

if "full_content" not in parser:
    # Suche das Ende der ParsedEmail-Klassenattribute (vor der ersten Methode oder leerem Bereich)
    # Pattern: letzte Feldzeile in ParsedEmail bevor eine Methode oder leere Klasse kommt

    # Strategie: Füge after 'attachments' oder letztem bekannten Feld eine Property hinzu
    OLD_PARSED_EMAIL_PROPERTY = ""

    # Versuche "thread_messages" Feld zu finden und dahinter @property einfügen
    m = re.search(
        r'(    thread_messages[^\n]*\n'          # thread_messages Feld
        r'(?:    [a-z_]+[^\n]*\n)*?)'            # weitere optionale Felder
        r'(\n    def |\n\n)',                      # erste Methode oder Leerzeile
        parser, re.MULTILINE
    )

    if m:
        insert_after = m.group(0)
        insert_pos = parser.index(insert_after) + len(m.group(1))

        full_content_property = (
            "\n"
            "    @property\n"
            "    def full_content(self) -> str:\n"
            '        """Vollständiger Inhalt: Body + Thread-Nachrichten + Anhangsliste.\n'
            "        Dieser Text wird dem Classifier übergeben.\n"
            '        """\n'
            "        parts = []\n"
            "        if self.body_plain and self.body_plain.strip():\n"
            "            parts.append(self.body_plain.strip())\n"
            "        # Thread-Nachrichten (eingebettete Weiterleitungen)\n"
            "        if self.thread_messages:\n"
            "            for tm in self.thread_messages:\n"
            "                tm_text = getattr(tm, 'body', None) or getattr(tm, 'content', None) or str(tm)\n"
            "                if tm_text and tm_text.strip():\n"
            "                    sender = getattr(tm, 'sender', '') or getattr(tm, 'from_addr', '')\n"
            "                    header = f'--- Weitergeleitete Nachricht von {sender} ---' if sender else '--- Weitergeleitet ---'\n"
            "                    parts.append(header)\n"
            "                    parts.append(tm_text.strip())\n"
            "        # Anhänge\n"
            "        if self.attachments:\n"
            "            names = [getattr(a, 'filename', None) or getattr(a, 'name', None) or str(a)\n"
            "                     for a in self.attachments]\n"
            "            names = [n for n in names if n]\n"
            "            if names:\n"
            "                parts.append('--- Anhänge ---')\n"
            "                parts.append('\\n'.join(f'- {n}' for n in names))\n"
            "        return '\\n\\n'.join(parts) if parts else ''\n"
        )

        new_parser = parser[:insert_pos] + full_content_property + parser[insert_pos:]

        if not DIAGNOSE_ONLY:
            PARSER_PATH.write_text(new_parser, encoding="utf-8")
            print(f"{GREEN}✓ eml_parser.py: full_content Property hinzugefügt{RESET}")
        else:
            print(f"{YELLOW}~ eml_parser.py: full_content Property würde hinzugefügt (--diagnose){RESET}")
            show("Neue Property", full_content_property, 40)
    else:
        print(f"{YELLOW}~ eml_parser.py: thread_messages-Pattern nicht gefunden – manuelle Prüfung nötig{RESET}")
        # Fallback: zeige alle Felder
        for i, l in enumerate(parser.splitlines()):
            if "class ParsedEmail" in l:
                show("ParsedEmail Felder", "\n".join(parser.splitlines()[i:i+25]), 25)
else:
    print(f"  eml_parser.py: full_content bereits vorhanden")


# ─────────────────────────────────────────────────────────────────────────────
# FIX 2: classifier.py – full_content statt body_plain verwenden
# ─────────────────────────────────────────────────────────────────────────────

clf = CLASSIFIER_PATH.read_text(encoding="utf-8")

# Ersetze body_plain → full_content im Classifier-Kontext
# (nur in der Stelle wo der Prompt-Text aufgebaut wird, nicht in Signaturen etc.)

replacements_done = 0
for old_pattern, new_pattern, label in [
    # Häufige Muster wie der Classifier den Body übergibt:
    ('email.body_plain',       'email.full_content',       'body_plain → full_content (direkt)'),
    ('parsed.body_plain',      'parsed.full_content',      'body_plain → full_content (parsed)'),
    ('email_data.body_plain',  'email_data.full_content',  'body_plain → full_content (email_data)'),
    ('"body_plain": ',         '"full_content": ',         'body_plain Key → full_content'),
    ("'body_plain': ",         "'full_content': ",         "body_plain Key → full_content (single-quote)"),
]:
    if old_pattern in clf:
        if not DIAGNOSE_ONLY:
            clf = clf.replace(old_pattern, new_pattern)
        print(f"{GREEN if not DIAGNOSE_ONLY else YELLOW}{'✓' if not DIAGNOSE_ONLY else '~'} classifier.py: {label}{RESET}")
        replacements_done += 1

# Zusätzlich: Stelle sicher dass Attachments im Prompt erwähnt werden
# Suche nach dem Prompt-Aufbau und füge Anhangsinformation hinzu

ATTACHMENT_HINT_MARKER = "# Anhänge im Prompt berücksichtigen"

if ATTACHMENT_HINT_MARKER not in clf:
    # Suche nach dem Ort wo der Prompt-String aufgebaut wird
    # Typisches Muster: prompt = f"..." oder content = f"..."

    # Muster 1: f-String mit body/content
    m = re.search(
        r'(Betreff[:\s]*\{[^}]+\}[^\n]*\n'   # Betreff: {subject}
        r'(?:[^\n]+\n){0,5})'                 # ein paar Zeilen
        r'(Nachricht[:\s]*\{[^}]+\})',         # Nachricht: {body}
        clf
    )

    if m:
        old_block = m.group(0)
        # Füge nach dem Nachricht-Block die Anhangsinformation ein
        new_block = (
            old_block
            + "\n"
            + "{attachment_section}"
        )

        # Suche den Variablennamen der für body verwendet wird
        body_var = re.search(r'Nachricht[:\s]*\{([^}]+)\}', old_block)
        body_varname = body_var.group(1).strip() if body_var else "body"

        print(f"{CYAN}  Gefunden: Prompt-Muster mit body-Variable '{body_varname}'{RESET}")

    # Alternativ: Direkte Suche nach attachment_section Einfügestelle
    # Suche die Funktion die den Prompt aufbaut
    for pattern in [
        r'def classify\(',
        r'def klassifiziere\(',
        r'def _build_prompt\(',
        r'def create_prompt\(',
    ]:
        m = re.search(pattern, clf)
        if m:
            func_start = m.start()
            func_lines = clf[func_start:func_start+800]
            show(f"classifier.py: Funktion ab Pos {func_start}", func_lines, 40)
            break

if not DIAGNOSE_ONLY and replacements_done > 0:
    CLASSIFIER_PATH.write_text(clf, encoding="utf-8")
    print(f"{GREEN}✓ classifier.py gespeichert{RESET}")
elif DIAGNOSE_ONLY:
    print(f"\n{YELLOW}Diagnose-Modus: keine Dateien verändert.{RESET}")
    print(f"Zum Anwenden: python scripts/fix_vollstaendiger_inhalt.py")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: classifier.py – Classifier-Prompt um Anhänge erweitern
# ─────────────────────────────────────────────────────────────────────────────

# Patch: In der classify() Funktion attachment_section berechnen und in Prompt einbauen

clf = CLASSIFIER_PATH.read_text(encoding="utf-8")

ATTACHMENT_INJECT_MARKER = "attachment_section ="
if ATTACHMENT_INJECT_MARKER not in clf:
    # Finde die classify() Funktion und ihre Eingabeparameter
    # und füge attachment_section Logik hinzu

    # Suche nach dem Muster wo body/content für den Prompt vorbereitet wird
    for old_prep, new_prep in [
        # Muster: body = email.full_content (nach vorherigem Fix)
        (
            "body = email.full_content\n",
            "body = email.full_content\n"
            "        # Anhänge explizit im Prompt aufführen\n"
            "        attachment_section = \"\"\n"
            "        if hasattr(email, 'attachments') and email.attachments:\n"
            "            att_names = [getattr(a, 'filename', None) or getattr(a, 'name', None) or str(a)\n"
            "                         for a in email.attachments]\n"
            "            att_names = [n for n in att_names if n]\n"
            "            if att_names:\n"
            '                attachment_section = "\\nAnhänge:\\n" + "\\n".join(f"- {n}" for n in att_names)\n',
        ),
        # Muster: body_text = ...
        (
            "body_text = email.full_content\n",
            "body_text = email.full_content\n"
            "        attachment_section = \"\"\n"
            "        if hasattr(email, 'attachments') and email.attachments:\n"
            "            att_names = [getattr(a, 'filename', None) or getattr(a, 'name', None) or str(a)\n"
            "                         for a in email.attachments]\n"
            "            att_names = [n for n in att_names if n]\n"
            "            if att_names:\n"
            '                attachment_section = "\\nAnhänge:\\n" + "\\n".join(f"- {n}" for n in att_names)\n',
        ),
    ]:
        if old_prep in clf:
            clf = clf.replace(old_prep, new_prep)
            if not DIAGNOSE_ONLY:
                CLASSIFIER_PATH.write_text(clf, encoding="utf-8")
                print(f"{GREEN}✓ classifier.py: attachment_section Logik eingefügt{RESET}")
            break
    else:
        print(f"{YELLOW}~ classifier.py: attachment_section manuell prüfen{RESET}")
        print(f"  Hinweis: Stellen Sie sicher dass in der classify()-Funktion")
        print(f"  email.attachments ausgelesen und als Text in den Prompt eingefügt wird.")

print(f"\n{'─' * 60}")
print(f"Nächste Schritte:")
print(f"  1. python scripts/fix_vollstaendiger_inhalt.py --diagnose")
print(f"     (zeigt an welche Stellen geändert würden)")
print(f'  2. python -m src.main --force --file "inbox\\WG_ Sicherheitsrosette.eml"')
print(f"     (E-Mail neu verarbeiten und Ergebnis prüfen)")
