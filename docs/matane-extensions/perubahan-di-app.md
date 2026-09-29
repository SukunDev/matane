# Perubahan di app setelah repo resmi hidup

Checklist sisi Matane untuk menyambungkan app ke `matane-extensions`. Bagian 2, 3, dan 5 **sudah dibuat di Milestone 4e** dan diuji dengan repo resmi test (`e2e/official.spec.ts`, `MATANE_E2E_OFFICIAL_KEY` + `MATANE_E2E_OFFICIAL_REPO`). Semuanya diam selama `OFFICIAL_REPO_URL` masih `null`. Yang tersisa untuk 4f adalah bagian 1, 4, 6, dan 7.

## 1. Kunci dan URL resmi

- `apps/desktop/src/main/extensions/official.ts`:
  - `OFFICIAL_KEYS`: isi dengan kunci publik `ed25519:…` dari [`setup-akun-dan-kunci.md`](setup-akun-dan-kunci.md);
  - `OFFICIAL_REPO_URL`: URL Pages atau custom domain, diakhiri `/` (sekarang `null`).
- Test: repo yang ditandatangani kunci itu berstatus `official`, dan index yang ditandatangani kunci lain tidak (unit test `repos.test.ts` sudah menguji logikanya dengan kunci test).

## 2. Repo resmi ditambahkan otomatis (sudah ada)

- `RepoService.ensureOfficial`: saat start, kalau belum ada repo dengan `OFFICIAL_REPO_URL`, repo itu ditambahkan tanpa dialog dan tanpa jaringan. Setting `extensions.officialRepo` mengingat URL yang pernah ditambahkan, jadi repo yang dihapus pengguna tidak kembali (tapi URL resmi baru di rilis berikutnya ditambahkan lagi).
- Sinkron pertama berjalan saat start (kalau online) atau begitu kembali online. Sebelum itu kartu repo menampilkan "Not synced yet".

## 3. Handoff MangaDex untuk pengguna lama (sudah ada)

Pengguna `0.1.0-beta.x` punya MangaDex **bawaan**. Begitu extension bawaan dihapus dari app, source-nya menjadi "tidak terpasang". Handoff mencegah itu:

- `extensions/handoff.ts`: saat start dan setiap kali repo resmi selesai sinkron, untuk setiap extension yang **catatannya masih ada** di DB (pernah terpasang dan tidak pernah di-uninstall; uninstall menghapus catatannya), yang dipakai library (manga `in_library`), yang **tidak terpasang**, dan yang **ditawarkan repo resmi**: pasang otomatis **sekali** lewat alur installer biasa (SHA-256 dicek, tulis atomik), tanpa dialog. Izin domain dianggap sudah diberikan karena extension itu sebelumnya bawaan app.
- Setting `extensions.handoffDone` mencatat extension yang sudah dipindahkan, jadi tidak ada pemasangan kedua.
- Berhasil → notifikasi "MangaDex now comes from the official repository". Repo belum tersinkron → banner "akan dipasang"; pemasangan gagal → banner dengan alasannya. Keduanya punya tombol **Install now** dan dicoba lagi saat start berikutnya.
- Storage dan preferensi extension ikut terbawa, karena id-nya sama dan data per extension tidak dihapus oleh handoff.
- `migrateUrl` tidak diperlukan kalau format `url` MangaDex tetap sama.

## 4. MangaDex keluar dari app

- Hapus `extensions/mangadex` dari repo matane (pindah ke `matane-extensions`), dan hapus `extraResources` untuk `../../extensions` di `apps/desktop/electron-builder.yml`.
- Hapus `builtinExtensionsDir()` dan asal `builtin` dari registry, **atau** biarkan folder kosong sebagai titik kembali. Keputusan dicatat di ADR 0023.
- Skrip root `dev`, `e2e`, `dist` tidak lagi menjalankan `pnpm --filter './extensions/*' build`.
- CI matane tidak lagi menjalankan test MangaDex (pindah ke CI `matane-extensions`).

## 5. Tampilan (sudah ada)

- Empty state Sources, dan Library kalau belum ada source, mengarah ke **Extensions → Tersedia** (`/browse/extensions?tab=available`).
- Onboarding (Fase 5) memakai daftar dari repo resmi untuk langkah "pilih source".

## 6. Verifikasi

- E2E: repo resmi test (kunci lewat `MATANE_E2E_OFFICIAL_KEY`, URL lewat variable test serupa) ditambahkan otomatis saat start; profil dengan manga dari extension "bawaan" mendapat extension itu dari repo; dan extension yang dihapus pengguna tidak dipasang ulang.
- Live check di app hasil build: repo resmi asli di GitHub Pages → MangaDex "Official · Verified" → baca satu chapter.
- Profil `0.1.0-beta.1` asli (salinan) dengan manga MangaDex dibuka di build baru: MangaDex terpasang otomatis, library dan progres utuh.

## 7. Dokumen

- `README.md` (bagian extension), `CHANGELOG.md`, `BRAINSTORM.md` §11, dan ADR 0023 (asal `builtin` dan handoff).
- `docs/extensions.md`: instal SDK dari npm (`@matane/extension-sdk`), bukan `workspace:*`.
