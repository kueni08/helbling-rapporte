@echo off
cd /d %~dp0
echo ============================================
echo  Helbling Rapporte - Start
echo ============================================
echo.
echo Starte Node App (Port 3000)...
start "" cmd /k "node server.js"
timeout /t 3 >nul
echo Starte Caddy (HTTPS + Login)...
start "" cmd /k "caddy run"
timeout /t 2 >nul
echo.
echo App laeuft unter: https://rapporte.helbling.net
echo.
start https://rapporte.helbling.net
pause
