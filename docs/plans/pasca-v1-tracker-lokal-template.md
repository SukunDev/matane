# Plan: Tracker, source file lokal, dan template CMS (setelah v1)

## Context

Tiga item "Setelah v1" di `docs/BRAINSTORM.md` dikerjakan sekarang. Dua item lain
(login per source dan sinkronisasi antar perangkat) dibatalkan oleh pengguna dan sudah dihapus dari semua docs (Langkah 0).

Pekerjaannya besar dan beda sifat, jadi dipecah jadi 6 milestone, diurutkan dari kecil ke besar
(keputusan pengguna): **Lokal -> Template -> Tracker**. Plan ini tidak mengubah 5g (rilis v1.0);
kapan fitur ini dirilis kamu yang menentukan.

Keputusan pengguna: login OAuth tracker memakai **loopback `127.0.0.1`** (bukan deep link `matane://`
seperti rancangan lama di BRAINSTORM, karena registrasi protokol tidak andal di AppImage/portable).

Aturan kerja yang tetap berlaku (memori proyek): plan disimpan di repo sebelum kode, **tidak ada
commit**, berhenti di tiap checkpoint untuk review, status ditulis di dokumen plan, dokumen plan
berbahasa Indonesia, formatter hanya untuk file yang disentuh, tidak ada nama situs sungguhan di
docs/tes/fixture (pakai "Example Source" dan domain `example.org`).

## Langkah 0: sebelum milestone apa pun (selesai 4 Okt 2026)

**0a. Hapus dua rencana yang dibatalkan dari docs (selesai).** Titik yang ditemukan:
- `docs/BRAINSTORM.md:381`: bullet "Login per source: ditunda setelah v1..." (hapus).
- `docs/BRAINSTORM.md:783`: "Sinkronisasi antar perangkat yang sesungguhnya." di bawah "Setelah v1" §6.7 (hapus).
- `docs/BRAINSTORM.md:1059` dan `:1063`: dua bullet yang sama di daftar roadmap "Setelah v1" (hapus).
- `docs/plans/fase-4-ekosistem-extension.md:35`: ubah menjadi "Template CMS (Madara dan sejenisnya) dikerjakan setelah v1."
- `docs/plans/fase-5-polish-rilis.md:57`: buang "login per source" dan "sinkronisasi antar perangkat" dari daftarnya.
- Sengaja **tidak** diubah: `BRAINSTORM.md:779` (tip memakai Dropbox/Syncthing untuk folder auto-backup; itu fitur backup yang sudah ada) dan `:512` ("sinkronisasi dua arah tracker"; itu bagian tracker).
- Cek akhir: `git grep -n -i -E 'login per|antar perangkat'` hanya boleh menyisakan `BRAINSTORM.md:779`.

**0b. Simpan plan ini di repo (selesai)** sebagai `docs/plans/pasca-v1-tracker-lokal-template.md`, dengan bagian "Status pelaksanaan" di bawah.

## Milestone 6a: Source file lokal (CBZ / folder)

Pendekatan: **source native di main**, bukan extension QuickJS (sandbox tidak boleh akses disk).
Ia mengikuti interface `Source` (`packages/extension-sdk/src/types.ts:143`) dan tampil seperti source lain
di Browse, Library, reader, Updates.

**Tata letak folder:** `<root>/<Judul manga>/<chapter>`; chapter = berkas `.cbz`/`.zip` atau subfolder
gambar; folder manga yang langsung berisi gambar = satu chapter (oneshot). Opsional `cover.jpg|png|webp`
di folder manga, dan `ComicInfo.xml` di dalam CBZ (Series, Writer, Penciller, Summary, Genre, Title,
Number). `.cbr/.rar/.7z` tidak didukung (didokumentasikan).

**Kode (baru):** `apps/desktop/src/main/local/`
- `scan.ts`: daftar manga/chapter, urut natural (`pageNames`/`byName` di `downloads/archive.ts:20`), cache per mtime folder.
- `comicinfo-read.ts`: pembaca XML kecil (hanya tag di atas, batas 256 KB, tanpa dependensi baru). Lawan dari `downloads/comicinfo.ts`.
- `source.ts` (`LocalSource`): `__info`, `__preferences`, `getPopular` (abjad), `getLatest` (mtime), `search` (substring), `getMangaDetails`, `getChapters`, `getPages`.
- `store.ts` (`LocalStore`): `pages(chapterId)` dan `page(chapterId, index)` lewat **`DownloadReader`** yang sudah ada (`downloads/archive.ts:80`, CBZ akses acak + folder); `cover(mangaId)` = `cover.*`, atau halaman pertama chapter pertama.
- URL relatif terhadap root (manga = nama folder, chapter = `<manga>/<chapter>`), jadi memindahkan root tidak merusak library dan backup (kunci alami `sourceId + url`).
- **Keamanan** (pelajaran audit no. 1): satu fungsi `safeJoin(root, relative)` yang menolak `..`, path absolut, dan symlink yang keluar dari root (`realpath`); dipakai semua jalur baca. File tersembunyi (titik) dilewati.

**Titik sambung (file yang diubah):**
- `extensions/registry.ts`: entri sintetis `local` (origin `builtin`, manifest di kode, `code: ''`), supaya `ExtensionService.init` meng-upsert manifest dan baris `sources` otomatis.
- `extensions/service.ts`: `call`/`transformImage`/`migrateUrls` dan `require()` mengalihkan `extensionId === 'local'` ke dependensi baru `native?` (tanpa host QuickJS).
- `extensions/sources.ts` `SourceService.pages` (sekitar baris 243) dan `images/service.ts` `page`/`findCover`: cek `LocalStore` sebelum download dan jaringan, pola sama dengan `downloads?.pages` / `downloads?.page`.
- `packages/shared/src/settings.ts`: `local: { folder: string | null }` (default `null`). IPC `local.chooseFolder` / `local.info` meniru `backup.chooseFolder` (`channels.ts`, `contract.ts`, `ipc/handlers.ts`). UI di `settings/BrowseSettings.tsx` (pilih, buka, scan ulang); status kosong di Browse "Pilih folder".
- Tombol Download dan otomatisasi download disembunyikan/ditolak untuk manga `local` (`manga/DownloadButton.tsx`, `downloads/manager.ts`).
- Filter bahasa konten: pastikan source `local` selalu terlihat (cek `extensions/content.ts`; kalau `lang` perlu nilai khusus, pakai `all` dan kecualikan dari filter).
- i18n `en.json` + `id.json`.

**Docs:** ADR 0033, `apps/docs/guide/local.md` + sidebar, CHANGELOG (Unreleased), BRAINSTORM (coret "Source file lokal").

**Tes:** unit (scan semua tata letak, `safeJoin` dengan `..`/absolut/symlink, ComicInfo, urutan natural, dispatch `call` ke native, `ImageService` lokal sebelum jaringan); e2e baru `local.spec.ts` (folder fixture berisi CBZ buatan `yazl` + folder gambar: browse, tambah ke library, baca, chapter baru terdeteksi).

**Checkpoint 6a:** folder contoh terbaca di app, chapter CBZ dan folder terbaca di reader tanpa jaringan, `..` ditolak.

## Milestone 6b: Template extension CMS (Madara, MangaThemesia)

Pendekatan: **pustaka yang di-bundle ke extension**, tanpa perubahan di app (berjalan di sandbox seperti extension biasa).
- Paket baru `packages/extension-templates` (`@matane/extension-templates`, MIT, mengikuti pola `publishConfig` -> `dist` dan versi 0.x seperti paket lain). Ekspor `createMadaraSource(config)` dan `createMangaThemesiaSource(config)` yang mengembalikan `(info: SourceInfo) => Source`, supaya penulis bisa menimpa satu metode: `createSource: (info) => ({ ...madara({ baseUrl }), search: custom })`.
- `config`: `baseUrl`, override selektor, path/listing, `useAjaxChapters`, header gambar, format tanggal. Memakai `http`, `html`, `parseRelativeDate` (`extension-sdk/src/date.ts`), dan `storage` (cache genre) yang sudah ada. Parsing ringan karena batas CPU sandbox 2 detik.
- **Struktur HTML tema harus diverifikasi terhadap perilaku tema saat implementasi** (belum saya cek di sini; catatan di BRAINSTORM juga bilang API perlu dicek ulang). Perkiraan awal: Madara memakai `admin-ajax.php` dan `.../ajax/chapters/` untuk daftar chapter; MangaThemesia memakai `.listupd .bsx`, `#chapterlist`, dan JSON `ts_reader.run(...)` untuk halaman.
- Fixture: HTML **buatan sendiri** dengan judul fiktif dan `example.org`, tidak disalin dari situs mana pun.
- CLI: `mr-ext create <id> --template html|madara|mangathemesia` (default `html` = perilaku sekarang). Ubah `packages/extension-cli/src/create.ts` (`template(domain)` jadi pemilih template; dependensi `@matane/extension-templates` mengikuti logika `layout` yang sudah ada untuk SDK) dan `cli.ts` (opsi `--template`), plus `cli.test.ts`.
- Rilis npm: tambahkan ke `.github/workflows/publish-sdk.yml` dan skrip `check-versions` (tag `sdk-v*`). `SDK_API_VERSION` tidak berubah (tidak ada perubahan host).
- Docs: ADR 0034, `apps/docs/extensions/templates.md` + sidebar, CHANGELOG.
- Tes: unit per template dengan fixture lewat `createNodeHost` dari `extension-cli`; tes scaffold untuk tiap `--template`.

**Checkpoint 6b:** `mr-ext create x --template madara` menghasilkan proyek yang lolos `mr-ext build` dan `mr-ext test` terhadap fixture.

## Milestone 6c: Kerangka tracker + AniList

Tabel `tracker_accounts`, `manga_tracks`, `tracker_queue` sudah ada di migrasi `0000_init.sql`
(skema di `db/schema/tracking.ts`), dan `backup.ts` sudah punya field `tracks` tanpa token. Kemungkinan
tidak perlu migrasi baru: refresh token disimpan sebagai JSON `{access, refresh}` terenkripsi di
`tokenEncrypted`. Bagian Settings `tracking` sudah dicadangkan di `settings/sections.ts` (tinggal
dipindah ke `READY_SECTIONS`).

**Kode (baru):** `apps/desktop/src/main/trackers/`
- `types.ts`: antarmuka `Tracker` (`id`, `connect`, `search(title)`, `getEntry`, `update(entry)`), status ternormalisasi (reading/completed/on_hold/dropped/plan), skor, progres (nomor chapter), tanggal mulai/selesai.
- `accounts.ts`: simpan/baca token terenkripsi. **Pakai ulang pola `network/control.ts`**: `safeStorage` dengan awalan `enc:` + base64 dan fallback teks biasa bila keyring tidak ada (mesin ini tidak punya keyring), dengan peringatan di UI.
- `oauth.ts`: server loopback sementara di `127.0.0.1` (port tetap per layanan, hanya hidup selama login, `state` acak, timeout 3 menit) + `shell.openExternal` ke browser sistem. AniList memakai implicit grant (token ada di fragment URL yang tidak sampai ke server), jadi halaman callback kecil milik kita membaca `location.hash` dan mengirimnya balik ke server; tanpa sumber daya eksternal.
- `anilist.ts`: GraphQL (`SaveMediaListEntry`, `Media` search). Client ID (publik, bukan rahasia) di `client-ids.ts` dengan nilai awal `null` dan override env, **pola `app/discord.ts:8`**; fitur tersembunyi sampai terisi.
- `service.ts` (`TrackerService`) dan `queue.ts`: antrean di `tracker_queue` (coalescing: terbaru menang per manga+layanan, backoff eksponensial lewat `nextAttemptAt`, jalan saat online lewat `OnlineMonitor`, 401 menandai akun kedaluwarsa). Request lewat `sessionFetch(session.defaultSession)` (`network/electron-fetch.ts`) supaya DoH dan proxy berlaku.
- **Hook push**: tambahkan callback opsional `onRead(mangaId)` di `ProgressRepository` (`db/repositories/progress.ts`; `save` saat `finished` dan `markRead(read=true)`), yang menjadi satu-satunya pintu: reader, "tandai dibaca", migrasi source semuanya lewat `setRead`. `TrackerService` menghitung nomor chapter terbaca tertinggi lalu mengantre pembaruan. **Incognito**: dorongan dari aktivitas reader tidak dikirim (aturan di `ReadingService`); aksi eksplisit pengguna tetap.
- Hanya manga **di library** dengan link yang didorong.

**UI:** `features/tracking/TrackingDialog.tsx` dari `MangaDetailPage.tsx` (cari + link otomatis dari judul, status, skor, chapter terbaca, tanggal, hapus link, buka di tracker); `settings/TrackingSettings.tsx` (hubungkan/putuskan, nama pengguna, jumlah antrean, galat terakhir). IPC `trackers.*`, event `trackers.changed`.

**Backup:** pastikan `backup/export.ts` mengisi `tracks` dan `restore.ts` memulihkannya (tanpa token); tes round-trip.

**Docs:** ADR 0035 (kerangka tracker), `apps/docs/guide/tracking.md`, CHANGELOG, i18n en/id.

**Tugasmu (seperti Discord Application):** daftarkan aplikasi di AniList dengan redirect `http://127.0.0.1:<port>/callback`, lalu beri Client ID. Tanpa itu, fitur terbangun dan teruji dengan server palsu tetapi login sungguhan belum bisa dicoba.

**Tes:** unit (antrean/backoff/coalescing, hook `onRead` termasuk incognito, `oauth.ts` dengan `state` salah, enkripsi token, pemetaan status AniList); e2e `trackers.spec.ts` dengan **server AniList palsu** (URL dasar bisa diganti hanya saat `MATANE_E2E`, seperti pola env e2e yang ada).

**Checkpoint 6c:** akun AniList nyata terhubung, membaca chapter menaikkan progres di AniList, antrean pulih setelah offline.

## Milestone 6d: MyAnimeList

OAuth2 **PKCE** (tanpa client secret, tipe aplikasi "other"; `code_challenge` plain) lewat loopback yang sama; tukar token dan **refresh token** (jalan otomatis sebelum request bila hampir kedaluwarsa). API v2: `GET /manga?q=`, `PATCH /manga/{id}/my_list_status` (status, skor, `num_chapters_read`, tanggal). Client ID di `client-ids.ts`. Tes dengan server palsu + refresh. Docs: tambahkan ke `tracking.md`.
**Tugasmu:** daftarkan aplikasi di MAL (redirect loopback). **Checkpoint 6d:** akun MAL nyata terhubung dan tersinkron.

## Milestone 6e: Kitsu dan MangaUpdates

Tanpa registrasi OAuth; login lewat **formulir di app** (kata sandi tidak pernah disimpan, hanya token terenkripsi).
- Kitsu: password grant `POST /api/oauth/token` memakai kredensial klien publik yang didokumentasikan Kitsu (verifikasi saat implementasi), refresh token; JSON:API `library-entries` dan pencarian `manga`.
- MangaUpdates: `PUT /v1/account/login` mengembalikan token sesi; pencarian `POST /v1/series/search`; daftar baca `lists/series` (progres = nomor chapter).
- Tracker dengan antarmuka yang sama; `TrackingDialog` dan `TrackingSettings` menyesuaikan (formulir untuk dua layanan ini). Docs, tes dengan server palsu.
**Checkpoint 6e:** dua layanan terhubung dan tersinkron dengan akun nyata (dicoba kamu).

## Milestone 6f: Sinkronisasi dua arah dan penyelesaian

- `reconcile()` fungsi murni: remote lebih tinggi -> tandai chapter lokal terbaca sampai nomor itu (lewat `ProgressRepository.markRead` dengan penanda asal "tracker" agar tidak menjadi dorongan balik); lokal lebih tinggi -> dorong; sama -> diam; status `completed` tidak pernah diturunkan.
- Dipicu: saat refresh library, saat app dibuka, dan tombol "Sinkronkan sekarang". Dimatikan per tautan (`manga_tracks.syncBack`, sudah ada di skema) dan per layanan (Settings).
- Opsional di akhir (tanya dulu): impor tautan tracker dari backup Mihon (`.tachibk`; ADR 0032 mencatatnya belum diimpor). Pemetaan `syncId` Mihon harus diverifikasi terhadap sumber Mihon.
- Docs: ADR 0036 (aturan sinkron), perbarui `backup.md`, BRAINSTORM (coret Tracker dari "Setelah v1"), CHANGELOG.
- Tes: unit `reconcile` (tabel kasus), e2e dua arah dengan server palsu.
**Checkpoint 6f:** progres di tracker memajukan chapter lokal, dan sebaliknya, tanpa pantulan tak berujung.

## Verifikasi (tiap milestone)

1. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`; `prettier --write` hanya untuk file yang disentuh.
2. e2e: jalankan spec baru milestone itu dan spec yang terkait; suite penuh di akhir milestone atas persetujuanmu.
3. Cek manual di app dengan profil terpisah (`XDG_CONFIG_HOME`, lihat memori live-check), unduhan ke folder scratch. Untuk tracker, akun nyata hanya dipakai kamu sendiri; saya tidak memakai akunmu.
4. Setiap milestone ditutup dengan "Status pelaksanaan" di dokumen plan dan berhenti untuk review. Tidak ada commit.

## Risiko dan hal terbuka

- Client ID AniList/MAL harus kamu daftarkan (redirect loopback dengan port tetap; bentrok port ditangani dengan pesan jelas).
- API tiap layanan (terutama Kitsu dan MangaUpdates) dan struktur HTML Madara/MangaThemesia diverifikasi saat implementasi, bukan diasumsikan dari plan ini.
- Mesin ini tidak punya keyring: token tersimpan teks biasa di sini dan UI harus mengatakannya.
- Source lokal: library yang memakai root berbeda di perangkat lain menampilkan manga sebagai hilang sampai folder dipilih ulang.

## Status pelaksanaan

- **Langkah 0:** selesai (4 Okt 2026). Dua rencana yang dibatalkan dihapus dari `docs/BRAINSTORM.md` (4 baris) dan dua dokumen plan Fase 4 dan 5; `git grep` untuk "login per|antar perangkat" hanya menyisakan tip backup di `BRAINSTORM.md` (sengaja). Plan ini disimpan di repo. Tidak ada commit.
- **Milestone 6a (source lokal): selesai (4 Okt 2026), menunggu review.** Tidak ada commit.
  - **Dikerjakan:** `apps/desktop/src/main/local/` (`paths.ts` `safeJoin`, `comicinfo-read.ts`, `files.ts` `LocalFiles`, `store.ts` `LocalStore`, `source.ts` extension native `local`), `extensions/native.ts`; `registry.ts` (opsi `native`), `service.ts` (`call` ke native, tanpa transformImage/migrateUrls), `validate.ts` (cover `local:cover/…` diterima), `images/service.ts` (`local.cover`), `downloads/manager.ts` (menolak chapter lokal), `sources.ts` (`webUrl` tanpa halaman web); `index.ts` merangkai `downloads`/`local` komposit (tanpa mengubah `SourceService` dan `ImageService`); setting `local.folder`, IPC `local.chooseFolder`/`local.openFolder`, konstanta `LOCAL_*` di `@manga-reader/shared`; UI Settings → Browse (`LocalFolder`), tombol download dan "Buka di browser" disembunyikan untuk manga lokal; i18n en/id; ADR 0033, `apps/docs/guide/local.md`, CHANGELOG `0.3.0-beta.1 — unreleased`, README, BRAINSTORM.
  - **Temuan saat uji:** `validate.ts` membuang thumbnail non-http(s), jadi cover lokal hilang (diperbaiki, dengan tes). Daftar Browse lama tetap tampil setelah folder diganti; `LocalFolder` kini menghapus query `['browse', 'local/files']` saat folder berubah. Docs lama masih menulis "reaches only the sites it lists" di `apps/docs/index.md` (sisa allowlist; diperbaiki).
  - **Pengecekan:** typecheck, lint (0 error), format:check, `pnpm test` (359 unit, 25 baru termasuk `safeJoin` yang terbukti gagal bila pengamannya dicabut, dan satu tes guard download), e2e penuh 130/130 (7 baru di `e2e/local.spec.ts`).
  - **Belum dicek:** dialog pemilih folder asli (e2e mengisi setting lewat IPC), dan folder berisi ribuan manga (tidak diukur; pemindaian membaca satu `stat` per folder manga).
  - **Di luar rencana:** nama source `local/files`; `ExtensionsPage` menampilkan `local` sebagai extension "Built-in" (belum dilihat di UI).
- **Milestone 6b (template CMS): selesai (4 Okt 2026), menunggu review.** Tidak ada commit.
  - **Dikerjakan:** paket baru `packages/extension-templates` (`@matane/extension-templates` 0.2.0, MIT): `madara(config)` dan `mangaThemesia(config)` mengembalikan `Source` lengkap; `common.ts` (url relatif, gambar lazy, status/tipe, tanggal relatif dan kalender Inggris/Indonesia, `jsonAfter` untuk `ts_reader.run`, normalisasi spasi). Madara: listing `m_orderby`, chapter dari halaman, lalu `ajax/chapters/`, lalu `admin-ajax.php`; opsi `chaptersAjax`. MangaThemesia: listing `?order=`, halaman dari `#readerarea` atau script `ts_reader`. Config: `listPath`, order, dan semua selektor (`MADARA_SELECTORS`, `MANGATHEMESIA_SELECTORS`).
  - **CLI:** `mr-ext create <id> --template html|madara|mangathemesia` (default `html`); dependensi mengikuti `--layout`. `cli.ts`, `create.ts`, `index.ts`.
  - **Rilis:** `publish-sdk.yml` memeriksa 4 versi (sdk, runtime, templates, cli) dan menerbitkan lewat filter `extension-cli...`; `extension-templates` adalah devDependency `extension-cli` (hanya untuk tes, tanpa siklus).
  - **Docs:** ADR 0034, `apps/docs/extensions/templates.md` + sidebar + tautan di panduan, README paket, README CLI/SDK/runtime, `DEVELOPMENT.md`, CHANGELOG, BRAINSTORM. README SDK dan runtime masih menyebut allowlist domain (sisa lama; diperbaiki).
  - **Pengecekan:** typecheck, lint (0 error), format:check, `pnpm test` (404 unit: 11 di paket templates, 24 tes integrasi baru di `extension-cli/src/templates.test.ts` yang menjalankan hasil scaffold di sandbox QuickJS terhadap fixture, terbukti gagal bila urutan atribut gambar dirusak), `mr-ext create --template` dan `build` dicoba manual (bundle 12 KB), e2e `local` + `extensions` ulang (16/16) setelah `pnpm install` baru.
  - **Fixture:** HTML buatan sendiri (judul fiktif, `example.org`) di `packages/extension-cli/test/templates/`, dikecualikan dari Prettier karena sengaja tidak rapi.
  - **BELUM TERVERIFIKASI:** selektor mengikuti markup default tema seperti yang saya ketahui, **tidak** dicek terhadap situs sungguhan (tema Madara/MangaThemesia tidak punya sumber publik yang bisa saya baca, dan saya tidak menyentuh situs nyata). Sebagian situs mengubah markup; itu sebabnya selektor bisa diganti lewat config. `mr-ext test` terhadap situs nyata perlu kamu coba sendiri.
  - **Di luar rencana:** `common.ts` punya `clean`, `known`, `splitLabel`; tes integrasi ada di paket CLI (bukan di paket templates) supaya tidak ada ketergantungan melingkar.
- **Milestone 6c (kerangka tracker + AniList):** belum dimulai.
- **Milestone 6d (MyAnimeList):** belum dimulai.
- **Milestone 6e (Kitsu + MangaUpdates):** belum dimulai.
- **Milestone 6f (sinkronisasi dua arah):** belum dimulai.
