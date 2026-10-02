# Memisahkan repo extension: langkah demi langkah

Rencana kerja Milestone 4f dengan strategi rilis yang diputuskan pada 2 Okt 2026:

- **GitHub dulu.** App, SDK, dan repo extension terbit di GitHub saja: GitHub Releases, GitHub Pages, dan Actions.
- **Rilis global ditunda** sampai app lengkap. Yang ditunda: AUR, Flathub, dan pengumuman (file di `packaging/` disimpan, tetapi belum dipakai). SDK di npm tidak termasuk yang ditunda.

SDK (`@matane/*`) diterbitkan ke **npm** (keputusan 2 Okt 2026, langkah 2). Sampai paketnya terbit, repo extension memakai tarball di `vendor/`.

Tanda di setiap langkah:
- 🧑 dikerjakan olehmu (akun, rahasia, push, tag);
- 🤖 dikerjakan olehku;
- ✅ cara mengecek bahwa langkah itu berhasil.

Pilihan default di bawah ini bisa diganti sebelum mulai:
- **Pemilik repo:** akun pribadi, jadi URL-nya `https://sukundev.github.io/matane-extensions/`.
- **Riwayat git:** dimulai baru. Cara mempertahankan riwayat ada di langkah 4.

---

## Langkah 0: Keputusan sebelum mulai (🧑)

1. **Extension mana yang masuk repo resmi.** Kandidatnya `mangadex`, `westmanga`, `ainzscansid`, dan `aarlas`.
   - README dan disclaimer app menyatakan repo resmi hanya berisi extension untuk layanan yang mengizinkannya.
   - MangaDex jelas memenuhi syarat itu (punya API publik dan aturan pemakaian).
   - Untuk tiga situs Indonesia, putuskan dua hal:
     - masuk repo resmi, lalu disclaimer-nya disesuaikan; **atau**
     - ditaruh di repo kedua yang tidak resmi (misalnya `matane-extensions-id`, dengan kunci terpisah, sehingga statusnya "Trusted" atau "Unverified" di app).
   - Langkah-langkah di bawah berlaku untuk keduanya. Kalau repo kedua dipilih, langkah 4–6 cukup diulang untuk repo itu.
2. **URL repo bersifat permanen.** URL Pages ditanam di app, jadi pemilik repo jangan dipindah setelah rilis. Kalau ingin bebas pindah host, pakai custom domain (misalnya `extensions.sukun.dev`) sejak awal.

## Langkah 1: Repo GitHub kosong (🧑)

1. Buat repo **publik** `SukunDev/matane-extensions` tanpa README, .gitignore, atau lisensi.
2. **Settings → Pages → Source: GitHub Actions.**
3. (Disarankan) **Settings → Branches:** buat aturan untuk `main` yang mewajibkan PR dan CI hijau. Dengan begitu, tidak ada kode yang ditandatangani tanpa ditinjau.
4. Kabari aku URL repo dan URL Pages-nya, termasuk custom domain kalau dipakai.

✅ Halaman repo terbuka, dan menu Pages menampilkan "GitHub Actions".

## Langkah 2: SDK ke npm

> **Perubahan (2 Okt 2026):** SDK diterbitkan ke npm, bukan sebagai tarball GitHub Release. Rilis app tetap hanya di GitHub dulu.

🧑 Yang kamu siapkan:
1. **Organisasi npm:** buka npmjs.com → avatar → **Add Organization**, isi nama `matane` dan pilih paket publik gratis.
   - Kalau nama itu sudah diambil, pilih nama lain dan kabari aku. Scope `@matane/*` lalu kuganti di semua paket dan dokumen.
2. **2FA:** **Account → Two-Factor Authentication**. Wajib untuk menerbitkan.
3. **Token:** **Access Tokens → Generate New Token → Granular Access Token**:
   - Packages and scopes: **Read and write**, hanya untuk scope `@matane`;
   - Organizations: `matane` → Read and write (supaya paket baru boleh dibuat di scope itu);
   - catat tanggal kedaluwarsanya.
4. **Secret** `NPM_TOKEN` di GitHub repo `SukunDev/matane`: **Settings → Secrets and variables → Actions → New repository secret**.
5. Commit semua yang tertunda, push ke `main`, lalu buat tag:

   ```sh
   git tag sdk-v0.1.0 && git push origin sdk-v0.1.0
   ```

   Workflow `publish-sdk.yml` menjalankan typecheck dan test, lalu menerbitkan ketiga paket berurutan (sdk → runtime → cli) dengan provenance.

🤖 Sudah dicek: `pnpm publish --dry-run` untuk ketiga paket lolos (2 Okt 2026), dan nama `@matane/extension-{sdk,runtime,cli}` masih kosong di npm.

✅ Tiga paket tampil di https://www.npmjs.com/org/matane dengan label "Provenance". `npm view @matane/extension-cli version` → `0.1.0`.

Setelah itu 🤖 di repo `matane-extension`:
- hapus `overrides` dan `vendor/`; catalog tetap `0.1.0`, ambil dari npm;
- `pnpm install`, lalu jalankan test lagi.

**Opsional, nanti:** setelah paket ada, pindahkan ke *Trusted Publishing* npm (OIDC dari GitHub Actions, tanpa token), lalu hapus `NPM_TOKEN`.

## Langkah 3: Kunci tanda tangan (🧑)

Kunci dibuat di komputermu, di luar folder git mana pun. Kunci privat tidak pernah kulihat.

```sh
cd /run/media/sukundev/Disk_D/Coding/node_js/electron/manga-reader
pnpm --filter mangadex exec mr-ext repo keygen --out ~/matane-repo-key.pem
# → Public key: ed25519:AbC…=
```

1. **Secret** `MR_REPO_KEY` di repo `matane-extensions` (**Settings → Secrets and variables → Actions → Secrets**): tempel seluruh isi file PEM, termasuk baris `BEGIN` dan `END`.
2. **Variable** `MR_REPO_PUBLIC_KEY` (tab Variables): isi dengan kunci publik `ed25519:…`.
3. Kirim kunci **publik** kepadaku.
4. Simpan file PEM di password manager, lalu hapus dari disk dengan `rm ~/matane-repo-key.pem`.

✅ Secret dan variable tampil di Settings. Kunci publik sudah ada di chat.

Kalau kunci bocor atau hilang, ikuti [`setup-akun-dan-kunci.md`](setup-akun-dan-kunci.md#kalau-kunci-bocor-atau-hilang).

## Langkah 4: Isi repo extension

🤖 Aku menyiapkan folder `../matane-extensions` (di sebelah repo matane, belum menjadi repo git):
- Salin `templates/` lalu isi placeholder-nya: nama, URL, dan daftar extension di README.
- Salin `extensions/<id>` yang dipilih di langkah 0, **tanpa** `dist/`, `node_modules/`, dan fixture.
- Di setiap `package.json` extension, ganti `workspace:*` menjadi `catalog:`. Skrip `mr-ext` tetap ada.
- Arahkan `pnpm-workspace.yaml` ke tarball, lewat catalog dan juga `overrides` (untuk dependensi transitif CLI → runtime → SDK):

  ```yaml
  catalog:
    '@matane/extension-cli': https://github.com/SukunDev/matane/releases/download/sdk-v0.1.0/matane-extension-cli-0.1.0.tgz
    '@matane/extension-runtime': https://github.com/SukunDev/matane/releases/download/sdk-v0.1.0/matane-extension-runtime-0.1.0.tgz
    '@matane/extension-sdk': https://github.com/SukunDev/matane/releases/download/sdk-v0.1.0/matane-extension-sdk-0.1.0.tgz
  overrides:
    '@matane/extension-runtime': $@matane/extension-runtime
    '@matane/extension-sdk': $@matane/extension-sdk
  ```

- Tambahkan `icon.png` untuk MangaDex (sekarang belum punya), lalu sesuaikan README, CONTRIBUTING, dan tautan panduan ke situs dokumentasi.
- Jalankan `pnpm install`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, dan `pnpm repo:build:unsigned`, lalu `mr-ext repo verify public`. Repo yang belum ditandatangani akan dilaporkan "unsigned", jadi cek lain harus lolos.
- Coba muat folder `public/` itu di app hasil build lewat server lokal, dengan profil scratch: pasang MangaDex lalu baca satu chapter.

🧑 Lalu push repo-nya:

```sh
cd ../matane-extensions
git init -b main
git add . && git commit -m "feat: initial extensions"
git remote add origin git@github.com:SukunDev/matane-extensions.git
git push -u origin main
```

**Kalau ingin riwayat git extension ikut pindah:** sebelum langkah ini, jalankan `git filter-repo --path extensions/mangadex --path extensions/westmanga …` di **salinan** repo matane, lalu jadikan salinan itu dasar repo baru. Hasilnya lebih rapi, tetapi lebih banyak langkah. Repo baru tanpa riwayat juga sudah cukup, karena riwayat lama tetap ada di repo matane.

✅ Push ke `main` menjalankan **CI** dan **Publish**, dan keduanya hijau.

## Langkah 5: Publish pertama dan cek repo hidup

🧑 Yang kamu lakukan:
1. Tunggu workflow **Publish** selesai.
2. Isi **variable** `REPO_URL` = `https://sukundev.github.io/matane-extensions/`. Variable ini dipakai cek versi di CI berikutnya.

🤖 / 🧑 Cek dari mana saja:

```sh
curl -sI https://sukundev.github.io/matane-extensions/index.json      # 200
pnpm --filter mangadex exec mr-ext repo verify https://sukundev.github.io/matane-extensions/ \
  --public-key ed25519:…                                               # OK
```

✅ `verify` lolos terhadap kunci publik dari langkah 3. Workflow **Smoke** bisa dijalankan manual (Actions → Smoke → Run workflow), dan hasilnya hijau, atau membuka issue kalau ada situs yang menolak runner GitHub.

## Langkah 6: Sambungkan app ke repo resmi (🤖)

Rinciannya ada di [`perubahan-di-app.md`](perubahan-di-app.md):

1. Di `apps/desktop/src/main/extensions/official.ts`, isi `OFFICIAL_KEYS = ['ed25519:…']` dan `OFFICIAL_REPO_URL = 'https://sukundev.github.io/matane-extensions/'`.
2. Keluarkan extension bawaan dari repo matane:
   - hapus `extensions/<id>` yang sudah pindah;
   - hapus `extraResources` di `electron-builder.yml`;
   - hapus `pnpm --filter './extensions/*' build` dari skrip root (`dev`, `e2e`, `dist`) dan dari `release.yml`.
3. Keputusan untuk asal `builtin` di registry: dibiarkan sebagai titik kembali dengan folder kosong, atau dihapus. Hasilnya dicatat di ADR 0023.
4. Perbarui panduan extension di `apps/docs`: pakai SDK dari tarball release (sampai npm) dan URL repo resmi. Perbarui juga README dan CHANGELOG.
5. Jalankan lint, typecheck, test, dan E2E. E2E memakai situs palsu, jadi tidak bergantung pada repo asli.

✅ Live check di app hasil build:
- profil baru: repo resmi muncul sendiri, MangaDex tampil dengan status "Official · Verified", lalu terpasang dan bisa dibaca;
- **salinan** profil `0.1.0-beta.1` yang punya manga MangaDex: handoff memasang MangaDex otomatis, dan library serta progres tetap utuh.

## Langkah 7: Rilis GitHub berikutnya (🧑)

1. Commit perubahan app.
2. Naikkan versi di `apps/desktop/package.json` (misalnya `0.2.0-beta.1`) dan isi CHANGELOG. Bagian versi ini bisa kubantu.
3. Push tag `v0.2.0-beta.1`. `release.yml` akan membangun semua OS dan menerbitkan pre-release di GitHub.

✅ Pengguna beta lama mendapat update. Setelah restart, MangaDex datang dari repo resmi lewat handoff.

## Langkah 8: Nanti, saat rilis global (ditunda)

- **AUR dan Flathub:** ikuti `packaging/README.md`.
- **Pengumuman dan rilis v1.0:** Milestone 5g.

---

## Ringkasan urutan

| # | Langkah | Siapa | Hasil |
|---|---|---|---|
| 0 | Pilih extension resmi dan URL | 🧑 | daftar extension, URL permanen |
| 1 | Repo GitHub + Pages | 🧑 | `SukunDev/matane-extensions` kosong |
| 2 | Org npm + `NPM_TOKEN`, tag `sdk-v0.1.0` | 🧑 | 3 paket di npm |
| 3 | Kunci tanda tangan | 🧑 | secret + variable, kunci publik untukku |
| 4 | Isi repo, push | 🤖 lalu 🧑 | CI dan Publish hijau |
| 5 | Cek repo hidup, `REPO_URL` | 🧑 + 🤖 | `index.json` terverifikasi |
| 6 | Sambungkan app, hapus extension bawaan | 🤖 | live check dan handoff lolos |
| 7 | Rilis beta di GitHub | 🧑 | tag `v0.2.0-beta.1` |
| 8 | AUR, Flathub | nanti | rilis global |

Yang bisa langsung kukerjakan sekarang tanpa menunggumu adalah bagian 🤖 di langkah 2 (workflow tarball dan uji lokal), dan persiapan folder di langkah 4 dengan tanda tangan dummy.

## Status pelaksanaan

### Langkah 4 (bagian 🤖): selesai (2 Okt 2026), menunggu review

- Folder: `/run/media/sukundev/Disk_D/Coding/node_js/electron/matane-extension` (belum menjadi repo git). Isinya:
  - template dari `templates/`;
  - keempat extension (`mangadex`, `westmanga`, `ainzscansid`, `aarlas`), tanpa `dist/` dan `node_modules/`. Fixture ikut disalin untuk test lokal, tetapi tetap di-gitignore.
- **SDK dari `vendor/`:** `pnpm pack` ketiga paket dari repo matane. Folder `vendor/` **ikut di-commit** sementara, supaya CI repo baru jalan tanpa npm dan tanpa release. Catalog `pnpm-workspace.yaml` berisi versi `0.1.0`, sedangkan tarball dipasang lewat `overrides` (pnpm tidak menerima `file:` di catalog). Setelah release `sdk-v0.1.0` ada, `overrides` diarahkan ke URL release dan `vendor/` dihapus.
- Penyesuaian:
  - `workspace:*` diganti `catalog:`;
  - `@types/node` ditambahkan lewat catalog ke setiap extension;
  - `tsconfig.test.json` westmanga/ainzscansid/aarlas memakai `types: ["node"]` seperti template. Sebelumnya `vitest/globals`, yang di repo terpisah tidak memuat tipe Node;
  - README berisi tabel 4 extension dan bagian pengembangan;
  - `.prettierignore` ditambahkan.
- Cek:
  - `pnpm install`, `format:check`, dan `typecheck` hijau; `pnpm test` 43 test hijau (mangadex 16, lainnya 9 masing-masing);
  - `pnpm repo:build:unsigned` menghasilkan 4 zip, hash-nya sama dengan build di repo matane;
  - build bertanda tangan dengan kunci uji sekali pakai (sudah dihapus) lolos `repo verify`, dan kunci lain ditolak;
  - app (profil scratch, `MATANE_E2E_OFFICIAL_*` ke server lokal) menyinkronkan repo itu dengan status **official** dan melihat keempat extension.
- Belum: `icon.png` untuk MangaDex. Logo MangaDex punya aturan pakai, jadi pilih sendiri gambarnya atau biarkan tanpa ikon.
- Berikutnya, setelah kamu siap dengan GitHub:
  - langkah 1 (repo + Pages);
  - langkah 3 (kunci);
  - `git init`, lalu push (langkah 4, bagian 🧑);
  - langkah 2 (release SDK) bisa menyusul, karena `vendor/` sudah cukup untuk CI.

### Langkah 2: selesai (2 Okt 2026)

- `@matane/extension-sdk`, `-runtime`, dan `-cli` versi 0.1.0 terbit di npm lewat tag `sdk-v0.1.0`.
  - Publish pertama gagal karena token tanpa bypass 2FA (`ERR_PNPM_OTP_NON_INTERACTIVE`).
  - Diperbaiki dengan Granular Token yang mencentang "Bypass two-factor authentication".
- `matane-extension` sekarang memakai npm: catalog `^0.1.0`, `overrides` dan `vendor/` dihapus. `install --frozen-lockfile`, `format:check`, `typecheck`, dan `test` (43) hijau, dan hash zip `repo:build:unsigned` sama seperti sebelumnya.
- Opsional: pasang Trusted Publishing di ketiga paket, lalu hapus `NPM_TOKEN`.
- Berikutnya: langkah 1 (repo GitHub `matane-extensions` + Pages) dan langkah 3 (kunci tanda tangan).

### Langkah 1, 3–6: selesai (2 Okt 2026)

Repo `SukunDev/matane-extensions` hidup di GitHub Pages, ditandatangani kunci resmi, dan app sudah tersambung. Rinciannya ada di [plan Fase 4, Milestone 4f](../plans/fase-4-ekosistem-extension.md). Berikutnya langkah 7: rilis beta di GitHub.
