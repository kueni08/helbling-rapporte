"""
Web-Scraper für das Helbling E-Mail-Verarbeitungssystem.
Crawlt konfigurierte URLs und speichert als Markdown in knowledge_base/web_cache/.
"""

import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

try:
    from markdownify import markdownify as md
    HAS_MARKDOWNIFY = True
except ImportError:
    HAS_MARKDOWNIFY = False
    logger.warning("markdownify nicht installiert, verwende einfache HTML-Konvertierung")


class WebScraper:
    """Crawlt konfigurierte URLs und speichert als Markdown in knowledge_base/web_cache/."""

    def __init__(self, config: dict = None):
        self.config = config or {}
        self.web_sources = config.get("web_sources", [])

        from .utils import resolve_path
        paths_cfg = config.get("paths", {})
        kb_path = paths_cfg.get("knowledge_base", "./knowledge_base")
        self.kb_path = resolve_path(kb_path)
        self.cache_path = self.kb_path / "web_cache"
        self.cache_path.mkdir(parents=True, exist_ok=True)

        self.log_file = self.cache_path / "_scrape_log.json"
        self.scrape_log = self._load_log()

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (compatible; HelblingEmailAgent/1.0)",
        })
        self.request_delay = 1.0  # Sekunden zwischen Requests

    def scrape_all(self, force: bool = False):
        """Crawlt alle konfigurierten Quellen."""
        if not self.web_sources:
            logger.info("Keine Web-Quellen konfiguriert.")
            return

        for source in self.web_sources:
            try:
                if not force and not self._needs_refresh(source):
                    name = source.get("name", "?")
                    logger.info(f"Quelle '{name}' ist aktuell, überspringe.")
                    continue
                self.scrape_source(source.get("name", ""))
            except Exception as e:
                logger.error(f"Fehler beim Crawlen von '{source.get('name')}': {e}")

    def scrape_source(self, source_name: str):
        """Crawlt eine einzelne Quelle anhand ihres Namens."""
        source = next(
            (s for s in self.web_sources if s.get("name") == source_name),
            None
        )
        if not source:
            logger.error(f"Quelle '{source_name}' nicht gefunden.")
            return

        name = source.get("name", "unknown")
        url = source.get("url", "")
        depth = source.get("crawl_depth", 1)
        include = source.get("include_patterns", ["*"])
        exclude = source.get("exclude_patterns", [])
        category = source.get("category", "allgemein")

        logger.info(f"Crawle: {name} ({url}, Tiefe {depth})")

        # URLs sammeln
        urls_to_crawl = {url}
        crawled = set()

        if depth > 1:
            page_html = self._fetch_page(url)
            if page_html:
                links = self._extract_links(page_html, url, include, exclude)
                urls_to_crawl.update(links[:50])  # Max 50 Seiten

        pages_saved = 0
        for page_url in list(urls_to_crawl):
            if page_url in crawled:
                continue
            crawled.add(page_url)

            try:
                html = self._fetch_page(page_url)
                if html:
                    content = self._html_to_markdown(html, page_url)
                    if content and len(content.strip()) > 100:
                        self._save_to_cache(content, name, page_url, category)
                        pages_saved += 1
                time.sleep(self.request_delay)
            except Exception as e:
                logger.warning(f"Fehler beim Crawlen von {page_url}: {e}")

        # Log aktualisieren
        self.scrape_log[name] = {
            "last_crawled": datetime.now(timezone.utc).isoformat(),
            "pages_crawled": pages_saved,
            "url": url,
        }
        self._save_log()
        logger.info(f"'{name}' fertig: {pages_saved} Seiten gespeichert.")

    def _fetch_page(self, url: str) -> Optional[str]:
        """Holt HTML einer Seite."""
        try:
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            return resp.text
        except requests.exceptions.RequestException as e:
            logger.warning(f"HTTP-Fehler für {url}: {e}")
            return None

    def _html_to_markdown(self, html: str, url: str) -> str:
        """Konvertiert HTML zu sauberem Markdown."""
        soup = BeautifulSoup(html, "html.parser")

        # Navigation, Footer, Scripts, Styles entfernen
        for tag in soup.find_all(["nav", "footer", "script", "style", "header",
                                  "aside", "iframe", "noscript"]):
            tag.decompose()

        # Cookie-Banner entfernen
        for tag in soup.find_all(class_=re.compile(r"cookie|banner|consent|gdpr", re.I)):
            tag.decompose()

        # Hauptinhalt finden
        main = (
            soup.find("main") or
            soup.find(id=re.compile(r"content|main", re.I)) or
            soup.find(class_=re.compile(r"content|main", re.I)) or
            soup.body
        )

        if not main:
            return ""

        if HAS_MARKDOWNIFY:
            content = md(str(main), heading_style="ATX", bullets="-")
        else:
            content = main.get_text(separator="\n")

        # Bereinigen: mehrfache Leerzeilen reduzieren
        content = re.sub(r"\n{3,}", "\n\n", content)
        content = re.sub(r"[ \t]+\n", "\n", content)
        return content.strip()

    def _extract_links(
        self, html: str, base_url: str, include: list, exclude: list
    ) -> list:
        """Extrahiert Links die den Patterns entsprechen."""
        soup = BeautifulSoup(html, "html.parser")
        base_domain = urlparse(base_url).netloc
        links = []

        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            full_url = urljoin(base_url, href)
            parsed = urlparse(full_url)

            # Nur gleiche Domain
            if parsed.netloc != base_domain:
                continue

            # Fragment-URLs ignorieren
            if parsed.fragment:
                continue

            path = parsed.path

            # Include-Pattern prüfen
            if include and include != ["*"]:
                if not any(p in path for p in include):
                    continue

            # Exclude-Pattern prüfen
            if any(p in path for p in exclude):
                continue

            links.append(full_url)

        return list(dict.fromkeys(links))  # Deduplicieren

    def _save_to_cache(self, content: str, source_name: str, url: str, category: str):
        """Speichert gecrawlten Inhalt als .md in knowledge_base/web_cache/."""
        # Ordnername aus Source-Name
        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", source_name.lower())
        source_dir = self.cache_path / safe_name
        source_dir.mkdir(exist_ok=True)

        # Dateiname aus URL-Pfad
        parsed = urlparse(url)
        path_clean = parsed.path.strip("/").replace("/", "_") or "index"
        path_clean = re.sub(r"[^a-zA-Z0-9_-]", "_", path_clean)
        filename = f"{path_clean[:80]}.md"

        frontmatter = (
            f"---\n"
            f"source_url: {url}\n"
            f"source_name: {source_name}\n"
            f"crawled_at: {datetime.now(timezone.utc).isoformat()}\n"
            f"category: {category}\n"
            f"---\n\n"
        )

        file_path = source_dir / filename
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(frontmatter + content)

        logger.debug(f"Gespeichert: {file_path}")

    def _needs_refresh(self, source: dict) -> bool:
        """Prüft ob eine Quelle neu gecrawlt werden muss."""
        name = source.get("name", "")
        interval_hours = source.get("refresh_interval_hours", 168)

        if interval_hours == 0:
            return False  # Nur manuell

        log_entry = self.scrape_log.get(name)
        if not log_entry:
            return True  # Noch nie gecrawlt

        last_str = log_entry.get("last_crawled", "")
        if not last_str:
            return True

        try:
            last = datetime.fromisoformat(last_str)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            elapsed_hours = (now - last).total_seconds() / 3600
            return elapsed_hours >= interval_hours
        except Exception:
            return True

    def _load_log(self) -> dict:
        """Lädt das Scrape-Log."""
        if self.log_file.exists():
            try:
                with open(self.log_file, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_log(self):
        """Speichert das Scrape-Log."""
        with open(self.log_file, "w") as f:
            json.dump(self.scrape_log, f, indent=2, default=str)

    def get_status(self) -> dict:
        """Gibt Status aller Web-Quellen zurück."""
        status = {}
        now = datetime.now(timezone.utc)

        for source in self.web_sources:
            name = source.get("name", "")
            interval = source.get("refresh_interval_hours", 168)
            log = self.scrape_log.get(name, {})
            last_str = log.get("last_crawled", "")

            if last_str:
                try:
                    last = datetime.fromisoformat(last_str)
                    if last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    age_hours = (now - last).total_seconds() / 3600
                    is_stale = age_hours >= interval if interval > 0 else False
                    status[name] = {
                        "last_crawled": last_str,
                        "age_hours": round(age_hours, 1),
                        "pages": log.get("pages_crawled", 0),
                        "is_stale": is_stale,
                        "url": source.get("url", ""),
                    }
                except Exception:
                    status[name] = {"last_crawled": "?", "is_stale": True}
            else:
                status[name] = {
                    "last_crawled": "Noch nie gecrawlt",
                    "pages": 0,
                    "is_stale": True,
                    "url": source.get("url", ""),
                }

        return status
