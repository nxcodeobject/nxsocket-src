# NxSocket — Rencana Kerja Bertahap

Dokumen ini dipakai untuk evaluasi progress per fase.  
Setiap fase punya **tujuan**, **deliverable**, **kriteria selesai (DoD)**, dan **checkpoint evaluasi**.  
Fase berikutnya baru dimulai setelah checkpoint fase sebelumnya lulus.

Referensi arsitektur: `README.md`

---

## Prinsip evaluasi

1. Selesai = memenuhi DoD, bukan “sudah mulai dikerjakan”.
2. Tiap fase harus punya demo singkat yang bisa dijalankan.
3. Fitur lanjutan tidak boleh mengikat core yang belum stabil.
4. Setelah setiap fase: review singkat → accept / revisi → baru lanjut.

Status fase: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## Ringkasan fase

| Fase | Nama | Status | Estimasi kasar |
|------|------|--------|----------------|
| 0 | Fondasi proyek | DONE | 1–2 hari |
| 1 | Core WebSocket server | DONE | 2–4 hari |
| 2 | Gateway token, auth, session, room | DONE | 2–4 hari |
| 3 | Client module | DONE | 2–3 hari |
| 4 | MVP modules (Presence, Chat, Notification, Monitoring) | DONE | 4–6 hari |
| 5 | Adapters data (SQLite + Firebase) | DONE | 3–5 hari |
| 6 | Modules lanjutan | DONE | 5–8 hari |
| 7 | Produksi & DX | DONE | 3–5 hari |

---

## Fase 0 — Fondasi proyek

**Tujuan:** Repo siap dikembangkan, CLI bisa dipanggil, struktur jelas.

### Pekerjaan
- [x] Inisialisasi package (TypeScript, script build/dev/test)
- [x] Struktur folder: `src/cli/`, `src/server/`, `src/client/`, `src/shared/`
- [x] CLI skeleton: perintah `nxsocket server`
- [x] Config dasar (port, host, env / file config)
- [x] README singkat cara install & jalankan (dev)

### Deliverable
- Perintah `nxsocket server` muncul (boleh masih stub)
- Struktur monorepo/package yang konsisten

### DoD / Checkpoint evaluasi
- [x] `nxsocket --help` atau `nxsocket server --help` berjalan
- [x] Project build tanpa error
- [x] Struktur folder sesuai kesepakatan README (Core / Modules / Adapters nanti diisi)

**Demo evaluasi:** jalankan CLI help + tampilkan tree folder.

**Status: DONE**

---

## Fase 1 — Core WebSocket server

**Tujuan:** Server WebSocket stabil untuk connect, heartbeat, session dasar.

### Pekerjaan
- [x] Server Node.js WebSocket listen di port config
- [x] **Connection** lifecycle: connect / disconnect
- [x] **Heartbeat** + timeout disconnect
- [x] **Session** sederhana (session id, metadata minimal)
- [x] Logging koneksi & error dasar
- [x] Smoke test internal (connect → heartbeat → disconnect)

### Deliverable
- Server bisa dijalankan via `nxsocket server`
- Client sederhana (script test) bisa connect

### DoD / Checkpoint evaluasi
- [x] Client connect sukses
- [x] Heartbeat menjaga koneksi / putus jika timeout
- [x] Disconnect membersihkan session
- [x] Tidak ada crash pada connect/disconnect berulang

**Demo evaluasi:** `npm run test:smoke`

**Status: DONE**

---

## Fase 2 — Gateway token, auth, session, room

**Tujuan:** Akses lewat Endpoint Gateway dengan token; session bisa di-resume; komunikasi berbasis room/channel.

### Pekerjaan
- [x] Endpoint Gateway sebagai entry point publik (contoh base: `http://host:7080/v1`)
- [x] **Gateway token**: create, list, regenerate, revoke (via CLI)
- [x] Client wajib kirim token saat connect; token invalid ditolak
- [x] **Regenerate token** → token lama langsung invalid
- [x] Session persistence singkat + **Reconnect** / resume (resume ack awal; reconnect di client)
- [x] Room/channel: `join`, `leave`, `broadcast` ke room
- [x] Event protocol dasar (nama event + payload JSON)

### Deliverable
- CLI menampilkan endpoint (lokal/jaringan) + token untuk dipakai client
- Auth/token wajib sebelum akses room
- Broadcast ke anggota room saja

### DoD / Checkpoint evaluasi
- [x] Tanpa token / token invalid → ditolak
- [x] Token valid → masuk + dapat session id
- [x] `regenerate` membuat token lama gagal connect; token baru sukses
- [x] Reconnect dengan session lama berhasil (atau aturan gagal yang jelas)
- [x] Client A & B di room yang sama saling terima broadcast; C di luar tidak

**Demo evaluasi:** `nxsocket gateway info` + `npx tsx scripts/smoke-regenerate.ts` + `npx tsx examples/basic.ts`

**Status: DONE** (resume session penuh bisa diperketat di fase berikutnya)

---

## Fase 3 — Client module

**Tujuan:** Library/module client resmi, API rapi untuk dipakai aplikasi lain.

### Pekerjaan
- [x] Package client (Node; browser opsional jika diperlukan)
- [x] API: `connect`, `auth`, `emit`/`send`, `on`, `join`, `leave`, reconnect otomatis
- [x] Type/shared contract selaras server
- [x] Contoh minimal (`examples/basic`)

### Deliverable
- Client module bisa di-import dari package
- Contoh jalan end-to-end dengan server

### DoD / Checkpoint evaluasi
- [x] Contoh `examples/basic` connect → join → kirim/terima event
- [x] Reconnect client bekerja tanpa restart manual
- [x] API terdokumentasi singkat (JSDoc atau README section)

**Demo evaluasi:** `npx tsx examples/basic.ts`

**Status: DONE**

---

## Fase 4 — MVP modules

**Tujuan:** Fitur realtime paling sering dipakai, di atas core yang sudah stabil.

Urutan wajib (evaluasi per sub-fase):

### 4.1 Presence
- [x] Online / offline
- [x] Subscribe presence user/room

**Checkpoint 4.1:** user connect → status online; disconnect → offline terlihat client lain.

### 4.2 Chat
- [x] Kirim/terima pesan room atau DM sederhana
- [x] Typing indicator

**Checkpoint 4.2:** chat 2 user + typing indicator muncul/hilang.

### 4.3 Notification
- [x] Event notifikasi ke user/room
- [x] Payload standar (title, body, data)

**Checkpoint 4.3:** server/trigger kirim notifikasi → client terima realtime.

### 4.4 Monitoring (dasar)
- [x] Metrik: jumlah koneksi aktif, room aktif
- [x] Event/stream status server sederhana

**Checkpoint 4.4:** dashboard/script lihat jumlah koneksi berubah saat client masuk/keluar.

### DoD fase 4 (keseluruhan)
- [x] Keempat sub-modul di atas lulus checkpoint
- [x] Modul tidak merusak core (auth/room/heartbeat tetap jalan)
- [x] Event naming konsisten (`presence:*`, `chat:*`, `notification:*`, `monitoring:*`)

**Demo evaluasi:** `npm run test:fase4` / `npm run example:fase4`

**Status: DONE**

---

## Fase 5 — Adapters data (SQLite + Firebase)

**Tujuan:** Persistensi lewat adapter, tanpa mengikat modul ke satu DB.  
Database yang dipakai: **SQLite** (lokal) dan **Firebase** (cloud) saja.

### Pekerjaan
- [x] Interface adapter generik
- [x] **SQLite** — persist token, riwayat chat
- [x] **Firebase** — persist / sync cloud (Firestore)
- [x] Config memilih adapter aktif (`json` default / `sqlite` / `firebase`)
- [x] Hapus Redis / PostgreSQL / MySQL dari scope (tidak dipakai)

### Deliverable
- Server bisa jalan dengan in-memory/json (default), SQLite, atau Firebase
- Modul presence/chat memakai adapter tanpa ubah API publik client

### DoD / Checkpoint evaluasi
- [x] Switch adapter via config / CLI `--adapter`
- [x] Token & chat tersimpan di SQLite dan bisa dibaca ulang setelah restart
- [x] Firebase: connect dengan credentials; gagal → error jelas (fail-fast)
- [x] Gagal buka DB ditangani jelas (log + fail-fast)

**Demo evaluasi:** `npx tsx scripts/smoke-sqlite.ts` / `nxsocket server --adapter sqlite`

**Status: DONE**

---

## Fase 6 — Modules lanjutan

**Tujuan:** Fitur spesialis setelah MVP dan adapter siap.

Evaluasi per modul (boleh parallel jika resource cukup):

### 6.1 Tracking
- [x] Update posisi realtime
- [x] Subscribe tracking entity/room

**Checkpoint:** posisi bergerak terlihat di client subscriber.

### 6.2 AI streaming
- [x] Stream token/chunk ke client
- [x] Start / cancel stream

**Checkpoint:** client menerima chunk berurutan hingga selesai.

### 6.3 Remote Terminal
- [x] Kirim command
- [x] Stream stdout/stderr
- [x] Batasan keamanan dasar (auth + allowlist / sandbox policy)

**Checkpoint:** command dijalankan, output realtime; unauthorized ditolak.

### 6.4 WebRTC signaling
- [x] Room signaling
- [x] Offer / answer / ICE candidate relay

**Checkpoint:** 2 peer saling tukar signaling via server (media peer-to-peer di luar scope server).

### DoD fase 6
- [x] Modul yang diklaim “done” punya example + checkpoint lulus
- [x] Modul opsional yang belum dikerjakan ditandai TODO (jangan half-done di docs)

**Demo evaluasi:** `npm run test:fase6` / `npm run example:fase6`

**Status: DONE**

---

## Fase 7 — Produksi & DX

**Tujuan:** Siap dipakai orang lain dengan aman dan terdokumentasi.

### Pekerjaan
- [x] Dokumentasi CLI + protocol event + client API
- [x] Example per use-case utama (`hello-chat`, fase4, fase6)
- [x] Hardening: rate limit + catatan TLS / deployment
- [x] Versioning & changelog (`0.2.0`)
- [x] Test suite inti (`npm test` → test-all)

### DoD / Checkpoint evaluasi
- [x] Contributor baru bisa ikut README dalam <15 menit sampai “hello chat”
- [x] Tidak ada secret di repo (`.env.example` saja)
- [x] Release checklist terisi (`RELEASE.md`)

**Demo evaluasi:** `npm run build` → `npm link` → `nxsocket server --adapter sqlite` → `npm run example:hello`

**Status: DONE**

---

## Backlog (di luar fase aktif)

Catatan fitur dari README yang belum diprioritaskan eksplisit:

- ~~Progress upload~~ ✅
- ~~Job/proses background completion events~~ ✅
- ~~Sinkronisasi data generik~~ ✅
- IoT sensor ingest
- Kontrol video di atas WebRTC signaling
- **Klien mobile Remora (UI → wire NxSocket)** — survey & fase kerja ada di  
  `D:\Framework\Development\React\Remora\Plan.md`  
  (matriks komunikasi: chat / telepon / video / group; server fase 0–7 dianggap baseline DONE)

Masukkan ke fase baru hanya jika ada kebutuhan nyata.

---

## Template evaluasi per fase

Salin blok ini saat review:

```text
Fase: _
Tanggal review: _
Status: TODO / IN PROGRESS / DONE / BLOCKED
DoD lulus: ya / tidak
Catatan:
- ...
Keputusan: lanjut / revisi dulu
Assignee / next action: _
```

---

## Urutan kerja yang disarankan minggu ini

1. ~~Selesaikan **Fase 0** sampai CLI help + struktur folder.~~
2. ~~Kerjakan **Fase 1** sampai demo connect/heartbeat.~~
3. ~~Fase 2–3 (gateway token + client).~~
4. Lanjut **Fase 4.1 Presence** → evaluasi → **4.2 Chat**.
5. ~~Fase 4 MVP modules.~~
6. ~~Fase 5 — Adapters (SQLite + Firebase).~~
7. ~~Fase 6 — Modules lanjutan.~~
8. ~~Fase 7 — Produksi & DX.~~
9. Semua fase plan selesai. Kerjakan backlog hanya jika dibutuhkan.

