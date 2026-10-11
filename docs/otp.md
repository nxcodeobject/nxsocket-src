# OTP API (Remora register)

Verifikasi nomor HP. Dua mode:

| Mode | Syarat | Perilaku |
|------|--------|----------|
| **dev (1)** | default / tanpa webhook | Response boleh berisi `debugCode`; Remora isi OTP otomatis dari situ |
| **sms (2)** | `NXSOCKET_OTP_WEBHOOK_URL` di-set | Server POST `{ phone, code, channel:"sms" }` ke webhook; provider kirim SMS |

Matikan leak kode: `NXSOCKET_OTP_DEBUG=0` (tetap boleh kirim SMS lewat webhook).

## Endpoints

| Method | Path | Body / query | Hasil |
|--------|------|--------------|--------|
| `POST` | `/v1/otp/request` | `{ "phone": "08…" }` | `{ ok, phone, expiresInSec, channel, debugCode? }` |
| `POST` | `/v1/otp/verify` | `{ "phone", "code" }` | `{ ok, verified, phone, claimId, claimToken, expiresAt }` |
| `GET` | `/v1/otp/status` | `?phone=08…` | `{ verified, phone, claimId?, expiresAt? }` |
| `GET` | `/v1/otp` | — | Demo UI |

Nomor dinormalisasi ke `62…`.

## Webhook produksi

```http
POST {NXSOCKET_OTP_WEBHOOK_URL}
Content-Type: application/json
X-NxSocket-Otp-Secret: {NXSOCKET_OTP_WEBHOOK_SECRET}   # opsional

{ "phone": "6281234567890", "code": "123456", "channel": "sms" }
```

Isi webhook dengan layanan SMS/WhatsApp kamu (Fonnte, Twilio, dll.).

## Env

| Var | Default | Arti |
|-----|---------|------|
| `NXSOCKET_OTP_DEBUG` | `1` | `1` = log + `debugCode`; `0` = sembunyikan |
| `NXSOCKET_OTP_WEBHOOK_URL` | — | URL kirim SMS |
| `NXSOCKET_OTP_WEBHOOK_SECRET` | — | Header rahasia ke webhook |

## Remora

1. `requestOtp(phone)` → tampilkan input OTP (`debugCode` diisi otomatis jika ada).
2. `verifyOtp(phone, code)` → simpan `claimToken`.
3. `saveRegistration` + `fetchTokenFromGateway`.

Kontak perangkat **bukan** bukti kepemilikan nomor.
