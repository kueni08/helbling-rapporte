"""
Aufgaben-Generator für das Helbling E-Mail-Verarbeitungssystem.
Erkennt Handlungsaufforderungen und erstellt strukturierte Aufgaben.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from .api_client import APIClient
from .classifier import Classification
from .eml_parser import ParsedEmail
from .thread_analyzer import ThreadAnalysis
from .utils import format_datetime

logger = logging.getLogger(__name__)

TASK_PROMPT = """\
Analysiere diese E-Mail und erkenne konkrete Handlungsaufforderungen.

## E-Mail:
Von: {from_addr}
Datum: {date}
Betreff: {subject}

{email_content}

## Klassifikation:
- Bereich: {bereich}
- Typ: {aktionstyp}
- Dringlichkeit: {dringlichkeit}

## Thread-Kontext:
{thread_context}

Erstelle eine Aufgabe im folgenden JSON-Format (keine zusätzlichen Erklärungen):
{{
  "titel": "Konkrete Aufgabe in einem Satz",
  "beschreibung": "Detaillierte Beschreibung was zu tun ist, inklusive wichtiger Details aus der E-Mail (Kontaktdaten, Mengen, Wünsche etc.)",
  "typ": "ANGEBOT_ERSTELLEN" | "RUECKRUF" | "TERMIN_PLANEN" | "NACHFASSEN" | "REKLAMATION_BEARBEITEN" | "BESTELLUNG_VERARBEITEN" | "INTERN_WEITERLEITEN" | "DOKUMENT_ERSTELLEN",
  "prioritaet": "hoch" | "mittel" | "niedrig",
  "faellig_in_tagen": 1-14,
  "teilaufgaben": ["Teilaufgabe 1", "Teilaufgabe 2", "Teilaufgabe 3"],
  "kontakt_name": "Name des Kunden/Absenders",
  "kontakt_email": "E-Mail-Adresse",
  "kontakt_telefon": "Telefonnummer falls erwähnt",
  "produkte": ["Produkt 1", "Produkt 2"],
  "notizen": "Weitere wichtige Hinweise aus der E-Mail"
}}
"""


@dataclass
class Task:
    """Eine generierte Aufgabe."""
    id: str
    titel: str
    beschreibung: str
    quelle_email: str
    bereich: str
    typ: str
    prioritaet: str
    faellig_bis: str
    status: str = "offen"
    zugewiesen_an: str = ""
    teilaufgaben: list = field(default_factory=list)
    kontakt_name: str = ""
    kontakt_email: str = ""
    kontakt_telefon: str = ""
    produkte: list = field(default_factory=list)
    notizen: str = ""
    erstellt_am: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "titel": self.titel,
            "beschreibung": self.beschreibung,
            "quelle_email": self.quelle_email,
            "bereich": self.bereich,
            "typ": self.typ,
            "prioritaet": self.prioritaet,
            "faellig_bis": self.faellig_bis,
            "status": self.status,
            "zugewiesen_an": self.zugewiesen_an,
            "teilaufgaben": self.teilaufgaben,
            "kontakt_name": self.kontakt_name,
            "kontakt_email": self.kontakt_email,
            "kontakt_telefon": self.kontakt_telefon,
            "produkte": self.produkte,
            "notizen": self.notizen,
            "erstellt_am": self.erstellt_am,
        }

    def to_markdown(self) -> str:
        """Gibt die Aufgabe als Markdown zurück."""
        lines = [
            f"# Aufgabe: {self.titel}",
            f"",
            f"**ID:** {self.id}",
            f"**Bereich:** {self.bereich}",
            f"**Typ:** {self.typ}",
            f"**Priorität:** {self.prioritaet.upper()}",
            f"**Fällig bis:** {self.faellig_bis}",
            f"**Status:** {self.status}",
            f"**Zugewiesen an:** {self.zugewiesen_an}",
            f"**Erstellt:** {self.erstellt_am}",
            f"",
            f"## Beschreibung",
            self.beschreibung,
            f"",
        ]

        if self.teilaufgaben:
            lines.append("## Teilaufgaben")
            for t in self.teilaufgaben:
                lines.append(f"- [ ] {t}")
            lines.append("")

        if self.kontakt_name or self.kontakt_email:
            lines.append("## Kontakt")
            if self.kontakt_name:
                lines.append(f"**Name:** {self.kontakt_name}")
            if self.kontakt_email:
                lines.append(f"**E-Mail:** {self.kontakt_email}")
            if self.kontakt_telefon:
                lines.append(f"**Telefon:** {self.kontakt_telefon}")
            lines.append("")

        if self.produkte:
            lines.append("## Produkte")
            for p in self.produkte:
                lines.append(f"- {p}")
            lines.append("")

        if self.notizen:
            lines.append("## Notizen")
            lines.append(self.notizen)

        lines.append(f"")
        lines.append(f"*Quelle: {self.quelle_email}*")

        return "\n".join(lines)


class Tasker:
    """Erkennt Handlungsaufforderungen und erstellt Aufgaben."""

    def __init__(self, api_client: APIClient, config: dict = None):
        self.api = api_client
        self.config = config or {}

        tasks_cfg = self.config.get("tasks", {})
        self.default_zugewiesen = tasks_cfg.get("default_zugewiesen", "Kueni")
        self.nachfass_tage = tasks_cfg.get("nachfass_tage", 3)
        self.prio_mapping = tasks_cfg.get("prioritaet_mapping", {})

    def create_task(
        self,
        parsed_email: ParsedEmail,
        thread_analysis: ThreadAnalysis,
        classification: Classification,
    ) -> Task:
        """Erstellt eine Aufgabe aus einer E-Mail."""
        # Priorität aus Mapping oder Klassifikation
        prio = self.prio_mapping.get(
            classification.aktionstyp,
            classification.dringlichkeit
        )

        # Thread-Kontext
        thread_context = "Erste Kontaktaufnahme."
        if thread_analysis.anzahl_nachrichten > 1:
            thread_context = (
                f"Thread mit {thread_analysis.anzahl_nachrichten} Nachrichten.\n"
                f"Verlauf: {thread_analysis.zusammenfassung}"
            )

        email_content = parsed_email.body_plain[:2000]
        date_str = format_datetime(parsed_email.date) if parsed_email.date else "Unbekannt"

        prompt = TASK_PROMPT.format(
            from_addr=parsed_email.from_addr,
            date=date_str,
            subject=parsed_email.subject,
            email_content=email_content,
            bereich=classification.bereich,
            aktionstyp=classification.aktionstyp,
            dringlichkeit=prio,
            thread_context=thread_context,
        )

        # Fälligkeitsdatum berechnen
        days = self._get_due_days(classification.aktionstyp, prio)
        due_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

        try:
            result = self.api.complete_json(prompt)
            task = self._build_task(result, parsed_email, classification, prio, due_date)
        except Exception as e:
            logger.warning(f"Task-Generierung fehlgeschlagen: {e}, verwende Fallback")
            task = self._fallback_task(parsed_email, classification, prio, due_date)

        logger.info(
            f"Aufgabe erstellt: {task.titel} "
            f"(Prio: {task.prioritaet}, fällig: {task.faellig_bis})"
        )
        return task

    def _build_task(
        self,
        result: dict,
        parsed_email: ParsedEmail,
        classification: Classification,
        prio: str,
        due_date: str,
    ) -> Task:
        """Erstellt ein Task-Objekt aus dem API-Ergebnis."""
        typ = result.get("typ", classification.aktionstyp)
        valid_types = (
            "ANGEBOT_ERSTELLEN", "RUECKRUF", "TERMIN_PLANEN", "NACHFASSEN",
            "REKLAMATION_BEARBEITEN", "BESTELLUNG_VERARBEITEN",
            "INTERN_WEITERLEITEN", "DOKUMENT_ERSTELLEN"
        )
        if typ not in valid_types:
            typ = self._map_aktionstyp_to_task_typ(classification.aktionstyp)

        # Override Priorität aus API falls valide
        api_prio = result.get("prioritaet", prio)
        if api_prio in ("hoch", "mittel", "niedrig"):
            prio = api_prio

        # Fälligkeitsdatum aus API übernehmen
        days = result.get("faellig_in_tagen", None)
        if days and isinstance(days, int) and 1 <= days <= 30:
            due_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

        task_id = self._generate_task_id()

        return Task(
            id=task_id,
            titel=result.get("titel", f"Aufgabe zu: {parsed_email.subject}"),
            beschreibung=result.get("beschreibung", ""),
            quelle_email=str(parsed_email.source_file),
            bereich=classification.bereich,
            typ=typ,
            prioritaet=prio,
            faellig_bis=due_date,
            status="offen",
            zugewiesen_an=self.default_zugewiesen,
            teilaufgaben=result.get("teilaufgaben", []),
            kontakt_name=result.get("kontakt_name", ""),
            kontakt_email=result.get("kontakt_email", parsed_email.from_addr),
            kontakt_telefon=result.get("kontakt_telefon", ""),
            produkte=result.get("produkte", []),
            notizen=result.get("notizen", ""),
            erstellt_am=datetime.now().isoformat(),
        )

    def _fallback_task(
        self,
        parsed_email: ParsedEmail,
        classification: Classification,
        prio: str,
        due_date: str,
    ) -> Task:
        """Fallback-Aufgabe wenn API nicht verfügbar."""
        typ = self._map_aktionstyp_to_task_typ(classification.aktionstyp)
        return Task(
            id=self._generate_task_id(),
            titel=f"{typ}: {parsed_email.subject}",
            beschreibung=f"E-Mail von {parsed_email.from_addr}: {parsed_email.subject}",
            quelle_email=str(parsed_email.source_file),
            bereich=classification.bereich,
            typ=typ,
            prioritaet=prio,
            faellig_bis=due_date,
            zugewiesen_an=self.default_zugewiesen,
            kontakt_email=parsed_email.from_addr,
            erstellt_am=datetime.now().isoformat(),
        )

    def _get_due_days(self, aktionstyp: str, prio: str) -> int:
        """Berechnet Fälligkeitstage basierend auf Typ und Priorität."""
        days_map = {
            "REKLAMATION": 1,
            "ANGEBOT_ANFRAGE": 2,
            "BESTELLUNG": 1,
            "TERMIN": 3,
            "NACHFASSEN": self.nachfass_tage,
            "ANFRAGE": 3,
            "INFO": 7,
            "INTERN": 5,
        }
        base = days_map.get(aktionstyp, 3)
        if prio == "hoch":
            return max(1, base - 1)
        elif prio == "niedrig":
            return base + 2
        return base

    def _map_aktionstyp_to_task_typ(self, aktionstyp: str) -> str:
        """Mapped Aktionstyp auf Task-Typ."""
        mapping = {
            "ANGEBOT_ANFRAGE": "ANGEBOT_ERSTELLEN",
            "REKLAMATION": "REKLAMATION_BEARBEITEN",
            "TERMIN": "TERMIN_PLANEN",
            "NACHFASSEN": "NACHFASSEN",
            "BESTELLUNG": "BESTELLUNG_VERARBEITEN",
            "ANFRAGE": "RUECKRUF",
            "INFO": "INTERN_WEITERLEITEN",
            "INTERN": "INTERN_WEITERLEITEN",
        }
        return mapping.get(aktionstyp, "RUECKRUF")

    def _generate_task_id(self) -> str:
        """Generiert eine eindeutige Aufgaben-ID."""
        now = datetime.now()
        import random
        rand = random.randint(100, 999)
        return f"TASK-{now.strftime('%Y-%m')}-{rand}"
