# NxSocket Protocol

Semua pesan WebSocket adalah JSON. Client → server memakai `ClientMessage`, server → client memakai `ServerMessage`.

## Koneksi

1. Connect ke `ws://host:7080/v1/ws`
2. Kirim token:
   - Header `Authorization: Bearer <token>`, atau
   - Header `X-NxSocket-Token: <token>`, atau
   - Query `?token=<token>`
3. Server membalas `welcome` berisi `sessionId`
4. Setelah disconnect singkat (≤5 menit), client bisa kirim `resume` + `sessionId` lama → server membalas `resumed` dan mengembalikan room membership (token harus sama)

## Core

| Client | Server |
| ------ | ------ |
| `ping` | `pong` |
| `identify` | `identified` |
| `join` / `leave` | `joined` / `left` |
| `broadcast` | `event` |
| `resume` | `resumed` |

`join` bisa ditolak dengan `room_forbidden` jika token punya ACL room (`allowedRooms`).

## Modules

| Prefix | Client | Server |
| ------ | ------ | ------ |
| presence | `presence.subscribe`, `presence.unsubscribe` | `presence.update`, `presence.snapshot` |
| chat | `chat.send`, `chat.typing`, `chat.getHistory`, `chat.read` | `chat.message`, `chat.history`, `chat.typing`, `chat.receipt`, `chat.read` |
| notification | `notification.send` | `notification` |
| monitoring | `monitoring.subscribe`, `monitoring.get` | `monitoring.stats` |
| tracking | `tracking.subscribe`, `tracking.update` | `tracking.update`, `tracking.snapshot` |
| ai | `ai.start`, `ai.cancel` | `ai.chunk`, `ai.done` |
| terminal | `terminal.exec`, `terminal.cancel` | `terminal.started`, `terminal.output`, `terminal.exit` |
| webrtc | `webrtc.signal` | `webrtc.signal` |
| progress | `progress.subscribe`, `progress.update`, `progress.done` | `progress.snapshot`, `progress.update`, `progress.done` |
| job | `job.subscribe`, `job.create`, `job.set`, `job.run` | `job.snapshot`, `job.update` |
| sync | `sync.subscribe`, `sync.set`, `sync.delete` | `sync.snapshot`, `sync.update`, `sync.delete` |

## Error

```json
{ "type": "error", "code": "rate_limited", "message": "..." }
```

Kode umum: `bad_json`, `handler_error`, `unknown_type`, `not_in_room`, `rate_limited`, `forbidden`, `room_forbidden`, `resume_failed`.

## HTTP Gateway

| Path | Keterangan |
| ---- | ---------- |
| `GET /v1` | Info gateway |
| `GET /v1/health` | Health check |
| `GET /v1/monitoring` | Snapshot metrik |
| `WS /v1/ws` | WebSocket |
| `POST /v1/media` | Upload media (Bearer token + scope `chat`). Body: raw bytes (`Content-Type` = mime) atau JSON `{ mime, name, data }` (base64 / data-URL). Header opsional `X-NxSocket-Media-Name`. Batas default 12MB; TTL default 7 hari (`NXSOCKET_MEDIA_MAX_BYTES`, `NXSOCKET_MEDIA_TTL_MS`). |
| `GET /v1/media/:id` | Ambil berkas (id acak; cocok untuk `<Image source={{ uri }}>` tanpa header auth) |

## FCM (Android/iOS Remora)

| Client | Server |
| ------ | ------ |
| `fcm.register` `{ token, platform?, phone?, rooms? }` | `fcm.registered` / `fcm.status` |
| `fcm.setRooms` `{ rooms, token? }` | — |
| `fcm.unregister` `{ token }` | `fcm.unregistered` |

Server mengirim FCM pada `chat.send` ke device yang punya room tersebut (kecuali pengirim). Butuh `NXSOCKET_FIREBASE_CREDENTIALS` (service account JSON).
