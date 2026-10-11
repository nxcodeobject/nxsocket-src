# WebRTC ICE / TURN (demo2 & demo3)

Panggilan suara/video butuh **STUN** (cari IP publik) dan sering **TURN** (relay jika peer tidak bisa P2P — beda Wi‑Fi, CGNAT, data seluler).

## Default NxSocket

Tanpa env khusus: hanya **STUN Google**. Cukup untuk banyak kasus **satu Wi‑Fi rumah**.

Server mengirim `ice.config` ke client saat connect. Banner:

```text
WebRTC   : ICE: STUN only (2) — set NXSOCKET_TURN_* untuk beda jaringan
```

## Tambah TURN (disarankan untuk produksi / HP data)

### Opsi B — env sederhana

```env
NXSOCKET_TURN_URLS=turn:YOUR_HOST:3478,turns:YOUR_HOST:5349
NXSOCKET_TURN_USERNAME=youruser
NXSOCKET_TURN_CREDENTIAL=yourpass
```

### Opsi A — JSON penuh

```env
NXSOCKET_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:YOUR_HOST:3478"],"username":"u","credential":"p"}]
```

Sumber TURN umum: [Metered.ca](https://www.metered.ca/tools/openrelay/), Twilio Network Traversal, coturn self-host.

Setelah set env: restart `nxsocket server`, refresh demo2/demo3 — status ICE muncul di UI.

Lihat juga perkuatan komunikasi: [`demo-comms-hardening.md`](./demo-comms-hardening.md).
