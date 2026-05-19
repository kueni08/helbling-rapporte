@echo off
:: ============================================================
::  Helbling Rapporte – Autostart einrichten
::  Dieses Script einmalig als Administrator ausfuehren!
:: ============================================================

echo.
echo ============================================================
echo  Helbling Rapporte – Autostart einrichten
echo ============================================================
echo.

:: Pfad zu dieser Batch-Datei ermitteln
set SCRIPT_DIR=%~dp0
:: Abschliessenden Backslash entfernen
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

set VBS_PATH=%SCRIPT_DIR%\start-rapporte-silent.vbs
set TASK_NAME=Helbling Rapporte Autostart

:: Pruefen ob VBS-Datei vorhanden ist
if not exist "%VBS_PATH%" (
    echo FEHLER: Datei nicht gefunden: %VBS_PATH%
    echo Stelle sicher, dass start-rapporte-silent.vbs im gleichen Ordner liegt.
    pause
    exit /b 1
)

echo Registriere Task Scheduler Aufgabe...
echo Aufgabenname : %TASK_NAME%
echo Script-Pfad  : %VBS_PATH%
echo Ausloser     : Bei Anmeldung (nach 1 Minute Verzoegerung)
echo.

:: Bestehende Aufgabe loeschen falls vorhanden
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Neue Aufgabe erstellen
:: /sc onlogon  = beim Anmelden des Benutzers
:: /delay 0001:00 = 1 Minute Verzoegerung (Netzwerk hochfahren lassen)
:: /ru %USERNAME% = als aktueller Benutzer ausfuehren
schtasks /create ^
    /tn "%TASK_NAME%" ^
    /tr "wscript.exe \"%VBS_PATH%\"" ^
    /sc onlogon ^
    /delay 0001:00 ^
    /ru "%USERNAME%" ^
    /f

if %errorlevel% == 0 (
    echo.
    echo ============================================================
    echo  Autostart erfolgreich eingerichtet!
    echo.
    echo  Die App startet ab jetzt automatisch ~1 Minute
    echo  nach dem Anmelden am Computer.
    echo.
    echo  Logs werden gespeichert unter:
    echo    %SCRIPT_DIR%\logs\node.log
    echo    %SCRIPT_DIR%\logs\caddy.log
    echo ============================================================
) else (
    echo.
    echo ============================================================
    echo  FEHLER beim Einrichten!
    echo  Bitte dieses Script als ADMINISTRATOR ausfuehren:
    echo  Rechtsklick auf autostart-einrichten.bat
    echo  dann "Als Administrator ausfuehren"
    echo ============================================================
)

echo.
pause
