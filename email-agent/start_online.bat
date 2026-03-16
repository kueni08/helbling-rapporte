@echo off
:: Helbling Dashboard — Online starten (einfache Version)
:: Startet Flask + Cloudflare Tunnel in zwei Fenstern

title Helbling Dashboard Online

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   Helbling E-Mail Agent — Online Dashboard   ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Prüfe cloudflared
if not exist "%~dp0cloudflared.exe" (
    where cloudflared >nul 2>&1
    if errorlevel 1 (
        echo  FEHLER: cloudflared.exe nicht gefunden!
        echo.
        echo  Bitte herunterladen:
        echo  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
        echo  Umbenennen zu cloudflared.exe und in diesen Ordner legen.
        echo.
        pause
        exit /b 1
    )
    set CLOUDFLARED=cloudflared
) else (
    set CLOUDFLARED="%~dp0cloudflared.exe"
)

:: Flask in neuem Fenster starten
echo  Starte Flask-Server...
start "Helbling Flask" cmd /k "cd /d %~dp0 && python -m src.main dashboard"

:: Kurz warten
timeout /t 4 /nobreak >nul

:: Cloudflare Tunnel in neuem Fenster starten
echo  Starte Cloudflare Tunnel...
echo  (Offentliche URL erscheint im neuen Fenster)
echo.
start "Cloudflare Tunnel" cmd /k "%CLOUDFLARED% tunnel --url http://127.0.0.1:5000 --no-autoupdate"

echo  ✓ Beide Dienste gestartet.
echo  → Schau in das Cloudflare-Fenster fur die offentliche URL
echo  → Beide Fenster schliessen zum Beenden
echo.
pause
