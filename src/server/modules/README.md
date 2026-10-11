# Server modules — catatan fitur

## Chat read receipt (centang 1 / 2)

**Masalah:** Remora butuh status pesan seperti messenger: 1 centang = terkirim/terkirim ke peer, 2 centang = sudah dibaca. Gateway sebelumnya hanya `chat.send` / `chat.message` / `typing` / `history` tanpa `id` di broadcast live dan tanpa status baca.

**Keputusan desain:**
- Status: `sent` → `delivered` → `read`
- Setiap `chat.message` punya `id` + `status`
- Client kirim `chat.read` (room + `messageIds` dan/atau `upToTs`) untuk menandai pesan orang lain sudah dibaca
- Server broadcast `chat.read` ke room; update opsional lewat `chat.receipt` untuk `delivered`
- Persist status di adapter (`status`, `readAt`); SQLite migrate kolom baru

**File:**
- `src/shared/types.ts`
- `src/server/modules/chat.ts`
- `src/server/index.ts` (handler `chat.read`)
- `src/adapters/{types,json,sqlite,firebase}.ts`
- `PROTOCOL.md`

**SUDAH DIEKSEKUSI** ✅ (2026-09-10)
