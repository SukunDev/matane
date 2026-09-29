# Perubahan di app setelah repo resmi hidup

Checklist sisi Matane untuk menyambungkan app ke `matane-extensions`. Kode dasarnya sudah ada sejak Fase 4a–4d. Yang tersisa adalah mengisi nilai resmi, menambahkan repo default, dan memindahkan MangaDex keluar dari app.

## 1. Kunci dan URL resmi

- `apps/desktop/src/main/extensions/official.ts`:
  - `OFFICIAL_KEYS`: isi dengan kunci publik `ed25519:…` dari [`setup-akun-dan-kunci.md`](setup-akun-dan-kunci.md);
  - tambahkan `OFFICIAL_REPO_URL` (URL Pages atau custom domain, diakhiri `/`).
- Test: repo yang ditandatangani kunci itu berstatus `official`, dan index yang ditandatangani kunci lain tidak (unit test `repos.test.ts` sudah menguji logikanya dengan kunci test).

## 2. Repo resmi ditambahkan otomatis

- Saat start, kalau belum ada repo dengan `OFFICIAL_REPO_URL`, repo itu ditambahkan (tanpa dialog, karena resmi). Pengguna boleh menghapusnya, jadi app mengingat bahwa repo resmi sudah pernah ditambahkan (setting) dan tidak memaksakannya lagi.
- Sinkron pertama berjalan begitu online. Selama offline, repo muncul tanpa index dan dengan pesan "belum disinkronkan".

## 3. Handoff MangaDex untuk pengguna lama

Pengguna `0.1.0-beta.x` punya MangaDex **bawaan**. Begitu extension bawaan dihapus dari app, source-nya menjadi "tidak terpasang". Handoff mencegah itu:

- Saat start (setelah sinkron repo resmi), untuk setiap extension yang dipakai library (`sources` dengan manga `in_library`), yang **tidak terpasang**, dan yang **ditawarkan repo resmi**: pasang otomatis **sekali**, lewat alur installer biasa (SHA-256 dicek, tulis atomik), tanpa dialog. Izin domain dianggap sudah diberikan karena extension itu sebelumnya bawaan app.
- Tandai selesai per extension di setting, supaya extension yang sengaja dihapus pengguna tidak dipasang lagi.
- Berhasil → notifikasi "MangaDex sekarang dipasang dari repo resmi". Offline atau gagal → banner di Library dan Sources dengan tombol **Pasang**, dan dicoba lagi saat start berikutnya.
- Storage dan preferensi extension ikut terbawa, karena id-nya sama dan data per extension tidak dihapus oleh handoff.
- `migrateUrl` tidak diperlukan kalau format `url` MangaDex tetap sama.

## 4. MangaDex keluar dari app

- Hapus `extensions/mangadex` dari repo matane (pindah ke `matane-extensions`), dan hapus `extraResources` untuk `../../extensions` di `apps/desktop/electron-builder.yml`.
- Hapus `builtinExtensionsDir()` dan asal `builtin` dari registry, **atau** biarkan folder kosong sebagai titik kembali. Keputusan dicatat di ADR 0023.
- Skrip root `dev`, `e2e`, `dist` tidak lagi menjalankan `pnpm --filter './extensions/*' build`.
- CI matane tidak lagi menjalankan test MangaDex (pindah ke CI `matane-extensions`).

## 5. Tampilan

- Empty state Library dan Sources mengarah ke **Extensions → Tersedia**, bukan hanya ke Extensions.
- Onboarding (Fase 5) memakai daftar dari repo resmi untuk langkah "pilih source".

## 6. Verifikasi

- E2E: repo resmi test (kunci lewat `MATANE_E2E_OFFICIAL_KEY`, URL lewat variable test serupa) ditambahkan otomatis saat start; profil dengan manga dari extension "bawaan" mendapat extension itu dari repo; dan extension yang dihapus pengguna tidak dipasang ulang.
- Live check di app hasil build: repo resmi asli di GitHub Pages → MangaDex "Official · Verified" → baca satu chapter.
- Profil `0.1.0-beta.1` asli (salinan) dengan manga MangaDex dibuka di build baru: MangaDex terpasang otomatis, library dan progres utuh.

## 7. Dokumen

- `README.md` (bagian extension), `CHANGELOG.md`, `BRAINSTORM.md` §11, dan ADR 0023 (asal `builtin` dan handoff).
- `docs/extensions.md`: instal SDK dari npm (`@matane/extension-sdk`), bukan `workspace:*`.
