"""
Fix-Script für eml_parser.py und utils.py im helbling-email-agent.

Problem:
- Weiterleitungs-Mails (WG:) haben leere From/Subject/Date-Header
- email_id enthält Leerzeichen (WG_ Sicherheitsrosette)
- Classifier sieht nur die Signatur, nicht den eingebetteten Thread-Inhalt

Fix:
1. utils.py: Leerzeichen in email_id normalisieren
2. eml_parser.py: Fallback-Metadaten aus eingebettetem Header-Block extrahieren
3. eml_parser.py: Deutschen Datumsparser hinzufügen

Ausführen:
  python scripts/fix_eml_parser.py
"""

import pathlib
import sys

BASE = pathlib.Path(__file__).parent.parent  # helbling-email-agent root

# ─── Fix 1: utils.py ────────────────────────────────────────────────────────

UTILS_PATH = BASE / "src" / "utils.py"
utils_content = UTILS_PATH.read_text(encoding="utf-8")

OLD_UTILS = '    file_hash = hashlib.md5(hash_input).hexdigest()[:8]\n    timestamp = datetime.now().strftime("%Y%m%d")\n    return f"{timestamp}_{path.stem}_{file_hash}"'
NEW_UTILS = '    file_hash = hashlib.md5(hash_input).hexdigest()[:8]\n    timestamp = datetime.now().strftime("%Y%m%d")\n    import re as _re\n    stem = _re.sub(r"\\s+", "_", path.stem)\n    return f"{timestamp}_{stem}_{file_hash}"'

if OLD_UTILS in utils_content:
    UTILS_PATH.write_text(utils_content.replace(OLD_UTILS, NEW_UTILS), encoding="utf-8")
    print("✓ utils.py: email_id Leerzeichen-Normalisierung gepatcht")
elif NEW_UTILS in utils_content:
    print("  utils.py: bereits gepatcht, übersprungen")
else:
    print("✗ utils.py: Pattern nicht gefunden – bitte manuell prüfen")

# ─── Fix 2: eml_parser.py – Fallback-Metadaten aus Body ────────────────────

PARSER_PATH = BASE / "src" / "eml_parser.py"
parser_content = PARSER_PATH.read_text(encoding="utf-8")

# Nach "date = self._parse_date(date_str)" einfügen
OLD_PARSER_DATE = (
    "        # Datum parsen\n"
    '        date_str = msg.get("Date", "")\n'
    "        date = self._parse_date(date_str)\n"
    "\n"
    "        # Body extrahieren\n"
    "        body_plain, body_html = self._extract_body(msg)"
)

NEW_PARSER_DATE = (
    "        # Datum parsen\n"
    '        date_str = msg.get("Date", "")\n'
    "        date = self._parse_date(date_str)\n"
    "\n"
    "        # Body extrahieren\n"
    "        body_plain, body_html = self._extract_body(msg)\n"
    "\n"
    "        # Fallback: Metadaten aus eingebettetem Header-Block (WG:/Fw: Mails)\n"
    "        if not from_addr or not subject or not date:\n"
    "            hb_match = HEADER_BLOCK.search(body_plain)\n"
    "            if hb_match:\n"
    "                if not from_addr and hb_match.group('sender'):\n"
    "                    from_addr = hb_match.group('sender').strip()\n"
    "                if not subject and hb_match.group('subject'):\n"
    "                    subject = hb_match.group('subject').strip()\n"
    "                if not date and hb_match.group('date'):\n"
    "                    date = self._parse_date_german(hb_match.group('date').strip())\n"
    "        # Letzter Fallback: Betreff aus Dateinamen\n"
    "        if not subject:\n"
    "            import re as _re\n"
    "            stem = Path(file_path).stem\n"
    "            # Entferne Datum-Prefix (YYYYMMDD_) falls vorhanden\n"
    "            stem = _re.sub(r'^\\d{8}_', '', stem)\n"
    "            subject = stem.replace('_', ' ').strip()"
)

if OLD_PARSER_DATE in parser_content:
    parser_content = parser_content.replace(OLD_PARSER_DATE, NEW_PARSER_DATE)
    print("✓ eml_parser.py: Fallback-Metadaten aus Body gepatcht")
elif "# Fallback: Metadaten aus eingebettetem Header-Block" in parser_content:
    print("  eml_parser.py: Fallback bereits vorhanden, übersprungen")
else:
    print("✗ eml_parser.py: Pattern nicht gefunden – bitte manuell prüfen")
    sys.exit(1)

# Fix 3: _parse_date_german Methode hinzufügen (nach _parse_date)
OLD_PARSE_DATE_END = (
    "        return None\n"
    "\n"
    "    def _extract_body(self, msg) -> tuple:"
)
NEW_PARSE_DATE_END = (
    "        return None\n"
    "\n"
    "    def _parse_date_german(self, date_str: str) -> Optional[datetime]:\n"
    '        """Parst deutsches Datum: \'Dienstag, 17. März 2026 09:32\'."""\n'
    "        MONTHS_DE = {\n"
    "            'januar': 1, 'februar': 2, 'märz': 3, 'april': 4,\n"
    "            'mai': 5, 'juni': 6, 'juli': 7, 'august': 8,\n"
    "            'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12,\n"
    "        }\n"
    "        import re as _re\n"
    "        m = _re.search(\n"
    "            r'(\\d{1,2})\\.\\s*(\\w+)\\s*(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?',\n"
    "            date_str, _re.IGNORECASE\n"
    "        )\n"
    "        if m:\n"
    "            day, month_str, year = int(m.group(1)), m.group(2).lower(), int(m.group(3))\n"
    "            hour = int(m.group(4)) if m.group(4) else 0\n"
    "            minute = int(m.group(5)) if m.group(5) else 0\n"
    "            month = MONTHS_DE.get(month_str)\n"
    "            if month:\n"
    "                try:\n"
    "                    return datetime(year, month, day, hour, minute)\n"
    "                except ValueError:\n"
    "                    pass\n"
    "        return None\n"
    "\n"
    "    def _extract_body(self, msg) -> tuple:"
)

if OLD_PARSE_DATE_END in parser_content:
    parser_content = parser_content.replace(OLD_PARSE_DATE_END, NEW_PARSE_DATE_END)
    print("✓ eml_parser.py: _parse_date_german Methode hinzugefügt")
elif "_parse_date_german" in parser_content:
    print("  eml_parser.py: _parse_date_german bereits vorhanden, übersprungen")
else:
    print("✗ eml_parser.py: _parse_date Ende-Pattern nicht gefunden")
    sys.exit(1)

PARSER_PATH.write_text(parser_content, encoding="utf-8")
print("\n✓ Alle Fixes angewendet!")
print("\nNächster Schritt: E-Mail neu verarbeiten mit:")
print('  python -m src.main --force --file "inbox\\WG_ Sicherheitsrosette.eml"')
print("  oder alle neu verarbeiten:")
print("  python -m src.main --force")
