"""
.eml Datei Parser für das Helbling E-Mail-Verarbeitungssystem.
Liest RFC 5322 / MIME E-Mails ein und extrahiert alle relevanten Daten
inkl. Thread-Verlauf aus gequoteten Antworten.
"""

import re
import email
import email.policy
import chardet
import logging
from dataclasses import dataclass, field
from datetime import datetime
from email.header import decode_header
from pathlib import Path
from typing import Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class Attachment:
    """Ein Anhang aus einer E-Mail."""
    filename: str
    content_type: str
    size_bytes: int
    content: bytes


@dataclass
class ThreadMsg:
    """Eine einzelne Nachricht im Thread-Verlauf."""
    sender: str
    date: Optional[str]
    body: str
    position: int       # 0 = neueste, 1 = Vorgänger, etc.
    is_incoming: bool   # True = externer Absender, False = Helbling


@dataclass
class ParsedEmail:
    """Vollständig geparste E-Mail mit allen Metadaten."""
    message_id: str
    subject: str
    from_addr: str
    to_addrs: list
    cc_addrs: list
    date: Optional[datetime]
    body_plain: str
    body_html: Optional[str]
    attachments: list
    in_reply_to: Optional[str]
    references: list
    thread_messages: list   # list[ThreadMsg]
    headers_raw: dict
    # Hilffelder
    email_id: str = ""           # Generierte ID
    source_file: str = ""        # Ursprüngliche .eml-Datei


# ----- Thread-Pattern-Definitionen -----

# Outlook Deutsch
OUTLOOK_DE = re.compile(
    r"(?:Von|From):\s*.+?\s*\n"
    r"(?:Gesendet|Sent):\s*.+?\s*\n"
    r"(?:An|To):\s*.+?\s*\n"
    r"(?:Betreff|Subject):\s*.+",
    re.MULTILINE | re.IGNORECASE,
)

# Outlook/Mail "Von: X Gesendet: Y An: Z Betreff: W" (eine Zeile oder mehrere)
OUTLOOK_BLOCK_DE = re.compile(
    r"(-{3,}\s*Ursprüngliche\s+Nachricht\s*-{3,}"
    r"|-{3,}\s*Original\s+Message\s*-{3,}"
    r"|_{3,})",
    re.IGNORECASE,
)

# Gmail Deutsch: "Am 15. März 2026, 10:30 Uhr, schrieb Max Mustermann <max@example.com>:"
GMAIL_DE = re.compile(
    r"Am\s+\d{1,2}\.\s+\w+\s+\d{4}(?:,\s+\d{1,2}:\d{2})?\s+Uhr(?:,\s+\d{1,2}:\d{2}\s+Uhr)?"
    r".*?schrieb\s+.+?:",
    re.IGNORECASE | re.DOTALL,
)

# Gmail English: "On Mon, Mar 15, 2026 at 10:30 AM, John <john@example.com> wrote:"
GMAIL_EN = re.compile(
    r"On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+.+?\s+wrote:",
    re.IGNORECASE | re.DOTALL,
)

# Kombiniertes Pattern für alle Trenner
THREAD_SEPARATOR = re.compile(
    r"(?:"
    r"-{3,}\s*(?:Ursprüngliche\s+Nachricht|Original\s+Message)\s*-{3,}"
    r"|_{5,}"
    r"|={5,}"
    r")",
    re.IGNORECASE,
)

# Header-Block Pattern (Von: / From: ... Gesendet: / Sent: ...)
HEADER_BLOCK = re.compile(
    r"(?:^|\n)"
    r"(?:Von|From):\s*(?P<sender>.+?)\s*\n"
    r"(?:Gesendet|Sent):\s*(?P<date>.+?)\s*\n"
    r"(?:An|To):\s*(?P<to>.+?)\s*\n"
    r"(?:(?:Betreff|Subject):\s*(?P<subject>.+?)\s*\n)?",
    re.IGNORECASE | re.MULTILINE,
)

# Quote-Präfix ("> Text")
QUOTE_PREFIX = re.compile(r"^>+\s?", re.MULTILINE)


class EmlParser:
    """Parser für .eml-Dateien."""

    def __init__(self, config: dict = None):
        self.config = config or {}
        company_cfg = self.config.get("company", {})
        self.company_domains = company_cfg.get("domains", ["helbling.ch", "helbling-co.ch"])

    def parse(self, file_path: str) -> ParsedEmail:
        """Parst eine .eml-Datei und gibt ein ParsedEmail-Objekt zurück."""
        file_path = str(file_path)

        with open(file_path, "rb") as f:
            raw_bytes = f.read()

        # Encoding erkennen
        detected = chardet.detect(raw_bytes)
        encoding = detected.get("encoding") or "utf-8"

        try:
            msg = email.message_from_bytes(
                raw_bytes,
                policy=email.policy.default
            )
        except Exception:
            msg = email.message_from_bytes(raw_bytes)

        # Basis-Felder extrahieren
        subject = self._decode_header_value(msg.get("Subject", ""))
        from_addr = self._decode_header_value(msg.get("From", ""))
        to_addrs = self._parse_addr_list(msg.get("To", ""))
        cc_addrs = self._parse_addr_list(msg.get("Cc", ""))
        message_id = msg.get("Message-ID", "").strip("<>")
        in_reply_to = msg.get("In-Reply-To", "").strip("<>") or None
        references_raw = msg.get("References", "")
        references = [r.strip("<>") for r in references_raw.split() if r.strip()]

        # Datum parsen
        date_str = msg.get("Date", "")
        date = self._parse_date(date_str)

        # Body extrahieren
        body_plain, body_html = self._extract_body(msg)

        # Anhänge extrahieren
        attachments = self._extract_attachments(msg)

        # Headers als Dict
        headers_raw = dict(msg.items())

        # Thread-Nachrichten aus Body parsen
        thread_messages = self._parse_thread(body_plain, from_addr)

        # Email-ID generieren
        from .utils import get_email_id
        email_id = get_email_id(file_path)

        parsed = ParsedEmail(
            message_id=message_id,
            subject=subject,
            from_addr=from_addr,
            to_addrs=to_addrs,
            cc_addrs=cc_addrs,
            date=date,
            body_plain=body_plain,
            body_html=body_html,
            attachments=attachments,
            in_reply_to=in_reply_to,
            references=references,
            thread_messages=thread_messages,
            headers_raw=headers_raw,
            email_id=email_id,
            source_file=file_path,
        )

        logger.info(
            f"Geparst: '{subject}' von {from_addr}, "
            f"{len(thread_messages)} Thread-Nachrichten, "
            f"{len(attachments)} Anhänge"
        )
        return parsed

    def _decode_header_value(self, value: str) -> str:
        """Dekodiert E-Mail-Header (MIME-encoded Words)."""
        if not value:
            return ""
        try:
            parts = decode_header(value)
            decoded = []
            for part, charset in parts:
                if isinstance(part, bytes):
                    if charset:
                        try:
                            decoded.append(part.decode(charset))
                        except (LookupError, UnicodeDecodeError):
                            decoded.append(part.decode("utf-8", errors="replace"))
                    else:
                        decoded.append(part.decode("utf-8", errors="replace"))
                else:
                    decoded.append(str(part))
            return "".join(decoded).strip()
        except Exception:
            return str(value)

    def _parse_addr_list(self, addr_str: str) -> list:
        """Parst eine kommagetrennte Adressliste."""
        if not addr_str:
            return []
        addrs = []
        for part in addr_str.split(","):
            part = self._decode_header_value(part.strip())
            if part:
                addrs.append(part)
        return addrs

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parst ein Datum aus einem E-Mail-Header."""
        if not date_str:
            return None
        from email.utils import parsedate_to_datetime
        try:
            return parsedate_to_datetime(date_str)
        except Exception:
            pass

        # Fallback: manuelle Patterns
        formats = [
            "%d %b %Y %H:%M:%S %z",
            "%a, %d %b %Y %H:%M:%S %z",
            "%d %b %Y %H:%M:%S",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue
        return None

    def _extract_body(self, msg) -> tuple:
        """Extrahiert Plain-Text und HTML-Body aus einer MIME-Nachricht."""
        plain_parts = []
        html_parts = []

        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                cd = str(part.get("Content-Disposition", ""))
                if "attachment" in cd:
                    continue
                if ct == "text/plain":
                    plain_parts.append(self._decode_part(part))
                elif ct == "text/html":
                    html_parts.append(self._decode_part(part))
        else:
            ct = msg.get_content_type()
            if ct == "text/plain":
                plain_parts.append(self._decode_part(msg))
            elif ct == "text/html":
                html_parts.append(self._decode_part(msg))

        body_html = "\n".join(html_parts) if html_parts else None

        if plain_parts:
            body_plain = "\n".join(plain_parts)
        elif body_html:
            # HTML → Plain Text konvertieren
            soup = BeautifulSoup(body_html, "html.parser")
            body_plain = soup.get_text(separator="\n")
        else:
            body_plain = ""

        return body_plain.strip(), body_html

    def _decode_part(self, part) -> str:
        """Dekodiert einen MIME-Teil."""
        try:
            payload = part.get_payload(decode=True)
            if payload is None:
                return ""
            charset = part.get_content_charset() or "utf-8"
            try:
                return payload.decode(charset)
            except (LookupError, UnicodeDecodeError):
                # Encoding auto-erkennen
                detected = chardet.detect(payload)
                enc = detected.get("encoding") or "utf-8"
                return payload.decode(enc, errors="replace")
        except Exception as e:
            logger.warning(f"Fehler beim Dekodieren: {e}")
            return ""

    def _extract_attachments(self, msg) -> list:
        """Extrahiert alle Anhänge aus einer Nachricht."""
        attachments = []
        if not msg.is_multipart():
            return attachments

        for part in msg.walk():
            cd = str(part.get("Content-Disposition", ""))
            filename = part.get_filename()

            if "attachment" in cd or (filename and part.get_content_type() != "text/plain"):
                if not filename:
                    continue
                filename = self._decode_header_value(filename)
                content = part.get_payload(decode=True) or b""
                attachments.append(Attachment(
                    filename=filename,
                    content_type=part.get_content_type(),
                    size_bytes=len(content),
                    content=content,
                ))

        return attachments

    def _parse_thread(self, body: str, current_sender: str) -> list:
        """
        Parst den Thread-Verlauf aus dem E-Mail-Body.
        Erkennt verschiedene Quoting-Formate und trennt die Nachrichten.
        """
        if not body:
            return []

        messages = []
        position = 0

        # Aktuelle (neueste) Nachricht zuerst extrahieren
        current_body = self._extract_current_message(body)
        if current_body:
            messages.append(ThreadMsg(
                sender=current_sender,
                date=None,
                body=current_body.strip(),
                position=0,
                is_incoming=not self._is_helbling_sender(current_sender),
            ))
            position = 1

        # Thread-Blöcke aus gequotetem Inhalt extrahieren
        quoted_blocks = self._extract_quoted_blocks(body)
        for block in quoted_blocks:
            sender = block.get("sender", "Unbekannt")
            thread_msg = ThreadMsg(
                sender=sender,
                date=block.get("date"),
                body=block.get("body", "").strip(),
                position=position,
                is_incoming=not self._is_helbling_sender(sender),
            )
            messages.append(thread_msg)
            position += 1

        return messages

    def _extract_current_message(self, body: str) -> str:
        """Extrahiert nur den aktuellen (neuesten) Teil der E-Mail ohne Quoted-Text."""
        # Zuerst Trennlinie suchen
        sep_match = THREAD_SEPARATOR.search(body)
        if sep_match:
            return body[:sep_match.start()].strip()

        # Dann Outlook-Header-Block suchen
        hb_match = HEADER_BLOCK.search(body)
        if hb_match:
            return body[:hb_match.start()].strip()

        # Gmail-Pattern
        gmail_match = GMAIL_DE.search(body) or GMAIL_EN.search(body)
        if gmail_match:
            return body[:gmail_match.start()].strip()

        # "> " Quote-Prefix
        lines = body.split("\n")
        first_quote = None
        for i, line in enumerate(lines):
            if line.startswith(">"):
                first_quote = i
                break
        if first_quote is not None and first_quote > 0:
            return "\n".join(lines[:first_quote]).strip()

        # Kein Thread gefunden — gesamter Body ist aktuelle Nachricht
        return body

    def _extract_quoted_blocks(self, body: str) -> list:
        """Extrahiert gequotete Nachrichten-Blöcke aus dem Body."""
        blocks = []

        # Outlook-Trenner
        sep_parts = THREAD_SEPARATOR.split(body)
        if len(sep_parts) > 1:
            for part in sep_parts[1:]:
                block = self._parse_header_block(part)
                if block:
                    blocks.append(block)
            return blocks

        # Outlook-Header-Blöcke
        header_matches = list(HEADER_BLOCK.finditer(body))
        if header_matches:
            for i, match in enumerate(header_matches):
                sender = match.group("sender") or "Unbekannt"
                date = match.group("date")
                # Body ist Text zwischen diesem und dem nächsten Header-Block
                start = match.end()
                end = header_matches[i + 1].start() if i + 1 < len(header_matches) else len(body)
                block_body = body[start:end].strip()
                if block_body:
                    blocks.append({
                        "sender": sender.strip(),
                        "date": date.strip() if date else None,
                        "body": block_body,
                    })
            return blocks

        # Gmail-Pattern
        all_patterns = list(GMAIL_DE.finditer(body)) + list(GMAIL_EN.finditer(body))
        all_patterns.sort(key=lambda m: m.start())
        if all_patterns:
            for i, match in enumerate(all_patterns):
                sender_text = match.group(0)
                start = match.end()
                end = all_patterns[i + 1].start() if i + 1 < len(all_patterns) else len(body)
                block_body = body[start:end].strip()
                # "> " Präfixe entfernen
                block_body = QUOTE_PREFIX.sub("", block_body).strip()
                if block_body:
                    blocks.append({
                        "sender": sender_text,
                        "date": None,
                        "body": block_body,
                    })
            return blocks

        # "> " Quoting
        lines = body.split("\n")
        quoted_lines = []
        in_quote = False
        for line in lines:
            if line.startswith(">"):
                in_quote = True
                quoted_lines.append(QUOTE_PREFIX.sub("", line))
            elif in_quote and not line.strip():
                quoted_lines.append("")
            else:
                if in_quote and quoted_lines:
                    block_body = "\n".join(quoted_lines).strip()
                    if block_body:
                        blocks.append({
                            "sender": "Vorherige Nachricht",
                            "date": None,
                            "body": block_body,
                        })
                    quoted_lines = []
                    in_quote = False

        if in_quote and quoted_lines:
            block_body = "\n".join(quoted_lines).strip()
            if block_body:
                blocks.append({
                    "sender": "Vorherige Nachricht",
                    "date": None,
                    "body": block_body,
                })

        return blocks

    def _parse_header_block(self, text: str) -> Optional[dict]:
        """Parst einen Outlook-Header-Block."""
        match = HEADER_BLOCK.search(text)
        if match:
            sender = match.group("sender") or "Unbekannt"
            date = match.group("date")
            body = text[match.end():].strip()
            return {
                "sender": sender.strip(),
                "date": date.strip() if date else None,
                "body": body,
            }

        # Versuche einfachen Text zurückzugeben
        text = text.strip()
        if len(text) > 10:
            return {
                "sender": "Unbekannt",
                "date": None,
                "body": text,
            }
        return None

    def _is_helbling_sender(self, sender: str) -> bool:
        """Prüft ob ein Absender zur Helbling-Domain gehört."""
        if not sender:
            return False
        sender_lower = sender.lower()
        for domain in self.company_domains:
            if domain.lower() in sender_lower:
                return True
        return False

    def save_attachments(self, parsed_email: ParsedEmail, output_dir: str) -> list:
        """Speichert Anhänge einer E-Mail und gibt Pfade zurück."""
        if not parsed_email.attachments:
            return []

        email_dir = Path(output_dir) / parsed_email.email_id
        email_dir.mkdir(parents=True, exist_ok=True)

        saved = []
        for att in parsed_email.attachments:
            from .utils import sanitize_filename
            safe_name = sanitize_filename(att.filename)
            out_path = email_dir / safe_name
            with open(out_path, "wb") as f:
                f.write(att.content)
            saved.append(str(out_path))
            logger.info(f"Anhang gespeichert: {out_path}")

        return saved
