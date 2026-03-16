"""Tests für den EML-Parser."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.eml_parser import EmlParser

SAMPLE_DIR = Path(__file__).parent / "sample_emails"
INBOX_DIR = Path(__file__).parent.parent / "inbox"

CONFIG = {
    "company": {
        "domains": ["helbling.ch", "helbling-co.ch"]
    }
}


@pytest.fixture
def parser():
    return EmlParser(CONFIG)


class TestEmlParser:
    def test_parse_simple_email(self, parser, tmp_path):
        """Parst eine einfache E-Mail ohne Thread."""
        eml = tmp_path / "test.eml"
        eml.write_text(
            "From: test@example.com\n"
            "To: info@helbling.ch\n"
            "Subject: Test-Anfrage\n"
            "Date: Mon, 16 Mar 2026 10:00:00 +0100\n"
            "MIME-Version: 1.0\n"
            "Content-Type: text/plain; charset=UTF-8\n"
            "\n"
            "Guten Tag, ich hätte eine Frage zu SIBOX S3.\n",
            encoding="utf-8",
        )
        result = parser.parse(str(eml))
        assert result.subject == "Test-Anfrage"
        assert "test@example.com" in result.from_addr
        assert "info@helbling.ch" in result.to_addrs[0]
        assert "SIBOX S3" in result.body_plain
        assert len(result.attachments) == 0

    def test_parse_umlauts(self, parser, tmp_path):
        """Stellt sicher dass Schweizer Umlaute korrekt geparst werden."""
        eml = tmp_path / "umlauts.eml"
        eml.write_text(
            "From: müller@example.ch\n"
            "To: info@helbling.ch\n"
            "Subject: Schlüsseldepot Anfrage für Zürich\n"
            "Date: Mon, 16 Mar 2026 10:00:00 +0100\n"
            "MIME-Version: 1.0\n"
            "Content-Type: text/plain; charset=UTF-8\n"
            "\n"
            "Können Sie uns über SIBOX-Produkte informieren? Wir sind in Zürich.\n",
            encoding="utf-8",
        )
        result = parser.parse(str(eml))
        assert "Schlüsseldepot" in result.subject
        assert "Zürich" in result.body_plain

    def test_parse_thread_with_outlook_quoting(self, parser, tmp_path):
        """Erkennt Thread-Verlauf im Outlook-Format."""
        body = (
            "Guten Morgen,\n\n"
            "danke für die Info. Ich bestelle 3x SIBOX S3.\n\n"
            "-----Ursprüngliche Nachricht-----\n"
            "Von: Helbling & Co. AG <info@helbling.ch>\n"
            "Gesendet: Montag, 15. März 2026 14:00\n"
            "An: kunde@example.com\n"
            "Betreff: Re: SIBOX Anfrage\n\n"
            "Sehr geehrter Herr Müller,\nDie SIBOX S3 ist verfügbar.\n\n"
        )
        eml = tmp_path / "thread.eml"
        eml.write_text(
            "From: hans.mueller@example.com\n"
            "To: info@helbling.ch\n"
            "Subject: Re: SIBOX Anfrage\n"
            "Date: Mon, 16 Mar 2026 09:00:00 +0100\n"
            "MIME-Version: 1.0\n"
            "Content-Type: text/plain; charset=UTF-8\n"
            "\n" + body,
            encoding="utf-8",
        )
        result = parser.parse(str(eml))
        assert len(result.thread_messages) >= 2
        # Neueste Nachricht ist von extern
        assert result.thread_messages[0].is_incoming is True
        # Vorherige ist von Helbling
        assert result.thread_messages[1].is_incoming is False

    def test_is_helbling_sender(self, parser):
        """Erkennt Helbling-Absender korrekt."""
        assert parser._is_helbling_sender("info@helbling.ch") is True
        assert parser._is_helbling_sender("support@helbling-co.ch") is True
        assert parser._is_helbling_sender("kunde@example.com") is False
        assert parser._is_helbling_sender("") is False

    def test_parse_real_test_emails(self, parser):
        """Parst alle 5 Test-E-Mails aus dem Inbox."""
        eml_files = sorted(INBOX_DIR.glob("*.eml"))
        assert len(eml_files) >= 5, "Mindestens 5 Test-E-Mails müssen vorhanden sein"

        for eml_file in eml_files:
            result = parser.parse(str(eml_file))
            assert result.subject, f"Kein Betreff in {eml_file.name}"
            assert result.from_addr, f"Kein Absender in {eml_file.name}"
            assert result.body_plain, f"Kein Body in {eml_file.name}"

    def test_parse_thread_email_01(self, parser):
        """Email 1: Thread mit 3 Nachrichten (Preisanfrage SIBOX)."""
        result = parser.parse(str(INBOX_DIR / "01_sibox_preisanfrage_thread.eml"))
        assert "SIBOX" in result.subject
        assert len(result.thread_messages) == 3
        # Neueste Nachricht ist die Offertanfrage
        assert "Offerte" in result.thread_messages[0].body or "SIBOX S3" in result.thread_messages[0].body

    def test_parse_attachment_email_05(self, parser):
        """Email 5: E-Mail mit Anhang (Bestellung)."""
        result = parser.parse(str(INBOX_DIR / "05_bestellung_mit_anhang.eml"))
        assert len(result.attachments) == 1
        assert result.attachments[0].filename == "Bestelliste_SiZentrale_Luzern.xlsx"
        assert result.attachments[0].size_bytes > 0

    def test_parse_reklamation_thread(self, parser):
        """Email 3: Reklamations-Thread mit 3 Nachrichten."""
        result = parser.parse(str(INBOX_DIR / "03_reklamation_thread.eml"))
        assert "Reklamation" in result.subject
        assert len(result.thread_messages) == 3
