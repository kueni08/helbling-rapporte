"""
E-Mail-Klassifikation für das Helbling E-Mail-Verarbeitungssystem.
Klassifiziert E-Mails nach Geschäftsbereich und Aktionstyp via Claude API.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from .api_client import APIClient
from .eml_parser import ParsedEmail
from .thread_analyzer import ThreadAnalysis
from .utils import format_datetime, truncate_text

logger = logging.getLogger(__name__)

CLASSIFICATION_PROMPT = """\
Analysiere diese E-Mail und ihren Thread-Verlauf und klassifiziere sie.

## Thread-Kontext (falls vorhanden):
{thread_context}

## Aktuelle E-Mail:
Von: {from_addr}
An: {to_addrs}
CC: {cc_addrs}
Datum: {date}
Betreff: {subject}
Anhänge: {attachment_names}

{email_content}

## Klassifizierungsregeln:
Geschäftsbereich:
- SIBOX: Schlüsseldepots, Notöffnung, Schliesszylinder, Keso, Kaba, SEA, Schliessanlagen
- FACETTESTAR: Entgratmaschinen, Anfasmaschinen, Entgraten, Anfasen, FS-100/200/300
- ALLGEMEIN: Administration, HR, Buchhaltung, allgemeine Anfragen, unklare Zuordnung

Aktionstyp:
- ANFRAGE: Informationsanfrage zu Produkten/Preisen/Verfügbarkeit
- ANGEBOT_ANFRAGE: Explizite Offertanfrage, Preisanfrage für konkrete Menge
- REKLAMATION: Beschwerde, Fehler, Problem mit Lieferung oder Produkt
- TERMIN: Terminanfrage, Terminbestätigung, Besichtigungsanfrage
- NACHFASSEN: Follow-up auf vorherige Kommunikation, keine neue Aktion
- BESTELLUNG: Konkrete Bestellung, Auftragserteilung
- INFO: Reine Information, keine Handlung erforderlich
- INTERN: Interne Kommunikation zwischen Mitarbeitern

Antworte NUR mit diesem JSON (keine zusätzlichen Erklärungen):
{{
  "bereich": "SIBOX" | "FACETTESTAR" | "ALLGEMEIN",
  "aktionstyp": "ANFRAGE" | "ANGEBOT_ANFRAGE" | "REKLAMATION" | "TERMIN" | "NACHFASSEN" | "BESTELLUNG" | "INFO" | "INTERN",
  "zusammenfassung": "Kurze Zusammenfassung in einem Satz",
  "absender": "Name und/oder E-Mail",
  "dringlichkeit": "hoch" | "mittel" | "niedrig",
  "schluesselwoerter": ["keyword1", "keyword2"],
  "benoetigt_antwort": true | false,
  "benoetigt_aufgabe": true | false,
  "thread_kontext_relevant": true | false,
  "bezug_auf_vorherige_nachricht": "Worauf bezieht sich die aktuelle Mail im Verlauf? (oder leer wenn kein Thread)"
}}
"""


@dataclass
class Classification:
    """Ergebnis der E-Mail-Klassifikation."""
    bereich: str              # SIBOX, FACETTESTAR, ALLGEMEIN
    aktionstyp: str           # ANFRAGE, ANGEBOT_ANFRAGE, etc.
    zusammenfassung: str
    absender: str
    dringlichkeit: str        # hoch, mittel, niedrig
    schluesselwoerter: list
    benoetigt_antwort: bool
    benoetigt_aufgabe: bool
    thread_kontext_relevant: bool
    bezug_auf_vorherige_nachricht: str

    def to_dict(self) -> dict:
        return {
            "bereich": self.bereich,
            "aktionstyp": self.aktionstyp,
            "zusammenfassung": self.zusammenfassung,
            "absender": self.absender,
            "dringlichkeit": self.dringlichkeit,
            "schluesselwoerter": self.schluesselwoerter,
            "benoetigt_antwort": self.benoetigt_antwort,
            "benoetigt_aufgabe": self.benoetigt_aufgabe,
            "thread_kontext_relevant": self.thread_kontext_relevant,
            "bezug_auf_vorherige_nachricht": self.bezug_auf_vorherige_nachricht,
        }


class Classifier:
    """Klassifiziert E-Mails nach Bereich und Aktionstyp."""

    def __init__(self, api_client: APIClient, config: dict = None):
        self.api = api_client
        self.config = config or {}
        clf_cfg = self.config.get("classification", {})
        self.keywords_sibox = [k.lower() for k in clf_cfg.get("keywords_sibox", [])]
        self.keywords_facettestar = [k.lower() for k in clf_cfg.get("keywords_facettestar", [])]
        self.default_bereich = clf_cfg.get("default_bereich", "ALLGEMEIN")

    def classify(
        self,
        parsed_email: ParsedEmail,
        thread_analysis: Optional[ThreadAnalysis] = None,
    ) -> Classification:
        """Klassifiziert eine E-Mail."""
        # Thread-Kontext aufbereiten
        thread_context = "Kein Thread-Verlauf."
        if thread_analysis:
            tc = thread_analysis
            thread_context = (
                f"Zusammenfassung: {tc.zusammenfassung}\n"
                f"Offene Punkte: {', '.join(tc.offene_punkte) or 'keine'}\n"
                f"Letzte Aktion: {tc.letzte_aktion}\n"
                f"Bereits besprochen: {', '.join(tc.bereits_angeboten) or 'nichts'}"
            )

        # Anhang-Namen
        att_names = "Keine"
        if parsed_email.attachments:
            att_names = ", ".join(a.filename for a in parsed_email.attachments)

        # E-Mail-Content kürzen
        content = truncate_text(parsed_email.body_plain, 2000)
        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        prompt = CLASSIFICATION_PROMPT.format(
            thread_context=thread_context,
            from_addr=parsed_email.from_addr,
            to_addrs=", ".join(parsed_email.to_addrs),
            cc_addrs=", ".join(parsed_email.cc_addrs) or "Keine",
            date=date_str,
            subject=parsed_email.subject,
            attachment_names=att_names,
            email_content=content,
        )

        try:
            result = self.api.complete_json(prompt)
            clf = self._build_classification(result)
        except Exception as e:
            logger.warning(f"Klassifikation fehlgeschlagen: {e}, verwende Keyword-Fallback")
            clf = self._keyword_classify(parsed_email)

        logger.info(
            f"Klassifikation: {clf.bereich} / {clf.aktionstyp} "
            f"(Dringlichkeit: {clf.dringlichkeit})"
        )
        return clf

    def _build_classification(self, result: dict) -> Classification:
        """Erstellt ein Classification-Objekt aus dem API-Ergebnis."""
        # Validierung der Enums
        bereich = result.get("bereich", "ALLGEMEIN").upper()
        if bereich not in ("SIBOX", "FACETTESTAR", "ALLGEMEIN"):
            bereich = "ALLGEMEIN"

        aktionstyp = result.get("aktionstyp", "INFO").upper()
        valid_types = ("ANFRAGE", "ANGEBOT_ANFRAGE", "REKLAMATION", "TERMIN",
                      "NACHFASSEN", "BESTELLUNG", "INFO", "INTERN")
        if aktionstyp not in valid_types:
            aktionstyp = "ANFRAGE"

        dringlichkeit = result.get("dringlichkeit", "mittel").lower()
        if dringlichkeit not in ("hoch", "mittel", "niedrig"):
            dringlichkeit = "mittel"

        return Classification(
            bereich=bereich,
            aktionstyp=aktionstyp,
            zusammenfassung=result.get("zusammenfassung", ""),
            absender=result.get("absender", ""),
            dringlichkeit=dringlichkeit,
            schluesselwoerter=result.get("schluesselwoerter", []),
            benoetigt_antwort=result.get("benoetigt_antwort", True),
            benoetigt_aufgabe=result.get("benoetigt_aufgabe", False),
            thread_kontext_relevant=result.get("thread_kontext_relevant", False),
            bezug_auf_vorherige_nachricht=result.get("bezug_auf_vorherige_nachricht", ""),
        )

    def _keyword_classify(self, parsed_email: ParsedEmail) -> Classification:
        """Fallback: Keyword-basierte Klassifikation ohne API."""
        text = f"{parsed_email.subject} {parsed_email.body_plain}".lower()

        # Bereich bestimmen
        sibox_hits = sum(1 for kw in self.keywords_sibox if kw in text)
        facettestar_hits = sum(1 for kw in self.keywords_facettestar if kw in text)

        if sibox_hits > facettestar_hits and sibox_hits > 0:
            bereich = "SIBOX"
        elif facettestar_hits > 0:
            bereich = "FACETTESTAR"
        else:
            bereich = self.default_bereich

        # Aktionstyp bestimmen
        aktionstyp = "ANFRAGE"
        if any(w in text for w in ["offert", "angebot", "preis", "kosten"]):
            aktionstyp = "ANGEBOT_ANFRAGE"
        elif any(w in text for w in ["reklamation", "defekt", "kaputt", "problem", "beschwerde"]):
            aktionstyp = "REKLAMATION"
        elif any(w in text for w in ["termin", "besichtigung", "treffen"]):
            aktionstyp = "TERMIN"
        elif any(w in text for w in ["bestell", "auftrag", "lieferung"]):
            aktionstyp = "BESTELLUNG"

        return Classification(
            bereich=bereich,
            aktionstyp=aktionstyp,
            zusammenfassung=f"E-Mail von {parsed_email.from_addr}: {parsed_email.subject}",
            absender=parsed_email.from_addr,
            dringlichkeit="mittel",
            schluesselwoerter=[],
            benoetigt_antwort=aktionstyp in ("ANFRAGE", "ANGEBOT_ANFRAGE", "REKLAMATION"),
            benoetigt_aufgabe=aktionstyp in ("ANGEBOT_ANFRAGE", "REKLAMATION", "TERMIN", "BESTELLUNG"),
            thread_kontext_relevant=False,
            bezug_auf_vorherige_nachricht="",
        )
