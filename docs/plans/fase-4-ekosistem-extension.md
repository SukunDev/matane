# Plan: Fase 4 (Ekosistem extension) Matane

## Context

Fase 3 selesai (beta `0.1.0-beta.1`, commit terakhir 3e). Saat ini extension hanya bisa masuk lewat dua jalan: **bawaan** (MangaDex dibundel di `resources/extensions`) dan **load dari folder** (mode dev). Pengguna belum bisa memasang, memperbarui, atau menghapus extension, dan pembuat extension belum punya cara mendistribusikannya.

Fase 4 menambahkan:
- **repo extension** bertanda tangan ed25519 (§5.8): pasang / update / uninstall dengan dialog izin domain, filter NSFW, dan bahasa konten;
- hook **`transformImage`** (§5.6) dan **`migrateUrl`** (§5.10), serta `crypto.aesDecrypt`;
- **repo extension resmi terpisah** dengan smoke test harian, dan **SDK di npm**.

Acuan:
- `BRAINSTORM.md` §5.1–5.10, §6.2 (Browse), §6.6 (NSFW, onboarding, Settings → Browse & Extension), dan §11 Fase 4;
- mockup `docs/ui/screens/09-extensions` dan `09b-extensions-install-dialog`;
- ADR 0003, 0004, 0012, 0013.

Keputusan dari diskusi:
- **5 milestone** dengan checkpoint. Aku berhenti untuk review dan commit olehmu di setiap checkpoint, dan tidak pernah commit sendiri.
- **Repo resmi terpisah**: repo GitHub baru (mis. `SukunDev/matane-extensions`), di-host lewat GitHub Pages, dengan CI build + sign + publish dan smoke test harian. Repo GitHub-nya, GitHub Pages, dan secret-nya dibuat olehmu.
- **MangaDex tidak dibundel lagi.** Setelah repo resmi hidup, MangaDex hanya dipasang dari repo. Repo resmi ditambahkan otomatis. Pengguna beta lama yang library-nya berisi manga MangaDex mendapat MangaDex terpasang otomatis sekali ("handoff").
- **npm: `@matane/extension-sdk`** (plus `@matane/extension-cli` dan `@matane/extension-runtime`, karena repo terpisah butuh CLI dan runtime untuk build/test). Organisasi npm `matane` dan token-nya dibuat olehmu. Hanya tiga paket ini yang berganti nama. `@manga-reader/shared` dan app tetap.

Yang sudah ada dan dipakai ulang:
- tabel `extension_repos` (skema §7) dan kolom `extensions.repoId` / `enabled`;
- mode dev (load folder + hot reload, `ExtensionRegistry`) dan `ExtensionService.reload(id)`;
- tipe `ImageTransform` / `transformImage` di SDK;
- `yazl` / `yauzl` dan pola penulisan atomik (`downloads/archive.ts`, `downloads/move.ts`);
- `OnlineMonitor`, `createLimiter`, `ConfirmDialog`, dan `features/settings/controls.tsx`;
- `SourceService` yang sudah menandai source "tidak terpasang".

Di luar cakupan:
- Onboarding penuh, VitePress, dan paket deb/rpm/AUR/Flatpak masuk Fase 5.
- Template CMS (Madara dan sejenisnya) dan login per source dikerjakan setelah v1.

Langkah pertama implementasi: simpan rencana ini ke `docs/plans/fase-4-ekosistem-extension.md`, dengan format seperti plan Fase 3.

---

## Milestone 4a: Format repo, signing ed25519, dan `mr-ext repo`

- **SDK** (`packages/extension-sdk/src/repo.ts`, baru): `repoIndexSchema` (zod), dipakai bersama oleh CLI dan app. Isinya:
  - `name`, `publicKey?` (informatif);
  - `extensions[]` berisi `id`, `name`, `version`, `apiVersion`, `langs`, `nsfw`, `domains`, `file`, `sha256`, `size`, dan `icon`.
  - Manifest mendapat `icon?` (default `icon.png`).
- **Signing:**
  - memakai `node:crypto` ed25519 (tanpa dependensi), atas byte persis `index.json`, disimpan base64 di `index.json.sig`;
  - format kunci publik `ed25519:<base64 32 byte>`, dan kunci privat sebagai PEM PKCS8.
- **CLI `mr-ext repo`** (`packages/extension-cli/src/repo.ts`):
  - `keygen --out key.pem`: mencetak kunci publik. Kunci privat tidak pernah masuk repo.
  - `build <ext...> --out <dir> [--key file | env MR_REPO_KEY]`: membuat zip **deterministik** (mtime tetap, urutan tetap) berisi `manifest.json`, `index.js`, dan `icon.png` di `extensions/<id>-<version>.zip`, lalu ikon, `index.json` yang terurut, sha256, dan `.sig`.
  - `verify <dir|url> --public-key`.
- **Unit test:** sign/verify, index yang diubah, sha256 tidak cocok, output deterministik, dan zip yang berisi file terlarang ditolak.

**Checkpoint 4a:**
- Repo dibangun dari MangaDex + extension E2E, lalu diverifikasi.
- Satu byte `index.json` atau zip diubah, lalu `verify` gagal dengan pesan yang jelas.
- Build dua kali menghasilkan hash yang sama.

---

## Milestone 4b: Repo dan pasang / update / hapus di app (mockup 09, 09b)

- **Migrasi DB:**
  - `extension_repos`: `index_json`, `signature_state`, `last_error`, dan `last_synced_at`;
  - `extensions`: `origin` (`repo` | `dev`), `sha256`, dan `domains_json` (untuk mendeteksi domain baru saat update).
- **`RepoService`** (`main/extensions/repos.ts`):
  - tambah repo lewat URL, dengan fetch `index.json` + `.sig` lewat `net.fetch` main (HTTPS saja; `http://localhost`/`127.0.0.1` untuk dev dan test), timeout, dan batas ukuran;
  - status kepercayaan: **resmi** (kunci resmi tertanam di app), **dipercaya** (kunci ditambahkan pengguna lewat "trust this key"), atau **tidak terverifikasi** (peringatan dikonfirmasi sekali);
  - sinkron manual dan berkala (default 24 jam, hanya saat online).
- **Installer** (`main/extensions/installer.ts`):
  - download zip (maks 20 MB) → cocokkan sha256 dengan index → unzip dengan `yauzl`. Hanya file datar yang diizinkan (anti zip-slip);
  - validasi manifest (id sama dengan index, `apiVersion` didukung), tulis ke `userData/extensions/<id>.tmp`, lalu rename atomik;
  - **dua tahap**: `prepareInstall` mengunduh dan memverifikasi, lalu mengembalikan domain, ukuran, apiVersion, dan status sha256 untuk dialog 09b; `install(token)` baru memasang.
  - **Update**: kalau versi baru menambah domain, pengguna ditanya lagi dan ditunjukkan domain barunya. Extension hanya diperbarui dari repo asalnya. Kalau id yang sama ada di dua repo, pengguna memilih satu.
  - **Uninstall**: hapus folder, storage, dan prefs (cascade), bersihkan session `persist:ext-<id>`, dan unload runtime. Manga di library tetap ada dan ditandai "source tidak terpasang".
- **Registry:** asal baru `repo` (`userData/extensions/*`), dengan prioritas dev > repo > bawaan.
- **UI Extensions** (mockup 09):
  - tab Terpasang / Tersedia / Update beserta jumlahnya, pencarian, dan filter bahasa;
  - "Update semua", dan per baris: update / setting / menu (hapus, lihat log untuk dev);
  - panel **Repositori** (badge Terverifikasi/Tidak terverifikasi, sinkron, percayai kunci, hapus) dan dialog "Tambah repositori";
  - **dialog pasang** (09b): status repo, domain, versi API, ukuran, "SHA-256 terverifikasi";
  - tanda di sidebar saat ada update extension.
- **IPC:** `repos.list/add/remove/sync/trustKey`, `extensions.available`, `extensions.prepareInstall/install/update/updateAll/uninstall`, event progres, dan tag `repos`.
- **E2E:**
  - situs palsu menyajikan repo yang dibuat dengan `mr-ext repo` (kunci test). Kunci resmi bisa di-override lewat `MATANE_E2E`;
  - skenario: tambah repo → pasang → browse → update (dengan domain baru yang ditanyakan) → hapus → manga "tidak terpasang" → pasang lagi dan manga normal lagi;
  - zip yang diubah ditolak, dan tanda tangan salah memunculkan peringatan tidak terverifikasi.

**Checkpoint 4b:** semua skenario E2E di atas lulus, dan dialog serta halaman Extensions dibandingkan dengan mockup 09/09b.

---

## Milestone 4c: NSFW, bahasa konten, Settings → Browse & Extension, dan panel log dev

- **Setting `browse`**:
  - `showNsfw` (default mati; menyalakannya butuh konfirmasi);
  - `languages` (bahasa konten; default bahasa UI + EN);
  - `autoUpdateExtensions` (default mati, jadi hanya tanda) dan interval sinkron repo.
- **Filter NSFW dan bahasa** berlaku di tab Tersedia/Terpasang, Sources, Browse, dan Global search (source NSFW tidak ikut dicari) (§6.6).
- **Settings → Browse & Extension** (masuk `READY_SECTIONS`): daftar repo (komponen yang sama dengan panel), bahasa konten, NSFW, dan update otomatis extension.
- **Panel log extension** (mode dev, "Lihat log" di mockup 09):
  - ring buffer per extension di main (500 baris terakhir);
  - isinya dari `log.*` extension, error panggilan, dan error HTTP;
  - dialog dengan tail live lewat event, filter level, dan salin.

**Checkpoint 4c:**
- Extension NSFW (situs E2E) tidak tampil di mana pun sampai toggle dinyalakan.
- Bahasa konten menyaring Sources dan Tersedia.
- Log dev tampil live.

---

## Milestone 4d: `transformImage`, `crypto.aesDecrypt`, dan `migrateUrl`

- **Runtime:**
  - `crypto.aesDecrypt(bytes, key, iv, mode)` (cbc/ctr/ecb) sebagai panggilan host sinkron di extension host;
  - `__transformImage` dan `__migrateUrls` di prelude. `migrateUrl` memproses batch, jadi tidak ada ribuan RPC.
- **Pipeline gambar** (`images/service.ts`):
  - kalau source punya `transformImage`, byte hasil fetch dikirim ke sandbox, yang mengembalikan `bytes` (dekripsi) dan/atau `tiles`;
  - tiles dieksekusi di main dengan **`sharp`** (composite, lalu encode ulang dengan format asli);
  - hasilnya masuk cache **dan** download (`pageBytes`), jadi pembacaan offline tidak diproses ulang;
  - gambar tanpa transform tidak lewat sandbox.
- **`sharp`**: versi dipin setelah dicek masih dirawat. `asarUnpack` untuk `sharp` dan `@img/*`, lalu dibuktikan di AppImage. `sharp` juga dipakai untuk warna cover di Fase 5.
- **`migrateUrl(url, kind, fromVersion)`**:
  - dipanggil setelah extension diperbarui (versi berubah), untuk semua manga dan chapter source-nya, dalam transaksi. Bentrok unik dilewati dan dicatat di log;
  - `migratedVersion` disimpan per extension, supaya migrasi yang terputus (app ditutup) dilanjutkan saat start.
- **SDK + dokumentasi** untuk kedua hook, dan `mr-ext test` mendukung `transformImage` (menulis halaman hasil transform ke file).
- **E2E:**
  - situs palsu menyajikan gambar ter-XOR dan gambar 2×2 tile teracak; extension test memulihkannya;
  - pixel di reader diperiksa lewat canvas, dan CBZ hasil download berisi gambar yang sudah benar;
  - extension v1 → v2 mengubah skema `url`: library, progres, dan download tetap jalan.

**Checkpoint 4d:** E2E di atas lulus, dan AppImage dengan `sharp` jalan.

---

## Milestone 4e: Repo resmi, SDK di npm, panduan, dan MangaDex keluar dari app

- **Paket npm** `@matane/extension-sdk`, `-runtime`, dan `-cli` (MIT):
  - ganti nama tiga paket ini di monorepo;
  - build ke `dist/` (sekarang mengekspor sumber TS), `exports`/`types`, README, dan versi `0.1.0`;
  - `npm pack --dry-run` dicek;
  - workflow `publish-sdk.yml` (tag `sdk-v*`, `NPM_TOKEN`, provenance).
- **Repo `matane-extensions`**: kuscaffold di folder terpisah yang kamu tentukan, lalu kamu push. Isinya:
  - MangaDex dipindah dari `extensions/mangadex` (beserta test fixture-nya);
  - workflow `ci` (lint/test/build), `publish` (push ke main → `mr-ext repo build` dengan secret kunci → GitHub Pages), dan `smoke` (cron harian `mr-ext test` ke situs asli; membuka issue kalau gagal).
- **App:**
  - URL + kunci publik repo resmi ditanam, dan repo resmi ditambahkan otomatis;
  - `extensions/` bawaan dan `extraResources`-nya dihapus;
  - empty state Sources/Library mengarah ke Extensions → Tersedia;
  - **handoff** untuk pengguna beta lama: saat start, kalau library memakai extension yang tidak terpasang dan repo resmi menyediakannya, extension itu dipasang otomatis sekali (dengan notifikasi). Kalau offline atau gagal, muncul banner dengan tombol pasang.
- **Dokumentasi:**
  - `docs/extensions.md` menjadi panduan lengkap: SDK dari npm, create/test, repo sendiri + signing, transformImage/migrateUrl;
  - ADR 0022 (repo + signing + model kepercayaan), 0023 (siklus pasang/update/hapus + prioritas asal), dan 0024 (transformImage dengan `sharp`);
  - README, CHANGELOG `0.2.0-beta.1`, dan `BRAINSTORM.md` §11 (Fase 4 selesai).

**Checkpoint 4e:**
- Repo resmi hidup di GitHub Pages (setelah kamu push dan mengisi secret).
- App hasil build memasang MangaDex dari repo itu, dengan tanda tangan resmi terverifikasi.
- Profil `0.1.0-beta.1` dengan manga MangaDex dibuka di build baru: MangaDex terpasang otomatis dan library utuh.
- `npm pack` tiga paket berhasil. Publikasi npm dilakukan oleh CI setelah token kamu isi.

---

## File kunci

- **Main:**
  - `extensions/{repos,installer,logs}.ts` (baru);
  - `extensions/{registry,service,sources}.ts`, `images/service.ts` (transform), dan `library/migration`-like runner untuk `migrateUrl` (baru, `extensions/url-migration.ts`);
  - `db/schema/extensions.ts` + migrasi drizzle baru, `ipc/handlers.ts`, dan `index.ts`.
- **Paket:**
  - `packages/extension-sdk/src/{repo,types,manifest}.ts`;
  - `packages/extension-runtime/src/{prelude,runtime}.ts` (aesDecrypt, `__transformImage`, `__migrateUrls`);
  - `packages/extension-cli/src/{repo,cli}.ts`.
- **Shared:** model `RepoEntry` / `AvailableExtension` / `InstallPreview`, `settings.browse`, dan kontrak IPC.
- **Renderer:**
  - `features/extensions/` (halaman sesuai 09, `RepositoriesPanel`, `InstallDialog`, `LogDialog`);
  - `features/settings/BrowseSettings.tsx`;
  - filter NSFW/bahasa di `features/browse`, `features/search`, dan sidebar.
- **Build/CI:** `apps/desktop/electron-builder.yml` (sharp, tanpa extension bawaan), `.github/workflows/publish-sdk.yml`, dan scaffold repo extension.
- **E2E:**
  - `e2e/support/site.ts`: menyajikan repo bertanda tangan, gambar teracak/terenkripsi, dan extension v1/v2;
  - spec baru `extensions.spec.ts` dan `transform.spec.ts`.
  - E2E yang sekarang memakai folder dev tetap jalan.

## Keamanan (berlaku di semua milestone)

- Tanda tangan diverifikasi atas byte persis `index.json`, dan sha256 wajib cocok untuk setiap zip.
- HTTPS saja untuk repo (kecuali localhost), dengan batas ukuran index dan zip.
- Zip hanya boleh berisi file datar yang diizinkan, dan `apiVersion` dicek.
- Extension tidak pernah diperbarui diam-diam dari repo lain, dan domain baru selalu ditanyakan.
- Kunci privat hanya disimpan sebagai secret CI.

## Verifikasi

1. **Per milestone:** `pnpm lint`, `format:check`, `typecheck`, `test`, dan `e2e` hijau, termasuk unit test baru untuk signing/verify, sha256, zip-slip, installer (atomik, update, hapus), aturan kepercayaan, filter NSFW/bahasa, aesDecrypt, eksekusi tiles, dan `migrateUrl`.
2. **E2E** memakai situs palsu tanpa jaringan: repo bertanda tangan, pasang/update/hapus, gambar teracak dan terenkripsi, dan migrasi url.
3. **Live check** di app hasil build (profil dan folder terpisah):
   - repo lokal lewat server HTTP;
   - di 4e: repo resmi di GitHub Pages + MangaDex asli;
   - handoff dari profil `0.1.0-beta.1`;
   - dibandingkan dengan mockup 09/09b.
4. **Paket:** AppImage dengan `sharp` jalan, `npm pack --dry-run` ketiga paket berhasil, dan `actionlint` lolos untuk workflow baru.

## Yang perlu kamu siapkan (paling lambat di 4e)

- Repo GitHub `matane-extensions` + GitHub Pages.
- Kunci ed25519: kamu menjalankan `mr-ext repo keygen` sendiri, memasukkan kunci privat ke secret `MR_REPO_KEY`, dan memberiku kunci publiknya.
- Organisasi npm `matane` + `NPM_TOKEN`.

## Status pelaksanaan

- 27 Sep 2026: rencana disetujui dan disimpan di sini. Implementasi dimulai dari Milestone 4a.

### Milestone 4a: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 7 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (sdk 18, shared 17, runtime 35, cli 13, mangadex 16, desktop 174). E2E 56/56.
- Test baru:
  - **runtime** (`repo.test.ts`, 21):
    - tanda tangan diverifikasi, tapi gagal kalau satu byte index berubah, kuncinya lain, atau tanda tangannya rusak;
    - `signerOf` memilih kunci yang cocok, dan kunci yang bukan ed25519 ditolak;
    - `parseRepoIndex` menolak JSON rusak, `formatVersion` lain, path keluar repo, ikon milik extension lain, id kembar, dan hash tidak valid;
    - arsip ditolak kalau berisi path bersarang, folder, file tambahan, nama `../` (zip-slip, disisipkan manual), tanpa `index.js`, manifest rusak, atau API lebih baru; juga kalau manifest berbeda dari index (domain tambahan, versi lain), kalau bytenya berubah (sha256), atau kalau bukan zip.
  - **cli** (`repo.test.ts`, 7):
    - repo bertanda tangan dari extension sumber (dibangun + minify) dan extension jadi terverifikasi, dan index terurut per id;
    - build dua kali (urutan argumen dibalik) menghasilkan byte identik;
    - satu byte `index.json` atau zip diubah → `verify` gagal dengan pesan yang tepat;
    - kunci salah, repo tanpa tanda tangan, dan ikon hilang dilaporkan, dan verify lewat URL jalan;
    - build ulang menimpa output lamanya sendiri (zip usang terhapus), tapi menolak folder lain yang tidak kosong dan id kembar;
    - `keygen` menulis file mode 600 dan tidak menimpa kunci yang sudah ada.
- Checkpoint, dicek dengan CLI asli (`pnpm exec mr-ext repo …`):
  - `keygen` mencetak kunci publik, dan menolak saat dijalankan kedua kali. `build` tanpa kunci menolak (butuh `--key`, `$MR_REPO_KEY`, atau `--unsigned`).
  - Repo dari MangaDex (dibangun dari sumber) + extension E2E (bundle jadi dari `extensionFiles`) → `verify --public-key` OK, baik dari folder maupun lewat HTTP (`python -m http.server`).
  - Build ulang lewat `$MR_REPO_KEY` dengan urutan argumen dibalik → sha256 `index.json`, `.sig`, dan kedua zip identik.
  - Diubah satu byte:
    - `index.json` (`size` 8157 → 8158): tanda tangan tidak cocok, dan ukuran zip MangaDex tidak cocok;
    - zip MangaDex: hanya sha256 zip itu yang dilaporkan, sementara tanda tangan tetap valid;
    - kunci publik lain: tanda tangan tidak cocok.
    - Setiap kasus keluar dengan kode 1.

Implementasi:
- **SDK** (`packages/extension-sdk`):
  - `src/repo.ts` (subpath baru `@manga-reader/extension-sdk/repo`, zod, tanpa Node) berisi:
    - `repoIndexSchema` / `repoEntrySchema`, `publicKeySchema`, `REPO_LIMITS` (index 2 MB, zip 20 MB, ikon 512 KB, manifest 64 KB, kode 10 MB), `ARCHIVE_FILES`, serta `archivePath()` / `iconPath()`.
    - Index: `formatVersion: 1`, `name`, `publicKey?` (informatif), dan `extensions[]` berisi `id`, `name`, `version`, `apiVersion`, `description?`, `nsfw`, `langs` (dari sources, unik dan terurut), `domains`, `file`, `size`, `sha256`, dan `icon`.
    - `file` dan `icon` wajib sama persis dengan path baku (`extensions/<id>-<versi>.zip`, `extensions/icons/<id>.png`, sesuai §5.8), jadi index tidak bisa menunjuk ke luar repo atau ke file extension lain.
  - `manifest.ts`: `extensionIdSchema` diekspor, plus field opsional `description` (maks 200 karakter; mockup 09 menampilkannya).
- **Runtime** (`packages/extension-runtime/src/repo.ts`, subpath `./repo`, `node:crypto` + `yauzl`), dipakai CLI sekarang dan installer app di 4b:
  - `generateRepoKey`, `publicKeyOf`, `parsePublicKey`, `signIndex`, `verifyIndexSignature`, `signerOf`, `sha256Hex`, `parseRepoIndex`, `checkArchiveHash`, `entryFields`, dan `readExtensionArchive`;
  - `RepoError` dengan kode `bad-key`, `bad-index`, `bad-signature`, `hash-mismatch`, dan `bad-archive`;
  - `readExtensionArchive` membaca arsip di memori dan memvalidasi isinya:
    - hanya file datar yang diizinkan, ukuran yang dideklarasikan dicek sebelum dibaca;
    - manifest harus valid dan apiVersion didukung;
    - dengan entry index, id, versi, apiVersion, nsfw, langs, dan domain wajib sama dengan index.
- **CLI** (`packages/extension-cli/src/repo.ts` + `cli.ts`): `mr-ext repo keygen --out`, `mr-ext repo build <ext...> -o <dir> [--name] [--key | $MR_REPO_KEY | --unsigned]`, dan `mr-ext repo verify <dir|url> [--public-key]`.
  - Zip deterministik (`yazl`): entri *stored* tanpa kompresi (zip hanya beberapa KB, dan hasilnya tidak bergantung versi zlib), mtime DOS tetap 1980-01-01 tanpa extra field timestamp, mode 644, dan urutan file tetap.
  - Tanpa `--public-key`, `verify` memakai kunci di index dan menyebutnya "bukan cek kepercayaan".
- **Dokumentasi**: `docs/extensions.md` mendapat bagian "Publishing a repository", plus `icon.png` dan `description` di layout/manifest.
- **Di luar rencana:** popover Filter di library sekarang bisa di-scroll dan tidak melewati tepi jendela (`max-h` = tinggi yang tersedia + `collisionPadding`). Dengan jendela test yang pendek (Hyprland memberi 1900×620), tombol "Clear filters" sebelumnya berada di luar layar dan E2E library gagal.

Beda dari rencana:
- Manifest **tidak** mendapat field `icon`. Ikonnya cukup `icon.png` di folder extension (sudah disalin oleh `mr-ext build`), jadi tidak ada path bebas yang perlu divalidasi.
- Fungsi tanda tangan dan pembaca arsip ada di **runtime**, bukan SDK. SDK tetap tanpa Node (`types: []`), sedangkan runtime memang paket sisi host yang dipakai app dan CLI.
- Path ikon mengikuti §5.8 (`extensions/icons/<id>.png`).

Catatan:
- Test `RateLimiter` di `cli.test.ts` (sudah ada sejak Fase 1) sekali gagal saat semua paket dites paralel. Tiga kali dijalankan ulang selalu lulus. Test ini bergantung pada timing, jadi mungkin perlu toleransi.

### Milestone 4b: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 7 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (desktop 199: +25).
  - Test baru `extensions/repos.test.ts` (21):
    - normalisasi URL (HTTPS saja, HTTP hanya loopback, `…/index.json` diterima, login di URL ditolak);
    - `evaluateTrust`: resmi / kunci dipercaya / kunci tak dikenal / tanpa tanda tangan / tanda tangan palsu (index menyebut kunci resmi, tapi ditandatangani kunci lain);
    - repo resmi langsung ditambahkan; repo tidak terverifikasi butuh konfirmasi, lalu kuncinya bisa dipercaya; repo tanpa tanda tangan tidak bisa "dipercaya";
    - sync mengambil index baru. Kalau repo yang dulunya bertanda tangan sekarang berisi index yang diubah atau ditandatangani kunci lain, index lama dipertahankan dan errornya dicatat; setelah diperbaiki, errornya hilang. Sync yang gagal (jaringan) tidak menghapus index;
    - installer: prepare tidak menulis apa pun; install menulis `manifest.json` + `index.js` + `icon.png`, token hanya sekali pakai; update dari repo yang sama (tanpa domain baru langsung terpasang, dengan domain baru dikembalikan untuk konfirmasi); id yang sama dari repo lain ditolak; zip yang diubah ditolak (sha256) tanpa menulis apa pun;
    - uninstall menghapus folder, storage, prefs, dan session, sementara source tetap ada; pasang lagi jalan; setelah uninstall, versi bawaan dengan id yang sama aktif lagi;
    - pemulihan install yang terputus (`.tmp` dihapus, `.old` tanpa folder dikembalikan).
  - `network/fetch-bytes.test.ts` (4): 404 → null, error HTTP/jaringan, batas ukuran (dengan dan tanpa `content-length`), timeout.
- E2E 64/64. Spec baru `e2e/extensions.spec.ts` (8 test). Situs palsu menyajikan repo yang dibangun dengan `mr-ext repo build`, dan kunci "resmi" adalah kunci test (`MATANE_E2E_OFFICIAL_KEY`):
  - tambah repo resmi → badge "Verified" → tab Tersedia → dialog pasang (repo resmi, domain, API version, "SHA-256 verified") → terpasang, "Up to date", ikon tampil;
  - source dari extension terpasang bisa di-browse, lalu manga masuk library;
  - update dengan domain baru: titik di sidebar, tab Update, dialog menandai domain "New" dan menampilkan peringatan; update tanpa domain baru lewat "Update all" terpasang tanpa dialog;
  - zip yang diubah satu byte → dialog "Cannot install this extension … sha256 mismatch", versi tetap;
  - uninstall → source "tidak terpasang", manga tetap di library, dan halaman source menampilkan "Not installed"; pasang lagi → manga normal (chapter terbaca);
  - repo tidak terverifikasi: peringatan saat menambah ("Signed with a key this app does not know"), "Add anyway", peringatan di dialog pasang, "Trust this key" (kuncinya ditampilkan) → "Trusted key";
  - index yang diubah setelah ditandatangani → "The signature does not match the index";
  - setelah restart, extension terpasang dan repo (beserta tingkat kepercayaannya) tetap ada, dan source-nya jalan.
- Live check di app hasil build (profil `XDG_CONFIG_HOME` dan folder download terpisah; repo lokal lewat `python -m http.server`; kunci resmi di-override lewat `MATANE_E2E_OFFICIAL_KEY`):
  - repo resmi berisi **MangaDex asli** (bundle `dist/` + ikon, 1.1.0) dan repo komunitas bertanda tangan kunci lain → dialog tambah repo tidak terverifikasi, tab Tersedia, dialog pasang (09b) untuk keduanya, lalu terpasang;
  - MangaDex dari repo menggantikan versi bawaan (`origin: repo`, `repoId` 1), dan Popular/Latest MangaDex asli tampil (48 dan 41 manga);
  - MangaDex 1.2.0 dengan domain tambahan `mangadex.org` → dialog update menandai domain itu "New" → terpasang;
  - uninstall Nebula dari menu baris → foldernya hilang dan extension muncul lagi di tab Tersedia;
  - **AppImage** (`pnpm dist:linux`) dengan profil yang sama memuat `mangadex@1.2.0 (repo)` dari `userData/extensions`.
  - Dibandingkan dengan mockup 09/09b: struktur sama (judul + badge jumlah update, Repositories / Update all, tab dengan jumlah, pencarian + filter bahasa, baris dengan ikon, versi, bahasa, garis kepercayaan, deskripsi, tombol update/setting/menu; panel repositori dengan badge, jumlah, waktu sinkron, sinkron, menu, dan "Add repository"; dialog pasang sama persis susunannya).
  - Hyprland men-tile jendela (lebar 992 px dan `setSize` diabaikan), jadi tata letak sempit ikut teruji: baris membungkus tombol aksinya ke bawah, dan garis kepercayaan tidak terlipat.

Implementasi:
- **DB:**
  - migrasi `0003_extension_repos`: `extension_repos` mendapat `index_json`, `signature`, dan `last_error`. Kolom `trusted` dihapus; kepercayaan sekarang berupa kunci (`public_key` = kunci yang dipercaya pengguna), bukan flag;
  - `ReposRepository` (repo + asal repo extension); `ExtensionsRepository.remove` (storage/prefs ikut terhapus lewat cascade).
- **Main:**
  - `network/fetch-bytes.ts`: `net.fetch` dengan revalidasi cache, timeout, dan batas ukuran yang dicek saat streaming.
  - `extensions/official.ts`: `OFFICIAL_KEYS` (masih kosong sampai 4e), plus kunci test lewat `MATANE_E2E_OFFICIAL_KEY` (hanya dengan `MATANE_E2E`).
  - `extensions/repos.ts` (`RepoService`):
    - `normalizeRepoUrl`, `evaluateTrust`, add/remove/sync/trustKey;
    - sync terjadwal: 15 detik setelah start, lalu tiap jam untuk repo yang lebih tua dari 24 jam, hanya saat online;
    - index yang diterima disimpan byte-per-byte bersama tanda tangannya, dan kepercayaan dihitung ulang dari situ;
    - repo resmi/dipercaya tidak pernah menerima index yang tidak lagi ditandatangani kuncinya.
  - `extensions/installer.ts` (`ExtensionInstaller`): `available`, `prepare` (unduh ≤ ukuran di index, cek sha256, validasi isi dan manifest), `install` (tulis atomik `<id>.tmp` → `<id>`, dengan `<id>.old` sebagai cadangan), `updateAll`, `uninstall`, `recover`.
  - `extensions/icons.ts` + protokol `manga://extension-icon/<id>` dan `manga://repo-icon/<repoId>/<id>` (hanya PNG; ikon repo di-cache di memori 24 jam).
  - `ExtensionRegistry` membaca `userData/extensions` sebagai asal `repo` (prioritas dev > repo > bawaan; folder dengan titik dilewati). `ExtensionEntry` mendapat `description`, `langs`, `domains`, `repoId`, dan `hasIcon`.
  - IPC `repos.list/add/remove/sync/trustKey` dan `extensions.available/prepareInstall/install/cancelInstall/updateAll/uninstall`, tag `repos`, dan kode error `repo`.
- **Renderer:**
  - `features/extensions/ExtensionsPage.tsx` ditulis ulang sesuai mockup 09: tab Terpasang/Tersedia/Update dengan jumlah, pencarian, filter bahasa (lokal; menjadi setting di 4c), "Update all", dan baris per asal (bawaan, repo dengan garis kepercayaan, dev dengan path + Reload);
  - `RepositoriesPanel.tsx` (panel + dialog tambah repo dengan konfirmasi tidak terverifikasi), `InstallDialog.tsx` (09b), `parts.tsx` (ikon dengan fallback inisial, badge dan garis kepercayaan, badge bahasa);
  - `lib/extensions.ts`; titik di sidebar saat ada update extension; teks EN/ID.
- **ADR** 0022 (repo + tanda tangan + model kepercayaan) dan 0023 (siklus pasang/update/hapus + prioritas asal), ditulis sekarang karena keputusannya lahir di 4b (rencana awal: di 4e).
- **E2E support:** `site.publishRepo()` (membangun dan menyajikan repo), `extensionFiles` dengan override versi/domain/deskripsi, dan `launchApp(extensions, env)`. `@manga-reader/extension-cli` menjadi devDependency desktop.

Beda dari rencana:
- `extensions` **tidak** mendapat kolom `origin`, `sha256`, dan `domains_json`. Asal dan domain diambil dari registry (folder dan manifest di disk), dan sha256 dicek saat pasang, jadi tidak perlu disimpan. Asal repo tetap di `extensions.repo_id` yang sudah ada.
- **Tidak ada event progres install.** Arsip paling besar 20 MB (biasanya beberapa KB), jadi dialog cukup menampilkan "Downloading and verifying…".
- "Id yang sama di dua repo, pengguna memilih satu": repo yang dipasang pertama menang. Repo lain menampilkan "Installed from another repository", dan pengguna bisa uninstall dulu untuk memilih yang lain.
- Toggle "Show NSFW" di mockup masuk 4c bersama setting-nya.

Catatan:
- Di satu live run, log mencatat `Unhandled TypeError: This database connection is busy executing a query`. Error ini muncul dari `saveState` jendela, yang dipanggil `app.close()` Playwright lewat `eval` inspector. Inspector bisa menyela JavaScript yang sedang berjalan (misalnya di tengah konversi baris query), jadi ini artefak harness test. Menutup jendela biasa lewat event loop tidak mengalami ini.

### Milestone 4c: selesai (29 Sep 2026), menunggu review

- `lint` (tanpa error; 7 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (shared 21: +4, desktop 202: +3). E2E 71/71.
- Test baru:
  - **shared** `content.test.ts`: bahasa konten default (bahasa UI + EN), subtag (`pt-br` cocok dengan `pt`), `all`/`multi` selalu tampil, NSFW tersembunyi sampai dinyalakan, nilai tersimpan yang rusak kembali ke default.
  - **desktop**:
    - `logs.test.ts`: ring buffer 500 baris per extension, pesan dipotong di 2000 karakter, nomor urut, dan clear;
    - `content.test.ts`: bahasa awal untuk profil lama (source yang di-pin, pernah dipakai, atau punya manga di library);
    - `services.test.ts`: source NSFW ditolak (`nsfw_hidden`) di browse dan `resolveUrl` selama tersembunyi, lalu jalan setelah dinyalakan; request HTTP dan jawaban extension yang tidak valid tercatat di log.
- E2E: spec baru `e2e/content.spec.ts` (6 test), plus 1 test di `extensions.spec.ts`. Extension baru di situs palsu: **E2E Adult** (NSFW, request-nya membawa `lang=nsfw`).
  - default: hanya EN, sementara 3 source tersembunyi (MangaDex ID, Mirror ID, Adult) beserta keterangan jumlahnya; tab Tersedia menyembunyikan 2 extension;
  - bahasa konten dipilih dari toolbar Extensions (menjadi setting `['en','id']`), lalu Mirror muncul di Tersedia dan Sources;
  - selama NSFW mati: source Adult tidak ada di Sources, URL langsung menampilkan "Adult sources are hidden", dan global search tidak pernah mengirim request `lang=nsfw`;
  - menyalakan NSFW meminta konfirmasi (Cancel tidak mengubah apa pun); setelah dinyalakan, source Adult ada di Sources, bisa di-browse, ikut dicari global search, dan extension-nya tampil di Tersedia dengan badge 18+;
  - Settings → Browse & extensions berisi kartu repositori ("Verified"), toggle update otomatis, dan interval sinkron (12 jam tersimpan);
  - dialog log extension dev: baris `log.info` extension, `GET … → 200`, `→ 404`, dan error panggilan `search (en): …` tampil live; filter "Errors" menyisakan 1 baris; Clear mengosongkan;
  - update otomatis: sinkron memasang 1.4.0 sendiri, sedangkan 1.5.0 yang menambah domain tetap menunggu tombol "Update to v1.5.0".
- Live check di app hasil build (profil terpisah, MangaDex asli):
  - profil lama tanpa setting `browse` yang pernah memakai MangaDex ID → saat start, bahasa konten diisi `["en","id"]`;
  - dengan default, Sources menampilkan MangaDex EN dan "1 source hidden by your content settings";
  - Settings → Browse & extensions dan pemilih bahasa (bahasa umum + bahasa source/repo, dengan satu bahasa minimal tetap aktif) tampil rapi;
  - dialog log MangaDex menampilkan request API asli (`GET https://api.mangadex.org/manga?… → 200 (176 ms)`) secara live.

Implementasi:
- **Shared:**
  - `settings.browse`: `showNsfw` (false), `languages` (null = bahasa UI + EN), `autoUpdateExtensions` (false), dan `repoSyncHours` (6/12/24/48/168, default 24);
  - `contentLanguages`, `isContentVisible`, `primaryLanguage`;
  - `SourceEntry.nsfw`, `ExtensionLogEntry`, kode error `nsfw_hidden`, IPC `extensions.logs/clearLogs`, dan event `extensions.log`.
- **Main:**
  - `SourceService` menolak browse/search source NSFW selama tersembunyi, dan `resolveUrl` melewatinya. Ini penjaga di main, jadi URL langsung atau pemanggil lain tetap tertolak.
  - `extensions/logs.ts` (`ExtensionLogs`): ring buffer di memori yang didorong live ke renderer. Isinya:
    - `log.*` extension;
    - setiap request HTTP (`debug`, atau `warn` untuk ≥ 400, `error` kalau gagal) beserta durasinya;
    - panggilan yang gagal;
    - jawaban extension yang tidak lolos validasi. `ExtensionService.call` sekarang menerima parser, jadi validasi dan pencatatannya ada di satu tempat.
  - `RepoService`: interval sinkron dari setting, dan `onSynced`. Dengan `autoUpdateExtensions`, update tanpa domain baru dipasang sendiri (satu proses pada satu waktu), sementara sisanya tetap ditandai.
  - Profil lama tanpa setting `browse`: bahasa awal = bahasa UI + EN + bahasa source yang sudah dipakai (`extensions/content.ts`). Profil baru tetap memakai default yang mengikuti bahasa UI.
- **Renderer:**
  - `lib/content.ts` (`useContentFilter`);
  - `ContentControls.tsx`: pemilih bahasa konten dan toggle NSFW dengan konfirmasi, dipakai di toolbar Extensions (sesuai mockup 09) dan di Settings;
  - filter diterapkan di tab Terpasang/Tersedia/Update (extension dev selalu tampil), Sources, Global search, dan target Migrasi, dengan keterangan "N hidden by your content settings · Change";
  - `features/settings/BrowseSettings.tsx` (masuk `READY_SECTIONS`): konten, extension (update otomatis, interval), dan repositori (kartu yang sama dengan panel);
  - `LogDialog.tsx`: tail live, filter level (All/Info/Warnings/Errors), Copy, dan Clear. Tombol "View logs" ada di baris dev (seperti mockup 09) dan di menu baris lainnya;
  - `lib/now.ts` (`useNow` dipakai bersama Updates dan Extensions). Teks EN/ID.
- **E2E support:** extension `adult`, `log.info` di `getPopular` extension test, dan `launchApp` menyetel bahasa konten `['en','id']` supaya spec lama yang memakai Mirror (ID) tetap berjalan.

Beda dari rencana:
- Filter bahasa berlaku juga di Global search dan target Migrasi, tidak hanya di daftar source, supaya hasilnya konsisten di semua tempat.
- Extension dev tidak ikut disaring, karena pembuat extension harus selalu melihat extension yang sedang dikerjakannya.
- Profil lama mendapat bahasa awal dari source yang sudah dipakai. Ini tidak ada di rencana; tujuannya supaya update tidak menyembunyikan source yang sedang dibaca pengguna beta.
