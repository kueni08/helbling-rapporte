# Helbling Dashboard — Online starten (Cloudflare Tunnel)
# Dieses Skript startet das Dashboard lokal und macht es via Cloudflare öffentlich erreichbar.
# Einmalige Vorbereitung: cloudflared.exe herunterladen und in denselben Ordner legen.
# Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
# Umbenennen zu: cloudflared.exe

$ErrorActionPreference = "Stop"

# Pfad zu diesem Skript
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Helbling E-Mail Agent — Online Dashboard   ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 1. Prüfe ob cloudflared vorhanden
$cloudflared = $null
if (Test-Path "$ScriptDir\cloudflared.exe") {
    $cloudflared = "$ScriptDir\cloudflared.exe"
} elseif (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    $cloudflared = "cloudflared"
} else {
    Write-Host "⚠  cloudflared.exe nicht gefunden!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Bitte herunterladen und in diesen Ordner legen:" -ForegroundColor White
    Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -ForegroundColor Blue
    Write-Host "  → Umbenennen zu: cloudflared.exe" -ForegroundColor White
    Write-Host ""
    Write-Host "Alternativ: Dashboard nur lokal starten mit:" -ForegroundColor White
    Write-Host "  python -m src.main dashboard" -ForegroundColor Green
    Write-Host ""
    Read-Host "Drücke Enter zum Beenden"
    exit 1
}

# 2. Prüfe ob Python verfügbar
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "✗ Python nicht gefunden. Bitte Python installieren." -ForegroundColor Red
    Read-Host "Drücke Enter zum Beenden"
    exit 1
}

# 3. Starte Flask auf 0.0.0.0 im Hintergrund
Write-Host "▶  Starte Flask-Server auf Port 5000 ..." -ForegroundColor Green
$flaskJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:DASHBOARD_HOST = "127.0.0.1"
    $env:DASHBOARD_PORT = "5000"
    python -m src.main dashboard 2>&1
} -ArgumentList $ScriptDir

# Kurz warten bis Flask gestartet ist
Start-Sleep -Seconds 3

# Prüfe ob Flask läuft
$flaskRunning = $false
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5000" -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) { $flaskRunning = $true }
} catch { }

if (-not $flaskRunning) {
    # Noch mal kurz warten
    Start-Sleep -Seconds 3
}

Write-Host "✓  Flask läuft auf http://127.0.0.1:5000" -ForegroundColor Green
Write-Host ""

# 4. Starte Cloudflare Tunnel
Write-Host "🌐 Starte Cloudflare Tunnel ..." -ForegroundColor Cyan
Write-Host "   (Öffentliche URL erscheint in wenigen Sekunden)" -ForegroundColor Gray
Write-Host ""
Write-Host "──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "   Zum Beenden: Strg+C drücken" -ForegroundColor Gray
Write-Host "──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# Cloudflare gibt die URL auf stderr aus — wir zeigen alles an
& $cloudflared tunnel --url http://127.0.0.1:5000 --no-autoupdate 2>&1 | ForEach-Object {
    $line = $_
    if ($line -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "║  ✓ DEIN DASHBOARD IST ONLINE:                ║" -ForegroundColor Green
        $url = $matches[0]
        Write-Host "║  $url" -ForegroundColor White
        Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
        Write-Host "  → Link an Kollegen schicken oder im Browser öffnen" -ForegroundColor Gray
        Write-Host "  → Strg+C zum Beenden" -ForegroundColor Gray
        Write-Host ""
    }
    Write-Host $line -ForegroundColor DarkGray
}

# Cleanup
Stop-Job $flaskJob -ErrorAction SilentlyContinue
Remove-Job $flaskJob -ErrorAction SilentlyContinue
