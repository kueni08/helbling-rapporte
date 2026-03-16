"""
Prozess-Orchestrierung für das Helbling E-Mail-Verarbeitungssystem.
Pipeline: parse → analyze → classify → retrieve → draft/task → log
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from .api_client import APIClient
from .classifier import Classification, Classifier
from .drafter import DraftResult, Drafter
from .eml_parser import EmlParser, ParsedEmail
from .knowledge import KnowledgeBase
from .tasker import Task, Tasker
from .thread_analyzer import ThreadAnalysis, ThreadAnalyzer
from .utils import (
    format_datetime,
    resolve_path,
    save_json,
    save_text,
)

logger = logging.getLogger(__name__)


class ProcessingResult:
    """Ergebnis der Verarbeitung einer E-Mail."""

    def __init__(
        self,
        email_id: str,
        source_file: str,
        parsed_email: ParsedEmail,
        thread_analysis: ThreadAnalysis,
        classification: Classification,
        draft: Optional[DraftResult] = None,
        task: Optional[Task] = None,
        error: Optional[str] = None,
    ):
        self.email_id = email_id
        self.source_file = source_file
        self.parsed_email = parsed_email
        self.thread_analysis = thread_analysis
        self.classification = classification
        self.draft = draft
        self.task = task
        self.error = error
        self.processed_at = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return {
            "email_id": self.email_id,
            "source_file": self.source_file,
            "processed_at": self.processed_at,
            "subject": self.parsed_email.subject,
            "from_addr": self.parsed_email.from_addr,
            "date": format_datetime(self.parsed_email.date) if self.parsed_email.date else None,
            "classification": self.classification.to_dict() if self.classification else None,
            "thread_analysis": self.thread_analysis.to_dict() if self.thread_analysis else None,
            "draft_generated": self.draft is not None,
            "draft_file": None,
            "task_generated": self.task is not None,
            "task_id": self.task.id if self.task else None,
            "task_file": None,
            "error": self.error,
        }


class Processor:
    """Orchestriert die E-Mail-Verarbeitungspipeline."""

    def __init__(self, config: dict):
        self.config = config
        paths = config.get("paths", {})

        self.inbox_path = resolve_path(paths.get("inbox", "./inbox"))
        self.output_path = resolve_path(paths.get("output", "./output"))
        self.archive_path = resolve_path(paths.get("archive", "./archive"))

        # Module initialisieren
        self.api = APIClient(config)
        self.kb = KnowledgeBase(config)
        self.parser = EmlParser(config)
        self.thread_analyzer = ThreadAnalyzer(self.api, config)
        self.classifier = Classifier(self.api, config)
        self.drafter = Drafter(self.api, self.kb, config)
        self.tasker = Tasker(self.api, config)

        # Wissensdatenbank laden
        self.kb.load()

        # Verarbeitungslog laden (für Idempotenz)
        self.processed_log_path = self.output_path / "logs" / "processed_emails.json"
        self._processed_ids = self._load_processed_ids()

    def process_file(self, file_path: str, force: bool = False) -> ProcessingResult:
        """Verarbeitet eine einzelne .eml-Datei."""
        file_path = Path(file_path)

        if not file_path.exists():
            raise FileNotFoundError(f"Datei nicht gefunden: {file_path}")

        logger.info(f"Verarbeite: {file_path.name}")

        # Idempotenz-Check
        from .utils import get_email_id
        email_id = get_email_id(str(file_path))

        if not force and email_id in self._processed_ids:
            logger.info(f"E-Mail bereits verarbeitet: {email_id}")
            # Lade gespeichertes Ergebnis
            result_path = self.output_path / "logs" / f"{email_id}.json"
            if result_path.exists():
                logger.info(f"Lade gespeichertes Ergebnis: {result_path}")

        # Schritt 1: Parsen
        try:
            parsed = self.parser.parse(str(file_path))
            parsed.email_id = email_id
        except Exception as e:
            logger.error(f"Parsing fehlgeschlagen: {e}")
            raise

        # Schritt 2: Anhänge speichern
        att_dir = str(self.output_path / "attachments")
        try:
            self.parser.save_attachments(parsed, att_dir)
        except Exception as e:
            logger.warning(f"Fehler beim Speichern der Anhänge: {e}")

        # Schritt 3: Thread analysieren
        try:
            thread_analysis = self.thread_analyzer.analyze(parsed)
        except Exception as e:
            logger.warning(f"Thread-Analyse fehlgeschlagen: {e}")
            thread_analysis = self.thread_analyzer._simple_analysis(parsed)

        # Schritt 4: Klassifizieren
        try:
            classification = self.classifier.classify(parsed, thread_analysis)
        except Exception as e:
            logger.warning(f"Klassifikation fehlgeschlagen: {e}")
            classification = self.classifier._keyword_classify(parsed)

        # Schritt 5: Wissensabruf
        query = (
            f"{parsed.subject} {parsed.body_plain[:500]} "
            f"{classification.bereich} {classification.aktionstyp}"
        )
        knowledge_chunks = self.kb.retrieve(
            query,
            top_k=5,
            category=classification.bereich.lower(),
        )

        # Schritt 6: Entwurf generieren
        draft = None
        draft_file = None
        if classification.benoetigt_antwort:
            try:
                draft = self.drafter.generate_draft(
                    parsed, thread_analysis, classification, knowledge_chunks
                )
                draft_file = self._save_draft(draft, email_id)
            except Exception as e:
                logger.error(f"Entwurf-Generierung fehlgeschlagen: {e}")

        # Schritt 7: Aufgabe erstellen
        task = None
        task_file = None
        if classification.benoetigt_aufgabe:
            try:
                task = self.tasker.create_task(
                    parsed, thread_analysis, classification
                )
                task_file = self._save_task(task, email_id)
            except Exception as e:
                logger.error(f"Aufgaben-Erstellung fehlgeschlagen: {e}")

        # Schritt 8: Ergebnis erstellen und speichern
        result = ProcessingResult(
            email_id=email_id,
            source_file=str(file_path),
            parsed_email=parsed,
            thread_analysis=thread_analysis,
            classification=classification,
            draft=draft,
            task=task,
        )

        result_dict = result.to_dict()
        if draft_file:
            result_dict["draft_file"] = str(draft_file)
        if task_file:
            result_dict["task_file"] = str(task_file)

        self._save_result(result_dict, email_id)
        self._mark_processed(email_id, str(file_path))

        logger.info(
            f"Verarbeitung abgeschlossen: {parsed.subject} "
            f"| Entwurf: {'ja' if draft else 'nein'} "
            f"| Aufgabe: {'ja' if task else 'nein'}"
        )
        return result

    def process_all(self, force: bool = False) -> list:
        """Verarbeitet alle .eml-Dateien im Inbox-Ordner."""
        results = []
        eml_files = list(self.inbox_path.glob("*.eml"))

        if not eml_files:
            logger.info(f"Keine .eml-Dateien in {self.inbox_path}")
            return results

        logger.info(f"Verarbeite {len(eml_files)} E-Mail(s)...")

        for eml_file in sorted(eml_files):
            try:
                result = self.process_file(str(eml_file), force=force)
                results.append(result)
            except Exception as e:
                logger.error(f"Fehler bei {eml_file.name}: {e}")

        logger.info(f"Fertig: {len(results)}/{len(eml_files)} verarbeitet")
        return results

    def _save_draft(self, draft: DraftResult, email_id: str) -> Path:
        """Speichert einen Antwortentwurf."""
        drafts_dir = self.output_path / "drafts"
        drafts_dir.mkdir(exist_ok=True)

        # Entwurf als Markdown
        md_path = drafts_dir / f"{email_id}_draft.md"
        md_content = (
            f"# Antwortentwurf\n\n"
            f"**An:** {draft.recipient}\n"
            f"**Betreff:** {draft.subject}\n"
            f"**Bereich:** {draft.classification_bereich}\n"
            f"**Typ:** {draft.classification_aktionstyp}\n"
            f"**Wissensdatenbank-Quellen:** {', '.join(draft.used_knowledge_sources) or 'keine'}\n"
            f"{'⚠️ Enthält [PRÜFEN: ...] Markierungen' if draft.has_check_markers else '✅ Kein manueller Check nötig'}\n\n"
            f"---\n\n"
            f"{draft.draft_text}"
        )
        save_text(md_content, str(md_path))

        # Als JSON für Dashboard
        json_path = drafts_dir / f"{email_id}_draft.json"
        save_json(draft.to_dict(), str(json_path))

        return md_path

    def _save_task(self, task: Task, email_id: str) -> Path:
        """Speichert eine Aufgabe."""
        tasks_dir = self.output_path / "tasks"
        tasks_dir.mkdir(exist_ok=True)

        # JSON
        json_path = tasks_dir / f"{task.id}.json"
        save_json(task.to_dict(), str(json_path))

        # Markdown
        md_path = tasks_dir / f"{task.id}.md"
        save_text(task.to_markdown(), str(md_path))

        return json_path

    def _save_result(self, result_dict: dict, email_id: str):
        """Speichert das Verarbeitungsergebnis."""
        logs_dir = self.output_path / "logs"
        logs_dir.mkdir(exist_ok=True)

        result_path = logs_dir / f"{email_id}.json"
        save_json(result_dict, str(result_path))

        # Gesamte Verarbeitungsliste aktualisieren
        self._update_processing_list(result_dict)

    def _update_processing_list(self, result_dict: dict):
        """Aktualisiert die Gesamtliste aller verarbeiteten E-Mails."""
        list_path = self.output_path / "logs" / "all_results.json"

        existing = []
        if list_path.exists():
            try:
                with open(list_path, "r") as f:
                    existing = json.load(f)
            except Exception:
                existing = []

        # Bestehenden Eintrag aktualisieren oder neu hinzufügen
        email_id = result_dict.get("email_id")
        existing = [r for r in existing if r.get("email_id") != email_id]
        existing.insert(0, result_dict)

        save_json(existing, str(list_path))

    def _load_processed_ids(self) -> set:
        """Lädt die Liste bereits verarbeiteter E-Mail-IDs."""
        if not self.processed_log_path.exists():
            return set()
        try:
            with open(self.processed_log_path, "r") as f:
                data = json.load(f)
            return set(data.keys())
        except Exception:
            return set()

    def _mark_processed(self, email_id: str, file_path: str):
        """Markiert eine E-Mail als verarbeitet."""
        self._processed_ids.add(email_id)
        self.processed_log_path.parent.mkdir(parents=True, exist_ok=True)

        log = {}
        if self.processed_log_path.exists():
            try:
                with open(self.processed_log_path, "r") as f:
                    log = json.load(f)
            except Exception:
                pass

        log[email_id] = {
            "file": file_path,
            "processed_at": datetime.now().isoformat(),
        }
        save_json(log, str(self.processed_log_path))
