@echo off
:: %~sdp0 = 8.3 Kurzpfad (kein & oder Leerzeichen-Probleme)
powershell -ExecutionPolicy Bypass -File "%~sdp0start_online.ps1"
