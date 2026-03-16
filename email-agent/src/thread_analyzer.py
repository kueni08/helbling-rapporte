"""
Thread-Analyse für das Helbling E-Mail-Verarbeitungssystem.
Analysiert den gesamten E-Mail-Verlauf via Claude API.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from .api_client import APIClient
from .eml_parser import ParsedEmail
from .utils import format_datetime

logger = logging.getLogger(__name__)

THREAD_ANALYSIS_PROMPT = """\
Analysiere diesen E-Mail-Verlauf chronologisch.

## Thread-Verlauf (älteste zuerst):
{thread_messages}

## Aktuelle (neueste) Nachricht:
Von: {from_addr}
Datum: {date}
Betreff: {subject}
Anhänge: {attachment_info}

{body}

Antworte NUR mit diesem JSON (keine zusätzlichen Erklärungen):
{{
  "anzahl_nachrichten": <Zahl>,
  "teilnehmer": ["Person 1 <email>", "Person 2 <email>"],
  "zusammenfassung": "Was wurde im Verlauf besprochen?",
  "offene_punkte": ["Punkt 1 der noch offen ist", "Punkt 2"],
  "letzte_aktion": "Was hat der Absender der neuesten Nachricht getan/gefragt?",
  "naechster_schritt": "Was wird von Helbling als nächstes erwartet?",
  "tonalitaet": "formell/informell, zufrieden/ungeduldig/veraergert/neutral",
  "bereits_angeboten": ["Produkt X für CHF Y", "..."],
  "eskalation_noetig": false,
  "kontext_fuer_antwort": "Kompakte Zusammenfassung die dem Drafter hilft, eine kontextbewusste Antwort zu schreiben"
}}
"""


@dataclass
class ThreadAnalysis:
    """Ergebnis der Thread-Analyse."""
    thread_id: str
    anzahl_nachrichten: int
    erster_kontakt: str
    letzter_kontakt: str
    teilnehmer: list
    zusammenfassung: str
    offene_punkte: list
    letzte_aktion: str
    naechster_schritt: str
    tonalitaet: str
    bereits_angeboten: list
    eskalation_noetig: bool
    kontext_fuer_antwort: str = ""

    def to_dict(self) -> dict:
        return {
            "thread_id": self.thread_id,
            "anzahl_nachrichten": self.anzahl_nachrichten,
            "erster_kontakt": self.erster_kontakt,
            "letzter_kontakt": self.letzter_kontakt,
            "teilnehmer": self.teilnehmer,
            "zusammenfassung": self.zusammenfassung,
            "offene_punkte": self.offene_punkte,
            "letzte_aktion": self.letzte_aktion,
            "naechster_schritt": self.naechster_schritt,
            "tonalitaet": self.tonalitaet,
            "bereits_angeboten": self.bereits_angeboten,
            "eskalation_noetig": self.eskalation_noetig,
            "kontext_fuer_antwort": self.kontext_fuer_antwort,
        }


class ThreadAnalyzer:
    """Analysiert E-Mail-Thread-Verläufe via Claude API."""

    def __init__(self, api_client: APIClient, config: dict = None):
        self.api = api_client
        self.config = config or {}

    def analyze(self, parsed_email: ParsedEmail) -> ThreadAnalysis:
        """Analysiert den Thread-Verlauf einer E-Mail."""
        # Thread-Nachrichten formatieren (älteste zuerst)
        thread_msgs = sorted(
            parsed_email.thread_messages,
            key=lambda m: m.position,
            reverse=True  # Höchste Position = älteste Nachricht
        )

        thread_text = self._format_thread_messages(thread_msgs[1:])  # Ohne neueste

        # Anhang-Info
        attachment_info = "Keine"
        if parsed_email.attachments:
            att_list = [f"{a.filename} ({a.content_type}, {a.size_bytes // 1024} KB)"
                       for a in parsed_email.attachments]
            attachment_info = ", ".join(att_list)

        # Body kürzen für API (max 3000 Zeichen)
        body = parsed_email.body_plain[:3000]
        if len(parsed_email.body_plain) > 3000:
            body += "\n[... Text gekürzt ...]"

        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        prompt = THREAD_ANALYSIS_PROMPT.format(
            thread_messages=thread_text or "(Kein vorheriger Thread-Verlauf)",
            from_addr=parsed_email.from_addr,
            date=date_str,
            subject=parsed_email.subject,
            attachment_info=attachment_info,
            body=body,
        )

        # Wenn kein Thread-Verlauf, verwende vereinfachte Analyse
        if len(parsed_email.thread_messages) <= 1:
            return self._simple_analysis(parsed_email)

        try:
            result = self.api.complete_json(prompt)
            return self._build_analysis(parsed_email, result)
        except Exception as e:
            logger.warning(f"Thread-Analyse fehlgeschlagen: {e}, verwende vereinfachte Analyse")
            return self._simple_analysis(parsed_email)

    def _format_thread_messages(self, thread_msgs: list) -> str:
        """Formatiert Thread-Nachrichten für den Prompt."""
        if not thread_msgs:
            return ""

        parts = []
        for msg in thread_msgs:
            date_str = f" ({msg.date})" if msg.date else ""
            direction = "← EXTERN" if msg.is_incoming else "→ HELBLING"
            parts.append(
                f"[{direction}] Von: {msg.sender}{date_str}\n"
                f"{msg.body[:1000]}{'...' if len(msg.body) > 1000 else ''}"
            )
        return "\n\n---\n\n".join(parts)

    def _build_analysis(self, parsed_email: ParsedEmail, result: dict) -> ThreadAnalysis:
        """Erstellt ein ThreadAnalysis-Objekt aus dem API-Ergebnis."""
        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        return ThreadAnalysis(
            thread_id=parsed_email.message_id or parsed_email.email_id,
            anzahl_nachrichten=result.get("anzahl_nachrichten", len(parsed_email.thread_messages)),
            erster_kontakt=result.get("erster_kontakt", "Unbekannt"),
            letzter_kontakt=date_str,
            teilnehmer=result.get("teilnehmer", [parsed_email.from_addr]),
            zusammenfassung=result.get("zusammenfassung", ""),
            offene_punkte=result.get("offene_punkte", []),
            letzte_aktion=result.get("letzte_aktion", ""),
            naechster_schritt=result.get("naechster_schritt", ""),
            tonalitaet=result.get("tonalitaet", "formell"),
            bereits_angeboten=result.get("bereits_angeboten", []),
            eskalation_noetig=result.get("eskalation_noetig", False),
            kontext_fuer_antwort=result.get("kontext_fuer_antwort", ""),
        )

    def _simple_analysis(self, parsed_email: ParsedEmail) -> ThreadAnalysis:
        """Einfache Analyse ohne API für E-Mails ohne Thread."""
        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        return ThreadAnalysis(
            thread_id=parsed_email.message_id or parsed_email.email_id,
            anzahl_nachrichten=1,
            erster_kontakt=date_str,
            letzter_kontakt=date_str,
            teilnehmer=[parsed_email.from_addr],
            zusammenfassung=f"Neue E-Mail von {parsed_email.from_addr}: {parsed_email.subject}",
            offene_punkte=[],
            letzte_aktion=f"Erste Kontaktaufnahme: {parsed_email.subject}",
            naechster_schritt="Antwort auf die Anfrage",
            tonalitaet="formell",
            bereits_angeboten=[],
            eskalation_noetig=False,
            kontext_fuer_antwort=f"Erste E-Mail im Thread. Betreff: {parsed_email.subject}",
        )
