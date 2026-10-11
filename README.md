# NxSocket

CLI dan platform WebSocket untuk membangun fitur realtime.

Dokumen terkait: [`PROTOCOL.md`](./PROTOCOL.md) · [`CHANGELOG.md`](./CHANGELOG.md) · [`Plan.md`](./Plan.md) · [`RELEASE.md`](./RELEASE.md)

## Quick start (dev) — hello chat < 15 menit

```bash
npm install
npm run build
npm link
nxsocket gateway info
nxsocket server
```

Terminal lain — uji **semua modul** (CLI):

```bash
npm run example:demo
```

Atau buka **demo browser**:

```text
http://127.0.0.1:7080/v1/demo    ← chat & presence
http://127.0.0.1:7080/v1/demo2   ← telepon suara
http://127.0.0.1:7080/v1/demo3   ← video call
http://127.0.0.1:7080/v1/demo4   ← AI streaming
http://127.0.0.1:7080/v1/demo5   ← remote AI control (Claude / Cursor Agent)
http://127.0.0.1:7080/v1/demo6   ← tracking posisi
http://127.0.0.1:7080/v1/demo7   ← progress / job / sync
http://127.0.0.1:7080/v1/demo8   ← group video call (multi-peer)
http://127.0.0.1:7080/v1/demo9   ← meeting (mesh)
http://127.0.0.1:7080/v1/demo10  ← SFU meeting (LiveKit)
http://127.0.0.1:7080/v1/demo11  ← social feed
http://127.0.0.1:7080/v1/demo12  ← groups & DM
http://127.0.0.1:7080/v1/otp     ← OTP request / verify
```

1. Jalankan `nxsocket server --https` (wajib mic/kamera HP)
2. Chat: `demo` · Suara: `demo2` · Video: `demo3` · AI: `demo4` · Remote AI: `demo5` · Track: `demo6` · Ops: `demo7`
3. Group/Meeting: `demo8` (mesh, ideal ≤4 peer) · `demo9` (meeting mesh) · `demo10` (SFU LiveKit, peserta lebih banyak)
4. Sosial: `demo11` (feed / post / like / comment) · `demo12` (groups & DM)
5. Video: 2 HP, room sama → **Video call** → **Angkat** · izinkan kamera + mic
6. AI: buka `demo4` → Masuk → ketik prompt → lihat chunk bertahap
7. Remote AI: buka `demo5` di HP → Masuk → set folder kerja → Claude / Cursor Agent
8. Tracking: 2 tab `demo6` target sama → Simulate / ketuk peta
9. Ops: `demo7` → Simulate upload / Run demo job / Set sync key
10. OTP: buka `demo` `/v1/otp` → request kode → verify

### SFU Meeting (LiveKit, demo10)

`demo10` memakai **LiveKit** sebagai SFU untuk meeting dengan banyak peserta (mesh WebRTC biasa tidak scalable di atas beberapa peer).

```bash
npm run livekit:dev   # jalankan LiveKit server lokal (dev)
```

Konfigurasi LiveKit lewat env (lihat `.env.example`): URL server, API key, API secret. Tanpa LiveKit berjalan, `demo10` tidak akan bisa connect ke room SFU.

### QR Token (CLI)

QR di terminal berisi **token saja** (bukan link demo):

```bash
nxsocket server          # default SQLite + QR token saat start
nxsocket gateway qr      # cetak QR token saja
nxsocket gateway info    # info + QR token
```

### HTTPS (mic HP) + firewall + QR

```bash
# Disarankan untuk uji 2 HP / panggilan suara
nxsocket server --https

# Token per-user dengan expiry, scope, dan ACL room
nxsocket gateway token create --label alice --expires 7d --scope chat,call,presence
nxsocket gateway token create --label bob --expires 30d --scope "*"
nxsocket gateway token create --label lobby --scope chat,presence --rooms lobby,support

# QR
nxsocket gateway qr          # token saja
nxsocket gateway qr-url      # URL https + token (default HTTPS)
nxsocket server --https      # wajib untuk mic/telepon HP
```

Scopes: `*` (semua), atau `chat,call,presence,notify,monitor,track,ai,terminal,progress,job,sync,admin`.

Rooms (`--rooms`): daftar room yang diizinkan; kosong / `*` = semua room.

### AI streaming (opsional)

Tanpa API key → fallback demo (pecah kata). Dengan key OpenAI-compatible:

```bash
# .env (contoh OpenRouter Free Tier)
NXSOCKET_AI_URL=https://openrouter.ai/api/v1
NXSOCKET_AI_MODEL=openrouter/free
NXSOCKET_AI_API_KEYS=sk-or-v1-...
```

(`OPENAI_API_KEY` / `NXSOCKET_AI_API_KEY` juga didukung.)

UI browser: `/v1/demo4` (atau `npx tsx examples/ai-stream.ts`).
Restart server setelah mengubah `.env`.

### Web Push & LiveKit (opsional)

```bash
# .env — notifikasi panggilan saat tab tertutup (VAPID)
NXSOCKET_VAPID_PUBLIC_KEY=...
NXSOCKET_VAPID_PRIVATE_KEY=...
NXSOCKET_VAPID_SUBJECT=mailto:you@example.com

# .env — SFU meeting (demo10), lihat "SFU Meeting" di atas
NXSOCKET_LIVEKIT_URL=ws://127.0.0.1:7880
NXSOCKET_LIVEKIT_API_KEY=devkey
NXSOCKET_LIVEKIT_API_SECRET=secret
```

Lihat [`.env.example`](./.env.example) untuk daftar lengkap.

### Uji di 2 HP (satu WiFi)

1. Di PC:
   ```bash
   nxsocket server --https
   ```
2. Scan **QR URL Jaringan** di terminal, atau buka baris **Jaringan** (https).
3. Di HP: terima peringatan sertifikat self-signed → lanjut.
4. Kedua HP: room sama → Telepon / Angkat.
5. Jika halaman tidak kebuka: izinkan firewall (perintah ada di output server).
6. Jika panggilan tersambung tapi **tidak ada suara**: ketuk tombol **Aktifkan suara**; pastikan izin mic di kedua HP; pakai `--https` (bukan HTTP).

Atau hello chat singkat:

```bash
npm run example:hello
```

## Apa itu NxSocket?

NxSocket menyediakan:

1. **CLI** — menjalankan dan mengelola NxSocket Server
2. **Server** — WebSocket server berbasis Node.js
3. **Client module** — library untuk aplikasi yang terhubung ke server

Fokusnya: koneksi realtime yang stabil, lalu modul fitur di atasnya (chat, presence, notifikasi, dll.).

User / client **tidak mengakses server secara langsung**. Semua akses masuk melalui **Endpoint Gateway**, lalu diarahkan ke NxSocket Server.

## Arsitektur

```text
┌──────────────────────┐
│      User / App      │
│   NxSocket Client    │
└──────────┬───────────┘
           │
      WebSocket / HTTP
           │
           ▼
┌──────────────────────┐
│  Endpoint Gateway    │
│  (entry point publik)│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   NxSocket Server    │
│      Node.js         │
└──────────┬───────────┘
           │
  ┌────────┼────────┐
  ▼        ▼        ▼
Database Service  Event
  │        │        │
  └────────┼────────┘
           │
           ▼
┌──────────────────────┐
│      Features        │
├──────────────────────┤
│ Chat                 │
│ Notification         │
│ Remote Terminal      │
│ AI Streaming         │
│ WebRTC Signaling     │
│ Monitoring           │
│ Tracking             │
└──────────────────────┘
```

Alur singkat:

1. User/app memakai **NxSocket Client**
2. Koneksi masuk ke **Endpoint Gateway** dengan **gateway token**
3. Gateway memvalidasi token, lalu meneruskan ke **NxSocket Server**
4. Server mengelola koneksi, auth, session, dan event
5. Database / service / adapter mendukung modul fitur

## Endpoint Gateway & token

Akses publik ke NxSocket lewat gateway (contoh base URL `/v1`).  
Setiap client/pengguna memakai **token gateway** yang diterbitkan (dan bisa di-regenerate) lewat CLI.

### Contoh endpoint

```text
Lokal   : http://127.0.0.1:7080/v1
Jaringan: http://192.168.100.80:7080/v1
Jaringan: http://172.17.192.1:7080/v1
Token   : c6f4d38ce9743b675448447a023ff4910a73632e2937ca1def4a481940722f5d
```

### Pengelolaan token (CLI)

| Perintah (contoh) | Fungsi |
| ----------------- | ------ |
| `nxsocket gateway token create` | Buat token baru untuk client/user |
| `nxsocket gateway token list` | Lihat token yang aktif |
| `nxsocket gateway token regenerate <id>` | Regenerasi token (token lama invalid) |
| `nxsocket gateway token revoke <id>` | Cabut akses token |

Catatan:

- Token dipakai client saat connect ke gateway.
- Cara kirim token (pilih salah satu):
  - Header: `Authorization: Bearer <token>`
  - Header: `X-NxSocket-Token: <token>`
  - Query: `?token=<token>` (kurang disarankan untuk produksi)
- **Regenerate** = token lama tidak berlaku lagi; client harus memakai token baru.
- Token disimpan di folder `data/tokens.json` (gitignore — jangan commit).
- Contoh token di dokumen ini hanya ilustrasi format.

## Catatan setting (jangan sampai lupa)

### Default

| Setting | Default | Keterangan |
| ------- | ------- | ---------- |
| Port | `7080` | Port listen gateway |
| Host / IP bind | `0.0.0.0` | Listen di semua interface |
| Path prefix | `/v1` | Base URL publik |
| WebSocket path | `/v1/ws` | Endpoint upgrade WS |
| Data dir | `./data` | Relatif ke **cwd** saat perintah dijalankan |
| Heartbeat interval | `15000` ms | Ping berkala |
| Heartbeat timeout | `45000` ms | Putus jika tidak ada aktivitas |

### Atur Port & IP lewat CLI

```bash
nxsocket server --port 3090 --host 127.0.0.1
nxsocket server -p 3090 -H 0.0.0.0
nxsocket server --path /v1 --data-dir D:\Framework\CLI\NxSocket\data
nxsocket server --adapter sqlite
nxsocket server --adapter firebase --firebase-credentials .\serviceAccount.json

nxsocket gateway info --port 3090
nxsocket gateway info --adapter sqlite
```

| Flag | Alias | Fungsi |
| ---- | ----- | ------ |
| `--port <n>` | `-p` | Port listen / tampilan URL |
| `--host <ip>` | `-H` | IP yang di-**bind** server (bukan URL tampilan) |
| `--path <prefix>` | | Path gateway, default `/v1` |
| `--data-dir <dir>` | | Lokasi penyimpanan data/token/DB |
| `--adapter <kind>` | | `json` (default) \| `sqlite` \| `firebase` |
| `--firebase-credentials <path>` | | Path service account Firebase JSON |

**Penting:** `--host` / `NXSOCKET_HOST` = alamat bind proses.  
IP yang muncul di `gateway info` (Lokal / Jaringan) diambil otomatis dari adapter mesin.

### Atur lewat environment variable

PowerShell:

```powershell
$env:NXSOCKET_PORT = "3090"
$env:NXSOCKET_HOST = "0.0.0.0"
$env:NXSOCKET_PATH = "/v1"
$env:NXSOCKET_DATA_DIR = "D:\Framework\CLI\NxSocket\data"
$env:NXSOCKET_HEARTBEAT_INTERVAL_MS = "15000"
$env:NXSOCKET_HEARTBEAT_TIMEOUT_MS = "45000"
nxsocket server
```

| Env | Fungsi |
| --- | ------ |
| `NXSOCKET_PORT` | Port |
| `NXSOCKET_HOST` | Host bind |
| `NXSOCKET_PATH` | Path prefix gateway |
| `NXSOCKET_DATA_DIR` | Folder data/token/DB |
| `NXSOCKET_ADAPTER` | `sqlite` (default) \| `json` \| `firebase` |
| `NXSOCKET_FIREBASE_CREDENTIALS` | Path service account Firebase |
| `NXSOCKET_FIREBASE_DATABASE_URL` | Database URL Firebase (opsional) |
| `NXSOCKET_HEARTBEAT_INTERVAL_MS` | Interval heartbeat |
| `NXSOCKET_HEARTBEAT_TIMEOUT_MS` | Timeout disconnect |
| `NXSOCKET_RATE_LIMIT_MAX` | Max pesan per jendela (default 60) |
| `NXSOCKET_RATE_LIMIT_WINDOW_MS` | Jendela rate limit ms (default 10000) |

Lihat juga [`.env.example`](./.env.example).

Prioritas: **flag CLI** > **env** > **default**.

### Database adapters (SQLite + Firebase)

Scope DB: **SQLite** (lokal) dan **Firebase** (cloud) saja.  
`json` tetap ada sebagai default ringan (file di `data/`).

| Adapter | Kapan dipakai | Storage |
| ------- | ------------- | ------- |
| `json` | File ringan (opsional) | `data/tokens.json`, `data/chat.json` |
| `sqlite` | **Default** — persist lokal | `data/nxsocket.sqlite` |
| `firebase` | Cloud sync | Firestore collections `nxsocket_tokens`, `nxsocket_chat` |

```bash
# Default sudah SQLite
nxsocket server

# Opsional ganti adapter
nxsocket server --adapter json
nxsocket server --adapter firebase --firebase-credentials .\serviceAccount.json
nxsocket gateway info
```

PowerShell:

```powershell
nxsocket server
```

```powershell
$env:NXSOCKET_ADAPTER = "firebase"
$env:NXSOCKET_FIREBASE_CREDENTIALS = "D:\path\serviceAccount.json"
nxsocket server
```

### Perintah CLI yang perlu diingat

```bash
# Umum
nxsocket --help
nxsocket --version

# Server
nxsocket server
nxsocket server --port 7080 --host 0.0.0.0

# Gateway info (endpoint + token)
nxsocket gateway info
nxsocket gateway info --port 7080

# QR token saja
nxsocket gateway qr

# Token
nxsocket gateway token create
nxsocket gateway token create --label aplikasi-a
nxsocket gateway token list
nxsocket gateway token list --all
nxsocket gateway token regenerate <token-id>
nxsocket gateway token revoke <token-id>
```

### Install / update CLI global (dev)

```bash
cd D:\Framework\CLI\NxSocket
npm install
npm run build
npm link
```

Setelah ubah kode: `npm run build` lagi (link tetap memakai `dist/`).

Lepas link:

```bash
npm unlink -g nxsocket
```

### Build binary (Windows .exe & Linux)

Hasilkan **executable standalone** (tanpa perlu Node.js terpasang) untuk Windows dan Linux:

```bash
npm run build:bin
```

Output di folder `release/`:

```text
release/nxsocket-win-x64.exe   ← Windows (x64)
release/nxsocket-linux-x64     ← Linux (x64, ELF)
```

Bisa juga per-OS: `npm run build:bin:win` / `npm run build:bin:linux`.

- Dibuat dengan [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) (devDependency), target Node 22 — bisa
  cross-compile dari Windows.
- Binary **tidak menyertakan berkas demo** (`public/*.html`), jadi route `/v1/demo*` mengembalikan 404;
  modul inti (gateway, server, WebSocket) tetap berjalan normal.
- Unduh binary rilis: <https://github.com/nxcodeobject/nxsocket/releases>

#### Pakai binary (pengguna)

Binary **standalone** — tidak perlu `npm install`, `npm run build`, `npm link`, maupun Node.js terpasang:

```bash
# Windows
nxsocket-win-x64.exe gateway info
nxsocket-win-x64.exe server

# Linux
chmod +x nxsocket-linux-x64
./nxsocket-linux-x64 server
```

Konfigurasi `.env`:

- Binary membaca `.env` dari **direktori kerja (cwd)** tempat perintah dijalankan — **bukan** dari folder
  binary. Jalankan dari folder yang berisi `.env`, atau `cd` ke sana dulu.
- Prioritas nilai: **flag CLI** (`--port`, `--data-dir`, …) → **environment OS** → **`.env`** → **default**.
  Variabel environment yang sudah ada **tidak** ditimpa oleh `.env`.
- `.env` **opsional** — tanpa itu server tetap jalan (default: port `7080`, host `0.0.0.0`, path `/v1`,
  adapter SQLite, folder `data/` mengikuti cwd). `.env` hanya untuk fitur opsional (HTTPS, AI, TURN/ICE,
  LiveKit, OTP, Firebase, VAPID/Web Push).
- `.env.example` **tidak** ikut di dalam binary — salin dari repo proyek lalu sesuaikan.

```bash
# contoh (Linux): jalankan dari folder yang berisi .env
cd /opt/nxsocket
cp /path/ke/repo/.env.example .env   # lalu edit seperlunya
./nxsocket-linux-x64 server
```

Catatan: file Windows belum ditandatangani (unsigned) → mungkin muncul peringatan SmartScreen
("More info → Run anyway"); prompt firewall bisa muncul saat pertama menjalankan `server`.

### HTTP endpoints gateway

| Method | Path | Fungsi |
| ------ | ---- | ------ |
| GET | `/v1` | Info gateway (JSON) |
| GET | `/v1/health` | Health + jumlah koneksi |
| WS | `/v1/ws` | WebSocket (wajib token) |
| GET | `/v1/qr` | Halaman QR token |
| GET | `/v1/qr.json` | Info token + link demo (JSON) |
| POST | `/v1/otp/request` | Minta kode OTP |
| POST | `/v1/otp/verify` | Verifikasi kode OTP |
| GET | `/v1/otp/status` | Status klaim OTP |
| * | `/v1/media` | Upload/ambil attachment file |

### Client (singkat)

```ts
import { NxSocketClient } from "nxsocket";

const client = new NxSocketClient({
  url: "http://127.0.0.1:7080/v1",
  token: "<gateway-token>",
  reconnect: true,
});

client.on("welcome", (sessionId) => {
  client.join("lobby");
  client.broadcast("lobby", "chat", { text: "halo" });
});

client.connect();
```

### Troubleshooting

| Masalah | Penyebab / solusi |
| ------- | ----------------- |
| `EADDRINUSE ... 7080` | Port masih dipakai. Matikan proses lama atau ganti `--port` |
| `401` saat connect | Token salah / sudah di-regenerate / di-revoke |
| Token beda tiap folder | `data/` mengikuti **cwd**. Samakan `--data-dir` atau jalankan dari folder proyek yang sama |
| `nxsocket` tidak ketemu | Jalankan lagi `npm link` dari folder proyek |
| Ubah kode tidak terasa | Lupa `npm run build` setelah edit |

Bebaskan port 7080 (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 7080 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

### Smoke test

```bash
# Terminal 1
nxsocket server

# Terminal 2 (dari folder proyek)
npm run test:smoke
npm run test:regenerate
npm run example:basic
```

## Use case

| Fungsi | Contoh | Status |
| ------ | ------ | ------ |
| Chat realtime | Pesan masuk langsung tanpa refresh | ✅ Ada |
| Notifikasi realtime | "Ada pesan baru", "Pesanan masuk" | ✅ Ada |
| Tracking realtime | Posisi kendaraan/petugas bergerak | ✅ Ada (demo6) |
| Dashboard realtime | Jumlah koneksi / room (monitoring dasar) | ✅ Ada (dasar) |
| Status online/offline | Mengetahui user sedang online | ✅ Ada |
| Typing indicator | "Iyan sedang mengetik..." | ✅ Ada |
| Signaling WebRTC | Offer / answer / ICE relay | ✅ Ada |
| Kontrol video | Video call WebRTC (demo3) | ✅ Ada |
| Remote terminal | Kirim perintah dan terima output | ✅ Ada (demo5 Remote AI Control) |
| AI streaming | Token/chunk dikirim bertahap | ✅ Ada (demo4 + OpenAI-compatible) |
| Monitoring server | Koneksi, room, CPU load, RAM, uptime | ✅ Ada |
| Progress upload | Status proses secara realtime | ✅ Ada (demo7) |
| Job/proses background | Server beri tahu proses selesai | ✅ Ada (demo7) |
| Sinkronisasi data generik | Perubahan data ke semua client | ✅ Ada (demo7) |
| Group video call | Panggilan video multi-peer (mesh) | ✅ Ada (demo8) |
| Meeting | Meeting room mesh WebRTC | ✅ Ada (demo9) |
| SFU meeting | Meeting skala besar via LiveKit | ✅ Ada (demo10) |
| Social feed | Post, like, comment | ✅ Ada (demo11) |
| Groups & DM | Grup chat + pesan pribadi | ✅ Ada (demo12) |
| OTP | Kirim & verifikasi kode OTP | ✅ Ada (`/v1/otp`) |
| Web push | Notifikasi panggilan saat tab tertutup | ✅ Ada (VAPID) |
| IoT | Sensor mengirim data realtime | ❌ Belum (bisa pakai tracking kasar) |

Keterangan: ✅ siap dipakai · 🟡 sebagian · ❌ backlog

## Struktur komponen

```text
NxSocket
│
├── Core
│   ├── Connection
│   ├── Authentication (gateway token)
│   ├── Session
│   ├── Reconnect
│   └── Heartbeat
│
├── Modules
│   ├── Chat         ← DONE (read receipt: sent/delivered/read)
│   ├── Notification ← DONE
│   ├── Presence     ← DONE
│   ├── Terminal     ← DONE
│   ├── AI           ← DONE
│   ├── WebRTC       ← DONE (1:1 call/video)
│   ├── Meeting      ← DONE (mesh multi-peer, demo8/9)
│   ├── SFU LiveKit  ← DONE (demo10, meeting skala besar)
│   ├── Tracking     ← DONE
│   ├── Monitoring   ← DONE
│   ├── Progress     ← DONE
│   ├── Job          ← DONE
│   ├── Sync         ← DONE
│   ├── Feed         ← DONE (social feed, demo11)
│   ├── Groups       ← DONE (grup chat & DM, demo12)
│   ├── Media        ← DONE (upload/attachment file)
│   ├── Blocks       ← DONE (block/unblock nomor)
│   ├── Profile      ← DONE (profil per token/nomor)
│   ├── OTP          ← DONE (kirim & verifikasi kode, `/v1/otp`)
│   ├── Web Push     ← DONE (VAPID — notif saat tab tertutup)
│   └── FCM          ← DONE (push notification mobile)
│
└── Adapters         ← SQLite + Firebase saja
    ├── SQLite       # lokal / file DB
    └── Firebase     # cloud
```

| Lapisan | Peran |
| ------- | ----- |
| **Core** | Fondasi koneksi: lifecycle, auth, session, reconnect, heartbeat |
| **Modules** | Fitur bisnis realtime di atas core |
| **Adapters** | Integrasi penyimpanan / pub-sub / layanan eksternal |

## Deployment & TLS

NxSocket Gateway biasanya duduk di belakang reverse proxy (Nginx, Caddy, Cloudflare).

### Akses dari luar rumah (VPN / Tunnel) — Cloudflare Quick Tunnel

Tunnel meneruskan **seluruh gateway** ke HP (bukan hanya satu demo): WebSocket `/v1/ws` + semua halaman `/v1/demo` … `/v1/demo7`.

1. Di PC: jalankan server **HTTP lokal** (TLS diganti Cloudflare):

```powershell
nxsocket server --adapter sqlite
```

2. Terminal kedua: tunnel

```powershell
npm run tunnel
```

3. Salin URL `https://….trycloudflare.com` → di HP (Wi‑Fi mana saja / data) buka path yang sama seperti lokal:

```text
https://….trycloudflare.com/v1/demo5   ← Remote AI Control
https://….trycloudflare.com/v1/demo    ← Chat
https://….trycloudflare.com/v1/demo3   ← Video (mic/kamera OK karena HTTPS publik)
```

Tempel **token** dari banner server. Client otomatis pakai `wss://` ke host yang sama.

Satu Wi‑Fi rumah (tanpa tunnel): tetap `https://192.168.x.x:7080/v1/…` dengan `nxsocket server --https`.

Catatan: URL quick tunnel **berubah tiap restart** (hostname lama seperti `recreation-procedures-…` tidak bisa dipakai lagi). URL aktif sementara ada di `data/current-tunnel-url.txt` setelah `npm run tunnel`.

### Domain tetap (punya akun Cloudflare)

Materi lengkap (Quick + Named, checklist beli domain): [`docs/cloudflare-tunnel.md`](./docs/cloudflare-tunnel.md).

Kalau domain sudah di Cloudflare (DNS nameserver Cloudflare):

**Setup sekali** (ganti hostname Anda):

```powershell
# Pastikan nxsocket server belum wajib jalan saat setup DNS
powershell -File scripts\tunnel-named-setup.ps1 -Hostname nxsocket.domainanda.com
```

Skrip akan: login browser → buat tunnel `nxsocket` → pasang DNS CNAME → tulis `%USERPROFILE%\.cloudflared\config.yml`.

**Tiap hari:**

```powershell
# Terminal A
nxsocket server

# Terminal B
npm run tunnel:named
```

HP (selamanya hostname sama):

```text
https://nxsocket.domainanda.com/v1/demo5
```

Tidak punya domain? Beli domain → add site di Cloudflare Dashboard → ubah nameserver di registrar → tunggu aktif → jalankan setup di atas.

Alternatif: **Tailscale** (VPN mesh, install di PC + HP) atau **ngrok** `http 7080`.

### Reverse proxy (produksi)

Rekomendasi:

1. Proxy `wss://your.domain/v1/ws` → `http://127.0.0.1:7080/v1/ws`
2. TLS dihentikan di proxy (Let's Encrypt)
3. Jangan expose port Node langsung ke internet tanpa firewall
4. Pakai SQLite (default) atau firebase + backup `data/`
5. Rotasi token dengan `nxsocket gateway token regenerate <id>`
6. Rate limit default: 60 pesan / 10 detik per koneksi (`NXSOCKET_RATE_LIMIT_*`)

Contoh Caddy singkat:

```text
your.domain {
  reverse_proxy /v1/* 127.0.0.1:7080
}
```

## Protocol & Client API

- Protocol event: [`PROTOCOL.md`](./PROTOCOL.md)
- Client: `import { NxSocketClient } from "nxsocket"`
- Method utama: `connect`, `identify`, `join`, `chat`, `notify`, `subscribePresence`, `subscribeTracking`, `startAi`, `exec`, `webrtcSignal`

## Rencana kerja

Pengembangan dan evaluasi bertahap didokumentasikan di [`Plan.md`](./Plan.md).

Urutan singkat:

1. Fondasi CLI & struktur proyek
2. Core WebSocket server
3. Gateway token, auth, session, room
4. Client module
5. MVP modules (Presence, Chat, Notification, Monitoring)
6. Adapters data
7. Modules lanjutan
8. Produksi & DX

## Status

Fase 0–7 selesai (siap evaluasi produksi/DX).  
Checklist rilis: [`RELEASE.md`](./RELEASE.md).

## Struktur repo

```text
src/
├── cli/          # Perintah nxsocket
├── server/       # Endpoint Gateway + WebSocket core
│   └── core/     # Connection, heartbeat, room
├── client/       # Library client
└── shared/       # Config, types, token store
examples/
scripts/
data/             # Token store lokal (gitignore)
```
