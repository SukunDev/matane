# Membangun `matane-extensions`

Panduan untuk menyiapkan **repo extension resmi** Matane: repo GitHub terpisah yang membangun, menandatangani, dan menerbitkan extension (mulai dari MangaDex) ke GitHub Pages, lalu dipasang pengguna dari halaman Extensions di app.

> **Status:** ditunda sampai semua fase app selesai (keputusan 29 Sep 2026). Semua kode di sisi app sudah siap: format repo, tanda tangan ed25519, `mr-ext repo`, pasang/update/hapus, `transformImage`, dan `migrateUrl` (Fase 4a–4d). Yang belum ada hanya hal-hal di luar kode: akun, kunci, dan repo itu sendiri.

## Isi folder ini

| File | Isi |
|---|---|
| [`setup-akun-dan-kunci.md`](setup-akun-dan-kunci.md) | Langkah membuat repo GitHub + Pages, kunci tanda tangan, organisasi dan token npm, serta ke mana setiap nilai disimpan. |
| [`struktur-repo.md`](struktur-repo.md) | Tata letak repo, aturan setiap extension, versi, fixture test, dan cara kerja ketiga workflow. |
| [`perubahan-di-app.md`](perubahan-di-app.md) | Apa yang diubah di Matane setelah repo resmi hidup: kunci resmi, repo default, handoff MangaDex, dan menghapus extension bawaan. |
| [`templates/`](templates) | File siap salin untuk repo baru (README, CONTRIBUTING, workspace pnpm, workflow CI/publish/smoke, skrip cek versi, dan kerangka satu extension). |

Panduan menulis extension itu sendiri ada di [`docs/extensions.md`](../extensions.md), dan keputusan desainnya di ADR [0022](../adr/0022-extension-repositories-and-trust.md), [0023](../adr/0023-extension-install-lifecycle.md), dan [0024](../adr/0024-image-transform-with-sharp.md).

## Gambaran besar

```
matane (repo ini)                    npm                          matane-extensions
────────────────                     ───                          ─────────────────
packages/extension-sdk      ──►  @matane/extension-sdk      ──►  extensions/*/ (sumber TS)
packages/extension-runtime  ──►  @matane/extension-runtime  ──►  test fixture (QuickJS yang sama)
packages/extension-cli      ──►  @matane/extension-cli      ──►  mr-ext repo build → public/
                                                                        │ (ditandatangani MR_REPO_KEY)
app Matane  ◄──── index.json + index.json.sig + zip ◄──── GitHub Pages ◄┘
   (kunci publik resmi tertanam di app → "Official · Verified")
```

- Repo extension bergantung pada **paket npm** SDK/CLI/runtime. Karena itu paket npm diterbitkan lebih dulu.
- App hanya memercayai repo yang ditandatangani kunci yang dikenalnya. Kunci publik resmi ditanam di app (`apps/desktop/src/main/extensions/official.ts`), sedangkan kunci privat **hanya** ada di secret CI dan di tempat penyimpananmu sendiri.

## Urutan kerja (checklist)

Kerjakan dari atas ke bawah. Langkah bertanda 🧑 dikerjakan olehmu (akun dan rahasia), langkah 🤖 bisa kukerjakan.

1. **Persiapan akun** (lihat [`setup-akun-dan-kunci.md`](setup-akun-dan-kunci.md)):
   - [ ] 🧑 Organisasi npm `matane` (atau scope lain, lalu kabari aku).
   - [ ] 🧑 Token npm "granular, publish" → secret `NPM_TOKEN` di repo **matane**.
   - [ ] 🧑 Repo GitHub kosong `matane-extensions` (publik), dengan Pages bersumber "GitHub Actions".
2. **Terbitkan SDK ke npm** (bagian dari Milestone 4e):
   - [x] 🤖 Paket di-rename ke `@matane/*`, di-build ke `dist/`, dicek dengan `pnpm pack` dan dipasang di proyek kosong, beserta workflow `.github/workflows/publish-sdk.yml` (sudah di Milestone 4e).
   - [ ] 🧑 Push tag `sdk-v0.1.0` → workflow menerbitkan ketiga paket.
3. **Kunci tanda tangan:**
   - [ ] 🧑 `npx @matane/extension-cli repo keygen --out matane-repo-key.pem` di komputermu.
   - [ ] 🧑 Isi PEM → secret `MR_REPO_KEY` di repo `matane-extensions`; kunci publik → variable `MR_REPO_PUBLIC_KEY`, dan kirimkan juga kepadaku.
   - [ ] 🧑 Simpan file PEM di password manager, lalu hapus dari disk.
4. **Isi repo** (lihat [`struktur-repo.md`](struktur-repo.md)):
   - [ ] 🤖 Salin [`templates/`](templates) + `extensions/mangadex` ke folder yang kamu tentukan, sesuaikan nama/URL, lalu jalankan `pnpm install` dan `pnpm test`.
   - [ ] 🧑 Push ke `main` → workflow **Publish** membangun, menandatangani, memverifikasi, lalu menerbitkan ke `https://<akun>.github.io/matane-extensions/`.
   - [ ] 🧑 Isi variable `REPO_URL` dengan URL itu (dipakai cek versi di CI).
5. **Sambungkan app** (lihat [`perubahan-di-app.md`](perubahan-di-app.md)):
   - [x] 🤖 Repo resmi ditambahkan otomatis dan handoff dibuat (Milestone 4e; aktif begitu URL + kunci diisi).
   - [ ] 🤖 Kunci publik + URL resmi ditanam, dan extension bawaan dihapus.
   - [ ] 🤖 Live check: build app memasang MangaDex dari repo resmi ("Official · Verified"); profil `0.1.0-beta.1` mendapat MangaDex otomatis dengan library utuh.

## Yang perlu diputuskan saat itu

- **Nama scope npm.** `@matane` hanya bisa dipakai kalau organisasi `matane` masih tersedia di npm. Kalau tidak, pilih scope lain (misalnya `@matane-app`); nama baru hanya perlu diganti di `package.json` dan dokumentasi.
- **Pemilik repo.** Repo pribadi (`SukunDev/matane-extensions`) atau organisasi GitHub. URL Pages mengikuti pemiliknya, dan URL itu ditanam di app, jadi sebaiknya tidak berpindah-pindah. Organisasi sejak awal lebih mudah kalau nanti ada kontributor lain.
- **Domain sendiri** (opsional). Custom domain di Pages (misalnya `extensions.matane.app`) membuat URL di app tidak bergantung pada nama akun GitHub.
