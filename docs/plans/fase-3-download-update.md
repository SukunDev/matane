# Plan: Fase 3 (Download & update) Matane → beta pertama

## Context

Fase 2 selesai (commit `3cfdc6a`). Library, progres, history, incognito, bookmark chapter, prefs scanlator, global search, dan migrasi sudah jalan. Tapi app masih butuh internet untuk membaca, dan tidak tahu kalau ada chapter baru. Fase 3 menambahkan:
- **download** chapter (CBZ/folder) supaya bisa dibaca offline, beserta otomatisasinya;
- **update checker** dengan halaman Updates dan notifikasi;
- tray dan jalan saat login;
- **paket beta pertama** dengan auto-update.

Acuan:
- `BRAINSTORM.md` §6.4 (download & update, tray), §6.5 (`manga://` membaca download, offline), §6.6 (setting Umum/Library/Download/Data), §7 (tabel `downloads`, Updates = `chapters` diurutkan `fetched_at`), §10 (paket, CI, auto-update, tanpa signing), §11 Fase 3;
- mockup `docs/ui/screens/07-updates` dan `08-downloads`.

Keputusan dari diskusi:
- **5 milestone** dengan checkpoint. Aku berhenti untuk review dan commit olehmu di setiap checkpoint, dan tidak pernah commit sendiri.
- **Paket beta lengkap:**
  - electron-builder (AppImage, NSIS, dmg x64 + arm64);
  - workflow GitHub Actions yang membuat pre-release di `SukunDev/matane` saat tag `v*-beta*`;
  - electron-updater channel beta.
  - Build Windows/macOS baru terbukti setelah kamu push tag.
- **Folder download default:** `Documents/Matane`, bisa diganti di setting.

Tabel `downloads` di skema §7 sudah punya semua kolom yang dibutuhkan (status, queue_order, pages_done/total, error, format, path, size_bytes), dan `categories.settings_json` sudah ada untuk aturan per kategori. Migrasi DB baru dibuat hanya kalau diperlukan untuk index.

Di luar cakupan:
- `transformImage` (dekripsi/tile shuffle, §5.6) dan `migrateUrl` masuk Fase 4. Download menulis gambar apa adanya.
- What's new, backup, DoH/proxy, statistik, dan paket portable/deb/rpm/AUR/Flatpak masuk Fase 5.

Langkah pertama implementasi: simpan rencana ini ke `docs/plans/fase-3-download-update.md`, dengan format seperti plan Fase 2.

---

## Milestone 3a: Mesin download dan baca offline

**Main** (`apps/desktop/src/main/downloads/`, baru)
- **`DownloadsRepository`** (`db/repositories/downloads.ts`): enqueue (idempoten per chapter), urutan (`queue_order`), status, progres, error, path, dan ukuran. `isDownloaded(chapterId)` berarti ada baris `done` dengan file yang masih ada.
- **`DownloadManager`**:
  - antrean persisten, **maks 2 chapter** dan **4 halaman per chapter** (limiter bersama). Rate limit extension tetap berlaku;
  - retry per halaman 3× dengan backoff eksponensial. Setelah itu status chapter menjadi `error`, dan halaman yang sudah jadi tidak diunduh ulang;
  - pause/resume (semua dan per item), batal, dan susun ulang. Saat app dibuka, antrean dilanjutkan otomatis (bisa dimatikan).
- **Penulisan aman:**
  - halaman ditulis ke `<chapter>.tmp/` dengan nama `001.<ext>` (jenis dari sniff byte, dipakai ulang dari `images/covers.ts`);
  - `ComicInfo.xml` berisi judul, nomor, scanlator, author, genre, `Manga=YesAndRightToLeft` untuk RTL, dan URL web;
  - di-zip jadi CBZ (`yazl`, stream), lalu **rename atomik**. Format folder cukup rename folder `.tmp`.
- **Path dan ukuran:** path `<folder>/<Source>/<Judul>/<Nama chapter>.cbz` dengan sanitasi nama file lintas OS (karakter terlarang, nama cadangan Windows, panjang). Path disimpan di DB. Ruang disk dicek dengan `fs.statfs` sebelum mulai.
- **Sumber byte halaman:** dari cache gambar kalau sudah ada (disalin). Kalau belum, di-fetch langsung lewat jaringan extension **tanpa masuk cache LRU**, supaya download massal tidak mengusir cache baca. `ImageService` dipecah jadi `fetchPageBytes(chapterId, index)`, yang dipakai ulang oleh `page()`.
- **Membaca download:**
  - `ImageService.page` memeriksa download dulu: CBZ dibaca acak dengan `yauzl` (handle zip di-cache LRU kecil), folder dibaca per file;
  - `SourceService.pages` untuk chapter yang sudah didownload memakai daftar isi file, tanpa jaringan;
  - chapter yang hilang dari source tapi sudah didownload tetap bisa dibaca.
- Hapus download (per chapter/manga) menghapus file dan barisnya.
- Tag `db.changed` baru: `downloads`. Event `downloads.progress` (di-throttle ±4×/detik) berisi byte, halaman, dan kecepatan.
- **IPC:** `downloads.enqueue({chapterIds})`, `downloads.list`, `downloads.pause/resume({ids?})`, `downloads.cancel({ids})`, `downloads.retry({ids})`, `downloads.reorder({ids})`, `downloads.delete({chapterIds})`, `downloads.stats`.

**Renderer**
- Ikon download per baris chapter: status antre / berjalan (%) / selesai / error. Aksi download dan hapus download di menu baris dan multi-select chapter (tombol download yang dulu disembunyikan diaktifkan).
- Filter "Didownload" di daftar chapter dan di library (sebelumnya non-aktif).
- Badge jumlah download di cover library (§6.2) dan badge antrean di sidebar Downloads.
- Setting sementara: folder default `Documents/Matane`, format CBZ.

**Checkpoint 3a:**
- Download beberapa chapter MangaDex (paralel 2 × 4), buka `.cbz`-nya dengan pembaca CBZ lain, dan periksa `ComicInfo.xml`.
- Matikan jaringan (atau situs E2E ditutup), lalu chapter yang sudah didownload tetap terbaca.
- Kill app di tengah download, lalu setelah dibuka lagi tidak ada CBZ setengah jadi dan antrean lanjut.
- Unit test: sanitasi nama, ComicInfo, retry/backoff, penulisan atomik, dan pembacaan CBZ.

---

## Milestone 3b: Halaman Downloads dan otomatisasi (mockup 08)

- **Halaman Downloads** (`routes/_app/downloads.tsx` → `features/downloads/`):
  - tab **Antrean / Selesai / Error** dengan jumlah per tab;
  - di tab Antrean, item dikelompokkan per manga: status, halaman x/y, kecepatan, ETA, format, ukuran, dan pause/lanjut/batal per item;
  - drag untuk menyusun ulang;
  - header: "N di antrean · M aktif · X GB dari batas Y GB" dengan bar, Pause semua / Lanjut semua, dan "Hapus yang selesai" (dari daftar, bukan file);
  - error menampilkan pesan, **Coba lagi**, dan Detail;
  - footer: status download ahead dan hapus-setelah-dibaca, plus tautan ke setting;
  - antrean panjang divirtualisasi.
- **Otomatisasi (main):**
  - **Download ahead**: saat membaca manga di library, N chapter berikutnya (default 2, versi dari `pickVersion`) masuk antrean.
  - **Hapus setelah dibaca**: chapter yang selesai dibaca dihapus. Opsi: tunda sampai N chapter sesudahnya dibaca, jangan hapus chapter bertanda, dan kecualikan kategori tertentu.
  - **Batas ukuran total** (mis. 20 GB): melewati batas memunculkan peringatan dan menghentikan download otomatis. Download manual tetap boleh setelah konfirmasi.
- **Settings → Download** (bagian baru; `READY_SECTIONS`):
  - folder (dengan pemilih folder, dan tawaran memindahkan file lama dengan progres, termasuk memperbarui path di DB);
  - format CBZ/folder, jumlah paralel, download ahead, hapus setelah dibaca beserta opsinya, batas ukuran, dan lanjutkan antrean saat app dibuka.
- Setting disimpan di `settings.downloads` (skema zod dengan fallback per field, seperti `library`).

**Checkpoint 3b:**
- Halaman Downloads sesuai mockup 08, dengan pause/resume/batal/susun ulang/coba lagi berfungsi.
- Download ahead memasukkan 2 chapter saat membaca.
- Hapus-setelah-dibaca menghapus file sesuai opsi.
- Pindah folder memindahkan file, dan chapter tetap terbaca.
- Batas ukuran menahan download otomatis.

---

## Milestone 3c: Update checker, halaman Updates, notifikasi (mockup 07)

- **`UpdateService`** (main, `main/library/updates.ts`):
  - **jadwal**: interval (mati / 6 / 12 (default) / 24 / 48 jam / mingguan), cek saat app dibuka kalau interval sudah lewat, dan tombol manual (semua / per kategori / per manga);
  - hanya manga di library. **Aturan lewati**: status completed, belum pernah dibaca, jumlah belum dibaca > N;
  - **maks 3 manga paralel**. Limiter dari `lib/limit.ts` dipindah ke `packages/shared` supaya dipakai main dan renderer;
  - memakai ulang `SourceService.refreshManga`, yang sudah mengembalikan `newChapterIds`. Metadata ikut diperbarui (opsional);
  - progres lewat event `updates.progress` (x/y, judul yang sedang dicek) dan bisa dibatalkan;
  - hasil: chapter baru per manga, error per manga, dan waktu cek terakhir/berikutnya (`settings` key non-app).
  - Tidak ada cek saat offline: tertunda sampai online lagi.
- **Chapter hilang dari source** (§6.4): sekarang semua disimpan dengan tanda `source_missing`. Aturannya disesuaikan: chapter disimpan kalau sudah didownload, punya progres, sudah dibaca, atau bertanda; selain itu dihapus.
- **Setelah cek:**
  - **auto-download chapter baru** per kategori (include/exclude, di `categories.settings_json`, opsional hanya manga yang sedang dibaca);
  - **notifikasi desktop** berkelompok ("5 chapter baru dari 3 manga"). Klik notifikasi fokus ke jendela dan membuka **Updates** (event `app.navigate`).
- **Halaman Updates** (`routes/_app/updates.tsx` → `features/updates/`):
  - daftar = chapter manga library dengan `fetched_at > manga.added_at`. Chapter yang sudah ada saat manga ditambahkan tidak ikut, tanpa perubahan skema. Diurutkan `fetched_at DESC` dan dikelompokkan per hari (memakai ulang `features/history/groups.ts`);
  - header: "Terakhir dicek … · berikutnya …", tombol **Cek library**, dropdown kategori, dan menu (…);
  - banner progres cek dengan tombol Batal;
  - baris: cover, judul, chapter, scanlator/source, dan waktu; aksi baca / download / tandai dibaca; chapter yang sudah dibaca ditampilkan redup;
  - multi-select (memakai ulang `features/library/selection.ts`) dan "Download semua N" per grup; list divirtualisasi.
- **Badge sidebar Updates**: jumlah chapter baru yang belum dibaca sejak halaman Updates terakhir dibuka.
- **Settings → Library** diperluas: interval, aturan lewati, update metadata, dan auto-download per kategori.
- **IPC:** `updates.check({scope})`, `updates.cancel`, `updates.list({categoryId?})`, `updates.status`, `updates.markSeen`, dan event `updates.progress`.

**Checkpoint 3c:**
- Situs E2E menambah chapter baru. "Cek library" menampilkannya di Updates dan notifikasinya terkirim.
- Aturan lewati bekerja, dan cek otomatis berjalan saat app dibuka kalau interval sudah lewat.
- Auto-download per kategori memasukkan chapter baru ke antrean.
- Cek MangaDex asli dengan beberapa manga di library: progres, pembatalan, dan error per manga.
- Unit test: jadwal, aturan lewati, aturan hapus chapter hilang, dan query Updates.

---

## Milestone 3d: Tray, jalan saat login, mode offline, dan Data & penyimpanan

- **Tray opsional**:
  - setting "Tutup ke tray", default mati. Kalau aktif, menutup jendela hanya menyembunyikannya, sehingga update check dan download tetap jalan;
  - menu: Buka, Cek update sekarang, Pause/lanjut download, status singkat, Keluar;
  - kalau tray tidak tersedia (sebagian DE Linux), setting ini dinonaktifkan dengan penjelasan;
  - ikon dari `resources/icon.png` (varian kecil).
- **Jalan saat login**, dengan opsi mulai tersembunyi di tray:
  - Windows/macOS: `app.setLoginItemSettings`;
  - Linux: file `~/.config/autostart/matane.desktop` (ditulis/dihapus, Exec memakai path AppImage kalau ada).
- **Mode offline**:
  - main memantau `net.isOnline()` + event, dan mengirim `app.online`. Renderer memakai sumber ini, bukan hanya `navigator.onLine`;
  - Browse dan Global search menampilkan status "Offline" (bukan error);
  - Library, History, Downloads, serta chapter yang sudah didownload atau ter-cache tetap bisa dibaca;
  - update check dan download otomatis ditunda, lalu dilanjutkan otomatis saat online.
- **Indikator aktivitas** di title bar (§6.6): update check atau download sedang berjalan, klik untuk membuka halaman terkait.
- **Settings → Umum**: tutup ke tray, jalan saat login, mulai tersembunyi.
- **Settings → Data & penyimpanan**:
  - ukuran cache halaman: setting (ADR 0014 menjanjikan ini), penggunaan saat ini, dan tombol hapus cache halaman / cover browse;
  - total ukuran download, dan tombol buka folder data/log.

**Checkpoint 3d:**
- Dengan tutup-ke-tray aktif, jendela tertutup tetapi download tetap selesai. Menu tray berfungsi (dicek manual di KDE/GNOME + AppIndicator).
- File autostart dibuat dan dihapus.
- Offline: Browse menampilkan status offline, chapter yang didownload terbaca, lalu update check jalan otomatis saat kembali online.
- Ubah batas cache, lalu LRU memangkas cache ke batas baru.

---

## Milestone 3e: Paket beta, auto-update, CI rilis

- **electron-builder** (`apps/desktop/electron-builder.yml`):
  - appId `dev.sukun.matane`, productName `Matane`, ikon dari `resources/icon.png` (+ `.ico`/`.icns` yang dibuat dari logo);
  - `extraResources`: `extensions/` (bawaan) dan `drizzle/`;
  - `asarUnpack` untuk `better-sqlite3`;
  - target: **AppImage**, **NSIS**, dan **dmg x64 + arm64**;
  - `publish` ke GitHub `SukunDev/matane`;
  - skrip `pnpm dist` / `dist:linux`.
- **Versi:** `0.1.0-beta.1`, dengan `CHANGELOG.md` awal. release-please ditunda.
- **electron-updater** (`main/app/updater.ts`):
  - channel `beta` (`allowPrerelease`);
  - setting "Download otomatis" / "Beri tahu saja" / mati;
  - hanya untuk NSIS dan AppImage. macOS tanpa signing, portable, dan Linux non-AppImage hanya diberi tahu, dengan tombol yang membuka halaman rilis;
  - UI: kartu di Settings → Tentang (cek sekarang, status, "Mulai ulang untuk memperbarui") dan notifikasi saat versi baru siap;
  - tidak ada telemetri.
- **CI rilis** (`.github/workflows/release.yml`), dijalankan oleh tag `v*`:
  - build matrix: ubuntu, windows, macos-13 (x64), macos-14 (arm64), karena modul native dibangun per OS;
  - unggah ke GitHub Release sebagai **pre-release** untuk tag `-beta`, termasuk `latest*.yml` / `beta*.yml` untuk updater;
  - workflow `ci.yml` yang sudah ada tidak berubah.
- **Dokumentasi:**
  - README: cara install per OS, cara melewati SmartScreen/Gatekeeper (tanpa signing), dan disclaimer;
  - `SECURITY.md` dan `CONTRIBUTING.md` versi awal;
  - ADR baru: format download (CBZ + ComicInfo, penulisan atomik, path di DB), update checker, dan paket + auto-update tanpa signing.
- **Penutup Fase 3:**
  - E2E alur penuh diperluas: tambah ke library → download → situs mati → baca offline → situs menambah chapter → Cek library → Updates → auto-download;
  - `BRAINSTORM.md` §11 ditandai Fase 3 selesai (beta).

**Checkpoint 3e:**
- `pnpm dist:linux` menghasilkan AppImage yang jalan di mesinmu: DB, extension MangaDex, dan migrasi folder data berfungsi.
- Auto-update diuji lokal: AppImage v0.1.0-beta.1 menemukan beta.2 dari server generic lokal (`dev-app-update.yml`/feed uji), mengunduh, lalu memasang ulang.
- Workflow rilis lolos lint (`actionlint`). Build Windows/macOS dibuktikan saat kamu push tag `v0.1.0-beta.1`.

---

## File kunci

- **Main:**
  - `apps/desktop/src/main/downloads/{manager,writer,comicinfo,paths,reader}.ts` (baru) dan `db/repositories/downloads.ts` (baru);
  - `main/library/updates.ts` (baru), `main/app/{tray,login-item,updater,online}.ts` (baru);
  - `images/service.ts` (download dulu, `fetchPageBytes`), `images/protocol.ts`, `extensions/sources.ts` (`pages` dari download), `db/repositories/chapters.ts` (aturan chapter hilang), `ipc/handlers.ts`, `index.ts`, `app/window.ts` (tutup ke tray).
- **Shared:**
  - `models.ts` (DownloadItem, DownloadStats, UpdateEntry, UpdateStatus);
  - `settings.ts` (`downloads`, `updates`, `general.tray/login`, `cacheSizeMb`, `updater`);
  - kontrak IPC + event;
  - `limit.ts` (pindahan dari renderer).
- **Renderer:**
  - `features/downloads/`, `features/updates/` (baru);
  - `features/settings/{DownloadSettings,DataSettings}.tsx` (baru) dan `LibrarySettings`/`GeneralSettings`/`AboutSettings` (diperluas);
  - `features/manga/ChapterList.tsx` (status/aksi download), library (badge dan filter didownload);
  - `components/shell/{TitleBar,Sidebar}.tsx` (aktivitas, badge).
- **Build/CI:** `apps/desktop/electron-builder.yml`, `.github/workflows/release.yml`, dan ikon di `apps/desktop/resources/`.
- **E2E:** `e2e/support/site.ts`:
  - chapter bisa ditambah saat test berjalan;
  - halaman bisa lambat atau gagal untuk menguji retry/error;
  - "situs mati".
  - Ditambah spec baru `downloads.spec.ts` dan `updates.spec.ts`, dan `full-flow.spec.ts` diperluas.

**Yang dipakai ulang:**
- dari main: `SourceService.refreshManga` (newChapterIds), `SourceService.pages`/`imageUrl`/`imageHeaders`, `ExtensionFetcher.fetchImage`, `sniffImage` (`images/covers.ts`), `ImageCache`, `pickVersion`/`adjacentChapter` (download ahead), `DbChanges`, `RequestRegistry`, dan pola `broadcast`;
- dari renderer: `groupByDay`, `selection.ts`, `ConfirmDialog`, `ErrorState`, `CoverImage`, pola virtualizer, pola settings per-field + `useUpdateSettings`, dan `IncognitoToggle` (sebagai pola indikator title bar).

**Dependensi baru:**
- `yazl` (tulis zip, stream) dan `yauzl` (baca acak), beserta types-nya;
- `electron-builder` dan `electron-updater`.

Semuanya akan dicek terawat dan versinya di-pin sesuai ADR 0009.

## Verifikasi

1. **Per milestone:** `pnpm lint`, `format:check`, `typecheck`, `test`, dan `e2e` hijau. Unit test baru untuk: sanitasi path, ComicInfo, penulis CBZ atomik + pembaca, antrean/retry/backoff, aturan hapus-setelah-dibaca, batas ukuran, jadwal dan aturan lewati update, query Updates, dan aturan chapter hilang.
2. **E2E** memakai situs palsu (tanpa jaringan): download → situs mati → baca offline; pause/resume/batal/coba lagi; situs menambah chapter → Updates; auto-download.
3. **Live check** di app hasil build terhadap MangaDex asli sesuai checkpoint:
   - download, lalu buka CBZ di pembaca lain;
   - cek update library;
   - dibandingkan dengan mockup 07 dan 08.
4. **Paket:** AppImage lokal jalan, dan auto-update diuji dengan feed lokal. Workflow rilis dicek dengan `actionlint`. Hasil build Windows/macOS menunggu tag dari kamu.

## Status pelaksanaan

- 27 Sep 2026: rencana disetujui dan disimpan di sini. Implementasi dimulai dari Milestone 3a.

### Milestone 3a: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (desktop 129, shared 17).
  - Test baru:
    - sanitasi nama (karakter terlarang, nama cadangan Windows, titik di akhir, whitespace kontrol, dipotong di batas karakter < 120 byte) dan path `<folder>/<Source (LANG)>/<Judul>/<Chapter [grup]>`;
    - `ComicInfo.xml` (escape, field kosong tidak ditulis, RTL);
    - CBZ ditulis lalu dibaca acak, dan format folder;
    - `DownloadManager`: 2 chapter × 4 halaman sekaligus; retry 3× dengan backoff lalu `error`, dengan halaman jadi tetap disimpan dan "Coba lagi" hanya mengambil yang kurang; error permanen (parse) tidak di-retry; pause → halaman di `.tmp` dipakai saat lanjut; batal dan hapus (folder kosong ikut dibersihkan, arsip yang terbuka ditutup dulu); restart mengembalikan antrean (atau menjeda kalau `resumeOnStart` mati) dan file `.part` tidak dianggap jadi; format folder; ruang disk kurang → error;
    - filter dan jumlah download di library.
- E2E 37/37. Spec baru `e2e/downloads.spec.ts` (3 test):
  - download dari tombol baris dan dari multi-select → CBZ berisi `001–004.png` + `ComicInfo.xml` (dibaca dengan `yauzl`) → filter "Downloaded" di chapter → badge "3 downloaded chapters" di library;
  - situs dimatikan → ch. 2 terbaca dari CBZ (halaman 1 dan 2);
  - hapus download dari menu baris → file terhapus.
- Diverifikasi di app hasil build terhadap MangaDex asli (profil dan folder download terpisah):
  - Kage no Jitsuryokusha ch. 1–3 (37–38 halaman, 15–30 MB per chapter) selesai dalam 16,7 detik, dengan maksimal 2 chapter berjalan bersamaan;
  - **app di-kill** (SIGKILL) saat ch. 4 di halaman 3/37 dan ch. 5 baru mulai: tidak ada CBZ setengah jadi, hanya folder `.tmp` berisi halaman yang sudah selesai. Setelah dibuka lagi, antrean lanjut sendiri dan kelima chapter selesai;
  - kelima CBZ lolos `zipfile.testzip()` (CRC benar). `ComicInfo.xml` berisi judul, seri, nomor, ringkasan, penulis/artist, scanlator, genre, URL MangaDex, jumlah halaman, bahasa, dan `YesAndRightToLeft`;
  - **tanpa jaringan** (semua request diarahkan ke port tertutup): Browse gagal seperti seharusnya, tapi ch. 2 yang sudah didownload tetap terbuka di reader.

Implementasi:
- **Main:**
  - `db/repositories/downloads.ts`: antrean, status, progres, urutan, statistik, dan daftar dengan data manga/chapter;
  - `downloads/paths.ts`, `comicinfo.ts`, `archive.ts` (tulis CBZ dengan `yazl`, baca acak dengan `yauzl` + pool arsip terbuka), `store.ts` (sisi baca), dan `manager.ts`.
  - Penulisan: halaman ke `<chapter>.tmp/NNN.ext` (lewat `.part` + rename), `ComicInfo.xml`, lalu zip ke `.cbz.part` → rename, atau folder `.tmp` → rename. Nama bentrok mendapat akhiran ` (2)`.
  - `ImageService.pageBytes`: dari download, lalu cache, lalu jaringan **tanpa disimpan ke cache LRU**. `ImageService.page` dan `SourceService.pages` memeriksa download lebih dulu, dan protokol `manga://` bisa menyajikan byte dari arsip. "Jadikan cover" juga jalan dari halaman yang sudah didownload.
  - Saat app ditutup, download berhenti tanpa menyentuh DB lagi, dan antrean dilanjutkan saat app dibuka.
  - Filter `downloaded` dan `downloadedCount` di query library. Limiter dipindah ke `packages/shared/src/limit.ts`.
  - IPC `downloads.*`, event `downloads.progress` (±4×/detik), tag `downloads`, dan setting `downloads` (folder, format, lanjutkan antrean saat app dibuka).
- **Renderer:**
  - `lib/downloads.ts` (query + penyimpanan progres live);
  - tombol download per baris chapter (unduh / antre / jeda / cincin progres / selesai / error = coba lagi);
  - download dan hapus di menu baris dan multi-select, dan chip "Didownload" (disimpan di view per manga);
  - filter "Didownload" di library aktif, badge jumlah download (teal) di cover, dan badge antrean di sidebar Downloads.

Keputusan:
- Folder default `Documents/Matane`. Pengaturannya menyusul di Settings → Download (3b); sekarang baru lewat setting `downloads.folder`.
- Nama file chapter menyertakan grup scanlator, dan folder source menyertakan bahasa, supaya dua rilis atau dua bahasa tidak bertabrakan.
- Retry hanya untuk error yang bisa sembuh (jaringan, timeout, 429, 5xx). Error lain (mis. bukan gambar) langsung jadi `error`.
- Download tidak berhenti di tengah halaman: pause/batal berlaku di antara halaman.
- Ruang disk minimal 300 MB sebelum sebuah chapter mulai.

### Milestone 3b: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 6 warning virtualizer, pola lama), `format:check`, `typecheck`, dan `test` hijau (desktop 149, shared 17).
  - Test baru:
    - aturan download ahead (chapter belum dibaca berikutnya, satu versi per nomor, chapter hilang dari source dilewati) dan hapus-setelah-dibaca (langsung, tunda N chapter, tidak menghapus kalau ada chapter di antaranya yang belum dibaca, semua versi satu nomor dihitung satu, chapter bertanda dipertahankan);
    - `DownloadAutomation`: sekali per chapter dibuka, hanya manga library, mati kalau `ahead = 0`; hapus hanya kalau aturan aktif dan manga tidak di kategori yang dikecualikan;
    - `DownloadManager`: jumlah paralel dari setting; batas ukuran menolak download otomatis tapi tidak download manual; pindah folder (CBZ selesai + halaman `.tmp` chapter yang sedang jalan, path di DB ikut, folder lama dibersihkan, antrean lanjut di folder baru tanpa mengunduh ulang halaman yang sudah ada);
    - daftar yang "dihapus dari halaman", `movePath`/`rebase`/`isInside`, pengelompokan dan susun ulang antrean, ETA, `formatBytes`/`formatDuration`.
- E2E 43/43. Spec baru `e2e/downloads-page.spec.ts` (6 test):
  - antrean per manga: "4 di antrean · 1 aktif", Pause semua → Lanjut semua, Alt+↑ dan drag menyusun ulang, batal per item, lanjut per item, tab Selesai, "Hapus yang selesai" (file tetap);
  - halaman gagal (HTTP 404) → tab Error, Detail, lalu Coba lagi sampai selesai;
  - download ahead: membuka ch. 1 memasukkan ch. 2 dan 3;
  - hapus setelah dibaca diaktifkan dari Settings → Download, membaca ch. 2 sampai habis menghapus file-nya;
  - ganti folder lewat dialog (pemilih folder dijawab dari main) → "Pindahkan file" → path pindah, file lama hilang, chapter terbaca dengan situs mati;
  - batas ukuran: download ahead tertahan, banner muncul, download manual meminta konfirmasi.
  - Situs E2E sekarang bisa memperlambat halaman (`pageDelayMs`) dan menggagalkannya (`failPages`). `launchApp` selalu mengarahkan folder download ke profil test, karena download ahead sekarang aktif secara default.
- Diverifikasi di app hasil build terhadap MangaDex asli (profil dan folder download terpisah), Kage no Jitsuryokusha:
  - antrean ch. 1–5 (2 paralel): halaman Downloads menampilkan grup manga, halaman x/y, kecepatan (±3 MB/dtk), ETA, dan ukuran berjalan; Pause semua menjeda di antara halaman (ch. 1 di 16/37, ch. 2 di 14/38), Alt+↑ memindah ch. 5 (di satu run, tekan cepat kedua hilang; lihat bug di bawah, sudah diperbaiki dan dicek ulang di E2E), ch. 4 dibatalkan, Lanjut semua menyelesaikan sisanya (14,7–29,7 MB per chapter) tanpa mengunduh ulang halaman yang sudah ada;
  - download ahead: membuka ch. 5 memasukkan ch. 6 dan 7;
  - hapus setelah dibaca dengan tunda 1: selesai membaca ch. 1 → ch. 1 tetap; selesai ch. 2 → ch. 1 dan file-nya terhapus; ch. 3 bertanda tetap ada setelah ch. 4 dibaca;
  - pindah folder: 4 CBZ (±102 MB) pindah, folder lama bersih, ch. 3 terbaca dari folder baru;
  - batas ukuran di bawah total: membuka ch. 7 tidak menambah antrean, banner batas tampil;
  - tampilan dibandingkan mockup 08 (EN dan ID).

Implementasi:
- **Main:**
  - `downloads/automation.ts`: `chaptersAhead`, `chaptersToDelete`, dan `DownloadAutomation`, dipicu `ReadingService.saveProgress` (hook `onProgress`). Karena progres tidak disimpan saat incognito, otomatisasi juga tidak jalan saat incognito.
  - `DownloadManager`: `parallel` dari setting, `overLimit`/`enqueueAuto`, `hold` (antrean berhenti sementara, chapter yang berjalan kembali ke antrean dengan halamannya), `moveTo` (setting folder di-commit di dalam `hold`, sebelum antrean jalan lagi), `settingsChanged`, dan `bytes` di event progres.
  - `downloads/move.ts`: rename, atau salin lalu hapus kalau beda perangkat (`EXDEV`), tanpa menimpa (akhiran ` (2)`).
  - `DownloadsRepository`: `relocate`, `touch`, `errorIds`, dan filter `completedAfter`.
  - IPC baru: `downloads.clearCompleted`, `downloads.folder`, `downloads.pickFolder`, `downloads.setFolder({folder, move})`, `downloads.openFolder({chapterId?})`, `downloads.list({listed})`, dan event `downloads.moveProgress`.
- **Shared:** `settings.downloads` diperluas (`parallel`, `ahead`, `deleteAfterRead{enabled, delay, keepBookmarked, excludeCategoryIds}`, `limitGb`), dengan fallback per field.
- **Renderer:**
  - `features/downloads/`: `DownloadsPage` (header, bar batas, banner batas, tab dengan jumlah, footer), `DownloadRows` (grup, item antrean, item selesai, dialog detail error), `queue.ts` (logika murni), `DownloadLimitDialog`;
  - `useEnqueueDownloads` menggantikan pemanggilan `downloads.enqueue` langsung di daftar chapter, sehingga konfirmasi batas berlaku di semua tempat;
  - `features/settings/DownloadSettings.tsx`, dan `downloads` masuk `READY_SECTIONS`;
  - `formatBytes`, `formatDuration`, dan teks EN/ID.

Keputusan:
- **Download ahead aktif secara default (2 chapter)**, sesuai BRAINSTORM §6.4 dan footer mockup. Berlaku hanya untuk manga di library, sekali per chapter yang dibuka, dan mengambil chapter berikutnya yang belum dibaca (versi dipilih seperti navigasi reader).
- **Hapus setelah dibaca mati secara default**, karena menghapus file. Aturan ini berlaku saat chapter selesai dibaca di reader, bukan saat "tandai dibaca" manual. "Tunda N" dihitung per posisi chapter (semua versi satu nomor = satu posisi), dan hanya berlaku kalau chapter-chapter di antaranya juga sudah dibaca.
- **Batas ukuran** default tanpa batas, dengan preset 5–500 GB. Batas dicek saat download otomatis akan masuk antrean; chapter yang sudah di antrean tetap selesai. Peringatannya berupa banner di halaman Downloads dan dialog konfirmasi untuk download manual. Belum ada toast, karena app belum punya sistem toast.
- **"Hapus yang selesai"** hanya menyembunyikan download selesai dari tab Selesai, lewat waktu yang disimpan di key setting `downloads.clearedAt`, tanpa perubahan skema. Chapter tetap berstatus terunduh.
- **Pindah folder**: file selesai dan halaman `.tmp` chapter yang belum selesai ikut dipindah. Kalau gagal di tengah jalan, proses berhenti tanpa mengganti setting; yang sudah pindah tetap valid, dan mencoba lagi memindahkan sisanya. "Jangan pindahkan" membiarkan file di tempatnya (path tersimpan di DB, tetap terbaca).
- **Susun ulang** berlaku untuk chapter di dalam manga yang sama (drag chapter) atau untuk satu manga utuh (drag header), dengan Alt+↑/↓ sebagai alternatif keyboard. Tab Antrean juga memuat item error (seperti mockup), sedangkan tab Error hanya memuat error.
- Jumlah chapter paralel 1–4 (default 2); 4 halaman per chapter tetap.

Bug yang ditemukan dan diperbaiki:
- (dari 3a) `downloads.list` mengurutkan download selesai menurut urutan antrean, bukan yang terbaru dulu.
- (dari 3a) Setelah satu halaman gagal permanen, halaman lain dari chapter itu tetap diunduh di latar belakang sementara chapter berikutnya sudah mulai. Ini ketahuan dari test retry yang flaky. Sekarang sisa halaman dihentikan dan ditunggu sebelum chapter ditandai error.
- (selama 3b) Alt+↑ yang ditekan dua kali cepat hanya tercatat sekali, dan fokus hilang setelah baris dipindah. Sekarang langkah berikutnya dihitung dari urutan terbaru, dan fokus dikembalikan ke baris yang dipindah.
