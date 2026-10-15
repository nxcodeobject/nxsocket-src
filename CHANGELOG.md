# Changelog

## 0.3.0 — 2026-10-15

### Added
- Group video call mesh (demo8), meeting mesh (demo9), SFU meeting via LiveKit (demo10)
- Social feed: post/like/comment (demo11)
- Groups & DM: grup chat + pesan pribadi (demo12)
- OTP: request/verify/status kode (`/v1/otp`, `/v1/otp/request`, `/v1/otp/verify`, `/v1/otp/status`)
- Media module: upload/ambil attachment file (`/v1/media`)
- Block/unblock nomor (module `blocks`)
- Profile module: profil per token/nomor
- Web Push (VAPID) untuk notifikasi panggilan saat tab tertutup
- FCM (Firebase Cloud Messaging) untuk push notification mobile
- Chat read receipt: status `sent` → `delivered` → `read` per pesan
- Build binary standalone: `npm run build:bin` → Windows `.exe` + Linux (via `@yao-pkg/pkg`, demo HTML tidak disertakan)

## 0.2.0 — 2026-09-09

### Added
- MVP modules: presence, chat, notification, monitoring
- Advanced modules: tracking, AI streaming (OpenAI-compatible + demo), remote terminal (allowlist), WebRTC signaling
- Backlog modules: progress, job, sync
- Session resume (reconnect + room restore) + room ACL per token
- Token expiry & scopes; HTTPS self-signed; QR token / network URL
- Data adapters: `json`, `sqlite` (default), `firebase`
- Gateway token CLI: create / list / regenerate / revoke (`--expires`, `--scope`, `--rooms`)
- Rate limiting per koneksi
- GitHub Actions CI (`build` + `test`)
- Docs: PROTOCOL.md, .env.example, hello-chat / backlog examples

### Changed
- Default port **7080** (sebelumnya 3080)

## 0.1.0 — 2026-09-09

### Added
- CLI `nxsocket server` + Endpoint Gateway
- Core: connection, session, heartbeat, room
- Client module Node.js
