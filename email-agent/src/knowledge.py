"""
Wissensdatenbank für das Helbling E-Mail-Verarbeitungssystem.
Lädt und indiziert alle Dokumente aus knowledge_base/ und web_cache/.
Stellt keyword-basiertes Retrieval bereit.
"""

import csv
import io
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class KnowledgeChunk:
    """Ein Chunk aus der Wissensdatenbank."""
    source_file: str
    content: str
    relevance_score: float = 0.0
    category: str = "allgemein"     # sibox, facettestar, allgemein
    source_type: str = "lokal"      # lokal, web
    chunk_id: str = ""

    def to_dict(self) -> dict:
        return {
            "source_file": self.source_file,
            "content": self.content[:500],  # Kürzen für JSON-Ausgabe
            "relevance_score": self.relevance_score,
            "category": self.category,
            "source_type": self.source_type,
        }


class KnowledgeBase:
    """Lädt und durchsucht die Wissensdatenbank."""

    def __init__(self, config: dict = None):
        self.config = config or {}
        self.chunks: list = []
        self._loaded = False

        kb_cfg = self.config.get("knowledge", {})
        self.chunk_size = kb_cfg.get("chunk_size", 1000)
        self.chunk_overlap = kb_cfg.get("chunk_overlap", 200)
        self.top_k = kb_cfg.get("top_k", 5)

        # Pfad zur Wissensdatenbank
        from .utils import resolve_path
        paths_cfg = self.config.get("paths", {})
        kb_path = paths_cfg.get("knowledge_base", "./knowledge_base")
        self.kb_path = resolve_path(kb_path)

    def load(self, force: bool = False):
        """Lädt alle Dateien aus der Wissensdatenbank."""
        if self._loaded and not force:
            return

        self.chunks = []
        logger.info(f"Lade Wissensdatenbank aus: {self.kb_path}")

        if not self.kb_path.exists():
            logger.warning(f"Wissensdatenbank-Pfad nicht gefunden: {self.kb_path}")
            return

        total_files = 0
        for file_path in self.kb_path.rglob("*"):
            if not file_path.is_file():
                continue
            if file_path.name.startswith(".") or file_path.name == "_scrape_log.json":
                continue

            suffix = file_path.suffix.lower()
            if suffix not in (".md", ".txt", ".csv", ".json"):
                continue

            try:
                new_chunks = self._load_file(file_path)
                self.chunks.extend(new_chunks)
                total_files += 1
            except Exception as e:
                logger.warning(f"Fehler beim Laden von {file_path}: {e}")

        # Optional: PDF-Support
        try:
            import PyPDF2
            for file_path in self.kb_path.rglob("*.pdf"):
                try:
                    new_chunks = self._load_pdf(file_path)
                    self.chunks.extend(new_chunks)
                    total_files += 1
                except Exception as e:
                    logger.warning(f"Fehler beim Laden von PDF {file_path}: {e}")
        except ImportError:
            pass

        self._loaded = True
        logger.info(
            f"Wissensdatenbank geladen: {total_files} Dateien, {len(self.chunks)} Chunks"
        )

    def _load_file(self, file_path: Path) -> list:
        """Lädt eine einzelne Datei und zerlegt sie in Chunks."""
        suffix = file_path.suffix.lower()
        category = self._detect_category(file_path)
        source_type = "web" if "web_cache" in str(file_path) else "lokal"

        if suffix == ".csv":
            return self._load_csv(file_path, category, source_type)
        elif suffix == ".json":
            return self._load_json_file(file_path, category, source_type)
        else:  # .md, .txt
            return self._load_text(file_path, category, source_type)

    def _load_text(self, file_path: Path, category: str, source_type: str) -> list:
        """Lädt eine Text/Markdown-Datei."""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # Frontmatter entfernen (für web_cache Dateien)
        content = self._strip_frontmatter(content)

        return self._chunk_text(
            content,
            source_file=str(file_path.relative_to(self.kb_path)),
            category=category,
            source_type=source_type,
        )

    def _load_csv(self, file_path: Path, category: str, source_type: str) -> list:
        """Lädt eine CSV-Datei (z.B. Preisliste)."""
        chunks = []
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if not rows:
            return chunks

        # Alle Zeilen als einen Chunk (für Preislisten)
        headers = list(rows[0].keys())
        lines = [",".join(headers)]
        for row in rows:
            line = ",".join(str(v) for v in row.values())
            lines.append(line)

        content = f"# {file_path.stem}\n" + "\n".join(lines)
        source_file = str(file_path.relative_to(self.kb_path))

        # In Chunks aufteilen wenn zu gross
        return self._chunk_text(content, source_file, category, source_type)

    def _load_json_file(self, file_path: Path, category: str, source_type: str) -> list:
        """Lädt eine JSON-Datei."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        content = json.dumps(data, ensure_ascii=False, indent=2)
        source_file = str(file_path.relative_to(self.kb_path))
        return self._chunk_text(content, source_file, category, source_type)

    def _load_pdf(self, file_path: Path) -> list:
        """Lädt eine PDF-Datei."""
        import PyPDF2
        category = self._detect_category(file_path)
        chunks = []
        with open(file_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
        content = "\n\n".join(text_parts)
        source_file = str(file_path.relative_to(self.kb_path))
        return self._chunk_text(content, source_file, category, "lokal")

    def _chunk_text(
        self, text: str, source_file: str, category: str, source_type: str
    ) -> list:
        """Zerlegt Text in überlappende Chunks."""
        if not text or not text.strip():
            return []

        chunks = []
        # Zuerst nach Markdown-Überschriften trennen
        sections = self._split_by_headings(text)

        for section in sections:
            if len(section) <= self.chunk_size:
                chunk_id = f"{source_file}::{len(chunks)}"
                chunks.append(KnowledgeChunk(
                    source_file=source_file,
                    content=section.strip(),
                    category=category,
                    source_type=source_type,
                    chunk_id=chunk_id,
                ))
            else:
                # Grossen Abschnitt weiter aufteilen
                for i in range(0, len(section), self.chunk_size - self.chunk_overlap):
                    part = section[i:i + self.chunk_size]
                    if len(part.strip()) < 50:
                        continue
                    chunk_id = f"{source_file}::{len(chunks)}"
                    chunks.append(KnowledgeChunk(
                        source_file=source_file,
                        content=part.strip(),
                        category=category,
                        source_type=source_type,
                        chunk_id=chunk_id,
                    ))

        return chunks

    def _split_by_headings(self, text: str) -> list:
        """Teilt Markdown-Text bei Überschriften auf."""
        heading_pattern = re.compile(r"^#{1,3}\s+.+", re.MULTILINE)
        matches = list(heading_pattern.finditer(text))

        if not matches:
            return [text]

        sections = []
        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            section = text[start:end].strip()
            if section:
                sections.append(section)

        # Text vor erster Überschrift
        if matches[0].start() > 0:
            prefix = text[:matches[0].start()].strip()
            if prefix:
                sections.insert(0, prefix)

        return sections if sections else [text]

    def _strip_frontmatter(self, content: str) -> str:
        """Entfernt YAML-Frontmatter aus Markdown-Dateien."""
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                return content[end + 3:].strip()
        return content

    def _detect_category(self, file_path: Path) -> str:
        """Erkennt die Kategorie einer Datei anhand des Pfads."""
        path_str = str(file_path).lower()
        if "sibox" in path_str:
            return "sibox"
        elif "facettestar" in path_str:
            return "facettestar"
        return "allgemein"

    def retrieve(self, query: str, top_k: int = None, category: str = None) -> list:
        """
        Sucht relevante Chunks für eine Anfrage.
        Gibt top_k Chunks sortiert nach Relevanz zurück.
        """
        if not self._loaded:
            self.load()

        if not self.chunks:
            return []

        k = top_k or self.top_k
        scored = []

        query_lower = query.lower()
        query_terms = set(re.findall(r"\w+", query_lower))

        for chunk in self.chunks:
            # Kategorie-Filter
            if category and chunk.category != "allgemein" and chunk.category != category:
                continue

            score = self._compute_relevance(query_terms, chunk.content.lower())
            if score > 0:
                scored.append((score, chunk))

        # Sortieren und Top-K zurückgeben
        scored.sort(key=lambda x: x[0], reverse=True)
        result = []
        for score, chunk in scored[:k]:
            chunk.relevance_score = score
            result.append(chunk)

        return result

    def _compute_relevance(self, query_terms: set, content: str) -> float:
        """Berechnet einen einfachen TF-IDF-ähnlichen Relevanz-Score."""
        if not query_terms or not content:
            return 0.0

        content_terms = set(re.findall(r"\w+", content))
        matches = query_terms & content_terms

        if not matches:
            return 0.0

        # Basis-Score: Anteil der Query-Terms die gefunden wurden
        precision = len(matches) / len(query_terms)

        # Bonus für exakte Phrasen-Matches
        phrase_bonus = 0.0
        for term in query_terms:
            if len(term) > 4 and term in content:
                phrase_bonus += 0.1

        return min(precision + phrase_bonus, 1.0)

    def get_status(self) -> dict:
        """Gibt Status der Wissensdatenbank zurück."""
        if not self._loaded:
            self.load()

        local_chunks = [c for c in self.chunks if c.source_type == "lokal"]
        web_chunks = [c for c in self.chunks if c.source_type == "web"]
        local_files = len(set(c.source_file for c in local_chunks))
        web_files = len(set(c.source_file for c in web_chunks))

        by_category = {}
        for chunk in self.chunks:
            by_category[chunk.category] = by_category.get(chunk.category, 0) + 1

        return {
            "total_chunks": len(self.chunks),
            "local_files": local_files,
            "local_chunks": len(local_chunks),
            "web_files": web_files,
            "web_chunks": len(web_chunks),
            "by_category": by_category,
        }

    def format_for_prompt(self, chunks: list, max_chars: int = 3000) -> str:
        """Formatiert Chunks für die Verwendung in einem Prompt."""
        if not chunks:
            return "Keine relevanten Informationen in der Wissensdatenbank gefunden."

        parts = []
        total_chars = 0

        for chunk in chunks:
            entry = (
                f"**Quelle: {chunk.source_file}** (Relevanz: {chunk.relevance_score:.2f})\n"
                f"{chunk.content}\n"
            )
            if total_chars + len(entry) > max_chars:
                break
            parts.append(entry)
            total_chars += len(entry)

        return "\n---\n".join(parts)
