# NxSocket — Rencana Cross-Device Communication (PC ↔ Android ↔ perangkat lain)

Dokumen ini **terpisah dari `Plan.md`** (fase inti 0–7, semua DONE) dan dari kebutuhan proyek Remora.
Fitur di sini adalah kapabilitas **generik NxSocket**: pairing, sinkronisasi clipboard/file, dan remote
command antar perangkat (PC, Android, dan perangkat lain) di jaringan yang sama, dibangun di atas core
WebSocket + gateway token yang sudah stabil.

Referensi arsitektur dasar: `README.md`, `Plan.md` (fase 0–7).
Prinsip: **pakai fondasi yang sudah ada** (gateway token, room, `sync.ts`, `media.ts`, `terminal.ts`) —
jangan bangun ulang dari nol apa yang sudah tersedia.

Status fase: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## 0. Audit fondasi yang sudah ada

Sebelum menulis kode baru, catat apa yang sudah bisa dipakai ulang dan apa yang masih kurang.

| Kebutuhan | Modul existing | Cukup? | Gap |
|-----------|----------------|--------|-----|
| Auth & koneksi lintas perangkat | Gateway token (`src/server/core`), room | Ya | — |
| Daftar perangkat online | `presence.ts` | Sebagian | Belum ada identitas perangkat (tipe, nama, kapabilitas) — baru presence user/session generik |
| Sinkron data kecil realtime (clipboard) | `sync.ts` (key-value pub/sub per channel) | Sebagian | Tidak ada limit ukuran/rate-limit; payload besar bisa membebani memori (`Map` in-process) |
| Transfer file | `media.ts` (upload HTTP + TTL + index) | Sebagian | Pull-based (upload → link); belum ada push notify realtime ke device tujuan, belum ada progress/chunking untuk file besar |
| Remote command | `terminal.ts` (`terminal.exec`, allowlist ketat) | Tidak cukup | Allowlist shell command generik, bukan model "device command" terstruktur (misal: kunci layar, buka app, balas notifikasi) |
| Device pairing/discovery | — | Tidak ada | Modul baru sepenuhnya |

**Keputusan desain:** jangan modifikasi `terminal.ts` (allowlist keamanannya sudah disepakati untuk use
case lain / remote AI agent) — buat modul baru `device.ts` untuk command device-to-device dengan model
keamanan berbeda (pairing eksplisit + approval, bukan allowlist command string).

---

## 1. Konsep & model keamanan

### Device identity

Setiap koneksi yang ikut fitur cross-device mendaftarkan **device profile**:

```text
{
  deviceId: string,       // persisten per instalasi (UUID disimpan lokal di client)
  deviceType: "pc" | "android" | "ios" | "web" | "other",
  deviceName: string,     // nama tampilan, mis. "Ian - PC Kerja"
  capabilities: string[], // ["clipboard", "file", "command:lock", "command:notify", ...]
}
```

### Pairing (bukan cuma gateway token)

Gateway token membuktikan *akses ke server* — bukan *kepercayaan antar device*. Dua device dengan token
gateway yang sama (satu akun/organisasi) **belum tentu saling percaya** untuk menerima command/file dari
satu sama lain. Maka pairing adalah lapisan kedua:

```text
1. Device A minta pairing ke Device B (lewat kode pendek 6 digit / QR, mirip Google Pairing)
2. Device B approve/reject secara eksplisit (UI konfirmasi, bukan auto-accept)
3. Setelah approve, server simpan pairing record: {deviceIdA, deviceIdB, pairedAt, scopes}
4. Command/file/clipboard hanya diterima dari device yang sudah di-pairing
   (kecuali scope publik yang sengaja dibuka, mis. "broadcast ke semua device milik akun sendiri")
```

Ini menghindari skenario: token gateway bocor/dipakai bersama → device asing bisa kirim command ke PC
orang lain begitu saja.

### Scope per fitur

Pairing tidak otomatis membuka semua command. Tiap pairing punya `scopes: string[]` (mis. `["clipboard",
"file"]` tanpa `"command"`), device penerima yang menentukan scope apa yang diizinkan saat approve.

---

## 2. Peta fase kerja

| Fase | Nama | Status | Dependensi |
|------|------|--------|------------|
| A | Device identity & registry | TODO | Gateway token (ada) |
| B | Pairing flow | TODO | Fase A |
| C | Clipboard sync realtime | TODO | Fase B, `sync.ts` (extend) |
| D | File transfer push antar device | TODO | Fase B, `media.ts` (extend) |
| E | Remote command device-to-device | TODO | Fase B (bukan `terminal.ts`) |
| F | Client SDK & contoh lintas platform | TODO | Fase C–E |

Urutan wajib: **A → B dulu** (fondasi identitas & kepercayaan), baru C/D/E bisa paralel setelah B selesai
(mereka independen satu sama lain, sama-sama konsumen dari pairing).

---

## Fase A — Device identity & registry

**Tujuan:** Server tahu perangkat apa saja yang online, tipe & kapabilitasnya, tanpa keliru dengan
presence user/session biasa.

### Pekerjaan
- [ ] Modul baru `src/server/modules/device.ts`: registry device per koneksi (deviceId, deviceType, deviceName, capabilities)
- [ ] Event protokol: `device.register`, `device.list`, `device.online`, `device.offline`
- [ ] `deviceId` persisten di client (disimpan lokal — AsyncStorage di Android, file config di PC), **bukan** session id yang berganti tiap reconnect
- [ ] Bind device ke akun/token pemilik (satu akun bisa punya banyak device: PC + Android + laptop)
- [ ] `device.list` hanya menampilkan device milik akun yang sama (bukan seluruh server)

### DoD
- [ ] 2 client (PC + Android) register device, saling terlihat di `device.list` (kalau akun sama)
- [ ] Reconnect tidak membuat entry device baru (dedup by `deviceId`)
- [ ] Device tipe ketiga (web) ikut register tanpa error

**Status: TODO**

---

## Fase B — Pairing flow

**Tujuan:** Kepercayaan eksplisit antar device sebelum command/file/clipboard mengalir.

### Pekerjaan
- [ ] Event: `pairing.request` (deviceId pengirim + target), `pairing.code` (server generate kode 6 digit, TTL 2 menit)
- [ ] Device target terima `pairing.incoming` → UI approve/reject (client-side, di luar scope server)
- [ ] `pairing.approve` / `pairing.reject` dari device target
- [ ] Simpan pairing record persisten: `data/device-pairs.json` (atau adapter yang sudah ada — SQLite/Firebase, ikuti pola `adapters/`)
- [ ] `pairing.revoke` untuk memutus pairing kapan saja dari kedua sisi
- [ ] `pairing.list` — device bisa lihat semua pairing aktifnya

### DoD
- [ ] Device A request pairing ke B via kode → B approve → keduanya lihat status "paired"
- [ ] Kode salah/kedaluwarsa ditolak dengan pesan jelas
- [ ] Revoke dari salah satu sisi memutus pairing utk keduanya
- [ ] Command/file/clipboard (fase C–E) ditolak server-side kalau device pengirim belum di-pairing dengan penerima

**Status: TODO**

---

## Fase C — Clipboard sync realtime

**Tujuan:** Copy di satu device, paste di device lain (paired), realtime.

### Pekerjaan
- [ ] Extend pola `sync.ts` **atau** modul baru `clipboard.ts` (keputusan: modul baru — supaya limit ukuran & rate-limit clipboard tidak mencampuri `sync.ts` generik yang dipakai fitur lain)
- [ ] Event: `clipboard.push` (device asal → device/semua device paired), `clipboard.update` (broadcast ke penerima)
- [ ] Limit ukuran payload clipboard (teks: batas karakter wajar, mis. 64KB; gambar clipboard → lewat jalur file fase D, bukan lewat event ini)
- [ ] Riwayat clipboard singkat opsional (mis. 10 item terakhir per device) — **opsional**, cek kebutuhan sebelum kerjakan
- [ ] Rate-limit push (cegah spam dari client yang salah kode)

### DoD
- [ ] Copy teks di PC (paired dengan Android) → event sampai ke Android dalam <1 detik di LAN
- [ ] Device tidak paired tidak menerima apapun
- [ ] Payload di atas limit ditolak dengan pesan jelas, bukan crash

**Status: TODO**

---

## Fase D — File transfer push antar device

**Tujuan:** Kirim file dari satu device ke device paired lain, dengan notifikasi realtime (bukan cuma
link yang harus di-share manual).

### Pekerjaan
- [ ] Extend `media.ts`: tambah field `targetDeviceId` opsional saat upload
- [ ] Setelah upload sukses, server kirim event `file.incoming` ke device target (paired) — payload: id, nama, ukuran, mime, url download
- [ ] Device target `file.accept` / `file.reject` (opsional — atau auto-download kalau scope pairing mengizinkan, keputusan UX di client)
- [ ] Progress upload/download besar: pertimbangkan chunking kalau file >batas single request wajar (cek limit HTTP body server saat ini)
- [ ] Bersihkan `tokenId`-only ownership di `media.ts` jadi juga terikat `deviceId` pengirim untuk audit

### DoD
- [ ] Kirim file dari PC → Android paired, notifikasi realtime muncul, file ke-download
- [ ] File besar (mendekati `NXSOCKET_MEDIA_MAX_BYTES`) tidak membuat server OOM/hang
- [ ] Device tidak paired tidak bisa jadi target `file.incoming`

**Status: TODO**

---

## Fase E — Remote command device-to-device

**Tujuan:** Command terstruktur antar device dengan scope eksplisit — **bukan** shell arbitrary seperti
`terminal.ts` (yang tetap untuk use case remote AI agent, tidak disentuh).

### Pekerjaan
- [ ] Modul baru `src/server/modules/device-command.ts`
- [ ] Command **terstruktur, bukan string shell bebas** — daftar command tertutup (allowlist by design), contoh awal:
  - `command:lock` — kunci layar device target
  - `command:notify` — tampilkan notifikasi di device target dengan teks tertentu
  - `command:ring` — bunyikan device target (cari HP hilang)
- [ ] Event: `device.command` (pengirim → server → target), `device.command.result` (target → pengirim, hasil eksekusi)
- [ ] Command hanya jalan kalau: (a) device paired, (b) scope pairing mengizinkan `"command"`, (c) command ada di allowlist yang device target dukung (dari `capabilities` fase A)
- [ ] Timeout command (device target offline/tidak respon dalam N detik → `command.timeout`)

### DoD
- [ ] PC kirim `command:lock` ke Android paired dengan scope command → Android eksekusi (native side, di luar server)
- [ ] Command ditolak kalau scope pairing tidak mengizinkan, walau device paired
- [ ] Command ke device yang tidak mendukung capability tsb ditolak sebelum dikirim (bukan gagal diam-diam)

**Status: TODO**

---

## Fase F — Client SDK & contoh lintas platform

**Tujuan:** Developer lain (termasuk proyek future) bisa pakai fitur ini tanpa baca source server.

### Pekerjaan
- [ ] Extend client module (`src/client/`) dengan API: `pairDevice()`, `onPairingRequest()`, `pushClipboard()`, `onClipboard()`, `sendFile()`, `onFileIncoming()`, `sendCommand()`, `onCommand()`
- [ ] Contoh Node/PC (`examples/cross-device-pc.ts`)
- [ ] Contoh browser sederhana (opsional, kalau target termasuk web)
- [ ] Update `PROTOCOL.md` dengan event baru (device.*, pairing.*, clipboard.*, file.incoming, device.command*)
- [ ] Demo publik opsional (`public/demo-crossdevice.html`) mengikuti pola demo lain — **hanya referensi protokol**, bukan wajib

### DoD
- [ ] Contoh PC↔PC (2 proses) pairing → clipboard sync → kirim file → command lock, semua jalan dari CLI/script
- [ ] `PROTOCOL.md` lengkap untuk semua event fase A–E

**Status: TODO**

---

## 3. Yang sengaja di luar cakupan (untuk sekarang)

- **Device discovery tanpa server** (mDNS/Bonjour broadcast LAN langsung antar device tanpa lewat NxSocket) — pairing di plan ini tetap lewat server (lebih sederhana, konsisten dengan arsitektur gateway yang ada). Discovery LAN-native bisa jadi fase lanjutan kalau kebutuhannya "auto-pairing tanpa kode" muncul nyata.
- **Enkripsi end-to-end untuk clipboard/file** (di luar TLS transport) — evaluasi terpisah kalau data sensitif jadi concern; `e2ee` pattern yang dipakai Remora chat bisa jadi referensi kalau diperlukan nanti.
- **Command arbitrary/shell di device-command** — dengan sengaja **tidak** dibuka; hanya command allowlist tertutup, karena target lintas-akun/perangkat asing punya risiko lebih tinggi dari remote AI agent (`terminal.ts`) yang scope-nya server milik sendiri.
- **Mobile-to-mobile tanpa PC** — plan ini tidak melarang, tapi belum ada requirement eksplisit; arsitektur pairing/command sudah device-agnostic jadi otomatis ter-cover kalau muncul kebutuhan.

---

## 4. Urutan kerja disarankan

1. Fase A (device identity) — fondasi wajib, kecil, cepat divalidasi.
2. Fase B (pairing) — blocker untuk semua fase lain, prioritaskan sampai DoD lulus.
3. Fase C dan D bisa paralel (clipboard vs file, tidak saling bergantung) setelah B selesai.
4. Fase E setelah C/D stabil — command adalah fitur paling sensitif (kontrol perangkat), pastikan pairing+scope benar-benar teruji dulu.
5. Fase F terakhir — SDK & dokumentasi setelah protokol stabil, supaya tidak menulis ulang API karena event masih berubah.
