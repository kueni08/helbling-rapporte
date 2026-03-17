@echo off
title Helbling Dashboard Online

echo.
echo  Helbling E-Mail Agent - Online Dashboard
echo.

:: Ins Skript-Verzeichnis wechseln
cd /d "%~dp0"

:: cloudflared prüfen (absoluter Pfad via %~dp0, & in quotes ist sicher)
if not exist "%~dp0cloudflared.exe" (
    echo  FEHLER: cloudflared.exe nicht gefunden!
    echo  Erwartet in: %~dp0cloudflared.exe
    pause
    exit /b 1
)

:: Flask in neuem PowerShell-Fenster starten
:: (PowerShell versteht den & im Pfad korrekt)
echo  Starte Flask-Server...
start "Helbling Flask" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location '%~dp0'; python -m src.main dashboard"

timeout /t 4 /nobreak >nul

:: Cloudflare Tunnel starten
echo  Starte Cloudflare Tunnel...
start "Cloudflare Tunnel" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location '%~dp0'; .\cloudflared.exe tunnel --url http://127.0.0.1:5000 --no-autoupdate"

echo  Beide Dienste gestartet.
echo  Beide Fenster schliessen zum Beenden.
echo.
pause
