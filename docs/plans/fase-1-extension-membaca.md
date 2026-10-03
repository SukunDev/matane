# Plan: Fase 1 (Extension & membaca) Manga Reader

## Context

Fase 0 sudah selesai: monorepo, shell UI Catppuccin, kontrak IPC typed (`packages/shared/src/ipc/contract.ts`), seluruh skema SQLite §7, i18n, CI, dan ADR 0001–0010. Fase 1 membuat app **benar-benar bisa dipakai membaca**: extension berjalan di sandbox QuickJS, Example Source sebagai source bawaan, browse → detail → baca chapter, dengan gambar disajikan lewat protokol `manga://` dan cache disk.

Acuan: `BRAINSTORM.md` §5 (extension), §6.1 (reader), §6.2 (browse/detail), §6.5 (network/cache/protokol), ADR 0003/0004/0005/0010, dan mockup `docs/ui/screens/02-detail`, `03-reader-single`, `04-reader-webtoon`, `05-browse`.

Keputusan dari diskusi:
- Dikerjakan dalam **4 milestone**. Aku berhenti di setiap checkpoint untuk review dan commit olehmu.
- `extension-runtime` dan CLI `mr-ext` berlisensi **MIT**, seperti SDK. App tetap GPL.
- Extension terpasang sebagai **bawaan** (Example Source dibundel di app), ditambah **"Load extension from folder"** (mode dev, dengan hot reload).
- Source Example Source: **EN dan ID** saja dulu.

Di luar cakupan Fase 1: library dan progress baca (Fase 2), download dan update checker (Fase 3), repo, signing, `transformImage`, dan `migrateUrl` (Fase 4), serta crop, split, filter warna, zoom, remap keyboard, dan gesture (Fase 5).

---

## Milestone 1a: Runtime, SDK, CLI, extension Example Source (tanpa Electron)

**`packages/extension-sdk`** (MIT)
- Tipe sesuai §5.3–5.5:
  - data: `Source`, `MangaSummary`, `MangaDetails`, `Chapter`, `Page`, `MangaPage`;
  - `Filter`: text, select, checkbox, tristate, sort, group, header;
  - `FilterState`, `Preference`, `ImageTransform` (tipe saja);
  - error bertipe: `NetworkError`, `HttpError`, `CloudflareError`, `RateLimitedError`, `NotFoundError`, `ParseError`.
- `defineExtension({ sources })`, deklarasi global untuk `http`, `html`, `storage`, `prefs`, `log`, `crypto`, `base64`, `utf8`, `timers` (untuk autocomplete), dan helper `parseRelativeDate`.
- Skema `manifest.json` (zod): `id`, `name`, `version`, `apiVersion`, `nsfw`, `domains`, `rateLimit`, `sources[{key, lang, name}]`.

**`packages/extension-runtime`** (MIT; ganti lisensi dari GPL)
- Kelas `ExtensionRuntime` di atas **quickjs-emscripten** (varian sync, promise di-resolve dari host):
  - satu runtime per extension, batas memori 64 MB (`setMemoryLimit`);
  - interrupt handler: kode sinkron maksimal 2 detik;
  - timeout per panggilan 30 detik (60 detik untuk `getChapters`);
  - data masuk dan keluar sandbox sebagai JSON.
- Host API diinjeksi lewat antarmuka `HostApi` (http, storage, prefs, log). Dengan begitu runtime yang sama bisa dipakai oleh app (http diteruskan ke main) dan oleh CLI (http memakai `fetch` Node).
- `html` diimplementasikan di host dengan **cheerio**:
  - hasil `html.load` berupa handle, dan objek DOM-nya tetap di host;
  - semua handle dibersihkan setelah panggilan selesai;
  - mendukung CSS selector dan mode XML.
- `http` di host memvalidasi **allowlist `domains`**.
- `crypto`, `base64`, dan `utf8` dijalankan di host. `timers.sleep` juga disediakan.
- **Test sandbox** (Vitest), yang semuanya harus gagal dengan aman: `require` / `process` / `fetch` tidak tersedia, request ke domain di luar allowlist ditolak, loop tak berujung diputus, batas memori, dan timeout. Ditambah test bridging promise dan handle `html`.

**`packages/extension-cli`**: bin `mr-ext` (MIT, memakai commander + esbuild)
- `mr-ext create <id>`: scaffold extension dari template.
- `mr-ext build [dir]`: bundle dengan esbuild ke ES2020 IIFE, validasi (tidak ada `import` tersisa, manifest valid), lalu output ke `dist/`: `index.js` + `manifest.json` + ikon.
- `mr-ext test [dir] [--source en] [--query …]`: menjalankan `getPopular` → `getMangaDetails` → `getChapters` → `getPages` dengan runtime yang sama (http lewat Node `fetch`), lalu mencetak ringkasannya.

**`extensions/example`**
- Source EN dan ID. Rate limit 5 request/detik.
- Dibangun di atas Example Source API:
  - popular (urut berdasarkan follow), latest, search dengan filter (tag tri-state, status, content rating Safe/Suggestive, sort);
  - detail manga, chapter dari feed (paginasi, disaring per bahasa terjemahan);
  - daftar halaman lewat at-home server;
  - `getWebUrl` dan `resolveUrl` (untuk URL `example.org/title/<uuid>`);
  - preference kualitas gambar (data saver).
- `url` manga dan chapter berupa UUID.
- **Aturan API Example Source dicek ulang di dokumentasi resmi** sebelum implementasi: User-Agent, rate limit, laporan Example@Home, dan atribusi.
- Test memakai fixture HTTP yang direkam, supaya CI tidak menyentuh Example Source.

**Checkpoint 1a:** `pnpm --filter example mr-ext test` menampilkan data Example Source asli. Test sandbox dan test fixture hijau.

---

## Milestone 1b: Host extension dan network layer di app

**Network layer** (`apps/desktop/src/main/network/`)
- `net.fetch` memakai session `persist:ext-<id>`.
- Rate limit per extension dengan token bucket.
- Allowlist domain divalidasi di setiap redirect (`redirect: 'manual'`).
- Timeout 20 detik. Retry untuk 5xx/429 dengan menghormati `Retry-After`.
- User-Agent default: UA Chrome milik Electron tanpa token "Electron".
- **Cloudflare:**
  - deteksi lewat `cf-mitigated` atau halaman challenge;
  - diselesaikan di BrowserWindow tersembunyi dalam partition yang sama, dengan UA yang sama;
  - app menunggu cookie `cf_clearance`; kalau ±10 detik belum selesai, jendelanya ditampilkan;
  - batas waktu 2 menit;
  - request yang kena challenge pada saat bersamaan menunggu satu penyelesaian yang sama.

**Host extension** (`apps/desktop/src/main/extensions/`)
- Proses host (`src/extension-host/index.ts`) dijalankan lewat `utilityProcess.fork`, sebagai entry build tambahan di electron-vite.
- RPC lewat MessagePort: main → host (`call`) dan host → main (`http`, `storage`, `prefs`).
- Kalau host crash, host dijalankan ulang dan error-nya diteruskan ke UI. Runtime di-load secara lazy dan dibongkar setelah idle.
- **Registry:**
  - extension bawaan dibaca dari `extensions/*/dist`: di mode dev langsung dari repo, sedangkan di build disalin ke `resources/extensions` lewat electron-builder `extraResources`;
  - extension dev dimuat dari folder yang dipilih pengguna (dengan watch + reload);
  - data extension di-upsert ke tabel `extensions` dan `sources`;
  - `storage` dan `prefs` disimpan di tabel `extension_storage` dan `extension_prefs`.

**Repository DB** (`apps/desktop/src/main/db/repositories/`)
- `sources`, `manga` (upsert berdasarkan `(source_id, url)`), dan `chapters`: sinkronisasi daftar, chapter baru ditambahkan, dan chapter yang hilang dari source ditandai `source_missing`.
- `page_list_cache` berlaku 1 jam.
- Setiap penulisan memancarkan event **`db.changed`** berisi tag entitas (ADR 0010).

**Tambahan kontrak IPC** (`packages/shared/src/ipc/{channels,contract}.ts`)
- `extensions.list`, `extensions.loadDevFolder`, `extensions.reload`
- `sources.list`, `sources.filters`
- `sources.browse({ sourceId, kind: popular|latest|search, page, query, filters })` → mengembalikan `MangaPage` dengan `mangaId` dari DB
- `sources.resolveUrl`
- `manga.get`, `manga.refresh` (mengambil detail dan chapter dari source, lalu upsert ke DB), `chapters.list`, `chapter.pages`
- `requests.cancel(requestId)` untuk pembatalan dari TanStack Query (lewat `AbortSignal`)
- Event: `db.changed`, `cloudflare.status`

**Checkpoint 1b:** dari DevTools, `window.api.invoke('sources.browse', …)` mengembalikan data Example Source, dan barisnya tersimpan di DB. Crash host tidak menjatuhkan app. Unit test untuk rate limiter, allowlist, sinkronisasi chapter, dan RPC hijau.

---

## Milestone 1c: UI Browse dan Detail manga

Acuan mockup: `05-browse`, `02-detail`, `06-global-search` (hanya kerangkanya; global search penuh ada di Fase 2).
- **Sources** (`/browse/sources`): daftar source dikelompokkan per bahasa, dengan ikon, pin, dan "terakhir dipakai".
- **Browse source** (`/browse/sources/$sourceId`):
  - tab Popular / Latest / Search, memakai `useInfiniteQuery` dengan `hasNextPage` (preset remote sesuai ADR 0010);
  - grid cover yang dimuat lewat `manga://cover/<mangaId>`;
  - skeleton saat memuat, dan state error dengan tombol "Coba lagi" serta "Verifikasi" untuk Cloudflare;
  - panel filter yang dibuat otomatis dari `getFilters()` (text, select, checkbox, tri-state, sort, group);
  - kotak "Buka dari URL".
- **Detail manga** (`/manga/$mangaId`):
  - header berisi cover, judul, author, status, genre, dan deskripsi;
  - tombol "Mulai baca", "Buka di browser", dan "Refresh";
  - daftar chapter (urutan dan filter scanlator dasar), dan klik chapter membuka reader.
  - Warna header dari cover dan prioritas scanlator ditunda ke Fase 2 dan Fase 5.
- **Extensions** (`/browse/extensions`): daftar extension terpasang dengan badge Bawaan / Dev. Tombol Reload dan "Load from folder" ada di Settings → Advanced.
- Query key dan pemetaan `db.changed` ke query key dibuat terpusat di `lib/ipc.ts`.
- String UI baru ditambahkan ke `en.json` dan `id.json`.

**Checkpoint 1c:** browse Example Source EN dan ID, filter, infinite scroll, dan buka detail. Screenshot dibandingkan dengan mockup.

---

## Milestone 1d: Protokol gambar dan Reader

**Protokol `manga://`** (`apps/desktop/src/main/protocol/`)
- Scheme didaftarkan sebagai privileged (`standard`, `secure`, `stream`).
- `page/<chapterId>/<index>`: cache → `getPages`/`getImageUrl` → fetch dengan `imageHeaders` → simpan ke cache → stream.
- `cover/<mangaId>`: diambil dari cache, kalau tidak ada di-fetch.
- Beberapa request untuk gambar yang sama pada saat bersamaan digabung jadi satu fetch.
- **Cache LRU** di `userData/cache` dengan tabel `image_cache`, batas 1 GB. Ukuran total dihitung, lalu entri terlama dihapus.
- CSP renderer ditambah `img-src manga:`.
- Dimensi halaman diukur di renderer setelah gambar selesai di-decode. `sharp` belum dipakai (baru di Fase 5 untuk crop/split).

**Reader** (`/reader/$chapterId`, layar penuh; acuan mockup `03`/`04`)
- **Mode:**
  - single page;
  - double page (halaman lebar tampil sendirian, tombol "geser 1 halaman");
  - webtoon (TanStack Virtual, lebar maksimum ±800 px, **tersambung** ke chapter berikutnya dengan pemisah);
  - vertical dengan gap.
- **Arah dan fit:** LTR/RTL; fit lebar, tinggi, layar, atau ukuran asli.
- **Overlay:** bar atas dan bawah yang sembunyi otomatis, slider halaman (dibalik untuk RTL), drawer pengaturan cepat, dan indikator halaman.
- **Navigasi:**
  - keyboard default (panah, A/D, Spasi, PgUp/PgDn, Home/End, `[` `]`, F, Esc);
  - preset tap zone: L, Kindle, kiri-kanan, tepi, nonaktif;
  - scroll wheel.
- **Transisi chapter:** halaman transisi "Selesai → Berikutnya" beserta **peringatan chapter hilang** kalau nomornya melompat. Urutan chapter mengikuti nomor dan urutan source.
- **Preload:** 4 halaman ke depan (`img.decode()`) dan halaman awal chapter berikutnya.
- **Pengaturan reader** disimpan secara global di settings (mode, arah, fit, tap zone, lebar webtoon). Override per manga ada di Fase 2.

**Checkpoint 1d:** membaca chapter Example Source dalam mode single (RTL), double, dan webtoon yang tersambung ke chapter berikutnya. Dibuka ulang dari cache juga harus berjalan tanpa jaringan.

---

## Penutup Fase 1

- **Benchmark runtime:** skrip yang mengukur durasi panggilan dan memori QuickJS dengan Example Source, lalu angka batas final dimasukkan ke ADR 0003.
- **E2E (Playwright `_electron`):** memakai extension tiruan + server fixture lokal untuk alur browse → detail → baca. Masuk ke CI lewat `xvfb-run`.
- **Dokumentasi:**
  - `docs/extensions.md` sebagai draf panduan membuat extension;
  - ADR baru: runtime dan CLI MIT, parsing HTML di utilityProcess (menggantikan "di main"), dan extension bawaan;
  - `BRAINSTORM.md` diperbarui sesuai perubahan keputusan tersebut.

## File kunci

- `packages/extension-sdk/src/**`, `packages/extension-runtime/src/**`, `packages/extension-cli/src/**`, `extensions/example/src/**`
- `packages/shared/src/ipc/{channels,contract}.ts`
- `apps/desktop/src/main/{network,extensions,protocol}/**`, `src/extension-host/index.ts`, `src/main/db/repositories/*.ts`, `src/main/ipc/handlers.ts`
- `apps/desktop/electron.vite.config.ts` (entry utility process), `src/renderer/index.html` (CSP)
- `apps/desktop/src/renderer/src/routes/_app/browse/sources/**`, `routes/_app/manga/$mangaId.tsx`, `routes/reader/$chapterId.tsx`, `features/{browse,manga,reader}/**`, `lib/ipc.ts`

Yang dipakai ulang: `registerIpcHandlers` / `broadcast` (`src/main/ipc/register.ts`), `localQueryDefaults` / `createQueryClient` (`src/renderer/src/lib/query.ts`), `SettingsRepository`, `EmptyState`, `Button`, token tema di `styles.css`, dan pola test DB di `src/main/db/__tests__/migrate.test.ts`.

## Verifikasi

1. `pnpm lint`, `format:check`, `typecheck`, dan `test` hijau, termasuk test sandbox, fixture Example Source, network, dan repository.
2. `mr-ext build` + `mr-ext test` untuk Example Source berjalan terhadap API asli (manual).
3. App (build dan `pnpm dev`) dijalankan lewat driver Playwright: browse → filter → detail → baca dalam mode single, double, dan webtoon; screenshot dibandingkan dengan mockup.
4. Membuka chapter yang sama saat offline berjalan dari cache. Ukuran cache terhitung, dan LRU menghapus entri terlama saat batas dikecilkan.
5. Crash host (proses di-kill manual) dipulihkan tanpa menjatuhkan UI.
6. E2E dengan extension tiruan hijau secara lokal.

---

## Catatan riset API Example Source (dicek di dokumentasi resmi, 23 Sep 2026)

- Batas global sekitar **5 request/detik per IP** untuk `api.example.org` (429, lalu ban 403 kalau terus dilanggar). `/at-home/server`: **40 request/menit**.
- **User-Agent wajib ada dan tidak boleh dipalsukan.** Extension Example Source memasang UA milik app sendiri (`MangaReader/<versi>`), bukan UA Chrome. Host mengizinkan extension mengganti UA (§5.5).
- Header `Via` dilarang. Gambar tidak boleh di-hotlink dan harus di-proxy: sudah sesuai, karena renderer tidak pernah fetch langsung (§6.5).
- URL gambar = `{baseUrl}/{data|data-saver}/{hash}/{file}`. **`baseUrl` hanya dijamin berlaku ±15 menit.** Kalau fetch gambar mendapat 403, host membuang `page_list_cache` untuk chapter itu dan memanggil `getPages` ulang sekali.
- **Laporan Example@Home wajib dikirim** (`POST https://api.example.network/report`: `url`, `success`, `bytes`, `duration`, `cached`) untuk gambar dari host non-`example.org`. Gambar dari `uploads.example.org` tidak dilaporkan.
  - Solusinya, SDK mendapat hook opsional baru `reportImage(result)` yang dipanggil host setelah setiap fetch gambar (fire-and-forget, 1d). Karena menambah permukaan API, hook ini dimasukkan ke apiVersion 1 sejak awal.

---

## Status pelaksanaan

### Milestone 1a: selesai (23 Sep 2026), menunggu review

- `lint`, `format:check`, `typecheck`, dan `test` hijau: 63 test. Rinciannya 18 SDK, 12 sandbox runtime, 5 CLI, 16 fixture Example Source, dan 12 test Fase 0.
- `pnpm --filter example mr-ext test` jalan ke API asli untuk EN dan ID: popular, latest, filter, detail, chapter, halaman, gambar pertama, dan laporan Example@Home. Opsi `-q`, `-u`, dan `--pref dataSaver=true` juga dicek.
- Bundle Example Source berukuran 13,9 KB (7,2 KB kalau di-minify).

Penyesuaian terhadap rencana:
- **SDK dipisah menjadi subpath `@manga-reader/extension-sdk/manifest`** (skema zod + `isAllowedHost`). Alasannya, kalau skema itu diekspor dari index, zod ikut masuk ke bundle extension dan ukurannya jadi 724 KB. Index SDK sekarang bebas zod.
- **CLI dijalankan lewat `tsx`**, langsung dari source TypeScript, tanpa langkah build. Script `mr-ext` ditambahkan di `extensions/example/package.json`, karena `pnpm --filter` tidak otomatis menjalankan bin.
- **Fixture host** (`createFixtureHost` di extension-cli) bisa dipakai ulang oleh extension lain:
  - `MR_RECORD=1 pnpm test` merekam hanya fixture yang belum ada;
  - `shrink` merampingkan respons saat direkam. Hasilnya 364 KB untuk Example Source.
- **`mr-ext test` melewati manga yang tidak punya chapter** dan mencoba sampai 5 manga pertama. Alasannya, judul populer seperti Solo Leveling dan Bisque Doll di Example Source hanya punya chapter eksternal atau berlisensi.

Catatan untuk milestone berikutnya:
- Interrupt QuickJS hanya dicek di antara bytecode. Operasi native yang panjang (mis. `'x'.repeat` besar) bisa melewati `syncMs`, walaupun tetap dibatasi memori dan timeout per panggilan. Ini perlu diukur di benchmark penutup Fase 1.
- Endpoint laporan `api.example.network/report` saat ini sering mengembalikan 522 setelah ±20 detik. Di 1b/1d, host wajib memanggil `reportImage` secara fire-and-forget, di luar jalur render gambar.

### Milestone 1b: selesai (23 Sep 2026), menunggu review

- `lint`, `format:check`, `typecheck`, dan `test` hijau: 107 test (desktop 50, shared 6, ditambah paket-paket 1a).
  - Test baru mencakup network (redirect allowlist, retry/Retry-After, deteksi Cloudflare, token bucket, UA), RPC dua arah, extension host (lazy load, prefs, pemetaan error, reload setelah OOM, idle unload), repository (sinkronisasi chapter, `source_missing`, page cache, `db.changed`), dan integrasi service (SQLite + registry + host sungguhan).
- Diverifikasi di app hasil build lewat `window.api` (driver Playwright) terhadap Example Source asli:
  - `sources.browse`, `sources.filters`, `manga.refresh` (99 chapter tersinkron), `chapter.pages` (cache kena di panggilan kedua), `sources.resolveUrl`;
  - error bertipe sampai ke renderer (`not_installed`, `cancelled`);
  - `requests.cancel` jalan;
  - proses host di-kill saat ada panggilan berjalan: panggilan itu gagal dengan `host_crashed`, jendela tetap hidup, dan panggilan berikutnya menjalankan host baru.
- Isi DB sudah dicek: `extensions`, `sources` (dengan `last_used_at`), `manga`, `chapters`, `page_list_cache`, dan `extension_storage`.

Penyesuaian terhadap rencana:
- **`net.fetch` tidak dipakai.** Dengan `redirect: 'manual'`, `net.fetch` Electron melempar "Redirect was cancelled" alih-alih mengembalikan respons 3xx. Karena itu dibuat adapter `sessionFetch` di atas `net.request` (event `redirect`) supaya setiap hop bisa dicek ke allowlist. Sudah diuji dengan situs asli: redirect ke luar allowlist ditolak, dan cookie session tersimpan.
- **Error bertipe** (`AppError` + kode, `@manga-reader/shared/errors`) dibawa di dalam `message` IPC, karena Electron hanya meneruskan `message`. Renderer memakai `decodeIpcError`.
- **Extension dev yang belum di-build** tetap terdaftar dengan `error`. Begitu `mr-ext build` dijalankan, watcher me-reload-nya otomatis.
- **Channel tambahan** di luar daftar rencana: `extensions.removeDevFolder`, `extensions.preferences`, `extensions.setPreference`, `sources.info` (capabilities), dan `sources.solveChallenge` (tombol "Verifikasi").
- **`manga.lastFetchedAt`** diambil dari kolom `last_update_check_at`, jadi tidak perlu migrasi.
- Script root `pnpm dev` sekarang mem-build `extensions/*` lebih dulu.
- `@manga-reader/extension-runtime/http-bridge` dipisah jadi subpath supaya main tidak memuat QuickJS/cheerio.

Belum dikerjakan / catatan:
- **Konfigurasi electron-builder `extraResources` belum ada**, karena packaging belum disiapkan. Path `resources/extensions` sudah ditangani di kode.
- **Solver Cloudflare belum diuji ke situs asli yang memakai challenge.** Example Source tidak memakainya. Logikanya (single-flight, tampil setelah 10 detik, batas 2 menit) baru diuji lewat fetcher dengan fake. Perlu dicoba di 1c dengan source yang memakai Cloudflare.
- Event `db.changed` tidak dipancarkan untuk baris manga baru dari browse, karena hasil browse langsung dikembalikan ke pemanggil. Tag dipancarkan untuk perubahan baris yang sudah ada, chapter, sources, dan extensions.

### Milestone 1c: selesai (23 Sep 2026), menunggu review

- `lint` (tanpa error; 1 warning yang diketahui: `useVirtualizer` tidak bisa di-memo oleh React Compiler), `format:check`, `typecheck`, dan `test` hijau: 116 test, desktop 59.
- Diverifikasi lewat driver Playwright di app hasil build, terhadap Example Source asli (jendela ±980 px CSS karena skala layar), tanpa error console:
  - daftar source dikelompokkan per bahasa, dengan pin dan "dipakai …";
  - browse Popular/Latest dengan cover lewat `manga://` dan infinite scroll (24 → 72 kartu);
  - panel filter: tag tri-state, status, content rating, dan sort; filter tersimpan di URL, jadi tombol Back memulihkan listing;
  - detail manga dengan header, badge, dan genre, dan chapter list virtual (99 chapter, 23 baris dirender), filter Belum dibaca/Ditandai, scanlator, urutan, dan lompat ke chapter;
  - "Buka dari URL", halaman Extensions, dialog preferensi (data saver), serta UI bahasa Indonesia + tema Latte.
- Screenshot dibandingkan dengan mockup `02-detail` dan `05-browse`: tata letak, tab, panel filter, dan chip tri-state sudah sesuai.
  - Elemen mockup yang datanya belum ada (subtitle "Ch. 128 · 15m ago" di kartu browse, "In library", Migrate, Downloaded) menunggu Fase 2/3.

Penyesuaian terhadap rencana:
- **Bagian cover dari protokol `manga://` ditarik maju dari 1d**, karena renderer tidak boleh hotlink gambar (§6.5, juga aturan Example Source).
  - Sudah ada `ImageCache` (disk + tabel `image_cache`, LRU 1 GB) dan `ImageService` (dedupe request, cek content-type, `reportImage`, header dari `imageHeaders()`). Bagian halaman (`manga://page/...`) tetap di 1d.
  - Gambar memakai bucket rate limit terpisah (20/detik), dan domain gambar juga harus ada di allowlist manifest.
- **URL cover memakai `?v=<hash thumbnailUrl>`**, supaya cover yang diganti source tidak tampil basi dari cache Chromium.
- Channel baru: `sources.setPinned` dan `manga.openInBrowser`. Tombol "Buka di browser" memakai `getWebUrl` extension, dengan `baseUrl + url` sebagai cadangan.
- **Breadcrumb dinamis** (nama source, judul manga) lewat store `crumbs`.
- Settings → Advanced sekarang berisi daftar folder extension dev, "Muat dari folder", dan "Muat ulang semua".

Bug yang ditemukan saat verifikasi dan sudah diperbaiki:
- `useEffect(() => el.scrollTo(...))` membuat app crash. Di Chromium 152, `scrollTo()` mengembalikan Promise, lalu React menganggapnya fungsi cleanup ("destroy_ is not a function").
- Baris tab/search/filter meluap di jendela sempit. Sekarang baris itu wrap.
- Breadcrumb tertimpa kotak search di title bar. Sekarang dipotong sebelum kotak search.
- Cover tidak muncul setelah detail mengisi `thumbnailUrl` (misalnya manga yang dibuka dari URL).

Catatan:
- Fixture Example Source (`extensions/example/test/fixtures/`) sempat hilang dari disk dan tidak ikut di commit terakhir, sehingga test Example Source gagal. Sudah direkam ulang (364 KB). Perlu diputuskan apakah fixture ini ikut di-commit; test dan CI membutuhkannya.
- Mengklik chapter membuka `/reader/$chapterId` yang masih placeholder, karena reader dikerjakan di 1d.

### Milestone 1d: selesai (23 Sep 2026), menunggu review

- `lint` (tanpa error; 2 warning `useVirtualizer` yang sudah diketahui), `format:check`, `typecheck`, dan `test` hijau: 127 test, desktop 70.
  - Test baru mencakup halaman dari cache tanpa memanggil source, refresh daftar halaman saat URL gambar kedaluwarsa (403), dan logika reader (mode/arah otomatis, chapter berikut/sebelumnya dengan preferensi scanlator, deteksi chapter hilang, pasangan halaman double, dan zona ketuk).
- Diverifikasi lewat driver Playwright di app hasil build, terhadap Example Source asli, tanpa error console:
  - **Single RTL** (mode otomatis untuk manga): ←/→ terbalik sesuai RTL, dan slider dibalik.
  - **Double**: halaman 1 di kanan, halaman 2 di kiri.
  - End → layar transisi "Selesai Ch. 1 / Berikutnya Ch. 2" → Ch. 2.
  - **Webtoon**: berlanjut ke Ch. 2 tanpa sesi baru, dan URL serta header ikut. Mode vertical dengan jarak antar halaman juga jalan.
  - Drawer pengaturan jalan.
- **Offline:** proxy session extension dimatikan dan `page_list_cache` dibuat kedaluwarsa (3 jam). Chapter tetap terbuka dari daftar halaman lama + cache gambar, dan halaman bisa dibalik.

Implementasi:
- `manga://page/<chapterId>/<index>`:
  - kunci cache = source + URL chapter + index, tidak bergantung pada URL gambar yang berganti-ganti, jadi halaman yang sudah di-cache terbuka tanpa jaringan;
  - pada 403/404/410 dengan daftar halaman dari cache, daftar diambil ulang sekali;
  - `getImageUrl` didukung, dan `reportImage` dipanggil untuk setiap gambar.
- `chapter.pages` jatuh ke salinan lama kalau source tidak bisa dihubungi. Channel baru: `chapter.get`, `window.toggleFullScreen`, dan event `window.fullScreenChanged`.
- Pengaturan reader global ada di `settings.reader`: mode, arah, fit, zona ketuk, geser halaman double, lebar webtoon, jarak vertical, dan latar.
  - Mode dan arah "otomatis": manhwa/manhua jadi webtoon, manga jadi RTL.
  - Setiap field punya fallback sendiri, jadi nilai lama tidak mereset semuanya.
- Konstanta reader ada di subpath zod-free `@manga-reader/shared/reader`, supaya zod tidak masuk bundle renderer.
- **Keyboard:** panah/A/D, Spasi/Shift+Spasi, PgUp/PgDn, Home/End, `[` `]`, F (layar penuh), M (menu), dan Esc (tutup panel → keluar layar penuh → kembali ke manga).
  - Scroll wheel menggulir halaman tinggi dulu, baru membalik halaman.
- **Preload:** 4 halaman ke depan (`img.decode()`), serta daftar halaman dan 2 halaman pertama chapter berikutnya saat mendekati akhir. Webtoon juga memuat 3 halaman di bawah layar.
- **Navigasi chapter** memakai `replace`, jadi Back keluar dari reader.

Catatan:
- Progres baca (halaman terakhir, tandai sudah dibaca) belum disimpan, karena itu Fase 2 sesuai rencana.
- Crop, split, filter warna, zoom, dan remap keyboard ada di Fase 5. Bookmark, incognito, dan auto-scroll dari mockup menunggu Fase 2/5.
- Bar atas dan bawah menutupi tepi halaman saat terlihat, lalu hilang otomatis setelah 3 detik (seperti Mihon).

### Penutup Fase 1: selesai (23 Sep 2026)

- **Benchmark runtime** (`mr-ext bench`, dengan fixture + live):
  - panggilan Example Source ≤ 11 ms di sandbox, dan sisanya jaringan;
  - kasus terburuk sintetis: JSON 2,9 MB/10k chapter 0,24 s dan ≤ 4 MB, HTML 1 MB dengan 9k panggilan bridge 0,6–0,8 s, loop CPU 5 juta iterasi 0,33 s.
  - **Batas final tetap** (64 MB, 2 detik, 30/60 detik). Angkanya ada di ADR 0003.
- **Bug quickjs-emscripten 0.32 ditemukan lewat benchmark.** Job promise yang memperbesar memori WASM membuat context liar, sehingga `dispose()` abort. Sudah ada workaround di `runtime.ts` dan test regresi.
  - Satu kebocoran lain juga diperbaiki: `computeMemoryUsage()` diganti dengan parsing `dumpMemoryUsage()`.
- **E2E** (`pnpm e2e`, Playwright `_electron`, 9 test, ±10 detik):
  - memakai extension tiruan + situs palsu di `e2e.localhost` (PNG dibuat di test, tanpa jaringan luar);
  - alurnya: install dari folder → browse + cover + infinite scroll → filter tri-state → error + Coba lagi → detail → baca RTL → double (spread sendirian) → peringatan chapter hilang (3 → 5) → kembali ke daftar chapter (regresi bug virtualizer, terbukti gagal kalau bug dimunculkan lagi) → webtoon bersambung → buka ulang chapter saat situs mati.
  - Sudah masuk CI lewat `xvfb-run -a pnpm e2e` (dengan `--no-sandbox` di CI, dan laporan Playwright diunggah kalau gagal).
- **Dokumentasi:**
  - `docs/extensions.md` (panduan membuat extension);
  - ADR 0011 (runtime + CLI MIT), 0012 (parsing HTML di extension host, `net.request`), 0013 (extension bawaan + folder dev), dan 0014 (`manga://` + cache gambar);
  - ADR 0002, 0003, dan 0010 diperbarui;
  - `BRAINSTORM.md` (§2, §5.1, §5.4, §5.5, §5.9, §5.10, §6.5, §9, §11, §13) dan `README.md` diperbarui.

Belum dijalankan / catatan:
- Job E2E di GitHub Actions belum pernah jalan, karena repo belum punya remote. Langkahnya sudah diuji secara lokal (tanpa xvfb, jendela tampil di layar).
- Konfigurasi electron-builder (packaging + `extraResources` untuk extension bawaan) belum ada. Ini masuk persiapan rilis.

**Keputusan fixture (23 Sep 2026):** fixture HTTP semua extension (`extensions/*/test/fixtures/`) **tidak di-commit** dan sudah masuk `.gitignore`. Kalau fixture belum direkam, test fixture dilewati secara otomatis (`hasFixtures()` dari `@manga-reader/extension-cli`). Artinya clone baru dan CI tidak menjalankan test Example Source. Untuk menjalankannya secara lokal, rekam dulu dengan `MR_RECORD=1 pnpm test` di folder extension.
