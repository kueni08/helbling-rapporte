"""Tests für den Klassifikator (Keyword-Fallback ohne API)."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.classifier import Classifier, Classification
from src.eml_parser import EmlParser, ParsedEmail
from datetime import datetime

INBOX_DIR = Path(__file__).parent.parent / "inbox"

CONFIG = {
    "classification": {
        "default_bereich": "ALLGEMEIN",
        "keywords_sibox": [
            "sibox", "schlüsseldepot", "notöffnung", "schliesszylinder",
            "keso", "kaba", "sea", "schliessanlage"
        ],
        "keywords_facettestar": [
            "facettestar", "entgrat", "anfas", "chamfer", "deburr", "fs-200", "fs-100"
        ],
    }
}


def make_email(subject="", body="", from_addr="test@example.com") -> ParsedEmail:
    """Erstellt eine Test-ParsedEmail."""
    from src.eml_parser import ThreadMsg
    return ParsedEmail(
        message_id="test-123",
        subject=subject,
        from_addr=from_addr,
        to_addrs=["info@helbling.ch"],
        cc_addrs=[],
        date=datetime(2026, 3, 16, 10, 0, 0),
        body_plain=body,
        body_html=None,
        attachments=[],
        in_reply_to=None,
        references=[],
        thread_messages=[
            ThreadMsg(sender=from_addr, date=None, body=body, position=0, is_incoming=True)
        ],
        headers_raw={},
        email_id="test-id",
        source_file="test.eml",
    )


class TestClassifierKeywordFallback:
    """Testet den Keyword-Fallback ohne API."""

    @pytest.fixture
    def clf(self):
        # APIClient wird nicht gebraucht für Keyword-Tests
        class FakeAPI:
            def complete_json(self, *a, **kw):
                raise Exception("Kein API verfügbar")
        c = Classifier.__new__(Classifier)
        c.config = CONFIG
        clf_cfg = CONFIG.get("classification", {})
        c.keywords_sibox = [k.lower() for k in clf_cfg.get("keywords_sibox", [])]
        c.keywords_facettestar = [k.lower() for k in clf_cfg.get("keywords_facettestar", [])]
        c.default_bereich = clf_cfg.get("default_bereich", "ALLGEMEIN")
        c.api = FakeAPI()
        return c

    def test_sibox_keyword_detection(self, clf):
        """Erkennt SIBOX-Bereich via Keywords."""
        email = make_email("SIBOX S3 Anfrage", "Ich interessiere mich für SIBOX S3.")
        result = clf._keyword_classify(email)
        assert result.bereich == "SIBOX"

    def test_facettestar_keyword_detection(self, clf):
        """Erkennt FACETTESTAR-Bereich via Keywords."""
        email = make_email("FACETTESTAR Frage", "Technische Frage zur FACETTESTAR FS-200.")
        result = clf._keyword_classify(email)
        assert result.bereich == "FACETTESTAR"

    def test_allgemein_fallback(self, clf):
        """Fällt auf ALLGEMEIN zurück wenn keine Keywords passen."""
        email = make_email("Allgemeine Frage", "Können Sie mir Ihre Öffnungszeiten mitteilen?")
        result = clf._keyword_classify(email)
        assert result.bereich == "ALLGEMEIN"

    def test_angebot_anfrage_detection(self, clf):
        """Erkennt ANGEBOT_ANFRAGE-Typ."""
        email = make_email("Offerte SIBOX", "Bitte erstellen Sie uns eine Offerte für SIBOX.")
        result = clf._keyword_classify(email)
        assert result.aktionstyp == "ANGEBOT_ANFRAGE"

    def test_reklamation_detection(self, clf):
        """Erkennt REKLAMATION-Typ."""
        email = make_email("Reklamation", "Das Produkt ist defekt und ich reklamiere.")
        result = clf._keyword_classify(email)
        assert result.aktionstyp == "REKLAMATION"

    def test_termin_detection(self, clf):
        """Erkennt TERMIN-Typ."""
        email = make_email("Terminanfrage", "Ich würde gerne einen Besichtigungstermin vereinbaren.")
        result = clf._keyword_classify(email)
        assert result.aktionstyp == "TERMIN"

    def test_bestellung_detection(self, clf):
        """Erkennt BESTELLUNG-Typ."""
        email = make_email("Bestellung", "Hiermit bestelle ich 5x SIBOX S3.")
        result = clf._keyword_classify(email)
        assert result.aktionstyp == "BESTELLUNG"

    def test_classification_result_complete(self, clf):
        """Classification-Ergebnis hat alle Pflichtfelder."""
        email = make_email("Test", "SIBOX Frage")
        result = clf._keyword_classify(email)
        assert isinstance(result, Classification)
        assert result.bereich in ("SIBOX", "FACETTESTAR", "ALLGEMEIN")
        assert result.aktionstyp in (
            "ANFRAGE", "ANGEBOT_ANFRAGE", "REKLAMATION",
            "TERMIN", "NACHFASSEN", "BESTELLUNG", "INFO", "INTERN"
        )
        assert result.dringlichkeit in ("hoch", "mittel", "niedrig")
        assert isinstance(result.benoetigt_antwort, bool)
        assert isinstance(result.benoetigt_aufgabe, bool)

    def test_sibox_priority_over_facettestar(self, clf):
        """SIBOX hat Priorität wenn mehr Keywords passen."""
        email = make_email(
            "SIBOX mit Keso Zylinder und Schliessanlage",
            "Ich brauche ein Schlüsseldepot SIBOX S3 mit Keso 2000 für eine Schliessanlage."
        )
        result = clf._keyword_classify(email)
        assert result.bereich == "SIBOX"
