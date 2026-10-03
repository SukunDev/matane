# Plan: Fase 2 (Library & progress) Matane

## Context

Fase 1 sudah selesai: extension di sandbox QuickJS, Example Source bawaan, browse → detail → reader (single/double/webtoon, RTL), cache gambar `manga://`, E2E, dan ADR 0011–0014. Tapi app belum **mengingat** apa pun: tidak ada library, progres baca, history, atau bookmark, dan setting reader berlaku global. Fase 2 membuat app bisa dipakai sehari-hari: simpan manga ke library, lanjut baca dari posisi terakhir, cari di semua source sekaligus, dan pindah source tanpa kehilangan progres.

Acuan:
- `BRAINSTORM.md` §6.1 (progress reader, pengaturan berlapis), §6.2 (library, detail, scanlator duplikat, global search, migrasi), §6.3 (progress, lanjut baca, history, sesi, incognito, bookmark), §6.5 (cover library permanen), §7 (skema);
- mockup `docs/ui/screens/01-library`, `02-detail`, `03-reader-single` (bookmark, "save as default for this manga"), `06-global-search`, `10-history`, `15-migration`.

Keputusan dari diskusi:
- **5 milestone** dengan checkpoint. Aku berhenti untuk review dan commit olehmu di setiap checkpoint, dan tidak pernah commit sendiri.
- Kategori awal **kosong**: hanya tab "Semua" + "Default" (manga tanpa kategori). Pengguna membuat kategori sendiri.
- Cover kustom bisa dari **file di disk** dan dari **klik kanan halaman di reader → "Jadikan cover"**.

Di luar cakupan Fase 2:
- download, update checker, dan halaman Updates (Fase 3);
- repo extension (Fase 4);
- **halaman statistik**, command palette, crop/filter/zoom reader, dan remap keyboard (Fase 5);
- tracker (setelah v1).

Data sesi baca tetap direkam mulai Fase 2 supaya statistik Fase 5 punya riwayat. Opsi "download" di migrasi dan filter "didownload" di library ditampilkan non-aktif sampai Fase 3.

Skema §7 sudah punya semua tabel dan kolom yang dibutuhkan (`categories`, `manga_categories`, `history`, `reading_sessions`, `manga_fts`, dan kolom manga `in_library`, `added_at`, `custom_cover_path`, `cover_path`, `reader_settings_json`, `scanlator_prefs_json`, `chapter_view_json`, serta kolom chapter `read`, `read_at`, `last_page`, `page_offset`, `bookmarked`). Migrasi baru hanya dibuat kalau ternyata perlu index tambahan.

**Prasyarat sebelum mulai:** `packages/extension-cli/src/index.ts` meng-export `hasFixtures` yang belum ada di `fixtures.ts` (pekerjaanmu yang belum selesai), sehingga `typecheck` gagal. Ini perlu dilengkapi atau di-revert dulu.


---

## Milestone 2a: Progress, lanjut baca, dan data inti

**Main process** (`apps/desktop/src/main/`)
- **`ProgressRepository`** (`db/repositories/progress.ts`):
  - `saveProgress(chapterId, page, total, offset?)`: mengisi `last_page`, `total_pages`, dan `page_offset`. Chapter otomatis ditandai dibaca saat halaman terakhir terlihat;
  - `markRead(chapterIds, read)` dan `markPreviousRead(chapterId)`;
  - **status baca per nomor chapter** (§6.2): menandai satu versi ikut menandai versi scanlator lain dengan nomor yang sama.
- **`HistoryRepository`**: upsert satu baris per manga (chapter + waktu), `list(query?)` dikelompokkan per hari, `remove(mangaId)`, dan `clear()`.
- **`SessionRecorder`** untuk `reading_sessions`:
  - renderer mengirim `reading.heartbeat` saat ada interaksi dan jendela fokus;
  - sesi ditutup setelah idle ±2 menit, saat keluar reader, atau saat ganti chapter;
  - yang dicatat hanya `activeMs`.
- **Logika "lanjut baca"** (`manga.continue`, §6.3): chapter terakhir belum selesai → lanjutkan chapter itu; sudah selesai → chapter belum dibaca berikutnya menurut nomor; belum pernah baca → chapter pertama. Aturan scanlator menyusul di 2d.
  - Memakai ulang `adjacentChapter` dari `features/reader/navigation.ts`, dipindah ke `packages/shared` supaya bisa dipakai main dan renderer.
- **Incognito** disimpan sebagai setting `incognito` (persisten). Selama aktif, semua penulisan progress, history, dan sesi dilewati di sisi main (satu penjaga di service, bukan di tiap panggilan renderer).
- Tag **`db.changed`** baru: `library`, `categories`, dan `history` (tag `bookmarks` sempat ada, lalu dihapus di revisi 2c), ditambah tag `manga:<id>` dan `chapters:<id>` yang sudah ada. Pemetaannya diperbarui di `keysForTag` (`renderer/src/lib/sources.ts`).
- **IPC baru:** `progress.save`, `chapters.markRead`, `chapters.markPreviousRead`, `manga.continue`, `reading.heartbeat`, `reading.end`, `history.list`, `history.remove`, dan `history.clear`.

**Reader** (`features/reader/`)
- Posisi dipulihkan saat reader dibuka: `last_page`, dan untuk webtoon juga `page_offset` di dalam halaman. Search param `page` tetap bisa menimpanya.
- Posisi disimpan saat halaman berganti:
  - debounce ±500 ms, dan di-flush saat keluar atau ganti chapter;
  - webtoon memakai halaman yang paling banyak terlihat + offset-nya;
  - sumber data: `useReaderPosition` (store yang sudah ada).
- Heartbeat sesi dikirim dari aktivitas pointer/keyboard.

**Detail manga**
- Tombol utama memakai `manga.continue` ("Lanjut · Ch X" / "Baca lagi").
- Baris chapter menampilkan progres ("Hal. 12/38") dan menu baris: tandai dibaca/belum, dan "tandai semua sebelumnya sudah dibaca".

**Checkpoint 2a:** membaca → keluar → buka lagi kembali ke halaman yang sama (paged dan webtoon, termasuk offset). Chapter otomatis ditandai dibaca di halaman terakhir. "Lanjut baca" benar untuk ketiga kasus. Incognito tidak menulis apa pun. Unit test repository dan logika lanjut baca hijau.

---

## Milestone 2b: Library (mockup 01)

- **Tambah ke library** dari detail manga, dengan dialog pilih kategori.
  - Ada **peringatan duplikat** kalau judul yang dinormalisasi sudah ada di library dari source lain.
  - Kalau manga belum pernah di-refresh, detail dan chapter-nya di-refresh dulu.
- **Cover library permanen** (§6.5, memperluas `ImageService.cover` di `main/images/service.ts`):
  - urutan sumber cover: kustom → `userData/covers/<mangaId>` (disalin saat masuk library, tidak kena LRU) → cache → fetch;
  - cover permanen dihapus saat manga dikeluarkan dari library;
  - URL cover memakai versi `?v=` supaya berubah saat cover diganti (pola dari `coverSrc`).
- **Cover kustom:**
  - pilih file di detail (dialog di main, file disalin ke `userData/covers/custom`), dan tombol reset;
  - klik kanan halaman di reader → "Jadikan cover", mengambil gambar dari cache `manga://page`.
- **Halaman Library** (`routes/_app/library.tsx` → `features/library/`):
  - tab kategori (Semua, kategori, Default) dengan jumlah per tab;
  - tampilan grid compact, grid comfortable, cover saja, dan list, plus slider ukuran cover;
  - sort: judul, terakhir dibaca, update terbaru, tanggal ditambahkan, belum dibaca, total chapter (naik/turun);
  - filter: belum dibaca, sedang dibaca, status, source (didownload non-aktif);
  - pencarian **FTS5** (`manga_fts`, prefix match) di kotak "Filter tampilan ini";
  - badge jumlah belum dibaca (dihitung per nomor chapter) dan ikon source;
  - kalau library kosong, tampil empty state dengan tautan ke Sources.
- **Multi-select** (Ctrl/Shift+klik, Esc untuk batal) dengan bar aksi: tandai dibaca/belum, atur kategori, dan keluarkan dari library. Tombol download disembunyikan sampai Fase 3.
- **Kategori** dikelola di Settings → Library: buat, ganti nama, hapus, dan urutkan (drag). Pengaturan tampilan library (mode, ukuran, sort, filter) disimpan di settings `library`.
- **Multi-select di daftar chapter** (detail): tandai dibaca/belum, bookmark, dan tandai sebelumnya dibaca.
- Badge jumlah library di sidebar, dan badge "Di library" di browse terus ter-update lewat `db.changed`.
- **IPC baru:** `library.list({ categoryId, sort, filters, query })`, `library.add`, `library.remove`, `library.setCategories`, `categories.list/create/rename/delete/reorder`, `manga.setCustomCover`, `manga.resetCover`, `manga.findDuplicates`.
- **`LibraryRepository`** menghitung query library (join `chapters` untuk belum dibaca dan terakhir dibaca, join `history`). Index tambahan (migrasi) dibuat hanya kalau diperlukan setelah diukur dengan 1.000 manga.

**Checkpoint 2b:** tambah beberapa manga Example Source ke library dan ke beberapa kategori. Sort, filter, pencarian, keempat tampilan, dan multi-select berjalan. Cover tetap tampil setelah cache gambar dikosongkan. Cover kustom dari file dan dari reader jalan. Library 1.000 manga sintetis tetap lancar di-scroll (grid tervirtualisasi). Screenshot dibandingkan dengan mockup 01.

---

## Milestone 2c: History, bookmark, dan incognito (mockup 10)

- **Halaman History:**
  - satu entri per manga, dikelompokkan Hari ini / Kemarin / Minggu ini / tanggal;
  - tiap entri: cover, source, chapter + halaman, bar progres %, tombol **Lanjut** / **Baca lagi**, hapus entri;
  - pencarian, dan "Hapus semua history" dengan konfirmasi;
  - di bagian atas ada banner status incognito seperti di mockup.
- **Bookmark chapter saja (seperti Mihon):** toggle di reader (ikon di bar atas, mockup 03) dan di daftar chapter, filter "Ditandai" di daftar chapter, dan filter "Ditandai" di library. *(Revisi setelah review: bookmark halaman, tab Bookmark di detail, dan halaman global Bookmarks dihapus.)*
- **Incognito:**
  - toggle di title bar dengan indikator yang selalu terlihat;
  - di reader, indikator tampil di bar atas;
  - di History, ada tombol "Nyalakan" / "Matikan".
- **IPC:** `chapters.setBookmarked` dan `settings.set({ incognito })` (sudah ada); filter `bookmarked` di `library.list`.

**Checkpoint 2c:** history terisi saat membaca, dan resume dari history membuka halaman yang benar. Bookmark chapter muncul di reader dan daftar chapter, dan filter "Ditandai" di library bekerja. Selama incognito tidak ada history, progres, maupun sesi yang tercatat (dicek langsung di DB).

---

## Milestone 2d: Setting reader per manga dan prioritas scanlator

- **Pengaturan berlapis** (§6.1): default global → default per jenis (logika "auto" yang sudah ada) → **override per manga** di `manga.reader_settings_json`, berupa sebagian field `readerSettingsSchema` yang divalidasi.
  - Di drawer reader ada tombol **"Simpan sebagai default untuk manga ini"** dan **"Reset"** (mockup 03), dengan indikator kalau override sedang aktif.
  - IPC: `manga.setReaderSettings`.
- **Scanlator per manga** (`scanlator_prefs_json`: `{ hidden: string[], priority: string[] }`):
  - dialog di detail manga untuk menyembunyikan dan mengurutkan (drag) scanlator;
  - dipakai oleh daftar chapter, jumlah belum dibaca, `manga.continue`, dan `adjacentChapter`: **satu versi per nomor** = prioritas tertinggi → scanlator yang sama dengan chapter sebelumnya → versi terbaru (§6.2).
- **Tampilan daftar chapter per manga** (`chapter_view_json`): filter, sort (urutan source / nomor / tanggal), dan scanlator disimpan per manga.

**Checkpoint 2d:** manga dengan beberapa scanlator (mis. Kage no Jitsuryokusha di Example Source) → sembunyikan satu grup → daftar, jumlah belum dibaca, "lanjut baca", dan chapter berikutnya di reader mengikuti prioritas. Override reader per manga tetap berlaku setelah restart, dan setting global tidak ikut berubah. Unit test pemilihan versi chapter hijau.

---

## Milestone 2e: Global search dan migrasi source (mockup 06 dan 15)

- **Global search** (`routes/_app/browse/global-search.tsx` → `features/search/`):
  - satu query dijalankan ke source terpilih. Default-nya source yang di-pin + source yang punya manga di library, bisa diubah lewat dropdown, dan pilihan disimpan;
  - **maksimal 5 source paralel** lewat antrean di renderer (`useQueries` + limiter). Rate limit per extension di main tetap berlaku;
  - hasil tampil bertahap per source sebagai baris horizontal: skeleton saat memuat, badge jumlah hasil, error per source dengan "Verifikasi" (Cloudflare) dan "Coba lagi" memakai `ErrorState`, "Lihat semua" → tab Search source itu, dan opsi "Hanya source dengan hasil";
  - progress bar keseluruhan, badge "Di library", serta query dan hasil disimpan di URL/cache;
  - memakai ulang `browseQuery`/`sources.browse` (kind `search`), `MangaCard`, dan `invokeCancellable`.
- **Migrasi** (route baru `/library/migrate`, dibuka dari multi-select library dan tombol **Migrasi** di detail):
  - **Urutan source tujuan** bisa diedit. Untuk tiap manga, main mencari judul di tujuan berurutan dan menilai kandidat (judul dinormalisasi + kemiripan dengan alt title, ditambah author). Kandidat diberi label Exact / Similar (%) / Tidak ditemukan, bisa diganti atau dicari manual, dan manga bisa dilewati.
  - **Opsi:** status baca dan progres (dicocokkan per nomor chapter), kategori, setting reader, cover kustom, dan bookmark chapter (per nomor chapter). Opsi download non-aktif sampai Fase 3. Setelah migrasi, manga lama **dihapus dari library** (default) atau **tetap disimpan**.
  - **Eksekusi di main dalam transaksi per manga:** refresh manga tujuan (detail + chapter) → salin data → tambah ke library → keluarkan yang lama sesuai opsi. Lalu tampil **ringkasan** (berhasil, dilewati, gagal, dan chapter yang tidak bisa dicocokkan).
  - **IPC:** `migration.findCandidates({ mangaId, targets })` dan `migration.run({ items, options })`, dengan event progres (`migration.progress`).

**Checkpoint 2e:** global search "frieren" ke Example Source EN dan ID tampil bertahap, dan error satu source tidak menghambat yang lain. Migrasi manga dari Example Source EN → ID (atau antara extension tiruan di E2E) memindahkan status baca per nomor chapter, kategori, setting reader, dan cover kustom, lalu ringkasannya benar.

---

## Penutup Fase 2

- **E2E diperluas:**
  - situs palsu mendapat **extension kedua** (untuk global search dan migrasi);
  - alur yang diuji: tambah ke library → kategori → baca sebagian → tutup/buka app → lanjut dari halaman yang sama → history → bookmark → incognito → global search → migrasi.
- **Performa:** seed 1.000 manga + 50 ribu chapter. Waktu query library/unread dan kelancaran scroll dicatat. Index ditambahkan kalau perlu.
- **Dokumentasi:**
  - ADR baru: status baca per nomor chapter + pemilihan versi scanlator, cover library permanen + cover kustom, dan batas data incognito;
  - `BRAINSTORM.md` §11 ditandai Fase 2 selesai beserta penyesuaiannya;
  - `README.md` diperbarui.

## File kunci

- **Main:**
  - `apps/desktop/src/main/db/repositories/{progress,history,library,categories}.ts` (baru) dan `manga.ts`/`chapters.ts` (diperluas);
  - `main/reading/sessions.ts`, `main/library/migration.ts` (baru);
  - `main/images/service.ts` (cover permanen dan kustom), `main/ipc/handlers.ts`.
- **Shared:**
  - `packages/shared/src/ipc/{channels,contract}.ts`, `models.ts` (LibraryItem, HistoryEntry, MigrationCandidate), `settings.ts` (`incognito`, `library`, `globalSearch`);
  - `adjacentChapter`/`resolveMode` dipindah ke `packages/shared/src/reader.ts`.
- **Renderer:**
  - `features/{library,history,search,migration}/` (baru);
  - `features/reader/*` (simpan/pulihkan progres, bookmark, klik kanan jadikan cover, simpan setting per manga);
  - `features/manga/*` (lanjut baca, multi-select, dialog scanlator);
  - `lib/sources.ts` (query + `keysForTag`), `components/shell/TitleBar.tsx` (incognito).
- **E2E:** `apps/desktop/e2e/support/site.ts` (extension kedua), dan spec baru `e2e/library.spec.ts`.

Yang dipakai ulang:
- dari data: `DbChanges`, `MangaRepository.upsertSummaries`/`updateDetails`, `ChaptersRepository.sync`/`toChapterInfo`, `SourceService.refreshManga`/`browse`, `ImageCache`;
- dari UI: `MangaGrid`/`MangaCard`, `CoverImage`/`coverSrc`, `ErrorState`, `SourceIcon`, `usePageCrumbs`, `invokeCancellable`, `useReaderPosition`, `readerSettingsSchema`, `adjacentChapter`, dan pola virtualizer dengan `scrollElement` sebagai state (perbaikan bug daftar chapter).

## Verifikasi

1. Per milestone: `pnpm lint`, `format:check`, `typecheck`, `test`, dan `e2e` hijau. Unit test baru untuk repository (progres, status per nomor, history, library query + FTS, kategori, bookmark), logika lanjut baca, pemilihan versi scanlator, penilaian kandidat migrasi, dan batas incognito.
2. Dijalankan lewat driver Playwright di app hasil build terhadap Example Source asli sesuai checkpoint masing-masing, lalu screenshot dibandingkan dengan mockup 01, 02, 03, 06, 10, dan 15.
3. Isi DB setelah skenario dicek langsung (history, sesi, progres, dan tidak ada tulisan saat incognito).
4. Performa dengan seed 1.000 manga: library terbuka < 200 ms dan scroll lancar.

---

## Status pelaksanaan

- 23 Sep 2026: rencana disetujui dan disimpan di sini. Implementasi dimulai dari Milestone 2a setelah prasyarat `hasFixtures` beres.
- Prasyarat selesai: `hasFixtures(dir)` di `extension-cli` (plus test). Test Example Source dilewati dengan peringatan (bukan gagal) kalau fixture tidak ada dan tidak sedang merekam.
- 24 Sep 2026: **Fase 2 selesai** (2a–2e + penutup, di bawah), menunggu review.

### Milestone 2a: selesai (23 Sep 2026), menunggu review

- `lint` (tanpa error; 2 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau: 147 test.
  - Test baru mencakup `continueChapter` (shared), repository progres (auto-dibaca di halaman terakhir, status per nomor chapter, tandai sebelumnya, reset saat ditandai belum dibaca), history (cari, hapus, hapus semua), sesi baca (waktu aktif, idle 2 menit, ganti chapter), dan penjaga incognito.
- E2E 11/11. Test baru: kembali ke halaman terakhir, tombol "Continue · Ch. 5", buka ulang di 3/4, dan menu "Tandai sebelumnya sudah dibaca".
- Diverifikasi di app hasil build terhadap Example Source asli, dengan app ditutup lalu dibuka lagi:
  - paged 7/52 → 7/52;
  - webtoon scrollTop 5600 → 5595 (offset 0,528 di dalam halaman yang sangat panjang);
  - "lanjut baca" untuk ketiga kasus (start → continue → next), dan chapter ditandai dibaca di halaman terakhir;
  - selama incognito tidak ada progres/history yang tercatat;
  - `reading_sessions` mencatat waktu aktif.

Implementasi:
- **Logika navigasi dipindah ke `@manga-reader/shared/chapters`** (zod-free): `adjacentChapter`, `missingBetween`, `resolveMode`, `resolveDirection`, dan `continueChapter` baru. Renderer me-re-export dari sana.
- **Main:**
  - `ProgressRepository`, `HistoryRepository`, `SessionRecorder` (`main/reading/sessions.ts`), dan `ReadingService` (`main/reading/service.ts`), yang menjadi satu-satunya penjaga incognito;
  - tag `db.changed` baru (`history`, `library`, `categories`, `bookmarks`);
  - 9 channel IPC baru, dan `ChapterInfo` mendapat `readAt` dan `pageOffset`.
- **Reader:**
  - `useProgressSaver` (debounce 500 ms, flush saat keluar/ganti chapter) dan `useReadingHeartbeat` (maks tiap 15 detik, hanya saat jendela fokus);
  - posisi dipulihkan dari `last_page` (chapter yang sudah dibaca mulai dari awal), dan webtoon dari offset di dalam halaman.
- **Detail manga:** tombol utama memakai `manga.continue` ("Mulai baca" / "Lanjut · Ch X" / "Baca lagi · Ch X"), baris chapter menampilkan progres, dan ada menu ⋮ untuk tandai dibaca/belum dan tandai sebelumnya.
- **Keputusan kecil:**
  - "belum pernah membaca" mulai dari chapter belum dibaca yang **paling awal** (bukan selalu chapter 1), supaya chapter yang ditandai manual tidak diulang;
  - aksi eksplisit "tandai dibaca" tetap berlaku saat incognito, karena itu suntingan pengguna, bukan aktivitas membaca.

Bug yang ditemukan saat verifikasi dan sudah diperbaiki:
- Ganti mode di reader (mis. double → auto) memasang ulang tampilan di posisi *tersimpan* yang sudah basi, lalu menimpanya. Sekarang tampilan mulai dari posisi yang sedang tampil, dan store posisi di-reset setiap reader dibuka.
- Resume webtoon meleset (5600 → 612) karena tinggi halaman belum diketahui. Offset sekarang diterapkan setelah halaman diukur, dan posisi tidak dilaporkan sebelum pemulihan selesai (sebelumnya posisi 0 sempat tersimpan).
- Waktu aktif sesi selalu 0. Sekarang jeda terakhir (≤ 2 menit) ikut dihitung saat sesi ditutup atau chapter berganti.

### Milestone 2b: selesai (24 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer, 2 di antaranya dari grid/list library baru), `format:check`, `typecheck`, dan `test` hijau: 161 test.
  - Test baru mencakup query library (jumlah per nomor chapter, tab/kategori, filter status/source/belum dibaca/sedang dibaca, FTS prefix yang aman dari tanda kutip, sort dengan null di akhir), jumlah per tab, `added_at` pertama dipertahankan, deteksi duplikat, kategori (buat/ganti nama/urutkan/hapus), `CoverStore` (salinan permanen per URL cover, cover kustom, file bukan gambar ditolak), dan logika multi-select (Ctrl/Shift).
- E2E 18/18. Spec baru `e2e/library.spec.ts` (7 test) memakai helper `e2e/support/app.ts`. Alurnya:
  - library kosong → tambah tanpa kategori → badge sidebar dan badge "In library" di browse;
  - kategori di Settings → pilih saat menambah → jumlah per tab;
  - cari, filter, sort, dan keempat tampilan;
  - Ctrl+klik → tandai dibaca / atur kategori / keluarkan;
  - salinan cover permanen di disk, klik kanan halaman reader → jadikan cover → reset;
  - multi-select chapter (Ctrl + Shift) → bookmark.
- Diverifikasi di app hasil build terhadap Example Source asli (profil terpisah):
  - 6 manga ditambahkan, satu lewat tombol di detail. `library.add` butuh 185–393 ms termasuk refresh detail + chapter;
  - dua kategori; tab All 6 / Favourites 2 / Plan to read 3 / Default 1;
  - screenshot keempat tampilan dan bar multi-select sesuai mockup 01;
  - **cache gambar dihapus** (file + baris `image_cache`) lalu app dibuka lagi: keenam cover tetap tampil dari `userData/covers` tanpa fetch ulang (folder cache tidak dibuat lagi);
  - cover kustom dari halaman reader Example Source berhasil.
- **Performa** (seed 1.000 manga + 50.000 chapter, total 1.006 manga di library):
  - `library.list` 40–61 ms termasuk IPC, untuk semua sort, FTS, dan filter belum dibaca;
  - library tampil 12 ms setelah navigasi, dengan 45 kartu ter-render (virtualisasi per baris);
  - scroll penuh (35.000 px, lompatan 400 px per frame): frame p50 16,7 ms, p95 33 ms.
  - Index tambahan tidak diperlukan.

Implementasi:
- **Main:**
  - `LibraryRepository` (satu query SQL dengan CTE: jumlah chapter/dibaca per nomor, join history), `CategoriesRepository`, dan `CoverStore` (`main/images/covers.ts`, cek jenis gambar dari byte awal, maks 20 MB);
  - `LibraryService` (`main/library/service.ts`) me-refresh manga yang belum pernah diambil sebelum ditambahkan, lalu menyalin cover permanen. Salinan permanen dihapus saat manga dikeluarkan;
  - urutan cover di `ImageService.cover`: kustom → permanen (hanya manga library) → cache/fetch, dan disalin permanen saat manga ada di library;
  - `coverKey` (path cover kustom ?? URL source) di `MangaInfo`, `BrowseItem`, dan `LibraryItem`, supaya URL `manga://cover` berubah saat cover diganti;
  - 16 channel IPC baru (`library.*`, `categories.*`, `manga.setCustomCover/resetCover/findDuplicates`, `chapters.setBookmarked`) dan setting `library`.
- **Renderer:**
  - `features/library/`: `LibraryPage` (tab di URL `?tab=`, pencarian debounce 200 ms, grid tervirtualisasi per baris dengan jumlah kolom dari lebar dan ukuran cover, list tervirtualisasi), `LibraryToolbar` (filter, sort, tampilan, slider ukuran yang disimpan saat dilepas), `CategoryDialog` (bisa membuat kategori inline), dan `selection.ts`;
  - detail manga: `LibraryButton` (cek duplikat → pilih kategori, atau langsung ke Default kalau belum ada kategori; "In library ▾" untuk ubah kategori/keluarkan) dan menu ⋮ untuk ganti/reset cover (`LibraryActions.tsx`);
  - reader: `PageContextMenu` (klik kanan halaman → "Jadikan cover", halaman dikenali dari `data-page` di `PageImage`);
  - daftar chapter: multi-select dengan bar aksi (tandai dibaca/belum, bookmark, tandai sebelumnya), plus bookmark di menu ⋮ per baris;
  - Settings → Library: kelola kategori (buat, ganti nama, hapus dengan konfirmasi, seret untuk urutkan);
  - badge jumlah library di sidebar; badge "In library" di browse membaca `libraryIdsQuery` lokal, jadi ikut ter-update tanpa fetch ulang ke source;
  - komponen baru `ConfirmDialog`, dan string en/id.
- **Keputusan kecil:**
  - klik biasa membuka manga, tapi saat ada pilihan klik biasa ikut memilih (seperti Mihon). Ctrl+A memilih semua, Esc membatalkan;
  - "Atur kategori" untuk banyak manga mencentang kategori yang dimiliki **semua** manga terpilih, dan menyimpannya mengganti kategori semuanya;
  - keluar dari library menyimpan progres dan history, tapi kategori dihapus.

Bug yang ditemukan saat verifikasi dan sudah diperbaiki:
- Setelah "Tandai dibaca" di library, badge belum dibaca tidak berubah, karena tag `chapters:<id>` tidak meng-invalidate query library. Sekarang tag `chapters:*` dan `history` ikut me-refresh `['library']` (jumlah belum dibaca dan "terakhir dibaca").
- Baris tab kategori menampilkan scrollbar vertikal kecil (`-mb-px` di dalam `overflow-x-auto`).

Belum dicakup E2E: cover kustom dari **file**, karena dialog file native tidak bisa diotomasi. Jalurnya sama dengan cover dari halaman (`CoverStore.setCustom`, ada unit test-nya).

---

### Milestone 2c: selesai (24 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (desktop 103 test).
  - Test baru: `hasUnread` dan `coverKey` di history, filter `bookmarked` di query library, pengelompokan hari (`features/history/groups.ts`), dan migrasi `0002` (tabel `page_bookmarks` hilang).
- E2E 23/23. Spec baru `e2e/history.spec.ts` (5 test):
  - history kosong → baca Ch. 2 sampai hal. 3 → entri "Today" dengan "Page 3/4 · 75%" → **Resume** membuka hal. 3;
  - ikon di bar atas reader menandai chapter → ikon penanda di baris chapter → filter "Bookmarked" di daftar chapter → dua manga di library → filter "Bookmarked" di library hanya menampilkan manga yang punya chapter bertanda;
  - incognito dari title bar → baca Ch. 3 → history dan `last_page` tidak berubah (dicek lewat IPC) → banner di History → matikan;
  - hapus satu entri, lalu "Hapus semua riwayat" dengan konfirmasi.
- Diverifikasi di app hasil build terhadap Example Source asli (profil terpisah):
  - Kage no Jitsuryokusha Ch. 1 sampai hal. 6 dan Chainsaw Man Ch. 1 selesai + Ch. 2 hal. 3. History menampilkan dua entri "Today" dengan cover, badge source, "Page x/y", jam, dan bar progres, sesuai mockup 10;
  - **incognito:** Ch. 3 Kage dibaca sampai hal. 5. DB langsung: `last_page` tetap 0, tidak ada baris `history` untuknya, dan 0 baris `reading_sessions`. Sesi bacaan sebelumnya tercatat (2,1–4,3 detik aktif). Incognito tetap aktif setelah restart, dan membaca lagi tetap tidak menulis apa pun;
  - pil "Incognito" tampil di title bar dan di bar atas reader;
  - filter "Bookmarked" di library hanya menampilkan manga dengan chapter bertanda;
  - migrasi `0002` di profil yang sudah berisi bookmark halaman: backup DB otomatis dibuat, lalu tabelnya terhapus.

Implementasi:
- **Main:** `history.list` sekarang mengembalikan `coverKey` (cover kustom ikut tampil) dan `hasUnread`. Filter `bookmarked` di `LibraryRepository` (manga dengan minimal satu chapter bertanda). Migrasi `drizzle/0002_drop_page_bookmarks.sql`.
- **Renderer:**
  - `features/history/` (halaman, banner incognito, pengelompokan Hari ini / Kemarin / Minggu ini / tanggal);
  - reader: ikon penanda di bar atas = toggle chapter (sesuai plan dan mockup 03); notifikasi singkat bersama (`notice.tsx`, dipakai "Jadikan cover");
  - tombol penanda per baris chapter (terisi saat ditandai, muncul saat hover), seperti mockup 02;
  - filter "Ditandai" di popover filter library (setting `library.bookmarkedOnly`);
  - `IncognitoToggle` di title bar dan reader (ikon saja saat mati, pil berlabel saat aktif), `SearchField` bersama (library dan history);
  - `keysForTag`: `chapters:*` dan `manga:*` ikut me-refresh history.

Keputusan:
- **Bookmark cukup per chapter, seperti Mihon** (keputusan pengguna saat review). Versi awal punya bookmark halaman + catatan, tab Bookmark di detail, dan halaman global Bookmarks. Semuanya dihapus, termasuk menu sidebar dan tabel `page_bookmarks`. BRAINSTORM §6.3, §6.6, §6.9, dan §7 sudah diperbarui.
- Bookmark chapter tetap bisa dibuat saat incognito, karena termasuk edit eksplisit pengguna seperti "tandai dibaca".
- **Resume** di history: chapter yang belum selesai dibuka di posisi terakhir. Chapter yang sudah selesai memakai logika "lanjut baca" yang sama dengan detail manga. Tombol berubah jadi **Baca lagi** kalau manga tidak punya chapter belum dibaca.
- History dibatasi 200 entri terakhir tanpa virtualisasi (sudah ada sejak 2a).

Bug yang ditemukan dan sudah diperbaiki: shortcut reader (Esc dan lainnya) sekarang mengabaikan event yang sudah ditangani popover atau menu Radix (`defaultPrevented`). Sebelumnya, Esc yang menutup popover juga ikut mengeluarkan pengguna dari reader.

---

### Milestone 2d: selesai (24 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (desktop 108 test, shared 14).
  - Test baru:
    - **pemilihan versi chapter** (`packages/shared/src/chapters.test.ts`): prioritas → scanlator sebelumnya → rilis terbaru, grup tanpa nama (`""`), navigasi yang melewati grup tersembunyi, dan "lanjut baca" dengan prefs;
    - jumlah belum dibaca dan `hasUnread` history tanpa grup tersembunyi;
    - simpan/baca override reader dan view chapter (JSON rusak diabaikan);
    - `viewChapters` (sort sumber/nomor/tanggal naik-turun, nilai kosong di akhir, filter, grup tersembunyi);
    - `ReadingService.continueTarget` dengan prioritas.
- E2E 27/27. Spec baru `e2e/manga-prefs.spec.ts` (4 test). Situs palsu mendapat manga **Twin Scans**: ch. 1 Alpha, 2 Alpha+Beta, 3 Beta, 4 Alpha+Beta; satu filler dikurangi supaya total daftar tetap 24.
  - sembunyikan Beta → 3 baris, "3 chapters hidden", belum dibaca 4 → 3, reader `]` dari ch. 1 → 2 Alpha → 4 Alpha (ch. 3 dilewati);
  - tampilkan lagi + Beta prioritas pertama → dari ch. 1 ke 2 Beta, tombol "Continue · Ch. 2" mengarah ke versi Beta;
  - sort nomor naik + filter belum dibaca → pindah ke manga lain (view default) → kembali, view tetap sama (juga dicek di `manga.get`);
  - "Simpan sebagai default untuk manga ini" → webtoon + abu-abu → override tersimpan, setting global tetap `auto`/hitam → Reset.
- Diverifikasi di app hasil build terhadap Example Source asli, Kage no Jitsuryokusha (6 grup; ch. 39–40 Biamam+Weeaboo, 82 Biamam+My Darling, 83–84 hanya My Darling):
  - sembunyikan My Darling + Weeaboo: "Showing 94 of 99 · 5 chapters hidden", belum dibaca di library 5 → 3, dari ch. 81 reader lanjut ke **82 Biamam**;
  - tampilkan semua + prioritas My Darling: dari ch. 81 ke **82 My Darling**;
  - override reader (webtoon + abu-abu) dan view (nomor naik + belum dibaca) **tetap berlaku setelah restart**. Setting global tetap `auto`/hitam, dan Chainsaw Man tetap membuka mode single RTL dengan latar hitam.
- **Performa** (seed 1.000 manga + 50.000 chapter, dua grup per nomor, separuh manga menyembunyikan satu grup): `library.list` 67–74 ms (2b: 40–61 ms), filter "Ditandai" 74 ms, `history.list` 8 ms. Index tambahan tidak diperlukan.

Implementasi:
- **Shared:**
  - `mangaReaderSettingsSchema` + `MANGA_READER_KEYS` + `effectiveReaderSettings` / `toMangaReaderSettings` (`settings.ts`);
  - `scanlatorPrefsSchema`, `chapterViewSchema` + `DEFAULT_CHAPTER_VIEW`, serta `MangaInfo.readerSettings/scanlatorPrefs/chapterView` (`models.ts`);
  - `pickVersion`, `isHiddenScanlator`, `scanlatorKey`, dan parameter `prefs` di `adjacentChapter` / `continueChapter` (`chapters.ts`).
- **Main:** `MangaRepository.setReaderSettings/setScanlatorPrefs/setChapterView` (JSON divalidasi saat dibaca; tidak valid → null/default). Prefs scanlator memicu tag `chapters:<id>`, sehingga daftar, library, history, dan "lanjut baca" ikut di-refresh. CTE `hidden` (`json_each`) di query library dan filter yang sama di `hasUnread`. `ReadingService` menerima `scanlatorPrefs`. IPC `manga.setReaderSettings`, `manga.setScanlatorPrefs`, `manga.setChapterView`.
- **Renderer:**
  - reader: setting efektif = global + override. Footer panel: "Simpan sebagai default untuk manga ini" atau indikator "Pengaturan khusus manga ini" + "Kembali ke pengaturan global". Prefs scanlator dipakai tombol/`[` `]` dan strip webtoon;
  - `ChapterList`: view per manga (optimistis) dengan chip Belum dibaca/Ditandai, filter scanlator, menu sort (urutan source / nomor / tanggal) + tombol arah, dan tombol **Scanlator** (jumlah grup tersembunyi);
  - `ScanlatorDialog`: tampil/sembunyikan per grup (switch), urutan lewat drag atau tombol naik/turun, jumlah chapter per grup, dan "Hapus urutan";
  - `features/manga/chapterView.ts` (filter + sort murni, dengan test).

Keputusan:
- Override per manga mencakup mode, arah, fit, geser halaman ganda, lebar strip, jarak halaman, dan latar. **Tap zone tetap global**, karena itu kebiasaan pembaca, bukan sifat manga.
- Selama override aktif, perubahan di panel reader hanya mengubah manga itu (tap zone tetap ke global). "Simpan sebagai default" menyalin semua nilai yang sedang berlaku. "Reset" menghapus override.
- **Prioritas scanlator baru ada setelah pengguna memindahkan grup.** Membuka dialog hanya untuk menyembunyikan grup tidak membuat urutan, jadi aturan "grup sebelumnya → rilis terbaru" tetap berlaku.
- Tanpa prioritas dan tanpa grup sebelumnya (mis. "lanjut baca" ke chapter yang belum pernah dibaca), yang dipilih adalah **rilis terbaru**. Sebelumnya dipakai versi pertama dalam urutan source.
- Chapter dari grup tersembunyi hilang dari daftar, jumlah belum dibaca, history (`hasUnread`), "lanjut baca", dan navigasi reader. Chapter tanpa grup bisa disembunyikan juga ("(tanpa grup)").
- Filter scanlator yang menunjuk grup yang kemudian disembunyikan dianggap "semua".

---

### Milestone 2e: selesai (24 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau (desktop 117 test).
  - Test baru:
    - `titleSimilarity` (judul dinormalisasi, Dice bigram);
    - `findCandidates`: berhenti di kecocokan persis pertama sesuai urutan tujuan, source sendiri dilewati, error per source dilaporkan dengan kodenya, hasil yang terlalu berbeda tidak ditawarkan;
    - `run`: status baca per nomor, progres, history, penanda, kategori, setting reader, cover kustom, pilihan "simpan keduanya", chapter yang tidak cocok, dan satu pasangan gagal tanpa menghentikan yang lain;
    - `createLimiter` (maks. N, slot diserahkan langsung, antrean yang dibatalkan tidak jalan).
- E2E 29/29. Extension tiruan sekarang punya **tiga source**: E2E Demo EN, E2E Demo ID (katalog sama, chapter hanya sampai 3), dan E2E Broken (pencarian selalu 503). Spec baru `e2e/search-migration.spec.ts` (2 test):
  - global search "hero": 3 baris, Broken gagal (HTTP 503, tombol Coba lagi) tanpa menahan yang lain, "Searching 3 sources · 2 done", 100%; "Hanya source dengan hasil"; set source kustom tersimpan; "See all" → tab Search source itu;
  - migrasi 2 manga dari multi-select library: Exact di source ID, cari manual → pilih lain → pilih lagi, lewati satu → ringkasan 1 berhasil / 1 dilewati / 0 gagal, "2 read chapters carried over · 1 chapter could not be matched: Ch. 5". Isi DB dicek lewat IPC: kategori, override reader, cover kustom, dibaca ch. 1–2, progres hal. 2 di ch. 3, dan entri lama keluar dari library.
- Diverifikasi di app hasil build terhadap Example Source asli:
  - global search "frieren" ke Example Source EN + ID: EN 7 hasil, ID 2 hasil (±7 detik; `curl` langsung ke API juga 7,3 detik). Pada percobaan pertama, API Example Source timeout 20 detik: kedua baris menampilkan error + "Coba lagi" dan progres tetap 100%;
  - migrasi Kage no Jitsuryokusha EN → ID: kandidat Exact, eksekusi 0,9 detik. **89 nomor chapter** dibaca terbawa ke 162 versi (Example Source ID punya 170 chapter dari beberapa grup). Kategori "Isekai", cover kustom, override reader, history, dan 2 penanda (per nomor, semua versi) ikut pindah, dan entri EN keluar dari library.

Implementasi:
- **Shared:** `migrationCandidateSchema`, `migrationSearchSchema`, `migrationResultSchema`, `migrationProgressSchema` (`models.ts`); `globalSearchSettingsSchema` dan `migrationSettingsSchema` + `DEFAULT_MIGRATION_OPTIONS` (`settings.ts`); IPC `migration.findCandidates` (bisa dibatalkan) dan `migration.run`, serta event `migration.progress`.
- **Main:** `MigrationService` (`main/library/migration.ts`):
  - kandidat: cari judul di tiap tujuan sesuai urutan; kecocokan persis menghentikan pencarian; kemiripan ≥ 60% ditawarkan sebagai "Similar";
  - eksekusi per pasangan: refresh manga tujuan (detail + chapter) → **satu transaksi** (status baca per nomor, progres kalau jumlah halaman sama/belum diketahui, history dengan versi terpilih, penanda, setting reader, tambah ke library dengan kategori) → cover kustom → keluarkan entri lama (opsional).
  - `HistoryRepository.entry`.
- **Renderer:**
  - `lib/limit.ts` (antrean maks. 5, dipakai global search dan pencarian kandidat migrasi); `lib/search.ts` (`sourceSearchQuery`, `defaultSearchSources`); `librarySourceIdsQuery`;
  - `features/search/GlobalSearchPage.tsx` (mockup 06): query di URL (`?q=`), baris per source (skeleton, jumlah hasil, `ErrorState` dengan Verifikasi/Coba lagi, "Lihat semua"), progres keseluruhan, "Hanya source dengan hasil", dan pemilih source (Default / kustom, disimpan);
  - `features/migration/` (mockup 15): route `/library/migrate?ids=[…]`, urutan tujuan (checkbox + naik/turun, disimpan), opsi (disimpan; download non-aktif), baris per manga (Exact / Similar % / Tidak ditemukan / Dipilih, "Ganti", "Cari manual", "Lewati"), footer siap/perlu dipilih, progres, dan ringkasan;
  - tombol **Migrasi** di bar multi-select library dan di detail manga (untuk manga di library).

Keputusan:
- **Penilaian kandidat hanya dari judul.** SDK belum punya judul alternatif, dan author baru diketahui setelah detail diambil (satu request per kandidat), jadi keduanya belum dipakai. Kalau hasilnya kurang, pengguna bisa memakai "Ganti" atau "Cari manual".
- Default source global search = source yang di-pin + source yang punya manga di library; kalau keduanya kosong, semua source terpasang. Default urutan tujuan migrasi = urutan tersimpan, lalu source yang di-pin, lalu semua source.
- Progres chapter yang sedang dibaca hanya dipindah kalau jumlah halaman versi tujuan sama atau belum diketahui. Reader tetap membatasi halaman awal.
- Status baca dipindah ke **semua versi** nomor yang sama, konsisten dengan aturan per nomor (§6.2). Penanda juga ke semua versi.
- Prefs scanlator tidak dipindah, karena grup di source lain berbeda.
- Pencarian manual tidak menawarkan source asal manga dan tidak bisa memilih manga itu sendiri (bug yang tertangkap E2E, sudah diperbaiki).

---

### Penutup Fase 2: selesai (24 Sep 2026), menunggu review

- `lint` (tanpa error; 4 warning virtualizer lama), `format:check`, `typecheck`, dan `test` hijau. **E2E 34/34** (sebelumnya 29).
- **Situs palsu mendapat extension kedua**, sesuai plan. Di 2e mirror Indonesia masih berupa source di extension yang sama; sekarang ia extension terpisah `e2e-mirror` ("E2E Mirror", ID). `e2e-demo` tetap punya source EN dan "E2E Broken" (pencarian selalu gagal). Migrasi di E2E sekarang lintas extension.
- `e2e/support/app.ts`: `launchApp()` memuat kedua extension dan punya **`restart()`** (keluar lalu buka lagi app dengan profil yang sama; folder extension dev diingat).
- **Spec baru `e2e/full-flow.spec.ts`** (5 test, satu sesi, lewat UI):
  1. buat kategori "Reading" di Settings → tambah Paged Hero ke kategori itu → tandai ch. 1 dibaca → baca ch. 2 sampai hal. 3 (RTL, tombol panah) → tandai chapter lewat ikon di reader;
  2. **restart app** → tab Reading berisi Paged Hero dengan "3 unread chapters" → "Continue · Ch. 2" membuka hal. 3 (penanda tetap ada) → History "Ch. 2 · Page 3/4";
  3. incognito dari title bar → baca ch. 3 sampai hal. 2 → tidak ada progres, history tetap ch. 2 → matikan;
  4. global search "hero" dengan set default = source yang punya manga di library (E2E Demo) + source yang di-pin (E2E Mirror) → 2 baris, hasil di Demo diberi badge "In library";
  5. tombol **Migrasi** di detail → Exact di E2E Mirror → "1 read chapter carried over" → entri baru: penanda ch. 2 ada, "Continue · Ch. 2" membuka hal. 3, dan tab Reading hanya berisi entri E2E Mirror.
- **Perbaikan yang ditemukan:** dialog "Cari manual" di migrasi sekarang dibuka di source kandidat yang sedang dipilih, bukan selalu source tujuan pertama (yang bisa saja source yang sedang error).
- **Performa di build final** (1.000 manga + 50.000 chapter, dua grup per nomor, separuh manga menyembunyikan satu grup):
  - `library.list` 71–73 ms (median) untuk semua sort dan filter belum dibaca; filter "Ditandai" 80 ms; `history.list` 8 ms;
  - halaman Library tampil **39 ms** setelah navigasi (36 kartu ter-render);
  - scroll penuh 56.000 px (lompatan 400 px per frame, 138 frame): p50 **16,5 ms**, p95 22,3 ms, maks 29,9 ms;
  - index tambahan tidak diperlukan (target: library < 200 ms, scroll lancar).
- **Dokumentasi:**
  - ADR 0015 (status baca per nomor + satu versi per nomor), 0016 (cover library permanen + cover kustom), 0017 (batas data incognito), dan 0018 (bookmark chapter saja, seperti Mihon), plus indeks `docs/adr/README.md`;
  - `BRAINSTORM.md` §11: Fase 2 ditandai selesai beserta penyesuaiannya;
  - `README.md`: status Fase 0–2 dan tautan ke ADR.

---

## Selingan: ganti nama menjadi Matane (またね), 24 Sep 2026

Dikerjakan sebelum 2c atas permintaan pengguna.
- **Nama yang terlihat pengguna:** `productName` `Matane`, judul jendela, title bar, sidebar dan About (`app.name` + `app.nameNative` "またね"), README, BRAINSTORM (deep link `matane://`, file backup `matane-backup-*.zip`). Nama root workspace `matane`.
- **Tetap:** scope paket internal `@manga-reader/*` (tidak terlihat pengguna, dan menggantinya cuma membuat diff besar). Plan Fase 0/1 dan catatan mockup/Stitch dibiarkan sebagai arsip.
- **Folder data** pindah dari `<appData>/MangaReader` ke `<appData>/Matane` (`main/app/legacy-data.ts`):
  - dijalankan sekali di awal proses, sebelum logging, single-instance lock, dan Chromium membuat folder baru, jadi biasanya cukup satu `rename`;
  - kalau folder baru sudah ada tanpa `data.db`, isinya digabung tanpa menimpa (lock file Chromium dilewati);
  - tidak melakukan apa pun kalau folder baru sudah punya `data.db`;
  - path absolut di DB (`manga.cover_path`, `manga.custom_cover_path`, `image_cache.path`, `downloads.path`) ditulis ulang ke folder baru.
- User-Agent: filter token app diperbarui ke `Matane` (UA extension Example Source sekarang `Matane/<versi>`).
- **Logo** (sumber dari pengguna, `docs/assets/logo.png`): diturunkan menjadi `apps/desktop/resources/icon.png` (512 px, sudut transparan; ikon jendela Windows/Linux lewat `?asset`) dan `renderer/src/assets/logo-mark.png` (128 px, buku saja tanpa tulisan, karena tulisan tidak terbaca di ukuran 32 px) untuk sidebar dan About. README menampilkan logo penuh.
