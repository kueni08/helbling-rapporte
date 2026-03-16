"""
Flask Web-Dashboard für das Helbling E-Mail-Verarbeitungssystem.
Läuft lokal auf http://localhost:5000
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

# Projektroot zum Pfad hinzufügen
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def create_app(config: dict = None) -> Flask:
    """Erstellt die Flask-App."""
    if config is None:
        from src.utils import load_config
        config = load_config(str(project_root / "config.yaml"))

    app = Flask(
        __name__,
        template_folder=str(Path(__file__).parent / "templates"),
        static_folder=str(Path(__file__).parent / "static"),
    )
    app.config["SECRET_KEY"] = "helbling-email-agent-2026"
    app.config["HELBLING_CONFIG"] = config

    from src.utils import resolve_path
    paths = config.get("paths", {})
    output_path = resolve_path(paths.get("output", "./output"))
    kb_path = resolve_path(paths.get("knowledge_base", "./knowledge_base"))

    # ---- Hilfsfunktionen ----

    def get_all_results() -> list:
        """Lädt alle verarbeiteten E-Mail-Ergebnisse."""
        results_file = output_path / "logs" / "all_results.json"
        if not results_file.exists():
            return []
        try:
            with open(results_file) as f:
                return json.load(f)
        except Exception:
            return []

    def get_all_drafts() -> list:
        """Lädt alle generierten Entwürfe."""
        drafts_dir = output_path / "drafts"
        drafts = []
        if not drafts_dir.exists():
            return drafts
        for f in sorted(drafts_dir.glob("*_draft.json"), key=lambda x: x.stat().st_mtime, reverse=True):
            try:
                with open(f) as fp:
                    draft = json.load(fp)
                    draft["file_id"] = f.stem.replace("_draft", "")
                    drafts.append(draft)
            except Exception:
                pass
        return drafts

    def get_all_tasks() -> list:
        """Lädt alle Aufgaben."""
        tasks_dir = output_path / "tasks"
        tasks = []
        if not tasks_dir.exists():
            return tasks
        for f in sorted(tasks_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
            try:
                with open(f) as fp:
                    task = json.load(fp)
                    tasks.append(task)
            except Exception:
                pass
        return tasks

    def get_kb_status() -> dict:
        """Lädt den Status der Wissensdatenbank."""
        try:
            from src.knowledge import KnowledgeBase
            kb = KnowledgeBase(config)
            kb.load()
            return kb.get_status()
        except Exception as e:
            return {"error": str(e), "total_chunks": 0}

    def get_kb_files() -> list:
        """Listet alle Dateien der Wissensdatenbank auf."""
        files = []
        if not kb_path.exists():
            return files
        for f in sorted(kb_path.rglob("*")):
            if not f.is_file() or f.name.startswith("."):
                continue
            if f.suffix.lower() not in (".md", ".txt", ".csv", ".json", ".pdf", ".xlsx"):
                continue
            rel = f.relative_to(kb_path)
            # Kategorie aus Pfad
            parts = rel.parts
            cat = "allgemein"
            if any("sibox" in p.lower() for p in parts):
                cat = "sibox"
            elif any("facettestar" in p.lower() for p in parts):
                cat = "facettestar"
            source_type = "web" if "web_cache" in str(rel) else "lokal"
            files.append({
                "name": f.name,
                "path": str(rel),
                "category": cat,
                "source_type": source_type,
                "size_kb": round(f.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(f.stat().st_mtime).strftime("%d.%m.%Y %H:%M"),
            })
        return files

    # ---- Routen ----

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/stats")
    def api_stats():
        """Statistik-Daten."""
        results = get_all_results()
        tasks = get_all_tasks()
        drafts = get_all_drafts()

        # Nach Bereich
        by_bereich = {}
        by_aktionstyp = {}
        today_count = 0
        today = datetime.now().strftime("%Y-%m-%d")

        for r in results:
            clf = r.get("classification") or {}
            bereich = clf.get("bereich", "ALLGEMEIN")
            aktionstyp = clf.get("aktionstyp", "INFO")
            by_bereich[bereich] = by_bereich.get(bereich, 0) + 1
            by_aktionstyp[aktionstyp] = by_aktionstyp.get(aktionstyp, 0) + 1
            if r.get("processed_at", "").startswith(today):
                today_count += 1

        open_tasks = [t for t in tasks if t.get("status") == "offen"]
        high_prio = [t for t in open_tasks if t.get("prioritaet") == "hoch"]

        return jsonify({
            "total_emails": len(results),
            "total_drafts": len(drafts),
            "total_tasks": len(tasks),
            "open_tasks": len(open_tasks),
            "high_prio_tasks": len(high_prio),
            "today_emails": today_count,
            "by_bereich": by_bereich,
            "by_aktionstyp": by_aktionstyp,
        })

    @app.route("/api/emails")
    def api_emails():
        """Liste verarbeiteter E-Mails."""
        results = get_all_results()
        return jsonify(results)

    @app.route("/api/emails/<email_id>")
    def api_email_detail(email_id):
        """Detail einer verarbeiteten E-Mail."""
        result_path = output_path / "logs" / f"{email_id}.json"
        if not result_path.exists():
            return jsonify({"error": "Nicht gefunden"}), 404
        with open(result_path) as f:
            return jsonify(json.load(f))

    @app.route("/api/drafts")
    def api_drafts():
        """Liste der Entwürfe."""
        return jsonify(get_all_drafts())

    @app.route("/api/drafts/<file_id>")
    def api_draft_detail(file_id):
        """Detail eines Entwurfs."""
        draft_path = output_path / "drafts" / f"{file_id}_draft.json"
        if not draft_path.exists():
            return jsonify({"error": "Nicht gefunden"}), 404
        with open(draft_path) as f:
            return jsonify(json.load(f))

    @app.route("/api/drafts/<file_id>/text")
    def api_draft_text(file_id):
        """Gibt den Markdown-Text eines Entwurfs zurück."""
        md_path = output_path / "drafts" / f"{file_id}_draft.md"
        if not md_path.exists():
            return jsonify({"error": "Nicht gefunden"}), 404
        with open(md_path) as f:
            return jsonify({"text": f.read()})

    @app.route("/api/tasks")
    def api_tasks():
        """Liste der Aufgaben."""
        tasks = get_all_tasks()
        status_filter = request.args.get("status")
        bereich_filter = request.args.get("bereich")
        if status_filter:
            tasks = [t for t in tasks if t.get("status") == status_filter]
        if bereich_filter:
            tasks = [t for t in tasks if t.get("bereich") == bereich_filter]
        return jsonify(tasks)

    @app.route("/api/tasks/<task_id>", methods=["GET"])
    def api_task_detail(task_id):
        """Detail einer Aufgabe."""
        task_path = output_path / "tasks" / f"{task_id}.json"
        if not task_path.exists():
            return jsonify({"error": "Nicht gefunden"}), 404
        with open(task_path) as f:
            return jsonify(json.load(f))

    @app.route("/api/tasks/<task_id>/status", methods=["POST"])
    def api_task_status(task_id):
        """Setzt den Status einer Aufgabe."""
        task_path = output_path / "tasks" / f"{task_id}.json"
        if not task_path.exists():
            return jsonify({"error": "Nicht gefunden"}), 404
        data = request.get_json()
        new_status = data.get("status", "offen")
        with open(task_path) as f:
            task = json.load(f)
        task["status"] = new_status
        with open(task_path, "w") as f:
            json.dump(task, f, ensure_ascii=False, indent=2)
        return jsonify({"ok": True, "status": new_status})

    @app.route("/api/knowledge/status")
    def api_knowledge_status():
        """Status der Wissensdatenbank."""
        return jsonify(get_kb_status())

    @app.route("/api/knowledge/files")
    def api_knowledge_files():
        """Liste aller Wissensdatenbank-Dateien."""
        return jsonify(get_kb_files())

    @app.route("/api/knowledge/web-status")
    def api_knowledge_web_status():
        """Status der Web-Quellen."""
        try:
            from src.web_scraper import WebScraper
            scraper = WebScraper(config)
            return jsonify(scraper.get_status())
        except Exception as e:
            return jsonify({"error": str(e)})

    @app.route("/api/knowledge/scrape", methods=["POST"])
    def api_knowledge_scrape():
        """Startet Web-Scraping."""
        data = request.get_json() or {}
        source = data.get("source")
        force = data.get("force", False)
        try:
            from src.web_scraper import WebScraper
            scraper = WebScraper(config)
            if source:
                scraper.scrape_source(source)
            else:
                scraper.scrape_all(force=force)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/knowledge/reload", methods=["POST"])
    def api_knowledge_reload():
        """Lädt Wissensdatenbank neu."""
        try:
            from src.knowledge import KnowledgeBase
            kb = KnowledgeBase(config)
            kb.load(force=True)
            status = kb.get_status()
            return jsonify({"ok": True, **status})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/process", methods=["POST"])
    def api_process():
        """Verarbeitet alle E-Mails im Inbox."""
        try:
            from src.processor import Processor
            processor = Processor(config)
            results = processor.process_all()
            return jsonify({
                "ok": True,
                "count": len(results),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)
