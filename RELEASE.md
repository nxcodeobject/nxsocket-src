# Release checklist

- [ ] `npm run build` sukses
- [ ] `npm run build:bin` sukses → `release/nxsocket-win-x64.exe` + `release/nxsocket-linux-x64`
- [ ] Binary di-upload ke GitHub Releases (https://github.com/nxcodeobject/nxsocket/releases)
- [ ] Cara pakai binary (jalan tanpa Node/npm) + konfigurasi `.env` (dibaca dari cwd) terdokumentasi
      di README bagian "Pakai binary (pengguna)"
- [ ] `npm test` (test-all) PASS
- [ ] `nxsocket --help` & `gateway info` jalan setelah `npm link`
- [ ] README Quick start + Hello chat masih akurat
- [ ] PROTOCOL.md selaras dengan types
- [ ] CHANGELOG diisi untuk versi ini
- [ ] Tidak ada secret / `serviceAccount.json` / token asli di repo
- [ ] `.gitignore` mencakup `data/`, `.env`, credentials
- [ ] Default port & adapter terdokumentasi
- [ ] Catatan TLS / deployment sudah ada di README
