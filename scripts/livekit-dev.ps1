# Jalankan LiveKit --dev TANPA Docker (binary Windows), fallback Docker jika ada.
# Unduh otomatis ke tools/livekit/livekit-server.exe dari GitHub Releases.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dir = Join-Path $Root "tools\livekit"
$Exe = Join-Path $Dir "livekit-server.exe"
$Version = if ($env:NXSOCKET_LIVEKIT_VERSION) { $env:NXSOCKET_LIVEKIT_VERSION } else { "1.13.4" }

function Ensure-LiveKitBinary {
  if (Test-Path $Exe) {
    Write-Host "LiveKit binary: $Exe"
    return
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $zipName = "livekit_${Version}_windows_amd64.zip"
  $url = "https://github.com/livekit/livekit/releases/download/v$Version/$zipName"
  $zipPath = Join-Path $Dir $zipName
  Write-Host "Mengunduh LiveKit v$Version (tanpa Docker)..."
  Write-Host $url
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $Dir -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $Exe)) {
    $found = Get-ChildItem -Path $Dir -Filter "livekit-server.exe" -Recurse | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $Exe -Force }
  }
  if (-not (Test-Path $Exe)) {
    throw "Gagal menemukan livekit-server.exe setelah ekstrak"
  }
  Write-Host "Siap: $Exe"
}

Write-Host "=== LiveKit SFU (alternatif Docker) ==="
Write-Host "Keys dev: API key=devkey  secret=secret"
Write-Host "Bind: 0.0.0.0:7880 (akses LAN OK)"
Write-Host ""

# 1) Binary native Windows (utama)
try {
  Ensure-LiveKitBinary
  Write-Host "Menjalankan binary..."
  & $Exe --dev --bind 0.0.0.0
  exit $LASTEXITCODE
} catch {
  Write-Host "Binary gagal: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 2) Docker (opsional)
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Write-Host "Fallback Docker..."
  docker run --rm `
    -p 7880:7880 -p 7881:7881 -p 7882:7882/udp `
    -e "LIVEKIT_KEYS=devkey: secret" `
    livekit/livekit-server --dev --bind 0.0.0.0
  exit $LASTEXITCODE
}

Write-Host @"

Tidak bisa jalanin LiveKit.
- Binary: gagal unduh / ekstrak
- Docker: tidak terpasang

Opsi lain:
1) Unduh manual: https://github.com/livekit/livekit/releases/latest
   → livekit_*_windows_amd64.zip → ekstrak ke tools\livekit\livekit-server.exe
2) LiveKit Cloud: https://cloud.livekit.io (isi NXSOCKET_LIVEKIT_* di .env)
3) Teritip (D:\Framework\CLI\Teritip): di Windows masih windows-stub
   (belum isolasi nyata). Isolasi Linux hanya di WSL2 TERITIP_DRIVER=linux
   + rootfs manual — belum pengganti praktis untuk image LiveKit.
   Untuk sekarang pakai binary Windows di atas.

"@ -ForegroundColor Red
exit 1
