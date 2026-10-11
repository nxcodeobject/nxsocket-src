# Perkuatan demo komunikasi (demo / demo2 / demo3)

**Konteks:** Chat, telepon suara, dan video call akan paling sering dipakai di sistem.

**Status:** ✅ Batch A–H + demo8 + demo9 (Level Zoom UI)

---

## Ringkasan

| Area | Status |
|------|--------|
| **demo2** | Grup suara mesh |
| **demo3** | Video 1:1 |
| **demo8** | Group video mesh |
| **demo9** | Meeting ala Zoom (lobby, host, share) — media masih mesh |

---

## demo9 — Level Zoom ✅

- `/v1/demo9` · `meeting.*` protocol · host admit / kick / lock / end all
- Raise hand, mute/cam indicators, screen share (`getDisplayMedia`)
- Mesh di bawah (bukan SFU) — cocok meeting kecil

### Uji cepat

```powershell
npm run build
nxsocket server --https
```

1. Host: `/v1/demo9` → **Buat / Host**
2. Guest: room sama → **Gabung meeting** → menunggu lobby
3. Host: **Admit** (atau Admit all)
4. Share layar · ✋ Hand · Invite link

### Berikutnya (opsional)

- ~~**SFU**~~ → ✅ **demo10** LiveKit (`docs/sfu-livekit.md`)
- Akun penuh (password/OAuth)
