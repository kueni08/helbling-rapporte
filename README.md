# Helbling Montagerapport

Digitaler Montagerapport als PWA – läuft komplett über GitHub, kein Backend nötig.

## Architektur

```
Techniker-Handy (PWA)  →  GitHub API  →  GitHub Repo
                                           └── /rapporte/
                                               └── 2026-02-21_HB-0142_Müller/
                                                   ├── rapport.json
                                                   ├── rapport.md
                                                   ├── foto_vorher_1.jpg
                                                   ├── foto_nachher_1.jpg
                                                   └── unterschrift.png
```

## Setup

### 1. Repo erstellen

Erstelle ein **privates** Repo auf GitHub, z.B. `helbling-rapporte`.

### 2. GitHub Pages aktivieren

Settings → Pages → Source: `main` branch, Ordner: `/ (root)`

### 3. Fine-grained Token erstellen

1. [GitHub Token erstellen](https://github.com/settings/personal-access-tokens/new)
2. Name: `Montagerapport`
3. Repo access: Nur `helbling-rapporte`
4. Permissions: `Contents → Read and Write`
5. Token kopieren

### 4. PWA einrichten

1. `index.html` und `manifest.json` ins Repo pushen
2. PWA im Browser öffnen: `https://DEIN-USERNAME.github.io/helbling-rapporte/`
3. Beim ersten Öffnen: Repo, Token und Techniker-Name eingeben
4. "Zum Startbildschirm hinzufügen" → funktioniert wie eine App

## Nutzung

- Rapport ausfüllen → Fotos machen → Kunde unterschreibt → Absenden
- Alles wird als Dateien direkt ins GitHub-Repo committet
- Entwürfe werden lokal gespeichert (💾-Button)
- Bei jedem Rapport entsteht ein Ordner mit JSON, Markdown, Fotos und Unterschrift

## Sicherheit

- Token wird nur lokal auf dem Gerät gespeichert (localStorage)
- Fine-grained Token hat nur Zugriff auf das eine Repo
- Repo sollte **privat** sein

## Optional: OneDrive-Sync

Falls die Rapporte zusätzlich auf OneDrive landen sollen:
- GitHub Action einrichten die bei jedem Push den `/rapporte/`-Ordner synct
- Oder: Microsoft Power Automate Workflow der das GitHub-Repo überwacht
