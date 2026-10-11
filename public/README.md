# Browser demos

| Path | Modul | Status |
|------|--------|--------|
| `/v1/demo` | Chat + presence | ✅ |
| `/v1/demo2` | Voice (+ grup mesh) | ✅ |
| `/v1/demo3` | Video 1:1 | ✅ |
| `/v1/demo4` | AI streaming | ✅ |
| `/v1/demo5` | Remote AI Control | ✅ |
| `/v1/demo6` | Tracking | ✅ |
| `/v1/demo7` | Progress / Job / Sync | ✅ |
| `/v1/demo8` | Group video mesh | ✅ |
| `/v1/demo9` | Meeting mesh (Level Zoom UX) | ✅ |
| `/v1/demo10` | **SFU Meeting (LiveKit)** | ✅ SUDAH DIEKSEKUSI |
| `/v1/demo11` | **Social feed** (+ like/foto/notif + follow/hapus/share) | ✅ + Batch 3 |
| `/v1/demo12` | **Chat grup + DM** (ala WhatsApp) | ✅ SUDAH DIEKSEKUSI |
| `/v1/qr` | **QR + token** (HTML gambar QR; API `/v1/qr.json`) | ✅ SUDAH DIEKSEKUSI |
| `/v1/otp` | **OTP** (request/verify HP — siap Remora) | ✅ SUDAH DIEKSEKUSI |

## Rencana `/v1/otp` — OTP nomor HP (fondasi Remora)

**Masalah:** Remora `register.js` butuh verifikasi nomor (OTP) sebelum/bersamaan ambil gateway token. Belum ada di NxSocket.

**Keputusan (fondasi dulu, SMS provider nanti):**
- Modul `OtpModule` → `data/otp.json`.
- HTTP: `POST /otp/request`, `POST /otp/verify`, `GET /otp/status`; demo `/otp`.
- Normalisasi `08…` → `62…`. Mode dev `debugCode` (default ON).
- Docs: [`docs/otp.md`](../docs/otp.md). Remora **belum** diubah.

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana `/v1/qr` — Token via halaman QR

**Masalah:** Token hanya di terminal / CLI QR; user HP sulit dapat token tanpa mengetik manual.

**Keputusan:**
- Server **hanya** API JSON `GET /v1/qr.json` → `{ token, base, pages, … }` (tidak generate gambar QR).
- HTML `GET /v1/qr` fetch API lalu **gambar QR di browser** (CDN `qrcode`).
- Query `?page=demo12` → QR berisi URL demo+token.
- Sama seperti QR terminal: token default gateway (LAN demo).

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana demo12 — Chat grup bernama + DM

**Masalah:** Chat sekarang hanya room generik (`/v1/demo`). Belum ada grup bernama, kode invite, daftar member, leave/kick, dan UI DM seperti WhatsApp.

**Keputusan:**
- Modul `GroupsModule` → `data/groups.json` (id, name, invite code, members keyed `tokenId|nama`).
- Channel chat: room WS `g:{groupId}` + riwayat lewat `ChatModule`/SQLite yang sudah ada.
- DM: room `dm:{namaA}|{namaB}` (nama di-sort), join otomatis saat buka chat; daftar peer dari presence online.
- Protokol: `group.create/join/leave/kick/sync` + `group.dm` + pakai `chat.send` / `chat.getHistory`.
- UI baru `public/demo12.html` (daftar chat + percakapan); demo lama tidak diubah.

**File:** `groups.ts`, `types.ts`, `index.ts`, `demo12.html`, README. ✅

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana demo11 Batch 3 — Follow · hapus · share

**Masalah:** Belum bisa follow penulis, hapus status sendiri, atau bagikan (share) status orang lain.

**Keputusan:**
- **Hapus:** `feed.delete` hanya penulis (`post.from === session`); broadcast `feed.post.deleted`.
- **Share:** `feed.share` buat post baru dengan `shared` (kutipan post asli) + komentar opsional; muncul di feed seperti quote-share.
- **Follow:** simpan di `feed.json` keyed `tokenId|nama` → daftar `{from,name}`; cocokkan penulis post by session **atau** nama (aman untuk 1 token multi-HP). `feed.follow` toggle → `feed.follows`; notif `feed.notify` kind `post` ke follower saat ada status baru.
- UI: tombol Follow / Share / Hapus di tiap post.

**File:** `feed.ts`, `types.ts`, `index.ts`, `demo11.html`, README.

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana demo11 Batch 2 — Like · foto · notifikasi

**Masalah:** Feed MVP belum punya like, lampiran foto, atau notifikasi saat ada komentar di status sendiri.

**Keputusan:**
- `likes[]` per post (`from` + `name`), toggle via `feed.like` → `feed.like.updated`.
- Foto opsional: data URL (JPEG/PNG/WebP) max ~280KB; client resize canvas sebelum kirim. Post boleh teks saja, foto saja, atau keduanya.
- Notifikasi: `feed.notify` ke penulis post (dan penulis komentar induk saat balas) via `sendToSession`; UI toast + Notification API jika tab hidden.
- Persist tetap `data/feed.json`.

**File:** `feed.ts`, `types.ts`, `index.ts`, `demo11.html`, README ini.

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana demo11 — Social feed

**Masalah:** Belum ada demo status/post seperti Facebook: tulis status, komentar, balasan (sub-komentar), realtime antar perangkat.

**Keputusan desain:**
- Modul server `FeedModule` (`src/server/modules/feed.ts`), persist `data/feed.json` (pola sama profile).
- Scope auth: pakai `chat` (token existing tetap jalan; tanpa scope baru).
- Room default demo: `social`.
- Model: post → komentar (`parentId: null`) → balasan (`parentId` = id komentar top-level). Max 2 level (tidak nested lebih dalam).
- Protokol: `feed.join` / `feed.post` / `feed.comment` → `feed.snapshot` / `feed.post.created` / `feed.comment.created`.
- UI: `public/demo10.html` tidak diubah; file baru `public/demo11.html` (feed mobile-style).

**Perubahan file:**
- `public/README.md` (rencana ini) ✅
- `src/server/modules/feed.ts` (baru) ✅
- `src/shared/types.ts` (tipe pesan) ✅
- `src/server/index.ts` (route + handler) ✅
- `public/demo11.html` (baru) ✅

**Status:** ✅ SUDAH DIEKSEKUSI

## Rencana demo10 — SFU

**Masalah:** Mesh max ~4; butuh SFU untuk meeting lebih besar.

**Keputusan:** LiveKit terpisah; NxSocket = token + UI. Dependency `livekit-server-sdk`. Client CDN. Docs [`docs/sfu-livekit.md`](../docs/sfu-livekit.md).

**Status:** ✅ SUDAH DIEKSEKUSI

## Setup singkat demo10 (tanpa Docker)

```powershell
npm run livekit:dev          # unduh + jalanin binary Windows
# .env sudah: NXSOCKET_LIVEKIT_* = devkey/secret
npm run build
nxsocket server --https
# buka /v1/demo10
```

Docs: [`docs/sfu-livekit.md`](../docs/sfu-livekit.md) — alternatif: binary, Docker, Cloud, catatan Teritip.

## Akses luar LAN

[`docs/cloudflare-tunnel.md`](../docs/cloudflare-tunnel.md)
