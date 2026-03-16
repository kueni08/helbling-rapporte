"""
Antwortentwurf-Generator für das Helbling E-Mail-Verarbeitungssystem.
Generiert professionelle Antwortentwürfe auf Schweizer Hochdeutsch.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from .api_client import APIClient
from .classifier import Classification
from .eml_parser import ParsedEmail
from .knowledge import KnowledgeBase, KnowledgeChunk
from .thread_analyzer import ThreadAnalysis
from .utils import format_datetime

logger = logging.getLogger(__name__)

DRAFT_PROMPT = """\
Du bist der E-Mail-Assistent von Helbling & Co. AG, Rapperswil-Jona.
Erstelle einen professionellen Antwortentwurf auf Deutsch (Schweizer Hochdeutsch, kein ß).

## Thread-Verlauf & Analyse:
{thread_context}

## Offene Punkte:
{offene_punkte}

## Bereits besprochen/angeboten:
{bereits_angeboten}

## Erwarteter nächster Schritt:
{naechster_schritt}

## Kontext aus Wissensdatenbank:
{knowledge_context}

## Aktuelle E-Mail (zu beantworten):
Von: {from_addr}
Datum: {date}
Betreff: {subject}
Anhänge: {attachment_info}

{email_content}

## Klassifikation:
- Bereich: {bereich}
- Typ: {aktionstyp}
- Zusammenfassung: {zusammenfassung}
- Dringlichkeit: {dringlichkeit}

## Regeln für den Entwurf:
1. Anrede: "Sehr geehrte/r [Name]," — oder passend zur Tonalität im Verlauf
2. Gruss: "{signatur}"
3. Bei Preisangaben: NUR Preise aus der Wissensdatenbank verwenden — bei unbekannten Preisen "[PRÜFEN: Preis]" schreiben
4. Bei Unsicherheiten: Rückfrage formulieren statt falsche Informationen geben
5. Markiere manuell zu prüfende Stellen mit [PRÜFEN: ...]
6. Beziehe dich auf den Verlauf wenn relevant (z.B. "Wie besprochen..." / "Bezugnehmend auf...")
7. Wiederhole KEINE Informationen die bereits im Verlauf gegeben wurden
8. Wenn Anhänge vorhanden: kurz erwähnen wo sinnvoll
9. KEIN "ß" — schreibe immer "ss"
10. Kurz und präzise — keine unnötigen Floskeln

Erstelle NUR den Antwortentwurf (kein JSON, kein Kommentar davor oder danach):
"""


@dataclass
class DraftResult:
    """Ergebnis der Entwurfsgenerierung."""
    email_id: str
    subject: str
    recipient: str
    draft_text: str
    used_knowledge_sources: list
    classification_bereich: str
    classification_aktionstyp: str
    has_check_markers: bool  # Hat [PRÜFEN: ...] Markierungen

    def to_dict(self) -> dict:
        return {
            "email_id": self.email_id,
            "subject": self.subject,
            "recipient": self.recipient,
            "draft_text": self.draft_text,
            "used_knowledge_sources": self.used_knowledge_sources,
            "classification_bereich": self.classification_bereich,
            "classification_aktionstyp": self.classification_aktionstyp,
            "has_check_markers": self.has_check_markers,
        }


class Drafter:
    """Generiert Antwortentwürfe für E-Mails."""

    def __init__(
        self,
        api_client: APIClient,
        knowledge_base: KnowledgeBase,
        config: dict = None,
    ):
        self.api = api_client
        self.kb = knowledge_base
        self.config = config or {}

        drafts_cfg = self.config.get("drafts", {})
        self.signatur = drafts_cfg.get("signatur", "Freundliche Grüsse\n\nHelbling & Co. AG")

    def generate_draft(
        self,
        parsed_email: ParsedEmail,
        thread_analysis: ThreadAnalysis,
        classification: Classification,
        knowledge_chunks: Optional[list] = None,
    ) -> DraftResult:
        """Generiert einen Antwortentwurf."""
        # Relevante Wissens-Chunks laden wenn nicht übergeben
        if knowledge_chunks is None:
            query = f"{parsed_email.subject} {classification.bereich} {classification.aktionstyp}"
            knowledge_chunks = self.kb.retrieve(
                query,
                top_k=5,
                category=classification.bereich.lower(),
            )

        knowledge_context = self.kb.format_for_prompt(knowledge_chunks)
        knowledge_sources = [c.source_file for c in (knowledge_chunks or [])]

        # Thread-Kontext formatieren
        thread_context = self._format_thread_context(thread_analysis)

        # Anhang-Info
        attachment_info = "Keine"
        if parsed_email.attachments:
            att_list = [f"{a.filename} ({a.size_bytes // 1024} KB)"
                       for a in parsed_email.attachments]
            attachment_info = ", ".join(att_list)

        # E-Mail-Content (nur aktuelle Nachricht, nicht den ganzen Thread)
        email_content = parsed_email.body_plain[:2000]
        if len(parsed_email.body_plain) > 2000:
            email_content += "\n[... Text gekürzt ...]"

        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        prompt = DRAFT_PROMPT.format(
            thread_context=thread_context,
            offene_punkte=(
                "\n".join(f"- {p}" for p in thread_analysis.offene_punkte)
                if thread_analysis.offene_punkte else "Keine offenen Punkte."
            ),
            bereits_angeboten=(
                "\n".join(f"- {p}" for p in thread_analysis.bereits_angeboten)
                if thread_analysis.bereits_angeboten else "Noch nichts besprochen."
            ),
            naechster_schritt=thread_analysis.naechster_schritt or "Antwort auf Anfrage",
            knowledge_context=knowledge_context,
            from_addr=parsed_email.from_addr,
            date=date_str,
            subject=parsed_email.subject,
            attachment_info=attachment_info,
            email_content=email_content,
            bereich=classification.bereich,
            aktionstyp=classification.aktionstyp,
            zusammenfassung=classification.zusammenfassung,
            dringlichkeit=classification.dringlichkeit,
            signatur=self.signatur,
        )

        try:
            draft_text = self.api.complete(prompt, max_tokens=1500)
        except Exception as e:
            logger.error(f"Fehler beim Generieren des Entwurfs: {e}")
            draft_text = self._fallback_draft(parsed_email, classification)

        has_check_markers = "[PRÜFEN:" in draft_text

        result = DraftResult(
            email_id=parsed_email.email_id,
            subject=f"Re: {parsed_email.subject}",
            recipient=parsed_email.from_addr,
            draft_text=draft_text,
            used_knowledge_sources=knowledge_sources,
            classification_bereich=classification.bereich,
            classification_aktionstyp=classification.aktionstyp,
            has_check_markers=has_check_markers,
        )

        logger.info(
            f"Entwurf generiert für: {parsed_email.subject} "
            f"({'mit' if has_check_markers else 'ohne'} PRÜFEN-Marker)"
        )
        return result

    def _format_thread_context(self, ta: ThreadAnalysis) -> str:
        """Formatiert den Thread-Kontext für den Prompt."""
        if ta.anzahl_nachrichten <= 1:
            return "Erste Kontaktaufnahme, kein vorheriger Verlauf."

        return (
            f"Zusammenfassung: {ta.zusammenfassung}\n"
            f"Teilnehmer: {', '.join(ta.teilnehmer)}\n"
            f"Tonalität: {ta.tonalitaet}\n"
            f"Kontext: {ta.kontext_fuer_antwort}"
        )

    def _fallback_draft(
        self, parsed_email: ParsedEmail, classification: Classification
    ) -> str:
        """Fallback-Entwurf wenn API nicht verfügbar."""
        return (
            f"Sehr geehrte/r [PRÜFEN: Name],\n\n"
            f"vielen Dank für Ihre E-Mail vom [PRÜFEN: Datum] "
            f"zum Thema '{parsed_email.subject}'.\n\n"
            f"[PRÜFEN: Antwort auf die Anfrage formulieren]\n\n"
            f"{self.signatur}"
        )
