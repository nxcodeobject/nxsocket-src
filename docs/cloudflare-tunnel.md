# Cloudflare Tunnel — materi lanjut (domain tetap)

Dokumen ini menyimpan pembahasan akses HP dari luar LAN lewat Cloudflare.
Pakai Quick Tunnel dulu kalau **belum punya domain**; lanjut Named Tunnel setelah domain dibeli.

---

## Ringkasan pilihan

| Cara | Domain sendiri? | URL | Kapan |
|------|-----------------|-----|--------|
| **Quick Tunnel** | Tidak | `*.trycloudflare.com` (berubah tiap restart) | Sekarang / uji coba |
| **Named Tunnel** | Ya (di Cloudflare) | `https://nxsocket.domainanda.com` (tetap) | Setelah beli + aktifkan domain |
| LAN saja | Tidak | `https://192.168.x.x:7080` | Satu Wi‑Fi rumah (`--https`) |

Firebase adapter **bukan** tunnel — hanya simpan token/chat di cloud.

---

## A. Quick Tunnel (tanpa domain) — siap dipakai

```powershell
cd D:\Framework\CLI\NxSocket

# Terminal A — HTTP lokal (TLS dari Cloudflare)
nxsocket server

# Terminal B
npm run tunnel
```

- URL aktif: layar ATAU `data/current-tunnel-url.txt`
- Di HP: `https://<url-itu>/v1/demo5` (seluruh `/v1/*` + WebSocket ikut)
- Hostname lama (mis. `recreation-procedures-…`) **tidak bisa dipakai lagi** setelah tunnel mati

Binary: `tools/cloudflared/cloudflared-windows-amd64.exe`  
Skrip: `scripts/tunnel-cloudflare.ps1`

---

## B. Named Tunnel (punya akun Cloudflare + domain) — lanjut nanti

### B1. Beli & pasang domain

1. Beli domain (Cloudflare Registrar / Namecheap / dll.)
2. Cloudflare Dashboard → **Add a site** → masukkan domain
3. Ubah **nameserver** di registrar sesuai instruksi Cloudflare
4. Tunggu status zona **Active**

### B2. Setup sekali di PC

Ganti `nxsocket.domainanda.com` dengan subdomain Anda:

```powershell
cd D:\Framework\CLI\NxSocket
powershell -File scripts\tunnel-named-setup.ps1 -Hostname nxsocket.domainanda.com
```

Yang dilakukan skrip:

1. `cloudflared tunnel login` (browser)
2. Buat tunnel nama `nxsocket` (jika belum ada)
3. `tunnel route dns` → CNAME hostname → tunnel
4. Tulis `%USERPROFILE%\.cloudflared\config.yml`
5. Simpan meta di `data/named-tunnel.json` + `data/current-tunnel-url.txt`

Contoh config: `tools/cloudflared/config.example.yml`

### B3. Tiap hari (setelah setup)

```powershell
# Terminal A
nxsocket server

# Terminal B
npm run tunnel:named
```

HP (hostname tetap):

```text
https://nxsocket.domainanda.com/v1/demo5
https://nxsocket.domainanda.com/v1/demo
…
```

### Perintah npm

| Script | Fungsi |
|--------|--------|
| `npm run tunnel` | Quick Tunnel (tanpa domain) |
| `npm run tunnel:named:setup` | Perlu `-Hostname …` via skrip PS (lihat atas) |
| `npm run tunnel:named` | Jalankan named tunnel |

Setup dengan hostname:

```powershell
powershell -File scripts\tunnel-named-setup.ps1 -Hostname nxsocket.domainanda.com
```

*(Jangan putus `-Hostname` di baris sendiri — argumen harus satu perintah.)*

---

## C. Checklist saat domain sudah dibeli

- [ ] Domain Active di Cloudflare
- [ ] `tunnel-named-setup.ps1 -Hostname …` sukses
- [ ] File `%USERPROFILE%\.cloudflared\config.yml` ada
- [ ] `nxsocket server` + `npm run tunnel:named`
- [ ] HP buka `https://<hostname>/v1/demo5` + tempel token
- [ ] (Opsional) bookmark HP; regenerasi token kalau sempat bocor

---

## D. Keamanan singkat

- Jangan share URL publik + gateway token ke orang lain
- Rotasi: `nxsocket gateway token regenerate <id>`
- Named tunnel lebih aman untuk pemakaian rutin daripada Quick Tunnel publik acak

---

## E. Hubungan dengan fitur NxSocket

Tunnel hanya **meneruskan** gateway lokal ke internet. Fitur tetap di PC:

- demo1–7, Remote AI (Claude/Cursor), WebSocket, dll.
- `NXSOCKET_WORKSPACE_ROOTS` tetap berlaku untuk demo5
- Server lokal cukup **HTTP**; HTTPS publik dari Cloudflare

---

**Status materi:** disiapkan untuk lanjut.  
**Blokir sekarang:** belum punya domain → pakai bagian **A** dulu.  
**Next:** beli domain → centang bagian **C**.
