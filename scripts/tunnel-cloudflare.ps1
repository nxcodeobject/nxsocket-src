# Tunnel akses luar LAN → PC lokal (Cloudflare Quick Tunnel)
#
# Meneruskan SELURUH gateway NxSocket (WebSocket + semua /v1/*).
#
# Cara pakai:
#   1. Terminal A:  nxsocket server
#   2. Terminal B:  npm run tunnel
#   3. Lihat URL di layar ATAU file: data/current-tunnel-url.txt
#
# Catatan:
# - Hostname *.trycloudflare.com acak tiap restart (tidak bisa dipesan).
# - Domain lama (mis. recreation-procedures-...) TIDAK bisa dipakai lagi
#   setelah tunnel mati — pakai URL baru dari file di atas.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Root "tools\cloudflared\cloudflared-windows-amd64.exe"
$UrlFile = Join-Path $Root "data\current-tunnel-url.txt"
$Port = if ($env:NXSOCKET_PORT) { $env:NXSOCKET_PORT } else { "7080" }
$Origin = if ($args[0]) { $args[0] } else { "http://127.0.0.1:$Port" }

if (-not (Test-Path $Exe)) {
  Write-Host "Mengunduh cloudflared..."
  New-Item -ItemType Directory -Force -Path (Split-Path $Exe) | Out-Null
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Invoke-WebRequest -Uri $url -OutFile $Exe -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path (Split-Path $UrlFile) | Out-Null
if (Test-Path $UrlFile) { Remove-Item $UrlFile -Force }

Write-Host ""
Write-Host "NxSocket Cloudflare Tunnel — akses HP dari mana saja"
Write-Host "  Origin : $Origin"
Write-Host "  URL aktif akan disimpan di: data\current-tunnel-url.txt"
Write-Host "  Pastikan: nxsocket server  (HTTP lokal, tanpa --https)"
Write-Host ""

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.Arguments = "tunnel --url $Origin --no-autoupdate"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi

$handler = {
  if (-not $EventArgs.Data) { return }
  $line = $EventArgs.Data
  [Console]::Error.WriteLine($line)
  if ($line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
    $u = $Matches[0]
    Set-Content -Path $UrlFile -Value $u -Encoding utf8
    [Console]::Error.WriteLine("")
    [Console]::Error.WriteLine("=== URL AKTIF (sementara) ===")
    [Console]::Error.WriteLine("  $u")
    [Console]::Error.WriteLine("  Remote AI: $u/v1/demo5")
    [Console]::Error.WriteLine("  Chat:      $u/v1/demo")
    [Console]::Error.WriteLine("  Disimpan:  data\current-tunnel-url.txt")
    [Console]::Error.WriteLine("=============================")
    [Console]::Error.WriteLine("")
  }
}

Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $handler | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $handler | Out-Null
[void]$proc.Start()
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()
$proc.WaitForExit()
exit $proc.ExitCode
