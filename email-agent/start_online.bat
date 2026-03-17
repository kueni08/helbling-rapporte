@echo off
setlocal enabledelayedexpansion
title Helbling Dashboard Online

set "BASEDIR=%~dp0"

echo.
echo  Helbling E-Mail Agent - Online Dashboard
echo.

if not exist "!BASEDIR!cloudflared.exe" (
    echo  FEHLER: cloudflared.exe nicht gefunden!
    echo  Bitte cloudflared.exe in den Programmordner legen.
    pause
    exit /b 1
)

echo  Starte Flask-Server...
start "Helbling Flask" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location '!BASEDIR!'; python -m src.main dashboard"

timeout /t 4 /nobreak >nul

echo  Starte Cloudflare Tunnel...
start "Cloudflare Tunnel" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location '!BASEDIR!'; .\cloudflared.exe tunnel --url http://127.0.0.1:5000 --no-autoupdate"

echo  Beide Dienste gestartet.
echo  Beide Fenster schliessen zum Beenden.
echo.
pause
endlocal
