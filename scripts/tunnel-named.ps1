# Jalankan named tunnel (domain tetap) — setelah tunnel-named-setup.ps1
#
#   npm run tunnel:named
#   powershell -File scripts/tunnel-named.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Root "tools\cloudflared\cloudflared-windows-amd64.exe"
$Config = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$Meta = Join-Path $Root "data\named-tunnel.json"

if (-not (Test-Path $Exe)) {
  throw "cloudflared belum ada. Jalankan dulu scripts/tunnel-named-setup.ps1"
}
if (-not (Test-Path $Config)) {
  throw "Config belum ada: $Config`nSetup dulu: powershell -File scripts/tunnel-named-setup.ps1 -Hostname nxsocket.domainanda.com"
}

$hostLabel = "(lihat config)"
if (Test-Path $Meta) {
  try {
    $m = Get-Content $Meta -Raw | ConvertFrom-Json
    $hostLabel = $m.url
    Set-Content -Path (Join-Path $Root "data\current-tunnel-url.txt") -Value $m.url -Encoding utf8
  } catch { }
}

Write-Host ""
Write-Host "NxSocket Named Tunnel"
Write-Host "  Config : $Config"
Write-Host "  URL    : $hostLabel"
Write-Host "  Pastikan nxsocket server (HTTP) sudah jalan di :7080"
Write-Host "  HP     : $hostLabel/v1/demo5"
Write-Host ""

& $Exe tunnel --config $Config run
