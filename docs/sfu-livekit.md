# SFU Meeting (LiveKit) — demo10

NxSocket **demo9** = meeting mesh (~4 orang).  
**demo10** = meeting **SFU** via [LiveKit](https://livekit.io).

## Arsitektur

```
Browser  ──WS──► NxSocket (gateway + AccessToken)
         ──WebRTC──► LiveKit Server (SFU)
```

## Cara jalanin LiveKit (tanpa Docker — disarankan di Windows)

Docker **tidak wajib**. Script mengunduh binary resmi:

```powershell
cd D:\Framework\CLI\NxSocket
npm run livekit:dev
```

Itu akan:
1. Unduh `livekit_*_windows_amd64.zip` ke `tools/livekit/`
2. Jalankan `livekit-server.exe --dev --bind 0.0.0.0`
3. Keys: **devkey** / **secret**, port **7880**

Manual (kalau script gagal):  
https://github.com/livekit/livekit/releases/latest → `livekit_*_windows_amd64.zip`  
ekstrak → `tools/livekit/livekit-server.exe` → `.\tools\livekit\livekit-server.exe --dev --bind 0.0.0.0`

## Env NxSocket

```env
NXSOCKET_LIVEKIT_URL=ws://127.0.0.1:7880
NXSOCKET_LIVEKIT_API_KEY=devkey
NXSOCKET_LIVEKIT_API_SECRET=secret
```

HP di LAN (LiveKit di PC):

```env
NXSOCKET_LIVEKIT_URL=ws://192.168.100.81:7880
```

Lalu:

```powershell
npm run build
nxsocket server --https
```

Buka: `https://192.168.100.81:7080/v1/demo10`

## Opsi lain

| Opsi | Kapan |
|------|--------|
| **Binary Windows** (di atas) | Default di PC Windows, tanpa Docker |
| **Docker** | Kalau Docker Desktop ada — script fallback otomatis |
| **LiveKit Cloud** | Tanpa server lokal — isi URL `wss://…` + key cloud di `.env` |
| **Teritip** | `D:\Framework\CLI\Teritip` — di Windows masih `windows-stub` (bukan isolasi nyata). Isolasi Linux hanya **WSL2** + `TERITIP_DRIVER=linux` + rootfs manual. Belum cocok sebagai pengganti praktis image LiveKit (rootfs harus disiapkan sendiri, bukan tarik dari registry). Pakai binary Windows dulu. |

## Protocol

| Arah | Type |
|------|------|
| S→C | `sfu.status` |
| C→S | `sfu.createToken` |
| S→C | `sfu.token` |
