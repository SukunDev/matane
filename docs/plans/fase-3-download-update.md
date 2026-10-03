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
- Download beberapa chapter Example Source (paralel 2 × 4), buka `.cbz`-nya dengan pembaca CBZ lain, dan periksa `ComicInfo.xml`.
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
- Cek Example Source asli dengan beberapa manga di library: progres, pembatalan, dan error per manga.
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
- `pnpm dist:linux` menghasilkan AppImage yang jalan di mesinmu: DB, extension Example Source, dan migrasi folder data berfungsi.
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
3. **Live check** di app hasil build terhadap Example Source asli sesuai checkpoint:
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
- Diverifikasi di app hasil build terhadap Example Source asli (profil dan folder download terpisah):
  - Kage no Jitsuryokusha ch. 1–3 (37–38 halaman, 15–30 MB per chapter) selesai dalam 16,7 detik, dengan maksimal 2 chapter berjalan bersamaan;
  - **app di-kill** (SIGKILL) saat ch. 4 di halaman 3/37 dan ch. 5 baru mulai: tidak ada CBZ setengah jadi, hanya folder `.tmp` berisi halaman yang sudah selesai. Setelah dibuka lagi, antrean lanjut sendiri dan kelima chapter selesai;
  - kelima CBZ lolos `zipfile.testzip()` (CRC benar). `ComicInfo.xml` berisi judul, seri, nomor, ringkasan, penulis/artist, scanlator, genre, URL Example Source, jumlah halaman, bahasa, dan `YesAndRightToLeft`;
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
- Diverifikasi di app hasil build terhadap Example Source asli (profil dan folder download terpisah), Kage no Jitsuryokusha:
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

### Milestone 3c: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 7 warning virtualizer, pola lama), `format:check`, `typecheck`, dan `test` hijau (desktop 162, shared 17).
  - Test baru:
    - jadwal (`nextCheckAt`: langsung kalau belum pernah, interval, mati), aturan lewati (tamat, belum mulai, belum dibaca > N), aturan auto-download per kategori (kecualikan menang, sertakan mempersempit, default semua), dan teks notifikasi EN/ID;
    - `UpdatesRepository`: daftar hanya chapter yang terlihat setelah manga masuk library, terbaru dulu, tanpa scanlator tersembunyi dan manga di luar library; jumlah belum dilihat; target cek beserta data aturan lewati;
    - `UpdateService`: maks 3 manga sekaligus, progres dan error per manga, cek kedua saat masih berjalan ditolak, aturan lewati tidak berlaku untuk cek per manga, batal (yang berjalan berhenti, sisanya tidak mulai), cek terjadwal hanya kalau sudah waktunya dan online, auto-download + notifikasi setelah cek otomatis, cek manual ditolak saat offline dan hanya memberi notifikasi kalau jendela tidak fokus;
    - aturan chapter hilang: dihapus kecuali dibaca, bertanda, punya progres, punya download, ada di history, atau ada di statistik; daftar kosong dari source tidak menghapus apa pun;
    - `flattenGroups` (daftar Updates yang divirtualisasi).
- E2E 48/48 (diulang 3×). Spec baru `e2e/updates.spec.ts` (5 test):
  - situs menambah chapter → cek dari halaman lain → badge sidebar Updates "1" → halaman Updates menampilkan "Hari ini · 1 chapter" dan badge hilang; manga tamat dilewati; "Terakhir dicek … · berikutnya dalam 12 jam";
  - tandai dibaca / belum, "Download 1" per grup, dan baca dari baris;
  - mematikan "Lewati manga tamat" di Settings → Library membuat manga tamat ikut dicek; satu manga gagal (HTTP 503) → "1 manga gagal dicek" dan dialog detailnya;
  - auto-download aktif dengan kategori "Weekly" dikecualikan: chapter baru manga tanpa kategori masuk antrean, manga di "Weekly" tidak;
  - app ditutup, waktu cek terakhir dimundurkan 13 jam di DB, lalu dibuka lagi → cek berjalan sendiri dan chapter baru muncul.
  - Situs E2E sekarang bisa menambah chapter (`addChapter`) dan menggagalkan detail manga tertentu (`failManga`). `restart` menerima fungsi yang dijalankan saat app tertutup.
  - Dua test lama yang flaky ikut diperbaiki: di global search, "See all" diperiksa sebelum halaman lama hilang; di Updates, nama tombol "Read" bentrok (tombol baca sekarang bernama "Read now").
- Diverifikasi di app hasil build terhadap Example Source asli (profil terpisah), dengan 10 manga di library:
  - "Cek library": 4 manga tamat dilewati, 6 dicek dalam 1,8 detik; banner progres "3 / 6 judul · Sedang dicek: One Punch-Man, Sakamoto Days, SPY×FAMILY" (3 paralel); Batal menghentikan cek di 3 dari 6;
  - simulasi lewat DB saat app tertutup: 3 chapter terbaru Kage no Jitsuryokusha dan 1 chapter Blue Lock dihapus (jadi "baru" lagi), URL One Punch-Man dirusak, dan waktu cek terakhir dimundurkan 13 jam;
  - app dibuka → cek otomatis berjalan sendiri: 4 chapter baru dari 2 manga, satu error per manga (HTTP 404, One Punch-Man), badge sidebar 4 (hilang setelah Updates dibuka), keempat chapter otomatis masuk antrean download;
  - notifikasi desktop tertangkap `dbus-monitor`: judul "4 new chapters from 2 manga", isi "Blue Lock, Kage no Jitsuryokusha ni Naritakute!", dengan aksi default. **Klik notifikasi → buka Updates belum diuji langsung** (tidak bisa dipicu dari script), dan perlu dicoba manual;
  - tampilan dibandingkan dengan mockup 07.

Implementasi:
- **Main:**
  - `library/updates.ts`:
    - `UpdateService` dengan scheduler (lihat 5 detik setelah start, lalu tiap menit; jalan kalau sudah waktunya dan `net.isOnline()`);
    - cek per scope (semua / kategori / manga), limiter bersama (maks 3), dan batal;
    - hasil terakhir dan waktu cek/dilihat disimpan di key setting non-app (`updates.lastCheckAt`, `updates.seenAt`, `updates.lastResult`);
    - auto-download lewat `enqueueAuto` (batas ukuran berlaku) dan notifikasi Electron. Klik notifikasi memfokuskan jendela dan mengirim `app.navigate`.
  - `db/repositories/updates.ts`: target cek, daftar Updates (`fetched_at > added_at`, maks 2000 terbaru), dan jumlah belum dilihat.
  - `ChaptersRepository.sync`: aturan chapter hilang (lihat keputusan). `SourceService.refreshManga(…, { metadata })` dan `MangaRepository.touchChecked` untuk "perbarui detail" yang dimatikan.
  - Kategori: `settings_json` di-parse per field (`categorySettingsOf`), dan `categories.setAutoDownload`.
  - IPC `updates.check/cancel/list/status/markSeen`, `categories.setAutoDownload`, event `updates.progress` dan `app.navigate`, serta tag `updates`.
- **Shared:** `settings.updates` (interval, aturan lewati, metadata, notifikasi, auto-download), `categorySettingsSchema`, dan model `UpdateEntry` / `UpdateScope` / `UpdateProgress` / `UpdateResult` / `UpdateStatus`.
- **Renderer:**
  - `features/updates/`: header (terakhir/berikutnya, Cek library atau Cek <kategori>, dropdown kategori, menu error dan setting), banner progres + Batal, grup per hari (`groupByDay`) dengan "Download semua N", baris (cover, judul · chapter, scanlator/source · waktu, download / tandai dibaca / baca, redup kalau sudah dibaca), multi-select (`selection.ts`), dan list yang divirtualisasi;
  - badge sidebar Updates;
  - "Cek update" di multi-select library (cek per manga, lalu pindah ke Updates);
  - Settings → Library: bagian "Update library" dan "Download chapter baru" (aturan per kategori). Kontrol setting bersama dipindah ke `features/settings/controls.tsx`.

Keputusan:
- **Aturan lewati:** default hanya "manga tamat" yang aktif (belum mulai dibaca dan batas belum dibaca mati). Aturan berlaku untuk cek library dan kategori, tidak untuk cek per manga.
- **Cek otomatis** pertama kali langsung jalan (belum pernah dicek), lalu tiap interval (default 12 jam). Waktu cek dicatat saat cek dimulai, supaya cek yang dibatalkan tidak langsung diulang semenit kemudian. Saat offline, cek terjadwal menunggu, dan cek manual memberi pesan offline.
- **Notifikasi:** selalu untuk cek otomatis; untuk cek manual hanya kalau jendela tidak fokus, karena hasilnya sudah terlihat di app. Teksnya EN/ID mengikuti bahasa app.
- **Auto-download** mati secara default. Aturan per kategori: "Kecualikan" selalu menang; kalau ada kategori "Sertakan", hanya manga di kategori itu; kalau tidak ada, semua manga. Chapter yang sudah dibaca dan chapter scanlator tersembunyi tidak diunduh.
- **Chapter hilang dari source** dipertahankan (bertanda) kalau dibaca, bertanda, punya progres, punya download (status apa pun), ada di history, atau ada di statistik sesi baca. Dua syarat terakhir ditambahkan karena menghapus chapter itu akan ikut menghapus entri history/statistik lewat cascade. Selain itu chapter dihapus. Kalau source mengembalikan daftar chapter kosong, tidak ada yang dihapus (kemungkinan besar source rusak).
- **Halaman Updates** memakai "chapter yang pertama terlihat setelah manga masuk library", jadi chapter yang baru dilihat saat membuka detail manga (yang sudah di library) juga masuk. Daftarnya dibatasi 2000 terbaru.
- "Perbarui detail" yang dimatikan tetap mengambil detail dari source (source membutuhkannya untuk daftar chapter), tapi detail itu tidak disimpan.

Bug yang ditemukan dan diperbaiki: tidak ada bug app baru; yang diperbaiki hanya dua race di test E2E (lihat di atas).

### Milestone 3d: selesai (27 Sep 2026), menunggu review

- `lint` (tanpa error; 7 warning virtualizer, pola lama), `format:check`, `typecheck`, dan `test` hijau (desktop 168, shared 17).
  - Test baru:
    - `OnlineMonitor`: listener diberi tahu saat jaringan berubah, dan status paksa (test) menang;
    - start saat login: isi `.desktop` (path dengan spasi dikutip, `--hidden`), file dibuat dan dihapus di Linux, dan `setLoginItemSettings` di Windows/macOS;
    - baris status tray EN/ID (offline, mengecek x/y, mengunduh, dijeda, tidak ada yang berjalan);
    - `DownloadManager.setOnline`: saat offline chapter yang berjalan kembali ke antrean (halamannya tetap) dan tidak ada yang mulai; saat online lagi antrean lanjut;
    - `ImageCache.bytesOf/clear` per jenis.
- E2E 53/53 (diulang 3×). Spec baru `e2e/system.spec.ts` (5 test):
  - tutup ke tray: indikator aktivitas "Downloading 1" di title bar, `window.close` menyembunyikan jendela, download tetap selesai, jendela bisa ditampilkan lagi. Tanpa tray, test memeriksa bahwa setting nonaktif dengan penjelasan;
  - start saat login: `autostart/matane.desktop` dibuat dengan `Exec`, lalu dihapus;
  - offline (dipaksa lewat hook test): title bar "Offline", Browse dan Global search menampilkan "Kamu sedang offline", antrean menunggu dengan banner, chapter yang sudah didownload tetap terbaca, lalu setelah online antrean lanjut dan Browse kembali;
  - app dibuka offline dengan cek update yang sudah jatuh tempo: cek tidak jalan selama offline, lalu jalan sendiri begitu online;
  - Data & penyimpanan: penggunaan cache halaman setelah membaca, "Hapus cache halaman" → "0 B dari 1 GB", ukuran cache 256 MB tersimpan.
- Diverifikasi di app hasil build terhadap Example Source asli (profil terpisah), di desktop Hyprland dengan StatusNotifierWatcher:
  - **tray**: menu dibaca dan diklik lewat D-Bus (`com.canonical.dbusmenu`). Menu idle: "Nothing running · Open Matane · Check for updates now · Resume downloads (nonaktif) · Quit". Saat mengunduh dengan jendela tertutup: "Downloading 2 · Pause downloads", dan kedua chapter selesai saat jendela tersembunyi. "Check for updates now" menjalankan cek ("Checking for updates 0/1"), dan "Open Matane" menampilkan jendela lagi. Tooltip ikut status;
  - **mulai tersembunyi**: dibuka dengan `--hidden` (tutup ke tray + login + mulai tersembunyi aktif) → jendela tidak tampil, dan "Open Matane" dari tray menampilkannya. Awalnya jendela tetap tampil (lihat bug di bawah);
  - **autostart**: `Exec=<electron> <folder app> --hidden`, lolos `desktop-file-validate`, dan terhapus setelah dimatikan;
  - **cache**: 5 chapter dimuat ke cache (128,5 MB), batas diturunkan ke 100 MB, lalu LRU memangkas ke 99,7 MB;
  - **offline** (dipaksa lewat hook; jaringan asli tetap nyala): Browse menampilkan status offline, ch. 2 yang didownload terbaca, ch. 3 yang di-enqueue tetap "Queued" dengan banner, lalu setelah online ch. 3 terunduh sendiri.
  - **Belum diuji**: tray di KDE dan GNOME + AppIndicator (hanya Hyprland), dan perpindahan online/offline dari jaringan sungguhan (`net.isOnline()`). Keduanya perlu dicoba manual.

Implementasi:
- **Main:**
  - `app/online.ts` (`OnlineMonitor`: `net.isOnline()` dibaca tiap 3 detik, dengan listener dan override);
  - `app/tray-support.ts` (deteksi tray), `app/tray.ts` (`AppTray`: menu dan tooltip EN/ID, dibangun ulang maks 1× per detik saat download/cek berubah);
  - `app/login-item.ts` (autostart Linux, dan `setLoginItemSettings` di Windows/macOS);
  - `app/window.ts`: `hidden` dan `hideOnClose`.
  - `index.ts`:
    - tray aktif hanya kalau "tutup ke tray" nyala dan tray tersedia; setting diterapkan saat start dan setiap `settings.set`;
    - saat online: `downloads.setOnline` dan `updates.tick()`; event `app.online`;
    - klik notifikasi dan instance kedua memakai `showWindow()`.
  - `DownloadManager.setOnline`, `ImageCache.bytesOf/clear`, dan ukuran cache dari setting (`setMaxBytes` saat berubah).
  - IPC `app.isOnline`, `app.tray`, `app.openPath`, `storage.info`, `storage.clearCache`, dan event `app.online`.
  - Hook test: `MATANE_E2E=1` membuka `globalThis.__matane.setOnline`, dan `MATANE_E2E_OFFLINE=1` membuat app mulai dalam keadaan offline.
- **Shared:** `settings.general` (`closeToTray`, `openAtLogin`, `startHidden`), `cacheSizeMb` (default 1024; pilihan 256 MB–10 GB), dan `CACHE_SIZES_MB`.
- **Renderer:**
  - status online dari main (`useOnlineSync`; `navigator.onLine` tidak dipakai lagi);
  - `OnlineOnly` untuk Browse dan Global search;
  - `ActivityIndicator` di title bar (cek update, atau download berjalan; klik membuka halamannya);
  - banner offline di Downloads;
  - Settings → Umum: bagian "Sistem";
  - Settings → Data & penyimpanan (`DataSettings`), yang masuk `READY_SECTIONS`.

Keputusan:
- **Deteksi tray di Linux**: tray dianggap tersedia kalau ada pemilik `org.kde.StatusNotifierWatcher` di session bus (KDE, Cinnamon, XFCE, Hyprland/waybar, GNOME + AppIndicator). Kalau tidak ada, setting dinonaktifkan dengan saran memasang AppIndicator. Kalau tidak ada `gdbus`/`dbus-send` untuk bertanya, tray dianggap ada.
- **Deteksi offline**: Electron tidak punya event jaringan di main, jadi `net.isOnline()` dibaca tiap 3 detik. Main menjadi satu-satunya sumber status online untuk renderer.
- **Saat offline, seluruh antrean download menunggu** (termasuk download manual), karena pasti gagal. Chapter yang sedang berjalan kembali ke antrean dengan halamannya.
- **Mulai tersembunyi** hanya berlaku kalau dibuka dengan `--hidden` dan "tutup ke tray" aktif serta tray tersedia. Kalau tidak, jendela tetap dibuka supaya app tidak "hilang". Di macOS toggle-nya nonaktif, karena login item macOS tidak meneruskan argumen.
- Teks tray dan notifikasi di main memakai peta kecil EN/ID (main tidak memakai i18next).

Bug yang ditemukan dan diperbaiki:
- Mulai tersembunyi tetap menampilkan jendela kalau status tersimpannya "maximized" (Hyprland melaporkan jendela tiling sebagai maximized), karena `maximize()` di Electron ikut menampilkan jendela. Sekarang maximize ditunda sampai jendela pertama kali ditampilkan.

### Milestone 3e: selesai (27 Sep 2026), menunggu review — Fase 3 selesai (beta)

- `lint` (tanpa error; 7 warning virtualizer, pola lama), `format:check`, `typecheck`, dan `test` hijau (desktop 174, shared 17).
  - Test baru:
    - `compareVersions` (urutan semver termasuk pre-release, awalan `v`) dan `newerRelease` (channel beta/stabil, draft diabaikan);
    - `AppUpdater` dengan autoUpdater palsu: download otomatis di channel beta lalu pasang saat diminta (`allowPrerelease`, `allowDowngrade` mati), mode "Beri tahu saja" (tidak download sampai diminta), status "terbaru" dan error, instalasi yang hanya diberi tahu (rilis GitHub, notifikasi sekali per versi), dan build pengembangan (mati).
- E2E 56/56:
  - `full-flow.spec.ts` diperluas sampai Fase 3: tambah Twin Scans ke library → download ch. 1 → situs mati (`site.down`) → ch. 1 terbaca → auto-download dinyalakan di Settings → situs menambah ch. 5 → "Cek library" → ch. 5 muncul di Updates dan sudah terunduh;
  - `system.spec.ts`: Tentang menampilkan versi `0.1.0-beta.1`; di build pengembangan updater mati dan "Cek sekarang" nonaktif; mode updater tersimpan.
- `actionlint` 1.7.12 (binari resmi, checksum dicek) lolos untuk `release.yml` dan `ci.yml`. Integrasi shellcheck-nya tidak ikut jalan karena shellcheck tidak terpasang. Skrip awk catatan rilis dicoba pada `CHANGELOG.md`.
- **`pnpm dist:linux`** menghasilkan `Matane-0.1.0-beta.1-linux-x86_64.AppImage` (±143 MB). Dijalankan dengan profil terpisah yang berisi folder data lama `MangaReader`:
  - folder dipindah ke `Matane`, dan DB serta migrasi jalan: library dan 3 download lama terbaca;
  - Example Source bawaan (`resources/extensions`) memuat Popular (24 item).
- **Auto-update diuji lokal**:
  - AppImage `beta.1` disalin ke folder scratch; `beta.2` dibangun dan disajikan dari server HTTP lokal (`MATANE_UPDATE_FEED`);
  - `beta.1` menemukan `beta.2`, mengunduhnya (kartu Tentang menampilkan "Matane 0.1.0-beta.2 is ready" + "Restart to update"), lalu "Restart to update" mengganti file AppImage (SHA-512 sama dengan build `beta.2`) dan membuka app lagi;
  - setelah dibuka ulang, versinya `0.1.0-beta.2`.
- Cek ke GitHub sungguhan dari AppImage menghasilkan "No published versions on GitHub", karena repo belum punya rilis. Ini hilang setelah tag pertama.
- **Belum terbukti:** build Windows (NSIS) dan macOS (dmg), serta workflow rilis itu sendiri. Keduanya menunggu kamu push tag `v0.1.0-beta.1`.

Implementasi:
- **Paket:**
  - `apps/desktop/electron-builder.yml`: appId `dev.sukun.matane`, AppImage / NSIS x64 / dmg x64 + arm64, `asarUnpack` better-sqlite3, dan `extraResources` untuk `dist/` extension bawaan;
  - `drizzle/` di dalam asar, publish ke GitHub sebagai draft, `syncDesktopName`, dan `desktopName`;
  - skrip `pnpm dist` / `pnpm dist:linux` (root dan desktop);
  - versi `0.1.0-beta.1`, `author` / `homepage` / `repository` di `package.json`.
- **Updater** (`main/app/updater.ts`):
  - jenis instalasi: NSIS dan AppImage "auto"; macOS, portable, dan Linux non-AppImage "notify" (API rilis GitHub + tautan); build pengembangan "none";
  - cek 30 detik setelah start lalu tiap 6 jam (kalau online dan tidak mati);
  - notifikasi "siap dipasang" / "tersedia" (sekali per versi); klik membuka Setting → Tentang;
  - IPC `updater.status/check/download/install/openRelease` dan event `updater.changed`;
  - setting `updater` (mode: otomatis / beri tahu / mati; channel stabil / beta, default beta).
- **UI:** kartu "Update aplikasi" di Setting → Tentang (status, progres, "Mulai ulang untuk memperbarui", "Download", "Buka halaman rilis", "Cek sekarang", mode, dan channel).
- **CI rilis** (`.github/workflows/release.yml`), dijalankan oleh tag `v*`:
  - job `draft` membuat rilis draft (pre-release kalau tag bersufiks) dengan catatan dari `CHANGELOG.md`;
  - `build` per OS: ubuntu, windows, `macos-15-intel` (x64), `macos-15` (arm64). Masing-masing menjalankan `electron-builder --publish always` tanpa signing;
  - `publish` mempublikasikan draft setelah semua build berhasil;
  - `ci.yml` tidak berubah.
- **Dependensi:**
  - electron-builder 26.15.3 dan electron-updater 6.8.9, keduanya tag `latest` rilis Juni 2026 dan masih dirawat. Tag `v26` yang baru dirilis sehari sebelumnya tidak dipakai;
  - di `pnpm-workspace.yaml`, skrip install `electron-winstaller` ditolak, karena hanya dipakai untuk Squirrel.Windows yang tidak kita buat.
- **Dokumentasi:**
  - README: status beta, cara install per OS, SmartScreen/Gatekeeper, dan lokasi data;
  - `CHANGELOG.md`, `SECURITY.md` (laporan privat lewat GitHub), dan `CONTRIBUTING.md`;
  - ADR 0019 (format download), 0020 (update checker), dan 0021 (paket + auto-update tanpa signing);
  - `BRAINSTORM.md` §11: Fase 3 ditandai selesai (beta).

Keputusan:
- **Channel beta = flag pre-release GitHub.** Untuk provider GitHub, electron-builder hanya membuat `latest*.yml` per rilis, sedangkan electron-updater memilih rilis pre-release kalau `allowPrerelease` aktif. Jadi tidak ada file `beta*.yml` (plan awal menyebutnya).
- **Runner macOS x64: `macos-15-intel`**, karena `macos-13` sudah dihentikan GitHub. Kedua job macOS sama-sama mengunggah `latest-mac.yml`; ini tidak masalah karena macOS hanya diberi tahu.
- **Rilis dibuat sebagai draft**, lalu dipublikasikan oleh job terakhir, supaya tidak ada rilis setengah jadi kalau satu OS gagal.
- **Default updater: download otomatis, channel beta** (semua rilis sekarang beta). Instalasi terjadi saat "Mulai ulang untuk memperbarui" atau saat app ditutup.
- `MATANE_UPDATE_FEED` menjadi hook untuk feed uji lokal, sebagai pengganti `dev-app-update.yml`.
- release-please ditunda, jadi `CHANGELOG.md` masih ditulis manual (sesuai plan).

Bug yang ditemukan dan diperbaiki: error typecheck di test updater (tipe `on` dari `EventEmitter`) sempat lolos, karena setelah menulis test itu aku hanya menjalankan vitest. Tertangkap di cek final.

**Untuk merilis beta pertama:** commit, lalu `git tag v0.1.0-beta.1 && git push origin main v0.1.0-beta.1`. Pastikan repo `SukunDev/matane` ada dan Actions boleh menulis (Settings → Actions → Workflow permissions: read and write).
