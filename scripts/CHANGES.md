# Änderungen im helbling-email-agent (lokal angewendet)
# Diese Datei dokumentiert was in src/ geändert wurde

## src/classifier.py
Zeile ~130: `content = truncate_text(parsed_email.body_plain, 2000)`
→ Ersetzt durch: vollständiger Text (body_plain + alle thread_messages.body), Limit 4000 Zeichen

## src/eml_parser.py
1. `_extract_body()`: HTML-in-text/plain erkennen und via BeautifulSoup in Plaintext konvertieren
2. Nach `_parse_date()`: Fallback-Betreff aus Dateiname (WG_/AW_/FW_ Prefix entfernen)
3. Nach `_parse_date()`: Fallback-Absender aus Body (Von:/From: Pattern)
4. `pathlib.Path(file_path).stem` → `Path(file_path).stem` (NameError fix)
