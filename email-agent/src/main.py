"""
Haupteinstiegspunkt für das Helbling E-Mail-Verarbeitungssystem.
CLI mit Befehlen: process, parse, knowledge, tasks, watch, dashboard
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint

# Sicherstellen dass src im Pfad ist
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.utils import load_config, setup_logging, resolve_path

console = Console()
load_dotenv()


def get_config():
    """Lädt die Konfiguration."""
    base_dir = Path(__file__).parent.parent
    config_path = base_dir / "config.yaml"
    if not config_path.exists():
        console.print(f"[red]config.yaml nicht gefunden: {config_path}[/red]")
        sys.exit(1)
    return load_config(str(config_path))


def cmd_process(args):
    """Verarbeitet E-Mails."""
    config = get_config()
    setup_logging(config)

    from src.processor import Processor

    try:
        processor = Processor(config)
    except ValueError as e:
        console.print(f"[red]Fehler: {e}[/red]")
        sys.exit(1)

    if args.file:
        # Einzelne Datei
        file_path = Path(args.file)
        if not file_path.exists():
            console.print(f"[red]Datei nicht gefunden: {args.file}[/red]")
            sys.exit(1)

        with console.status(f"Verarbeite {file_path.name}..."):
            result = processor.process_file(str(file_path), force=args.force)

        _print_result(result)

    elif args.all:
        # Alle E-Mails
        with console.status("Verarbeite alle E-Mails im Inbox..."):
            results = processor.process_all(force=args.force)

        console.print(f"\n[green]✓ {len(results)} E-Mail(s) verarbeitet[/green]")
        for r in results:
            _print_result_summary(r)

    else:
        console.print("[yellow]Bitte --file oder --all angeben.[/yellow]")


def cmd_parse(args):
    """Parst eine E-Mail und zeigt die Struktur an."""
    config = get_config()
    setup_logging(config)

    from src.eml_parser import EmlParser

    parser = EmlParser(config)
    file_path = Path(args.file)

    if not file_path.exists():
        console.print(f"[red]Datei nicht gefunden: {args.file}[/red]")
        sys.exit(1)

    with console.status(f"Parse {file_path.name}..."):
        parsed = parser.parse(str(file_path))

    # Ausgabe
    console.print(Panel(
        f"[bold]Betreff:[/bold] {parsed.subject}\n"
        f"[bold]Von:[/bold] {parsed.from_addr}\n"
        f"[bold]An:[/bold] {', '.join(parsed.to_addrs)}\n"
        f"[bold]Datum:[/bold] {parsed.date}\n"
        f"[bold]Message-ID:[/bold] {parsed.message_id}\n"
        f"[bold]Thread-Nachrichten:[/bold] {len(parsed.thread_messages)}\n"
        f"[bold]Anhänge:[/bold] {len(parsed.attachments)}",
        title="E-Mail Header",
        style="blue"
    ))

    if parsed.thread_messages:
        console.print("\n[bold cyan]Thread-Verlauf:[/bold cyan]")
        for msg in parsed.thread_messages:
            direction = "← EXTERN" if msg.is_incoming else "→ HELBLING"
            color = "yellow" if msg.is_incoming else "green"
            console.print(f"\n[{color}]{direction}[/{color}] von {msg.sender}")
            console.print(msg.body[:300] + ("..." if len(msg.body) > 300 else ""))

    if parsed.attachments:
        console.print(f"\n[bold]Anhänge:[/bold]")
        for att in parsed.attachments:
            console.print(f"  - {att.filename} ({att.content_type}, {att.size_bytes} Bytes)")

    console.print(f"\n[bold]Body (erste 500 Zeichen):[/bold]")
    console.print(parsed.body_plain[:500])


def cmd_knowledge(args):
    """Verwaltet die Wissensdatenbank."""
    config = get_config()
    setup_logging(config)

    from src.knowledge import KnowledgeBase
    from src.web_scraper import WebScraper

    kb = KnowledgeBase(config)
    scraper = WebScraper(config)

    if args.scrape:
        source = getattr(args, "source", None)
        if source:
            console.print(f"Crawle Quelle: {source}...")
            scraper.scrape_source(source)
        else:
            console.print("Crawle alle Web-Quellen...")
            scraper.scrape_all(force=args.force)
        console.print("[green]✓ Crawling abgeschlossen[/green]")

    if args.reload or args.status:
        kb.load(force=True)

    if args.status:
        kb_status = kb.get_status()
        web_status = scraper.get_status()

        console.print(Panel(
            f"[bold]Lokale Dateien:[/bold] {kb_status['local_files']} Dateien, "
            f"{kb_status['local_chunks']} Chunks\n"
            f"[bold]Web-Quellen:[/bold] {kb_status['web_files']} Seiten, "
            f"{kb_status['web_chunks']} Chunks\n"
            f"[bold]Total:[/bold] {kb_status['total_chunks']} Chunks",
            title="Wissensdatenbank Status",
            style="blue"
        ))

        if web_status:
            table = Table(title="Web-Quellen")
            table.add_column("Quelle", style="cyan")
            table.add_column("URL")
            table.add_column("Seiten")
            table.add_column("Zuletzt gecrawlt")
            table.add_column("Status")

            for name, info in web_status.items():
                status_icon = "⚠ Veraltet" if info.get("is_stale") else "✓ Aktuell"
                status_color = "red" if info.get("is_stale") else "green"
                table.add_row(
                    name,
                    info.get("url", "")[:40],
                    str(info.get("pages", 0)),
                    info.get("last_crawled", "nie")[:20],
                    f"[{status_color}]{status_icon}[/{status_color}]",
                )
            console.print(table)


def cmd_tasks(args):
    """Zeigt Aufgaben an."""
    config = get_config()
    output_path = resolve_path(
        config.get("paths", {}).get("output", "./output")
    )
    tasks_dir = output_path / "tasks"

    if not tasks_dir.exists():
        console.print("[yellow]Keine Aufgaben gefunden.[/yellow]")
        return

    task_files = list(tasks_dir.glob("*.json"))
    if not task_files:
        console.print("[yellow]Keine Aufgaben gefunden.[/yellow]")
        return

    # Filter
    status_filter = getattr(args, "status", None)
    bereich_filter = getattr(args, "bereich", None)

    table = Table(title=f"Aufgaben ({len(task_files)} total)")
    table.add_column("ID", style="cyan")
    table.add_column("Titel")
    table.add_column("Bereich", style="magenta")
    table.add_column("Priorität")
    table.add_column("Fällig")
    table.add_column("Status")

    for tf in sorted(task_files, key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            with open(tf) as f:
                task = json.load(f)

            if status_filter and task.get("status") != status_filter:
                continue
            if bereich_filter and task.get("bereich") != bereich_filter:
                continue

            prio = task.get("prioritaet", "mittel")
            prio_color = {"hoch": "red", "mittel": "yellow", "niedrig": "green"}.get(prio, "white")
            status = task.get("status", "offen")
            status_color = "green" if status == "erledigt" else "yellow"

            table.add_row(
                task.get("id", ""),
                task.get("titel", "")[:50],
                task.get("bereich", ""),
                f"[{prio_color}]{prio}[/{prio_color}]",
                task.get("faellig_bis", ""),
                f"[{status_color}]{status}[/{status_color}]",
            )
        except Exception as e:
            pass

    console.print(table)


def cmd_watch(args):
    """Watch-Modus: überwacht inbox/ auf neue .eml-Dateien."""
    config = get_config()
    setup_logging(config)

    inbox_path = resolve_path(
        config.get("paths", {}).get("inbox", "./inbox")
    )

    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        console.print("[red]watchdog nicht installiert: pip install watchdog[/red]")
        sys.exit(1)

    from src.processor import Processor

    try:
        processor = Processor(config)
    except ValueError as e:
        console.print(f"[red]Fehler: {e}[/red]")
        sys.exit(1)

    class EmlHandler(FileSystemEventHandler):
        def on_created(self, event):
            if not event.is_directory and event.src_path.endswith(".eml"):
                console.print(f"\n[cyan]Neue E-Mail erkannt: {Path(event.src_path).name}[/cyan]")
                try:
                    import time
                    time.sleep(1)  # Kurz warten bis Datei vollständig geschrieben
                    result = processor.process_file(event.src_path)
                    _print_result_summary(result)
                except Exception as e:
                    console.print(f"[red]Fehler: {e}[/red]")

    observer = Observer()
    observer.schedule(EmlHandler(), str(inbox_path), recursive=False)
    observer.start()

    console.print(f"[green]Watch-Modus gestartet. Überwache: {inbox_path}[/green]")
    console.print("[dim]Ctrl+C zum Beenden[/dim]")

    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        console.print("\n[yellow]Watch-Modus beendet.[/yellow]")
    observer.join()


def cmd_dashboard(args):
    """Startet das Web-Dashboard."""
    config = get_config()
    dash_cfg = config.get("dashboard", {})
    host = dash_cfg.get("host", "127.0.0.1")
    port = dash_cfg.get("port", 5000)

    console.print(f"[green]Starte Dashboard auf http://{host}:{port}[/green]")

    # Flask App importieren und starten
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from web.app import create_app
    app = create_app(config)
    app.run(host=host, port=port, debug=dash_cfg.get("debug", False))


def _print_result(result):
    """Gibt ein Verarbeitungsergebnis detailliert aus."""
    clf = result.classification
    ta = result.thread_analysis

    bereich_color = {"SIBOX": "blue", "FACETTESTAR": "magenta", "ALLGEMEIN": "cyan"}.get(
        clf.bereich, "white"
    )
    prio_color = {"hoch": "red", "mittel": "yellow", "niedrig": "green"}.get(
        clf.dringlichkeit, "white"
    )

    console.print(Panel(
        f"[bold]Betreff:[/bold] {result.parsed_email.subject}\n"
        f"[bold]Von:[/bold] {result.parsed_email.from_addr}\n"
        f"[bold]Bereich:[/bold] [{bereich_color}]{clf.bereich}[/{bereich_color}]\n"
        f"[bold]Typ:[/bold] {clf.aktionstyp}\n"
        f"[bold]Dringlichkeit:[/bold] [{prio_color}]{clf.dringlichkeit}[/{prio_color}]\n"
        f"[bold]Zusammenfassung:[/bold] {clf.zusammenfassung}\n\n"
        f"[bold]Thread:[/bold] {ta.anzahl_nachrichten} Nachricht(en)\n"
        f"[bold]Tonalität:[/bold] {ta.tonalitaet}\n"
        f"[bold]Nächster Schritt:[/bold] {ta.naechster_schritt}\n\n"
        f"[bold]Entwurf:[/bold] {'✓ generiert' if result.draft else '✗ nicht nötig'}\n"
        f"[bold]Aufgabe:[/bold] {'✓ erstellt' if result.task else '✗ nicht nötig'}",
        title=f"Ergebnis: {result.email_id}",
        style="green" if not result.error else "red"
    ))

    if result.draft:
        console.print(f"\n[bold cyan]Antwortentwurf:[/bold cyan]")
        console.print(result.draft.draft_text[:800])
        if len(result.draft.draft_text) > 800:
            console.print("[dim]... (gekürzt)[/dim]")

    if result.task:
        task = result.task
        console.print(f"\n[bold yellow]Aufgabe erstellt:[/bold yellow]")
        console.print(f"  ID: {task.id}")
        console.print(f"  Titel: {task.titel}")
        console.print(f"  Fällig: {task.faellig_bis}")
        if task.teilaufgaben:
            for t in task.teilaufgaben[:3]:
                console.print(f"  - {t}")


def _print_result_summary(result):
    """Gibt eine kurze Zusammenfassung aus."""
    clf = result.classification
    icons = []
    if result.draft:
        icons.append("✉ Entwurf")
    if result.task:
        icons.append(f"📋 Aufgabe ({result.task.id})")

    status = " | ".join(icons) or "Archiviert"
    console.print(
        f"  [cyan]{result.parsed_email.subject[:50]}[/cyan] "
        f"[{clf.bereich}] {clf.aktionstyp} → {status}"
    )


def main():
    """Haupteinstiegspunkt."""
    parser = argparse.ArgumentParser(
        description="Helbling & Co. AG — Intelligentes E-Mail-Verarbeitungssystem",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Befehle")

    # process
    p_process = subparsers.add_parser("process", help="E-Mails verarbeiten")
    p_process.add_argument("--file", help="Einzelne .eml-Datei")
    p_process.add_argument("--all", action="store_true", help="Alle E-Mails im Inbox")
    p_process.add_argument("--force", action="store_true", help="Erneut verarbeiten")
    p_process.set_defaults(func=cmd_process)

    # parse
    p_parse = subparsers.add_parser("parse", help=".eml-Datei parsen (kein API-Call)")
    p_parse.add_argument("--file", required=True, help=".eml-Datei")
    p_parse.set_defaults(func=cmd_parse)

    # knowledge
    p_kb = subparsers.add_parser("knowledge", help="Wissensdatenbank verwalten")
    p_kb.add_argument("--status", action="store_true", help="Status anzeigen")
    p_kb.add_argument("--reload", action="store_true", help="Neu laden")
    p_kb.add_argument("--scrape", action="store_true", help="Web-Quellen crawlen")
    p_kb.add_argument("--source", help="Bestimmte Quelle crawlen")
    p_kb.add_argument("--force", action="store_true", help="Erzwingen (auch aktuelle)")
    p_kb.set_defaults(func=cmd_knowledge)

    # tasks
    p_tasks = subparsers.add_parser("tasks", help="Aufgaben anzeigen")
    p_tasks.add_argument("--list", action="store_true", help="Liste anzeigen")
    p_tasks.add_argument("--status", help="Filter: offen, erledigt")
    p_tasks.add_argument("--bereich", help="Filter: SIBOX, FACETTESTAR, ALLGEMEIN")
    p_tasks.set_defaults(func=cmd_tasks)

    # watch
    p_watch = subparsers.add_parser("watch", help="Inbox überwachen (Watch-Modus)")
    p_watch.set_defaults(func=cmd_watch)

    # dashboard
    p_dash = subparsers.add_parser("dashboard", help="Web-Dashboard starten")
    p_dash.set_defaults(func=cmd_dashboard)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if hasattr(args, "func"):
        args.func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
