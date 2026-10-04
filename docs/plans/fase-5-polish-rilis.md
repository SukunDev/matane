# Plan: Fase 5 (Polish & rilis v1.0) Matane

> **Catatan (3 Oct 2026):** bagian yang menyebut repo extension resmi, kunci resmi, dan handoff sudah dicabut dari repo ini (DMCA); lihat ADR 0022/0023. Catatan di bawah tinggal sejarah.

## Context

Fase 4 selesai, kecuali Milestone 4f. Status sekarang:
- Inti app jalan: reader, library, download, update, dan ekosistem extension.
- Fitur polish dari BRAINSTORM §11 Fase 5 sebagian besar belum ada:
  - **Reader:** belum ada crop border, split gambar tinggi, filter warna, auto-scroll, remap keyboard, zoom/pan, maupun gesture sentuh.
  - **Shell:** command palette (tombol di title bar masih "segera"), onboarding, What's new, Discord RPC, dan halaman Statistik (masih placeholder) belum ada.
  - **Setting:** bagian Reader dan Jaringan masih "coming soon".
  - **Data:** backup/restore belum ada.
  - **Rilis:** paket baru tersedia untuk AppImage, NSIS, dan dmg. Belum ada situs dokumentasi.

Fase 5 menutup semua itu dan berakhir dengan rilis **v1.0**.

Sudah ada dan dipakai ulang:
- **Tema:** AMOLED dan 14 aksen sudah jadi.
- **Reader:**
  - mode `vertical` dengan gap, background 3 preset;
  - override per manga (`effectiveReaderSettings`, `manga.reader_settings_json`);
  - preset tap zone (`navigation.ts`);
  - menu klik kanan "Set as cover" (`PageContextMenu.tsx`);
  - virtualisasi `@tanstack/react-virtual`.
- **Database:**
  - kolom `image_cache.width/height/segments/variantsJson` sudah ada tapi belum dipakai;
  - kolom `manga.coverColor` juga sudah ada tapi belum dipakai;
  - tabel `reading_sessions` sudah terisi oleh `SessionRecorder`.
- **Main:**
  - `sharp` (ADR 0024) dan `@matane/extension-runtime/image`;
  - `app.getInfo` dan `AppUpdater` (`main/app/updater.ts`, deteksi AppImage/portable);
  - `features/settings/controls.tsx` dan `READY_SECTIONS`.
- **Mockup** `docs/ui/html/11-settings-reader`, `12-command-palette`, `13-onboarding`, dan `14-statistics` (ADR 0008).

Acuan:
- `docs/BRAINSTORM.md` §6.1 (reader), §6.3 (statistik), §6.5 (jaringan), §6.6 (tema, palette, onboarding, What's new, Discord, struktur setting), §6.7 (backup), §10 (paket, logging, dokumentasi), dan §11;
- ADR 0008, 0014, 0021, dan 0024.

Keputusan dari diskusi (1 Okt 2026):
- **7 milestone (5a–5g) dengan checkpoint.** Aku berhenti di setiap checkpoint untuk review dan commit olehmu, dan tidak pernah commit sendiri.
- **Discord Rich Presence masuk Fase 5:**
  - default mati;
  - Client ID dibuat olehmu di Discord Developer Portal;
  - selama ID masih kosong, opsinya disembunyikan.
- **Situs dokumentasi VitePress di GitHub Pages:**
  - panduan pengguna dan panduan extension;
  - Pages dinyalakan olehmu.
- **AUR dan Flatpak:**
  - Fase 5 menyiapkan PKGBUILD dan manifest Flatpak lalu mengujinya lokal;
  - submit ke AUR/Flathub kamu lakukan bersama 4f.
  - portable, deb, dan rpm dibangun di CI.
- **Urutan: Fase 5 (5a–5f) → Milestone 4f → 5g (rilis v1.0).** v1.0 sudah memakai repo resmi, dan Example Source dipasang dari repo.
- **Nama final** tetap **Matane** (sudah dipakai di appId, productName, dan userData). Di 5g ketersediaannya dicek di AUR dan Flathub.

Di luar cakupan (setelah v1, sesuai §11):
- tracker, login per source, import `.tachibk`, source file lokal, template CMS, sinkronisasi antar perangkat, dan code signing.

Langkah pertama implementasi:
- simpan rencana ini ke `docs/plans/fase-5-polish-rilis.md` (sudah, 1 Okt 2026);
- perbarui `docs/BRAINSTORM.md` §11 Fase 5 (keputusan di atas) dan §12.

---

## Milestone 5a: Pipeline gambar reader (dimensi, crop border, split gambar tinggi)

- **Dimensi di main:**
  - Saat halaman disajikan (`images/service.ts`), `sharp().metadata()` mengisi `width`, `height`, dan `segments` di `image_cache`. Halaman download yang tidak masuk cache dicatat dengan key metadata saja.
  - IPC `reader.pageInfo({chapterId})` mengembalikan dimensi yang sudah diketahui. Webtoon memakainya untuk `estimateSize` tanpa layout shift.
  - Pengukuran di renderer (`usePageSizes`) tetap menjadi fallback.
- **Crop border otomatis:**
  - `sharp.trim()` dengan threshold, hanya membuang tepi yang seragam putih atau hitam;
  - setting `reader.cropBorders` (default mati, bisa dioverride per manga);
  - hasilnya disimpan sebagai **varian** di cache (`variantsJson`, ikut LRU). Halaman asli dan download tidak diubah.
- **Split gambar tinggi:**
  - gambar dengan tinggi lebih dari 3× lebar atau lebih dari 5000 px dipotong menjadi segmen di main;
  - route `manga://page/<chapterId>/<index>/seg/<n>`;
  - urutan proses: `transformImage` extension → crop → split;
  - webtoon me-render dan me-preload per segmen. Progress dan offset tetap dihitung per halaman: segmen dipetakan kembali ke halaman beserta offset-nya.
  - setting `reader.splitTall` (default nyala, bisa dimatikan).
- **Pindah pekerjaan berat dari thread utama:** crop dan split memakai thread pool libvips milik sharp (async), dengan dedupe in-flight seperti `page()`.
- **Test:**
  - unit test untuk trim (tepi putih, hitam, tanpa tepi), titik potong split, pemetaan segmen ↔ halaman/offset, dan varian yang ikut terhapus LRU;
  - E2E: situs palsu menyajikan halaman bertepi putih dan satu strip 800×12000. Reader menampilkan halaman yang sudah di-crop, strip tampil sebagai 3 segmen, dan progress tersimpan dengan benar setelah restart.

**Checkpoint 5a:**
- Webtoon panjang (Example Source/strip E2E) di-scroll tanpa lompatan layout.
- Crop dinyalakan dan dimatikan, dan halaman langsung berubah.
- Chapter yang sudah didownload tetap terbaca offline, dengan crop dan split.

---

## Milestone 5b: Interaksi reader dan Settings → Reader (mockup 11)

- **Remap keyboard:**
  - `features/reader/keymap.ts`: daftar aksi (`next`, `prev`, `nextChapter`, `prevChapter`, `fullscreen`, `menu`, `exit`, `first`, `last`, `scrollDown`, `scrollUp`, `autoScroll`, `zoomIn`/`zoomOut`/`zoomReset`) dengan default yang sama seperti sekarang;
  - satu dispatcher menggantikan tiga listener `keydown` di `ReaderPage`, `PagedView`, dan `WebtoonView`;
  - setting `reader.keymap` menyimpan override saja, dan bentrok tombol ditolak di UI.
- **Zoom/pan:**
  - Ctrl+scroll, Ctrl +/−/0, dan double-click di mode halaman. Pan dengan drag dan scroll saat zoom > 1.
  - Di webtoon, zoom mengubah lebar kolom.
- **Sentuh** (Pointer Events, tanpa library):
  - swipe untuk ganti halaman (mengikuti arah LTR/RTL);
  - pinch untuk zoom;
  - tap memakai tap zone yang sama dengan mouse.
- **Auto-scroll webtoon:**
  - kecepatan bisa diatur (`reader.autoScrollSpeed`);
  - tombol di overlay, plus Space atau klik untuk jeda;
  - berhenti di akhir chapter terakhir yang tersedia, dan juga saat jendela tidak fokus.
- **Filter warna** (CSS filter di renderer):
  - brightness, kontras, grayscale, invert, dan sepia/"hangat";
  - warna latar kustom selain 3 preset;
  - grup `reader.filters` dengan override per manga dan tombol reset.
- **Indikator halaman:** setting `reader.pageIndicator` (nyala/mati).
- **Menu klik kanan:** tambah "Save image…" (dialog simpan, nama `<judul> - Ch X - p N.ext`) dan "Copy image" (`clipboard.writeImage` di main), di samping "Set as cover".
- **Lapisan default per jenis:**
  - `reader.typeDefaults` per jenis (`manga`, `manhwa`, `manhua`, `comic`) untuk mode dan arah;
  - default-nya sama dengan logika yang sekarang di-hardcode di `resolveMode`/`resolveDirection`;
  - urutan: global → per jenis → per manga.
- **Settings → Reader** (masuk `READY_SECTIONS`, sesuai mockup 11):
  - mode, arah, fit, lebar webtoon, gap, dan latar;
  - default per jenis;
  - tap zone dengan pratinjau visual (memakai ulang `zoneGrid`);
  - crop dan split dari 5a;
  - filter, auto-scroll, dan indikator;
  - editor keybinding ("tekan tombol…", reset per aksi dan reset semua).
- **Test:**
  - unit test: keymap (default, override, bentrok), resolusi tiga lapis, dan gesture (ambang swipe/pinch dengan event sintetis);
  - E2E: remap `next` ke `L` lalu dipakai di reader, zoom dengan Ctrl+scroll, filter grayscale terlihat di computed style, save image ke folder scratch, dan auto-scroll bergerak lalu berhenti.

**Checkpoint 5b:**
- Settings → Reader dibandingkan dengan mockup 11.
- Semua aksi keyboard bisa di-remap.
- Gesture sentuh dicoba dengan emulasi touch.

---

## Milestone 5c: Command palette, onboarding, What's new, warna cover, dan Discord RPC

- **Command palette (Ctrl+K, mockup 12):**
  - memakai `cmdk` lewat komponen shadcn `Command` (dicek dulu bahwa masih dirawat), dipicu oleh tombol di title bar (hapus `titlebar.searchSoon`);
  - grup isi:
    - navigasi ke semua halaman dan bagian setting;
    - manga di library (FTS5 yang sudah ada);
    - "Lanjut baca" dari 5 item history teratas;
    - aksi: cek update, pause/resume download, toggle incognito, buka setting reader, sinkron repo.
  - Mengetik lalu `Tab` atau memilih "Search sources for…" membuka Global search.
- **Onboarding (mockup 13), 5 langkah:**
  1. bahasa UI dan tema;
  2. bahasa konten (`browse.languages`);
  3. folder download;
  4. source: pasang dari repo resmi (aktif setelah 4f), atau dilewati;
  5. ringkasan kontrol reader.
  - Setting `onboarding.done`. Profil lama yang sudah punya library atau source terpakai dianggap selesai.
  - Bisa diulang dari Settings → About.
- **What's new:**
  - `CHANGELOG.md` di-bundle (`?raw`), lalu bagian versi berjalan diparse dengan format `## <versi> — <tanggal>` yang sama dengan `release.yml`;
  - dialog tampil sekali setelah versi berubah (setting `whatsNew.lastSeen`), dan tetap bisa tampil saat offline;
  - bisa dibuka lagi dari About. Tidak tampil di install pertama (onboarding didahulukan).
- **Warna dari cover:**
  - dominan cover diekstrak dengan `sharp().stats()` saat cover library disimpan atau diperbarui (`library/covers.ts`), lalu disimpan ke `manga.coverColor`;
  - manga lama diisi bertahap (backfill) di background;
  - `MangaInfo.coverColor` dipakai untuk tint header detail dan tombol utama, dengan kontras dijaga (warna diturunkan otomatis kalau terlalu terang, teks crust/base mengikuti aturan aksen).
- **Discord Rich Presence:**
  - library IPC Discord dicek dulu bahwa masih dirawat (mis. `@xhayper/discord-rpc`);
  - `main/app/discord.ts` menampilkan "Reading <judul> · Ch X" dari state reader;
  - setting `general.discord`: `enabled` (default mati) dan `hideTitle`;
  - otomatis mati untuk manga dari source NSFW dan saat incognito;
  - kalau Discord tidak jalan, fitur ini diam tanpa error dan mencoba lagi dengan jeda;
  - `DISCORD_CLIENT_ID: string | null = null`; selama null, opsinya disembunyikan (pola yang sama dengan URL repo resmi).
- **Test:**
  - unit test: parser changelog, ekstraksi warna dan penyesuaian kontras, dan aturan kapan presence dikirim (NSFW, incognito, hideTitle) dengan klien palsu;
  - E2E: Ctrl+K → buka manga, toggle incognito lewat palette, onboarding di profil baru (langkah 1–5, setting tersimpan), profil lama tidak menampilkan onboarding, dan What's new muncul sekali setelah versi palsu berubah.

**Checkpoint 5c:**
- Palette dan onboarding dibandingkan dengan mockup 12 dan 13.
- Header detail berwarna dari cover di tema Mocha dan Latte.
- Discord diuji live kalau Client ID sudah ada. Kalau belum, cukup unit test.

---

## Milestone 5d: Statistik dan setting Jaringan

- **Halaman Statistik (mockup 14):**
  - **Ringkasan:** jumlah manga di library, chapter dibaca, total waktu baca, rata-rata per hari, dan streak.
  - **Grafik:** chapter dibaca dan waktu baca per minggu/bulan (dari `reading_sessions` + `chapters.read_at`), genre dan source teratas.
  - **Rentang:** 30 hari, 12 bulan, atau semua.
  - Grafik memakai komponen SVG sendiri (bar dan list), tanpa dependensi grafik. Data incognito memang tidak pernah tercatat.
  - IPC `stats.overview({range})` dengan query ber-index, diuji dengan seed 1.000 manga / 50 ribu chapter.
  - Tombol "hapus statistik" di Settings → Data.
- **Settings → Jaringan:**
  - **DNS-over-HTTPS:** `app.configureHostResolver`, dengan preset Cloudflare, Google, Quad9, AdGuard, atau URL kustom (divalidasi https), dan mode mati / otomatis / wajib.
  - **Proxy:** ikut sistem, langsung, HTTP, atau SOCKS5 (host, port, auth opsional). Diterapkan dengan `session.setProxy` ke default session, semua partition `persist:ext-*` yang sudah dibuat, dan partition yang dibuat setelahnya (`NetworkManager`). Kredensial auth lewat event `login`, disimpan dengan `safeStorage`.
  - **User-Agent kustom:** prioritasnya UA extension → UA global → default (`user-agent.ts`), dengan tombol reset.
  - Tombol **"Test connection"** (fetch ke Example Source API / `example.com` lewat stack yang sama), lalu tampilkan hasil dan IP resolver.
  - Semua perubahan berlaku langsung tanpa restart.
- **Test:**
  - unit test: agregasi statistik (minggu/bulan, zona waktu, rentang kosong), validasi setting jaringan, dan prioritas UA;
  - E2E: statistik dari seed sesi baca (angka cocok), proxy HTTP lokal di test (request extension benar-benar lewat proxy), dan UA kustom terlihat di server palsu.

**Checkpoint 5d:**
- Statistik dibandingkan dengan mockup 14.
- Live check: DoH Cloudflare + proxy lokal, dan Example Source tetap jalan.

---

## Milestone 5e: Backup dan restore

- **Format** `matane-backup-YYYY-MM-DD.zip`:
  - `backup.json` dengan `formatVersion: 1` dan skema zod di `packages/shared/src/backup.ts`, plus folder `covers/`;
  - semua data dirujuk lewat **natural key** (`sourceId` + `url`).
  - Isinya sesuai §6.7: library, kategori, chapter (dibaca, bookmark, progress), setting reader per manga, prefs scanlator, cover kustom, history, sesi baca, repo, daftar extension terpasang beserta prefs dan storage-nya, setting app, dan link tracker tanpa token.
  - Tidak termasuk: file download, cache, dan rahasia.
- **Pembuatan dan restore di worker thread** (`main/backup/worker.ts`, koneksi SQLite sendiri), dengan event progres.
- **Restore:**
  - **preview:** jumlah manga, kategori, dan chapter dibaca, serta extension yang belum terpasang;
  - **Merge** (default):
    - dibaca = OR, progress = yang terjauh, kategori = gabungan, history = yang terbaru;
    - setting hanya ditimpa kalau dicentang.
  - **Replace:** wajib konfirmasi, dan backup otomatis kondisi sekarang dibuat dulu.
  - Extension yang belum terpasang ditawarkan dari repo yang tercatat di backup atau repo yang sudah ada, lewat dialog izin biasa (installer 4b).
  - Chapter download dihubungkan lagi kalau path-nya ada.
  - Hasil akhir berupa ringkasan: berhasil, dilewati, dan gagal.
- **Auto-backup:**
  - pilihan harian (default), mingguan, atau mati, dengan menyimpan 7 file;
  - folder bisa diatur (default `userData/backups`), dengan tip untuk Syncthing/Dropbox;
  - dijalankan saat idle, dan dikejar saat start kalau terlewat.
- **UI:** Settings → Data → Backup berisi buat sekarang, restore, auto-backup, folder, dan daftar backup terakhir. Ada juga aksi "Backup now" di palette.
- **Test:**
  - unit test:
    - round-trip export → import ke DB kosong (hasilnya sama);
    - aturan merge per tabel;
    - file rusak atau `formatVersion` asing ditolak dengan pesan jelas;
    - rotasi 7 file;
    - auto-backup yang terlewat;
  - E2E: buat backup → profil baru → restore merge → library, progres, dan kategori sama; extension yang hilang ditawarkan dan dipasang dari repo test; replace membuat backup pengaman.

**Checkpoint 5e:**
- Backup profil live check dipulihkan ke profil kosong.
- Restore 1.000 manga tidak membekukan UI.

---

## Milestone 5f: Lanjutan, paket, dokumentasi, dan performa

- **Settings → Lanjutan dan Tentang:**
  - **Log:** level log (`electron-log`: error / warn / info / debug), dan tombol buka folder log.
  - **Crash:** `crashReporter.start({ uploadToServer: false })`, dengan dump disimpan lokal.
  - **Info debug:** tombol "Copy debug info" berisi versi app/OS/Electron, jenis paket, extension terpasang (id@versi, asal), dan 100 baris log terakhir, tanpa path pribadi atau URL berisi token.
  - **Tentang:** lisensi pihak ketiga (dihasilkan saat build), link repo/issue/dokumentasi, ulangi onboarding, dan What's new.
- **Paket:**
  - **Target baru** di `electron-builder.yml`:
    - Windows `portable`;
    - Linux `deb` dan `rpm` (x64);
    - matrix `release.yml` ikut menghasilkan file-file ini.
  - **AUR:** `packaging/aur/PKGBUILD` (`matane-bin`, dari `.deb` rilis), plus `.SRCINFO` dan skrip `update-aur.mjs` untuk mengisi versi dan sha256. Diuji dengan `makepkg` lokal kalau tersedia.
  - **Flatpak:**
    - `packaging/flatpak/dev.sukun.matane.yml` (base `org.electronjs.Electron2.BaseApp`) dan `dev.sukun.matane.metainfo.xml` (screenshot dari `docs/ui/screens`);
    - folder download lewat portal;
    - diuji dengan `flatpak-builder` lokal kalau tersedia.
    - Persyaratan Flathub dicek dulu (§12).
  - **Updater per jenis paket:**
    - deteksi `FLATPAK_ID`, deb/rpm/AUR (bukan AppImage, terpasang di `/opt` atau `/usr`), dan portable;
    - semuanya mode `notify`, dengan pesan "update lewat package manager" untuk Flatpak/AUR/deb/rpm;
    - ADR 0021 diperbarui.
  - Live check: deb dan rpm dipasang di container (podman/docker kalau ada) lalu app terbuka. Portable diuji di CI Windows (smoke start).
- **Komunitas:**
  - `CODE_OF_CONDUCT.md` (Contributor Covenant);
  - `.github/ISSUE_TEMPLATE/`: bug (dengan info debug), fitur, dan permintaan source (diarahkan ke repo extension), plus `PULL_REQUEST_TEMPLATE.md`.
- **Situs dokumentasi VitePress** (`apps/docs`, paket workspace):
  - **Panduan pengguna:** install per OS (cara melewati SmartScreen/Gatekeeper, Flatpak/AUR), library, reader dan kontrol, download dan offline, extension dan repo, jaringan (DoH untuk pengguna Indonesia), backup, dan FAQ dengan disclaimer konten.
  - **Panduan extension:** isi `docs/extensions.md` dipindah ke sini, dan file lamanya menjadi link.
  - Workflow `docs.yml` membangun di PR dan deploy ke Pages dari `main`.
  - Bahasa: Inggris (sama seperti README).
- **Performa** (target §10):
  - skrip `apps/desktop/scripts/bench/`:
    - waktu startup (`app ready` → library tampil) dari profil seed;
    - scroll library 1.000 manga (frame time lewat Playwright tracing);
    - memori renderer di webtoon 200 halaman.
  - Hasilnya dicatat di plan. Perbaikan dilakukan kalau ada yang melewati target (startup < 2 detik).
- **Test:** unit test untuk deteksi jenis paket dan isi info debug (tanpa data pribadi), plus E2E untuk Copy debug info dan level log.

**Checkpoint 5f:**
- Semua paket Linux dibangun lokal.
- Situs dokumentasi dibangun dan dicek di `vitepress preview`.
- `actionlint` lolos.
- Hasil benchmark tercatat.

---

## Milestone 4f (di antara 5f dan 5g)

Dijalankan sesuai `docs/plans/fase-4-ekosistem-extension.md` dan `panduan repo extension (dihapus)`:
- repo resmi hidup;
- SDK diterbitkan ke npm;
- Example Source keluar dari app, dengan handoff untuk pengguna lama.

Onboarding langkah 4 diuji ulang dengan repo resmi asli. Submit AUR/Flathub juga dilakukan di sini olehmu, dengan panduan di `packaging/README.md`.

---

## Milestone 5g: Rilis v1.0

- **Release candidate:**
  - versi `1.0.0-rc.1`, lalu `1.0.0`;
  - default `updater.channel` menjadi `stable`, sementara profil beta yang sudah memilih `beta` tetap di beta.
- **Isi rilis:**
  - `CHANGELOG.md` untuk 1.0.0 (juga isi What's new);
  - `SECURITY.md` (versi yang didukung: 1.x);
  - README berisi status v1, screenshot terbaru, tabel unduhan per format, dan link situs dokumentasi;
  - `docs/BRAINSTORM.md` §11 (Fase 5 selesai) dan §12 (semua checklist terjawab).
- **Pengecekan akhir:**
  - E2E penuh;
  - live check AppImage di profil baru (onboarding → pasang Example Source dari repo resmi → baca → download → backup);
  - profil `0.1.0-beta.1` dan `0.2.0-beta.x` (salinan) dibuka di 1.0: migrasi DB, handoff, dan What's new.
- **Tag `v1.0.0`** di-push olehmu. Workflow rilis membangun semua paket, lalu PKGBUILD AUR dan manifest Flatpak diperbarui dengan versi dan hash.

**Checkpoint 5g:** rilis GitHub v1.0.0 lengkap untuk semua OS, auto-update dari beta terakhir ke 1.0.0 terbukti (AppImage/NSIS), dan situs dokumentasi hidup.

---

## File kunci

- **Main:**
  - `images/{service,protocol,cache}.ts` (dimensi, varian crop/split, `/seg/<n>`), dan `images/processing.ts` (baru);
  - `app/{discord,crash,debug-info}.ts` (baru), `app/updater.ts`, dan `app/log.ts`;
  - `network/{manager,user-agent}.ts` + `network/settings.ts` (baru: DoH dan proxy);
  - `stats/service.ts` (baru);
  - `backup/{service,worker,format,merge}.ts` (baru);
  - `library/covers.ts` (warna cover);
  - `ipc/handlers.ts` dan `index.ts`.
- **Shared:**
  - `settings.ts`: grup `reader` diperluas, plus grup baru `network`, `backup`, `onboarding`, `whatsNew`, dan `general.discord`;
  - `backup.ts` (baru);
  - kontrak IPC `reader.pageInfo`, `stats.*`, `backup.*`, `network.test`, dan `app.debugInfo`;
  - `MangaInfo.coverColor`.
- **Renderer:**
  - `features/reader/{keymap,gestures,autoscroll,filters}.ts` (baru) dan view yang sudah ada;
  - `features/settings/{ReaderSettings,NetworkSettings,BackupSettings}.tsx`;
  - `features/palette/`, `features/onboarding/`, `features/whats-new/`, dan `features/statistics/`;
  - header detail untuk tint warna cover.
- **Build/CI:**
  - `electron-builder.yml`, `release.yml`, dan `docs.yml` (baru);
  - `packaging/{aur,flatpak}/`;
  - `apps/docs/` (VitePress) dan `apps/desktop/scripts/bench/`.
- **E2E:**
  - `e2e/support/site.ts`: halaman bertepi, strip tinggi, dan proxy HTTP test;
  - spec baru: `reader-images`, `reader-controls`, `palette`, `onboarding`, `statistics`, `network`, dan `backup`.

## Verifikasi

1. **Per milestone:** `pnpm lint`, `format:check`, `typecheck`, `test`, dan `e2e` semuanya hijau, termasuk unit test baru di atas.
2. **E2E** tetap memakai situs palsu tanpa jaringan.
3. **Live check** di app hasil build, dengan `XDG_CONFIG_HOME` terpisah dan folder scratch:
   - Example Source asli untuk crop, split, dan auto-scroll;
   - DoH + proxy;
   - backup dan restore antar profil;
   - dibandingkan dengan mockup 11–14.
4. **Paket:** AppImage, deb, rpm, Flatpak lokal, dan PKGBUILD; `actionlint` untuk workflow baru dan yang diubah.

## Yang perlu kamu siapkan

- **5c:** Discord Application "Matane" di Discord Developer Portal, lalu Client ID-nya (tidak rahasia) diberikan kepadaku. Opsional; fiturnya tersembunyi kalau belum ada.
- **5f:** nyalakan GitHub Pages (source: GitHub Actions) di repo `matane` untuk situs dokumentasi.
- **4f:** semua yang tercantum di plan Fase 4, ditambah akun AUR (kunci SSH) dan PR ke Flathub.
- **5g:** push tag `v1.0.0-rc.1` / `v1.0.0`.

## Status pelaksanaan

- 1 Okt 2026: rencana disetujui dan disimpan di sini. Implementasi dimulai dari Milestone 5a setelah kamu bilang "lanjut".

### Milestone 5a: selesai (1 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `react-hooks/incompatible-library` untuk `useVirtualizer`), `format:check`, `typecheck`, dan `test` hijau: desktop 228 test (sebelumnya 211), shared 24 (sebelumnya 21). E2E 83/83.
- Test baru:
  - `packages/shared/src/reader.test.ts` (3): rencana segmen `pageSegments`.
  - `apps/desktop/src/main/images/processing.test.ts` (8): ukuran dengan orientasi EXIF, crop margin putih/hitam, noise JPEG, halaman tanpa margin, margin tipis, halaman hampir kosong, crop satu sisi, potong segmen berurutan, dan crop sebelum dipotong.
  - `page-meta.test.ts` (4): simpan ukuran lalu kotak crop, daftar per chapter, tanda pakai sekali sehari, dan pemangkasan.
  - `images.test.ts` (+5): prepare dengan/tanpa crop, halaman tanpa margin disajikan apa adanya, segmen dibuat sekali lalu dibuat ulang setelah keluar dari cache, halaman download tidak diubah, dan gambar baru di key yang sama diukur ulang.
  - `e2e/reader-images.spec.ts` (4): strip 100×12000 tampil sebagai 3 segmen dengan tinggi benar sebelum dimuat, crop langsung berlaku, posisi di tengah halaman tinggi kembali tepat setelah restart, dan chapter download terbaca dengan crop + segmen saat situs mati dan cache kosong.
- Live check (app hasil build, profil `XDG_CONFIG_HOME` terpisah, folder download scratch):
  - Example Source tidak bisa dipakai: DNS ISP membelokkan `api.example.org` ke halaman blokir (alasan DoH di 5d). Dipakai source Indonesia bawaan.
  - "Riches Can't Buy Loyalty" (Example Source C) halaman 800×14770 → 4 segmen (3692/3692/3692/3694), tinggi kotak 14770 sebelum dan sesudah dimuat, sambungan antarsegmen tidak terlihat.
  - Halaman Example Source B 836×1200 → 813×1172 dengan crop; screenshot sebelum/sesudah menunjukkan margin putih hilang.
  - Chapter tinggi di-download, cache halaman dikosongkan, app dibuka lagi dengan `--proxy-server=http://127.0.0.1:9` (tanpa jaringan): keempat segmen tetap tampil.
- Implementasi:
  - **Shared:** `pageSegments` + `SPLIT_ABOVE_PX` (5000) / `SEGMENT_HEIGHT_PX` (4000); setting `reader.cropBorders` (default mati) dan `reader.splitTall` (default nyala), keduanya bisa per manga; IPC `reader.preparePage` dan `reader.pageSizes`.
  - **DB:** migrasi `0004_page_meta`: tabel `page_meta` (ukuran, kotak crop, ukuran byte gambar asal) dan kolom `image_cache` yang tidak terpakai dihapus.
  - **Main:** `images/processing.ts` (measure, cropBox, cropImage, splitImage), `images/page-meta.ts`, `ImageService.pageView/preparePage/pageSizes/clearCache`, varian di cache (`#c0`, `#s<n>`, `#cs<n>`), route `manga://page/<c>/<i>/seg/<n>?crop=1`, pemangkasan `page_meta` saat start (200 000 baris).
  - **Renderer:** `pages.ts` (ukuran per mode crop, `preparePage`, `seedPageSizes`, preload per segmen), `PageImage` (segmen bertumpuk dengan aspect ratio, dimuat lazy), toggle "Crop borders" dan "Split tall pages" di panel reader.
  - **Dokumentasi:** ADR 0025, `docs/BRAINSTORM.md` §6.1, §6.5, dan §7.
- Beda dari rencana:
  - Dimensi dan crop disimpan di tabel baru `page_meta`, bukan di kolom `image_cache`, supaya halaman download (yang tidak masuk cache) juga punya ukuran; kolom lama dihapus.
  - Aturan split menjadi "lebih tinggi dari 5000 px → segmen sama tinggi maks. 4000 px", tanpa aturan "3× lebar".
  - Crop dihitung sendiri dari satu decode greyscale (bukan `sharp.trim()`), supaya aturannya pasti dan bisa diuji.
  - Halaman tetap satu item di strip (progress dan offset per halaman); segmennya dimuat lazy saat mendekat.
- Catatan:
  - `e2e/content.spec.ts` gagal karena extension bawaan baru di commit terakhirmu (example-d, example-c, example-b) menambah source Indonesia yang tersembunyi. Jumlah yang diharapkan sekarang dihitung dari daftar source.
  - Setting Reader lengkap (termasuk crop/split) masuk Settings → Reader di 5b; untuk sekarang toggle-nya ada di panel reader.

### Milestone 5b: selesai (1 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `useVirtualizer`), `format:check`, `typecheck`, dan `pnpm test` hijau: desktop 239 test, shared 31. E2E 90/90.
- Test baru:
  - `packages/shared`: `reader.test.ts` (+3: nama tombol `keyId`, keymap efektif, dan tidak ada tombol bawaan ganda) dan `settings.test.ts` (4: setting lama terisi bawaan, field rusak jatuh sendiri, resolusi global → per jenis → per manga, field yang ikut manga).
  - `features/reader/gestures.test.ts` (8): swipe cepat vs drag lambat, ambang jarak dan arah, tap, pinch dua jari, pointer asing, batas zoom, chip tombol, dan filter CSS.
  - `main/images/page-file.test.ts` (3): nama file "Judul - Ch X - p N", karakter terlarang, dan konversi PNG untuk clipboard.
  - `e2e/reader-controls.spec.ts` (8): remap tombol di Settings → Reader + tombol bentrok ditolak, tombol baru membalik halaman, zoom Ctrl+wheel/Ctrl+= tanpa men-zoom jendela + drag untuk menggeser, filter hanya di halaman, simpan dan salin gambar (clipboard berisi PNG), swipe dan pinch sentuh (CDP touch), auto-scroll (Space berhenti, berhenti sendiri di akhir chapter terakhir), dan default per jenis.
- Live check (app hasil build, profil terpisah):
  - Settings → Reader dibandingkan dengan mockup 11: bagian Bawaan, Per jenis, Navigasi (kartu tap zone dengan pratinjau, balik zona, roda gulir), Pintasan keyboard, Tampilan, dan Performa.
  - Auto-scroll pada strip Example Source C asli: 300 px/s → bergerak ±900 px dalam 3 detik, berhenti total setelah Space.
  - Zoom pada halaman Example Source B asli: Ctrl+wheel → 331% di sekitar kursor, zoom jendela tetap 1.
  - Live check menemukan bug yang lolos dari E2E: CSS `zoom` tidak memperbesar halaman yang sudah dibatasi layar (fit screen), lalu kotak `min-h-full` ikut membesar dan halaman tergeser keluar layar. Diperbaiki dengan menskalakan spread (`transform`) di dalam kotak seukuran hasil zoom. E2E sekarang memeriksa bahwa halaman yang di-zoom tetap di layar; asersi ini terbukti gagal pada versi yang salah.
- Implementasi:
  - **Shared:** `READER_ACTIONS`, `DEFAULT_KEYMAP`, `keyId`, `effectiveKeymap`, `actionForKey`; setting reader baru `typeDefaults`, `invertTapZones`, `wheelTurnsPages`, `preloadPages`, `backgroundColor` (+ latar `custom`), `filters`, `autoScrollSpeed`, `pageIndicator`, `keymap`; `filters`/`backgroundColor` ikut override per manga; `resolveMode`/`resolveDirection` memakai default per jenis (tipe kosong = "other").
  - **Main:** IPC `reader.savePage` (dialog simpan, file asli) dan `reader.copyPage` (PNG lewat clipboard API async Electron 44), `images/page-file.ts`.
  - **Renderer:** `keymap.ts` (konteks + `useReaderKeys`), satu listener tombol di `ReaderPage`, `gestures.ts` + `useGestures.ts`, `filters.ts` (variabel `--reader-filter` hanya untuk `[data-page]`), zoom di `PagedView` (1–4×) dan `WebtoonView` (lebar kolom 0,5–3×), auto-scroll, tombol Auto-scroll di bar bawah, menu klik kanan Save/Copy, panel reader mendapat filter + warna latar + tautan ke Settings → Reader, halaman `ReaderSettings.tsx` + `KeymapEditor.tsx`.
  - **Dokumentasi:** ADR 0026 (input reader), `docs/BRAINSTORM.md` §6.1 dan §6.6, ADR 0006 (test di Node).
- Beda dari rencana:
  - Ditambah tiga opsi dari mockup 11 yang belum ada di rencana: "Invert tap zones", "Scroll wheel turns pages", dan "Preload pages".
  - Klik dua kali hanya men-zoom di zona tengah (zona menu), supaya tidak bentrok dengan tap zone yang membalik halaman.
  - Di strip, sentuhan tetap memakai scroll bawaan browser; pinch sentuh di strip bergantung pada browser yang meneruskan kedua jari (trackpad dan keyboard selalu jalan).
  - Tombol "Export settings" di mockup tidak dibuat (masuk backup di 5e).
- Catatan:
  - **Unit test desktop sekarang jalan di Node biasa** (`vitest run`), tidak lagi di dalam Electron (`ELECTRON_RUN_AS_NODE`). Di mode itu sharp crash (SIGSEGV) pada buffer piksel mentah dan `metadata()` PNG/JPEG, padahal di proses main Electron yang dipakai app sharp jalan normal (E2E + live check dengan 49 halaman JPEG). `better-sqlite3` 13 sudah N-API, jadi binary yang sama jalan di Node. Akibatnya, laporan 5a "desktop 228" berasal dari `vitest` di Node; lewat `pnpm test` waktu itu tiga file test sharp sebenarnya crash tanpa terlihat. Sekarang `pnpm test` di root menjalankan semuanya (239/239).
  - `.github/workflows/ci.yml` hanya berubah di komentar; actionlint tidak tersedia di sesi ini.

### Milestone 5c: selesai (1 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `useVirtualizer`), `format:check`, `typecheck`, dan `pnpm test` hijau: desktop 258 test, shared 31. E2E 103/103.
- Dependensi baru: `cmdk` 1.1.1 (palette) dan `@xhayper/discord-rpc` 1.5.1 (Discord), keduanya dicek masih dirawat.
- Test baru:
  - `app/discord.test.ts` (6): judul + chapter sekali saja dan hilang saat reader ditutup, sembunyikan judul / NSFW / incognito, tidak menyambung saat mati, Discord tidak jalan → diam dan coba lagi tiap menit, tampil lagi setelah Discord restart, hilang setelah 10 menit tanpa aktivitas, dan sumber Client ID.
  - `images/cover-color.test.ts` (3): warna cover (bukan latar putih/garis hitam), warna hanya berlaku untuk cover asalnya, dan diukur sekali di background.
  - `lib/cover-tint.test.ts` (3): kontras teks ≥ 4,5:1 di tema gelap dan Latte, cover terang diturunkan / gelap dinaikkan, dan cover abu-abu tanpa tint.
  - `features/whats-new/changelog.test.ts` (4) dan `features/palette/match.test.ts` (3).
  - E2E: `palette.spec.ts` (6: warna header dari cover, Ctrl+K → manga library, lanjut baca, incognito dan "Settings › Reader", Tab → Global search, Ctrl+K/Escape menutup), `onboarding.spec.ts` (3: lima langkah di profil baru, tidak muncul lagi tapi bisa diulang dari About, profil lama tidak melihatnya), `whats-new.spec.ts` (3: profil baru tidak, setelah update sekali saja, dari About kapan saja), dan `discord.spec.ts` (1: opsi tersembunyi tanpa Client ID; dengan ID dan tanpa Discord, membaca tetap normal).
- Live check (app hasil build):
  - Profil lama dari live check 5a/5b: onboarding tidak muncul, What's new 0.1.0-beta.1 muncul sekali (profil ini memang dibuat sebelum fitur ini).
  - Palette (mockup 12) dengan "ki": hasil library dengan cover dan "Continue", Lanjut baca, Search sources + Tab.
  - Onboarding (mockup 13) di profil baru, langkah 1–5.
  - Header detail dengan cover asli Example Source B dan Example Source C: Mocha → tan pastel rgb(209 162 133) dengan teks crust; Latte → cokelat pekat rgb(152 93 58) dengan teks base.
  - Live check menemukan dua masalah yang lolos dari E2E dan sudah diperbaiki: (1) `stats().dominant` sharp memberi `#f8f8f8` untuk kedua cover asli (latar putih menang), diganti pemilihan hue berbobot chroma; (2) tombol utama tetap ungu karena tema memakai `@theme inline`, jadi yang di-override sekarang `--app-accent`/`--app-on-accent`.
- Implementasi:
  - **Shared:** setting `onboarding.done` dan `general.discord {enabled, hideTitle}`, `MangaInfo.coverColor`, `AppInfo.discord`, IPC `app.whatsNew`/`app.whatsNewSeen`.
  - **Main:** `runMigrations` melaporkan `fresh`; inisialisasi onboarding/What's new di `index.ts` (env test `MATANE_E2E_NO_ONBOARDING`); `images/cover-color.ts` (`dominantColor`, `CoverColors`) + backfill library 5 detik setelah start; `coverColorOf`/`setCoverColor` di `MangaRepository`; `app/discord.ts` (`DISCORD_CLIENT_ID = null`, override `MATANE_DISCORD_CLIENT_ID`) diberi umpan dari heartbeat reader.
  - **Renderer:** `features/palette/` (cmdk + Radix Dialog, Ctrl/⌘+K di shell, tombol title bar), `features/onboarding/OnboardingPage.tsx` + route `/onboarding` + guard di `_app`, `features/whats-new/` (parser changelog + dialog), `lib/cover-tint.ts` + `theme/useColorScheme.ts` untuk header detail, `settings/appearance.tsx` (pemilih tema/aksen/bahasa dipakai bersama), `DiscordSettings.tsx`, tombol "What's new" dan "Run setup again" di About.
  - **Dokumentasi:** ADR 0027, `docs/BRAINSTORM.md` §6.6.
- Beda dari rencana:
  - Versi terakhir yang catatannya sudah dilihat disimpan sebagai key setting biasa `app.whatsNewSeen` (bukan `whatsNew.lastSeen` di AppSettings), dan profil baru/lama dibedakan dari database baru (`fresh`), bukan dari isi library.
  - Warna cover memakai hue paling menonjol (bukan `stats().dominant`), dan disimpan bersama kunci cover-nya sehingga cover baru otomatis diukur ulang.
  - Palette hanya di shell app; di reader, Ctrl+K tidak dipakai (reader punya keymap sendiri).
- Catatan:
  - Discord (diperbarui 1 Okt 2026): Application ID `1555185294750257252` dari kamu sekarang menjadi `DISCORD_CLIENT_ID` (di Discord RPC, "client id" = Application ID; Public Key tidak dipakai). Opsi Discord kini tampil di Settings → General. Untuk gambar besar presence, unggah gambar dengan key `matane` di Rich Presence → Art Assets. Test yang perlu opsi tersembunyi memakai `MATANE_DISCORD_CLIENT_ID=''`. Live check presence belum bisa: Discord tidak berjalan di mesin ini.
  - `CHANGELOG.md` belum diisi untuk Fase 5; catatan 1.0.0 ditulis di 5g (What's new membaca bagian versi itu).
  - Race di `e2e/reader-images.spec.ts` (5a) diperbaiki: tinggi strip diukur dari item pembungkus, bukan halaman yang masih tersembunyi.

### Milestone 5d: selesai (2 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `useVirtualizer`), `format:check`, `typecheck`, dan `pnpm test` hijau: desktop 269 test, shared 31. E2E 110/110.
- Test baru:
  - `stats/service.test.ts` (7): chapter yang selesai di reader dan waktu baca per hari (minggu), per bulan (tahun) dan sejak awal; peringkat genre, manga, dan source; library, sedang dibaca, dan streak; profil kosong dan hapus statistik; streak; dan skala library (1.000 manga, 50.000 chapter, 20.000 sesi → periode Semua + Bulan ±90 ms).
  - `network/settings.test.ts` (4): server DoH preset/kustom (https saja, template dipertahankan), konfigurasi resolver, aturan proxy (kembali ke sistem kalau tidak lengkap), dan validasi host.
  - E2E `statistics.spec.ts` (3): profil baru kosong; chapter yang dibaca di reader terhitung tetapi yang hanya ditandai tidak, 30/7/12 kolom, tooltip, dan tabel; hapus statistik dari Settings → Data tanpa menyentuh progres.
  - E2E `network.spec.ts` (4): User-Agent kustom sampai ke situs lalu reset; proxy HTTP membawa request extension dan "Test connection", lalu "Tanpa proxy" kembali langsung; password proxy dipakai saat proxy meminta login (407 → kredensial) dan tidak pernah kembali ke renderer; DoH preset dan URL kustom wajib https.
- Live check (app hasil build):
  - **DoH Cloudflare (mode Selalu)**: Test connection ke `api.example.org/ping` → HTTP 200, popular Example Source 24 manga.
  - **Proxy HTTP lokal** (dengan CONNECT) + DoH: request HTTPS asli lewat proxy (`api.example.org:443`), Example Source tetap jalan, dan screenshot halaman Network.
  - Kali ini Example Source juga terbuka **tanpa** DoH (DNS sistem), padahal di 5a diblokir; jadi efek DoH membuka blokir DNS belum bisa dibuktikan di jaringan ini.
  - Mesin ini tidak punya keyring (`safeStorage` backend `basic_text`), sehingga halaman Network benar menampilkan peringatan password disimpan tanpa enkripsi.
  - Statistik dengan profil scratch berisi 142 chapter dalam 11 bulan, di Mocha dan Latte, dibandingkan dengan mockup 14.
  - Live check menemukan dan memperbaiki: label sumbu teratas terpotong, persen genre yang dihitung dari jumlah tag (Fantasy 28% padahal ada di semua chapter → sekarang 100%), waktu di bawah satu jam tampil "0 h" (sekarang menit), dan grafik yang menahan lebar lama saat jendela menyempit (halaman jadi bisa digeser ke samping).
- Implementasi:
  - **Shared:** `networkSettingsSchema` (DoH, proxy, User-Agent) di AppSettings; `StatsOverview`, `STATS_RANGES`; IPC `stats.overview`/`stats.clear` dan `network.info`/`network.setProxyPassword`/`network.test`.
  - **Main:** `stats/service.ts`; `network/settings.ts` (DoH, aturan proxy), `network/control.ts` (`NetworkControl`: resolver, `app.setProxy`, default session, semua session extension, User-Agent, password, tes koneksi, event `login`); `NetworkManager.setProxy/setUserAgent` (session baru menunggu proxy-nya); `sessionFetch` menjawab `login` proxy; hook test `__matane.setNetworkTestUrl`, env test `MATANE_E2E_PROXY_LOOPBACK`.
  - **Renderer:** `features/statistics/StatisticsPage.tsx` (kartu, grafik kolom SVG sendiri, tabel, genre, paling banyak dibaca, source), `features/settings/NetworkSettings.tsx`, bagian Statistik di Settings → Data.
  - **Dokumentasi:** ADR 0028, `docs/BRAINSTORM.md` §6.3 dan §6.5.
- Beda dari rencana:
  - Grafik tidak menumpuk batang (chapter) dan garis (jam) dengan dua skala seperti mockup 14: satu ukuran per grafik dengan tombol "Chapter | Jam" (grafik dua sumbu menyesatkan). Ditambah tampilan tabel.
  - Periode mengikuti mockup (Minggu, Bulan, Tahun, Semua), bukan "30 hari / 12 bulan / semua".
  - "Test connection" tidak menampilkan IP hasil resolver (Electron tidak memberikannya); yang ditampilkan status, waktu, dan URL.
  - Password proxy disimpan tanpa enkripsi di sistem tanpa keyring (dengan peringatan), bukan ditolak.
- Catatan:
  - Permintaan app sendiri lewat `net.fetch` (repositori, cek update) memakai proxy tetapi tidak bisa menjawab password proxy; source, gambar, dan jendela Cloudflare bisa.

### Milestone 5e: selesai (2 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `useVirtualizer`), `format:check`, `typecheck`, dan `pnpm test` hijau: desktop 276 test, shared 31. E2E 114/114.
- Test baru:
  - `backup/backup.test.ts` (7):
    - round trip ke profil baru (library, chapter, history, sesi, download, kategori, repositori, setting, data extension tertunda);
    - aturan merge (dibaca/bookmark = keduanya, progres terjauh, kategori gabungan, history terbaru, setting lokal per manga menang, restore dua kali tidak menambah apa pun);
    - replace (backup pengaman dulu, isinya bisa dipulihkan);
    - file bukan zip / tanpa backup.json / JSON rusak / format lebih baru / skema salah ditolak tanpa menyentuh DB;
    - auto-backup harian dan rotasi 7 (backup pengaman tidak ikut dihapus);
    - prefs extension tertunda diterapkan setelah terpasang tanpa menimpa;
    - skala: 1.000 manga / 50.000 chapter.
  - E2E `backup.spec.ts` (4): profil A (kategori, progres, bookmark, download, tema) → "Back up now"; profil B menolak file rusak; merge memulihkan semuanya + setting, lalu extension yang hilang dipasang dari repo yang ikut di backup dan source-nya jalan lagi; replace meminta konfirmasi dan membuat backup pengaman.
- Pengukuran (mesin senggang): backup 1.000 manga / 50.000 chapter 307 ms, restore 914 ms, langkah terpanjang 272 ms (parse `backup.json`), langkah berikutnya ±30 ms. Batas di test dilonggarkan (jumlah langkah ≥ 20, langkah < 3 detik) karena `pnpm test` paralel membuat angka waktu tidak stabil.
- Live check (app hasil build):
  - Profil statistik (2 manga asli Example Source B/Example Source C, 142 chapter dibaca, 1 download) → "Back up now" 172 ms, 9 KB.
  - Dipulihkan ke profil baru dengan merge dalam 89 ms: library identik (120/120 dan 22/22 dibaca, download tersambung lagi), statistik sama (142 chapter, 38 jam).
  - Auto-backup tertulis ±1 menit setelah app dibuka (`matane-backup-2026-10-02-0245.zip`).
  - Screenshot bagian Backup dan dialog pemulihan.
- Implementasi:
  - **Shared:** `backup.ts` (`backupSchema` format 1, preview, hasil, daftar file, progres), setting `backup {auto, folder}`, IPC `backup.create/list/pick/preview/restore/chooseFolder/openFolder`, event `backup.progress`.
  - **Main:** `backup/export.ts` (kumpulkan + tulis zip atomik), `backup/restore.ts` (buka dan validasi, preview, restore bertahap dengan aturan merge/replace), `backup/service.ts` (`BackupService`: manual, otomatis + rotasi, backup pengaman, data extension tertunda); `extensions.install` menerapkan data tertunda; callback perubahan setting di `index.ts` dipakai bersama oleh restore.
  - **Renderer:** `features/settings/BackupSettings.tsx` (Backup sekarang, Pulihkan, auto-backup, folder, daftar backup, dialog pemulihan dengan preview, mode, progres, ringkasan, dan pasang extension yang hilang), aksi palette "Back up now".
  - **Dokumentasi:** ADR 0029, `docs/BRAINSTORM.md` §6.7.
- Beda dari rencana:
  - Restore berjalan di main secara bertahap (transaksi per 50 manga), bukan di worker thread: dengan better-sqlite3 sinkron di main, penulis kedua akan mengunci database dan justru membekukan main.
  - Nama file memakai jam (`matane-backup-YYYY-MM-DD-HHmm.zip`) supaya backup manual dan otomatis di hari yang sama tidak bertabrakan; rotasi mengurutkan nama, bukan waktu file.
  - Cover kustom di-backup; cover permanen dan cache tidak (diambil lagi dari source).
- Catatan:
  - Auto-backup default harian juga berjalan untuk profil baru (file kecil).
  - Saat replace, file cover kustom milik manga lama tetap tertinggal di folder `covers/custom` (tidak lagi dirujuk).

### Milestone 5f: selesai (2 Okt 2026), menunggu review

- `pnpm lint` 0 error (7 warning lama `useVirtualizer`), `typecheck` dan `pnpm test` hijau: desktop 281 test, shared 31. E2E 117/117. `actionlint` (1.7.12, binary resmi di folder scratch) lolos untuk keempat workflow.
- `format:check` hanya menandai 13 file di `extensions/example-d`, `extensions/example-c`, dan `extensions/example-b` (dari commit extension kamu, bukan bagian 5f). Sesuai aturan repo, file itu tidak aku format.
- Test baru:
  - `app/packaging.test.ts` (4): deteksi jenis paket per OS/variabel, `MATANE_PACKAGE` menang, jenis updater per paket, dan isi info debug (versi, paket, extension, 100 baris log terakhir; home, nama user, query URL, Bearer/token/password disamarkan).
  - `app/updater.test.ts` (+1): Flatpak memberi tahu "update lewat package manager", tar.gz tetap "Lihat Setting → Tentang".
  - E2E `diagnostics.spec.ts` (3): level log berlaku langsung dan setelah restart; "Copy debug info" berisi versi, extension, dan akhir log tanpa token/home; Tentang menampilkan jenis instalasi dan dialog lisensi (filter `react-dom`).
- **Paket** (dibangun lokal dari `0.1.0-beta.1`):
  - deb (`Matane-0.1.0-beta.1-linux-amd64.deb`, 121 MB): `/opt/Matane` + `/usr/share/applications/matane.desktop` (lolos `desktop-file-validate`), dependensi default electron-builder + `Recommends: libappindicator3-1`.
  - tar.gz (145 MB): dijalankan dari folder scratch dengan profil terpisah. Terdeteksi `archive`; dengan `MATANE_PACKAGE=aur` terdeteksi `aur`. Lisensi 173 paket, info debug benar, folder Crashpad terbentuk.
  - rpm tidak bisa dibangun di sini (tidak ada `rpmbuild`), jadi hanya di CI (`release.yml` memasang `rpm`). Portable juga hanya di CI Windows. Podman/docker tidak ada, jadi deb belum dipasang di container.
  - **AUR:** `packaging/aur/PKGBUILD` (`matane-bin`, repack tar.gz ke `/opt/matane`, wrapper `/usr/bin/matane` dengan `MATANE_PACKAGE=aur`). `makepkg -f` lolos dengan tarball lokal; isi paket benar (`chrome-sandbox` 4755, wrapper, desktop, ikon). `.SRCINFO` dari `update-aur.mjs` identik dengan `makepkg --printsrcinfo`.
  - **Flatpak:** `packaging/flatpak/dev.sukun.matane.yml` (Freedesktop/Electron2 BaseApp 25.08, zypak), plus metainfo (lolos `appstreamcli validate --pedantic`) dan desktop (lolos validasi). `update-flatpak.mjs` diuji pada salinan (URL, sha256 tarball dan ikon, entri `<release>`). `flatpak-builder` tidak ada, jadi belum dibangun.
- **Situs dokumentasi** `apps/docs` (VitePress 1.6.4):
  - 8 halaman panduan dan 2 halaman extension, `vitepress build` lolos termasuk cek dead link;
  - `vitepress preview` dicek: semua halaman 200, screenshot desktop dan mobile, warna brand merah Catppuccin;
  - `docs.yml` membangun di PR dan deploy ke Pages dari `main`.
- **Benchmark** (`pnpm bench`, mesin ini, layar 60 Hz, profil seed 1.000 manga × 20 chapter, server lokal):

  | Ukuran | Hasil | Target |
  | --- | --- | --- |
  | Startup (launch → cover library pertama tampil, median 5×) | **1,57 s** (proses main 1,46 s) | < 2 s ✅ |
  | Scroll library 1.000 manga, ±1.200 px/s | **55 fps**, p95 33 ms, 0 frame > 50 ms | lancar ✅ |
  | Scroll cepat ±3.600 px/s (seret scrollbar) | 50 fps, p95 33 ms, 2 frame > 50 ms | — |
  | Webtoon 200 halaman (800×1400): working set renderer | 185 → 220 MB (naik ±0,18 MB/halaman), JS heap 14 MB datar | stabil ⚠️ |

  - Memori webtoon diselidiki dengan memory dump Chromium (memory-infra). Yang tumbuh adalah `cc/image_memory`, yaitu cache decode gambar compositor. ±99% berstatus *unlocked* (locked 3 MB), sehingga bisa dibuang Chromium saat memori menekan. DOM, JS heap, dan preload (maks. 40) tetap terbatas, jadi tidak ada kebocoran di kode app.
  - Uji 600 halaman: working set mencapai ±620 MB dan belum turun setelah reader ditutup. Batas cache discardable Chromium bergantung pada RAM, dan Linux jarang mengirim sinyal memory pressure, jadi di mesin RAM besar cache ini tumbuh lama.
  - Pertimbangan untuk 5g atau setelahnya: perkecil decode (`<img>` selebar kolom). Belum diubah di 5f karena masih dalam batas wajar untuk chapter normal.
- Implementasi:
  - **Shared:** `PACKAGE_KINDS`/`PACKAGE_MANAGED`, `appLicenseSchema`, `updaterStatus.packaging`, `AppInfo.packaging`, setting `advanced.logLevel`, IPC `app.copyDebugInfo`, `app.licenses`, dan `app.openPath('crashes')`.
  - **Main:**
    - `app/packaging.ts` (deteksi + jenis updater, menggantikan logika inline di `index.ts`);
    - `app/debug-info.ts` (`scrub`, `debugInfo`, `logTail`, `readLicenses`);
    - `app/log.ts` `setLogLevel` (saat start dan saat setting berubah);
    - `crashReporter.start({ uploadToServer: false })`;
    - `AppUpdater` menerima `packaging`, dengan pesan notifikasi untuk paket package manager;
    - hook E2E `__matane.logLevel`.
  - **Build:** `build-tools/licenses.ts` (plugin Vite renderer: modul yang benar-benar di-bundle + dependensi produksi main) → `out/licenses.json`.
  - **Renderer:**
    - Setting → Lanjutan: kartu Diagnostik (level log, buka log/laporan crash, Copy debug info).
    - Setting → Tentang: "Terpasang sebagai …", pesan updater package manager, tautan dokumentasi/kode sumber/lapor masalah, dan dialog lisensi (`LicensesDialog.tsx`, dengan filter).
    - `lib/links.ts`.
  - **Rilis:** target `electron-builder.yml` (Windows `portable`, Linux AppImage/deb/rpm/tar.gz x64, `Keywords` desktop, maintainer/vendor); `release.yml` memasang `rpm` di runner Linux.
  - **Komunitas:** `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `.github/ISSUE_TEMPLATE/` (bug dengan info debug, fitur, `config.yml`: permintaan source → repo repo extension, dokumentasi, keamanan), `PULL_REQUEST_TEMPLATE.md`, dan tautan dari `CONTRIBUTING.md`.
  - **Dokumentasi:**
    - panduan extension pindah ke `apps/docs/extensions/` (dipecah: menulis extension dan menerbitkan repo); `docs/extensions.md` sekarang berisi tautan;
    - link di README, CONTRIBUTING, README/`homepage` paket SDK/runtime/CLI, dan template repo extension diarahkan ke situs;
    - ADR 0021 diperbarui, `docs/BRAINSTORM.md` §10 dan §12, dan `packaging/README.md` (langkah submit AUR/Flathub).
  - **Benchmark:** `apps/desktop/scripts/bench/run.mts` (`pnpm bench`, opsi `--only`, `--runs`, `--pages`, `--json`), dengan server dan extension sendiri sehingga E2E tidak terpengaruh.
- Beda dari rencana:
  - AUR me-repack **tar.gz**, bukan `.deb` (lebih sederhana dan tanpa `/opt/Matane` bawaan deb). deb/rpm/tar.gz dianggap "system"/"archive", bukan AUR, kecuali launcher memberi `MATANE_PACKAGE`.
  - deb/rpm hanya memberi tahu update. electron-updater sebenarnya bisa memasang deb/rpm lewat pkexec, tetapi file itu sebaiknya tetap dimiliki package manager.
  - Frame time scroll diukur dengan `requestAnimationFrame` di renderer, bukan Playwright tracing (angka lebih langsung, tanpa overhead trace).
- Catatan untuk kamu:
  - `maintainer` deb/rpm, `# Maintainer:` PKGBUILD, dan kontak penegakan di `CODE_OF_CONDUCT.md` memakai email `sukundev32@gmail.com`. Ganti kalau kamu ingin alamat lain yang publik.
  - Flathub memverifikasi app id `dev.sukun.matane` lewat domain `sukun.dev`. Kalau domain itu bukan milikmu, pakai `io.github.SukunDev.Matane` (lihat `packaging/README.md`).
  - Nyalakan GitHub Pages (Source: GitHub Actions) supaya `docs.yml` bisa deploy.
  - `PKGBUILD`/`.SRCINFO` saat ini berisi hash dari tarball lokal. Jalankan `node packaging/update-aur.mjs <versi>` setelah rilis sungguhan, sebelum submit. Manifest Flatpak masih berisi hash nol sampai `update-flatpak.mjs` dijalankan.
  - `CHANGELOG.md` belum memuat fitur Fase 5; ditulis di 5g bersama catatan 1.0.0.

### Keputusan rilis (2 Okt 2026)

- Rilis hanya di GitHub dulu (Releases, Pages, Actions). AUR, Flathub, dan pengumuman ditunda sampai app lengkap; SDK diterbitkan ke npm (keputusan menyusul di hari yang sama).
- Berikutnya: Milestone 4f, yaitu memisahkan repo extension, mengikuti panduan repo extension (dihapus). SDK dari npm (`@matane/*`, tag `sdk-v0.1.0`).
