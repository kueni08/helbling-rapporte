"""Hilfsfunktionen für das Helbling E-Mail-Verarbeitungssystem."""

import os
import json
import yaml
import logging
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Any


def load_config(config_path: str = None) -> dict:
    """Lädt die Konfiguration aus config.yaml."""
    if config_path is None:
        # Suche config.yaml relativ zum Projektroot
        base_dir = Path(__file__).parent.parent
        config_path = base_dir / "config.yaml"

    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def setup_logging(config: dict = None, log_level: str = "INFO") -> logging.Logger:
    """Konfiguriert das Logging-System."""
    if config:
        log_level = config.get("logging", {}).get("level", log_level)
        log_file = config.get("logging", {}).get("file", "./output/logs/processing.log")
    else:
        log_file = "./output/logs/processing.log"

    # Log-Verzeichnis erstellen
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)

    level = getattr(logging, log_level.upper(), logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler()
        ]
    )

    return logging.getLogger("helbling-email-agent")


def get_email_id(file_path: str) -> str:
    """Generiert eine eindeutige ID für eine E-Mail-Datei."""
    path = Path(file_path)
    # Hash aus Dateiname + Inhalt (erste 1000 Bytes)
    try:
        with open(file_path, "rb") as f:
            content = f.read(1000)
        hash_input = f"{path.name}{content}".encode()
    except Exception:
        hash_input = path.name.encode()

    file_hash = hashlib.md5(hash_input).hexdigest()[:8]
    timestamp = datetime.now().strftime("%Y%m%d")
    return f"{timestamp}_{path.stem}_{file_hash}"


def ensure_dirs(config: dict):
    """Erstellt alle notwendigen Output-Verzeichnisse."""
    base_dir = Path(__file__).parent.parent
    output_base = base_dir / config.get("paths", {}).get("output", "./output")

    dirs = [
        output_base / "drafts",
        output_base / "tasks",
        output_base / "attachments",
        output_base / "logs",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)


def save_json(data: Any, file_path: str):
    """Speichert Daten als JSON-Datei."""
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def load_json(file_path: str) -> Any:
    """Lädt Daten aus einer JSON-Datei."""
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_text(content: str, file_path: str):
    """Speichert Text in eine Datei."""
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)


def load_text(file_path: str) -> str:
    """Lädt Text aus einer Datei."""
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


def resolve_path(path_str: str, base_dir: Path = None) -> Path:
    """Löst einen Pfad relativ zum Projektroot auf."""
    if base_dir is None:
        base_dir = Path(__file__).parent.parent

    p = Path(path_str)
    if p.is_absolute():
        return p
    return (base_dir / p).resolve()


def format_datetime(dt: datetime) -> str:
    """Formatiert ein Datetime für die Ausgabe."""
    if dt is None:
        return "Unbekannt"
    return dt.strftime("%d.%m.%Y %H:%M")


def truncate_text(text: str, max_chars: int = 500) -> str:
    """Kürzt Text auf maximale Länge."""
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def sanitize_filename(name: str) -> str:
    """Bereinigt einen String für die Verwendung als Dateiname."""
    import re
    # Ungültige Zeichen ersetzen
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', '_', name)
    name = name.strip('._')
    return name[:100]  # Max 100 Zeichen
