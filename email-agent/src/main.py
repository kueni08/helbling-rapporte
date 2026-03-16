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
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
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

        _print_result(result, show_draft=getattr(args, "show_draft", False))

    elif args.all:
        # Alle E-Mails
        eml_files = sorted(
            (resolve_path(config.get("paths", {}).get("inbox", "./inbox"))).glob("*.eml")
        )
        if not eml_files:
            console.print("[yellow]Keine .eml-Dateien im Inbox.[/yellow]")
            return

        results = []
        errors = []

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Verarbeite E-Mails...", total=len(eml_files))
            for eml_file in eml_files:
                progress.update(task, description=f"[cyan]{eml_file.name}[/cyan]")
                try:
                    result = processor.process_file(str(eml_file), force=args.force)
                    results.append(result)
                except Exception as e:
                    errors.append((eml_file.name, str(e)))
                finally:
                    progress.advance(task)

        _print_batch_summary(results, errors, args)

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
    host = getattr(args, "host", None) or dash_cfg.get("host", "127.0.0.1")
    port = getattr(args, "port", None) or dash_cfg.get("port", 5000)
    online = getattr(args, "online", False)

    if online:
        host = "127.0.0.1"
        console.print(f"[green]Starte Dashboard + Cloudflare Tunnel ...[/green]")
        _start_with_tunnel(config, host, port)
        return

    console.print(f"[green]Starte Dashboard auf http://{host}:{port}[/green]")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from web.app import create_app
    app = create_app(config)
    app.run(host=host, port=port, debug=dash_cfg.get("debug", False))


def _start_with_tunnel(config, host, port):
    """Startet Flask und Cloudflare Tunnel parallel."""
    import threading
    import subprocess
    import shutil

    # Flask in Hintergrundthread starten
    def run_flask():
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from web.app import create_app
        app = create_app(config)
        app.run(host=host, port=port, debug=False, use_reloader=False)

    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    import time
    time.sleep(2)

    # cloudflared suchen
    cloudflared = shutil.which("cloudflared")
    base_dir = Path(__file__).parent.parent
    local_cf = base_dir / "cloudflared.exe"
    if local_cf.exists():
        cloudflared = str(local_cf)

    if not cloudflared:
        console.print(
            "[yellow]cloudflared nicht gefunden.[/yellow]\n"
            "Bitte herunterladen und ins Projektverzeichnis legen:\n"
            "[blue]https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe[/blue]\n"
            "→ Umbenennen zu cloudflared.exe\n\n"
            f"Dashboard läuft lokal auf [green]http://{host}:{port}[/green]"
        )
        flask_thread.join()
        return

    console.print(f"[cyan]Cloudflare Tunnel wird gestartet ...[/cyan]")
    try:
        proc = subprocess.Popen(
            [cloudflared, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        import re
        for line in proc.stdout:
            m = re.search(r"https://[a-z0-9\-]+\.trycloudflare\.com", line)
            if m:
                console.print(f"\n[bold green]✓ Dashboard öffentlich erreichbar:[/bold green]")
                console.print(f"  [bold white]{m.group(0)}[/bold white]")
                console.print("[dim]Strg+C zum Beenden[/dim]\n")
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        console.print("\n[yellow]Beendet.[/yellow]")


def _print_result(result, show_draft: bool = False):
    """Gibt ein Verarbeitungsergebnis detailliert aus."""
    clf = result.classification
    ta = result.thread_analysis

    bereich_color = {"SIBOX": "blue", "FACETTESTAR": "magenta", "ALLGEMEIN": "cyan"}.get(
        clf.bereich, "white"
    )
    prio_color = {"hoch": "red", "mittel": "yellow", "niedrig": "green"}.get(
        clf.dringlichkeit, "white"
    )

    draft_line = "✓ generiert" if result.draft else "✗ nicht nötig"
    if result.draft and result.draft.has_check_markers:
        draft_line += " [yellow]⚠ enthält [PRÜFEN:] Markierungen[/yellow]"

    task_line = "✗ nicht nötig"
    if result.task:
        task_line = f"✓ erstellt — ID: [bold]{result.task.id}[/bold], fällig: {result.task.faellig_bis}"

    console.print(Panel(
        f"[bold]Betreff:[/bold]       {result.parsed_email.subject}\n"
        f"[bold]Von:[/bold]           {result.parsed_email.from_addr}\n"
        f"[bold]Bereich:[/bold]       [{bereich_color}]{clf.bereich}[/{bereich_color}]\n"
        f"[bold]Typ:[/bold]           {clf.aktionstyp}\n"
        f"[bold]Dringlichkeit:[/bold] [{prio_color}]{clf.dringlichkeit}[/{prio_color}]\n"
        f"[bold]Zusammenfassung:[/bold] {clf.zusammenfassung}\n\n"
        f"[bold]Thread:[/bold]       {ta.anzahl_nachrichten} Nachricht(en), "
        f"Tonalität: {ta.tonalitaet}\n"
        f"[bold]Nächster Schritt:[/bold] {ta.naechster_schritt}\n\n"
        f"[bold]Entwurf:[/bold]       {draft_line}\n"
        f"[bold]Aufgabe:[/bold]       {task_line}",
        title=f"[bold]Ergebnis[/bold] — {result.email_id}",
        style="green" if not result.error else "red",
        expand=False,
    ))

    if result.task and result.task.teilaufgaben:
        console.print("[bold yellow]Teilaufgaben:[/bold yellow]")
        for t in result.task.teilaufgaben[:5]:
            console.print(f"  • {t}")

    if result.draft:
        draft_len = len(result.draft.draft_text)
        limit = 0 if show_draft else 600
        if show_draft or draft_len <= limit:
            console.print("\n[bold cyan]Antwortentwurf:[/bold cyan]")
            console.print(result.draft.draft_text)
        else:
            console.print(f"\n[bold cyan]Antwortentwurf[/bold cyan] [dim](erste 600 von {draft_len} Zeichen — "
                          f"--show-draft für vollständige Anzeige)[/dim]")
            console.print(result.draft.draft_text[:600] + "\n[dim]...[/dim]")


def _print_result_summary(result):
    """Gibt eine kurze Zusammenfassung aus (für Watch-Modus)."""
    clf = result.classification
    bereich_color = {"SIBOX": "blue", "FACETTESTAR": "magenta", "ALLGEMEIN": "cyan"}.get(
        clf.bereich, "white"
    )
    icons = []
    if result.draft:
        marker = " ⚠" if result.draft.has_check_markers else ""
        icons.append(f"✉ Entwurf{marker}")
    if result.task:
        icons.append(f"📋 {result.task.id}")

    status = " | ".join(icons) or "archiviert"
    console.print(
        f"  [{bereich_color}]{clf.bereich}[/{bereich_color}] "
        f"[bold]{clf.aktionstyp}[/bold]  "
        f"[cyan]{result.parsed_email.subject[:45]}[/cyan]  →  {status}"
    )


def _print_batch_summary(results: list, errors: list, args):
    """Gibt eine Gesamtübersicht nach --all aus."""
    total = len(results) + len(errors)
    console.print()

    if not results and not errors:
        console.print("[yellow]Keine E-Mails verarbeitet.[/yellow]")
        return

    # Summary table
    table = Table(
        title=f"Verarbeitungs-Übersicht  ({len(results)}/{total} erfolgreich)",
        show_lines=False,
        expand=False,
    )
    table.add_column("#", style="dim", width=3)
    table.add_column("Datei", style="cyan", no_wrap=True)
    table.add_column("Betreff")
    table.add_column("Bereich", style="magenta")
    table.add_column("Typ")
    table.add_column("Prio")
    table.add_column("Entwurf")
    table.add_column("Aufgabe")

    for i, result in enumerate(results, 1):
        clf = result.classification
        prio_color = {"hoch": "red", "mittel": "yellow", "niedrig": "green"}.get(
            clf.dringlichkeit, "white"
        )
        draft_cell = "[green]✓[/green]"
        if result.draft and result.draft.has_check_markers:
            draft_cell = "[yellow]✓⚠[/yellow]"
        elif not result.draft:
            draft_cell = "[dim]–[/dim]"

        task_cell = f"[green]{result.task.id[:16]}[/green]" if result.task else "[dim]–[/dim]"

        table.add_row(
            str(i),
            Path(result.source_file).name[:25],
            result.parsed_email.subject[:40],
            clf.bereich,
            clf.aktionstyp,
            f"[{prio_color}]{clf.dringlichkeit}[/{prio_color}]",
            draft_cell,
            task_cell,
        )

    for name, err in errors:
        table.add_row("!", name[:25], f"[red]FEHLER: {err[:35]}[/red]", "", "", "", "", "")

    console.print(table)

    # Stats line
    drafts_count = sum(1 for r in results if r.draft)
    tasks_count = sum(1 for r in results if r.task)
    markers_count = sum(1 for r in results if r.draft and r.draft.has_check_markers)
    console.print(
        f"\n[green]✓[/green] {len(results)} E-Mails verarbeitet  "
        f"✉ {drafts_count} Entwürfe  "
        f"📋 {tasks_count} Aufgaben"
        + (f"  [yellow]⚠ {markers_count} mit [PRÜFEN:][/yellow]" if markers_count else "")
    )

    if getattr(args, "show_draft", False) and results:
        for result in results:
            if result.draft:
                console.print(
                    f"\n[bold cyan]Entwurf: {result.parsed_email.subject[:50]}[/bold cyan]"
                )
                console.print(result.draft.draft_text)
                console.print("[dim]" + "─" * 60 + "[/dim]")


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
    p_process.add_argument("--show-draft", action="store_true", dest="show_draft",
                           help="Vollständigen Entwurf anzeigen")
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
    p_dash.add_argument("--online", action="store_true",
                        help="Cloudflare Tunnel starten (öffentlich erreichbar)")
    p_dash.add_argument("--host", default=None, help="Host-Adresse (Standard: 127.0.0.1)")
    p_dash.add_argument("--port", type=int, default=None, help="Port (Standard: 5000)")
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
