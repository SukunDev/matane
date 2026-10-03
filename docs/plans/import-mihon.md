# Plan: Import backup Mihon/Tachiyomi (`.tachibk`)

> Dibuat 4 Okt 2026, atas permintaan pengguna (contoh file: backup Mihon asli, 405 manga dari 5 source).
> Awalnya "setelah v1" di BRAINSTORM §6.7; dikerjakan lebih awal karena diminta langsung.

## Context

Restore sekarang hanya menerima zip Matane (`backup.json`, ADR 0029). File Mihon (`app.mihon_….tachibk`) ditolak dengan "not a zip archive".

Hasil membongkar file contoh:
- **Format**: gzip (`1f 8b`) → protobuf (skema `Backup` milik Mihon). Isinya: `backupManga` (1), `backupCategories` (2), `backupSources` (101, pasangan nama ↔ ID Long), `backupExtensionRepo` (106), plus preferensi yang tidak kita pakai.
- **Manga**: `source` (Long), `url` relatif milik extension Kotlin, judul, author/artist, deskripsi, genre, `status` (0–6), `thumbnailUrl`, `dateAdded` (ms), `favorite`, `categories` (daftar `order` kategori), `chapters`, `history`, `tracking`.
- **Chapter**: `url`, `name`, `scanlator`, `read`, `bookmark`, `lastPageRead` (indeks halaman, mulai dari 0), `dateUpload` (ms), `chapterNumber` (float, -1 = tidak ada), `sourceOrder` (0 = paling atas di daftar source).
- **History**: per chapter (`url`, `lastRead` ms, `readDuration` ms).
- **ID source Mihon** = 8 byte pertama `MD5("<nama huruf kecil>/<lang>/<versionId>")` sebagai Long positif. Sudah dicek pada file contoh: `Doujindesu` (id, v1) dan `Everia.club` (all, v1) cocok persis. Source tanpa nama di `backupSources` hanya bisa dikenali lewat ID.

## Keputusan (4 Okt 2026)

1. **Pemetaan source: otomatis + pilih manual.** Otomatis: (a) hitung ID Mihon dari tiap source terpasang (nama + lang + versionId 1–10) dan bandingkan; (b) cadangan: nama sama persis (tanpa huruf besar/kecil) bila hanya ada satu kandidat. Di dialog tiap source Mihon punya dropdown (Lewati / source terpasang). Yang tetap "Lewati" tidak diimpor dan dilaporkan di ringkasan (nama + jumlah manga).
2. **URL diimpor apa adanya.** Port extension 1:1 biasanya memakai pola URL yang sama. Kalau tidak, chapter baru dari source terpisah dari yang diimpor; ditulis sebagai batasan di dokumentasi. Pencocokan lewat nomor chapter tidak dibuat.
3. **Manga non-favorit diimpor** dengan `inLibrary = false` (jejak riwayat tetap tampil), sama seperti backup Matane.

Keputusan turunan:
- Mode **hanya gabung (merge)** untuk file Mihon: ini impor, bukan pemulihan. Tidak ada "Replace" dan tidak ada opsi pengaturan app. Mekanisme merge yang sama dengan ADR 0029 (read = salah satu, progres = terjauh, riwayat = terbaru, impor dua kali tidak mengubah apa pun).
- **Format dikenali dari isi file** (`PK` = zip Matane, selain itu dianggap Mihon), bukan dari ekstensi.
- **Decoder protobuf kecil sendiri** (varint/length-delimited/fixed), tanpa dependensi baru. Field tidak dikenal dilewati; `repeated` diterima packed maupun tidak.
- Konversi menghasilkan objek `Backup` biasa, lalu dipakai `restoreBackup` yang sudah ada (batch 50 manga, progress, dedup).
- **Status**: 1 ongoing, 2 completed, 4 (publishing finished) completed, 5 cancelled, 6 hiatus, selain itu unknown (termasuk "licensed").
- **Waktu baca chapter** (`readAt`): `lastRead` riwayat chapter itu, kalau tidak ada `lastRead` terbaru manga itu, kalau tidak ada dibiarkan kosong (restore memakai waktu impor).
- **Riwayat** → satu entri history per manga (`lastRead` terbaru yang chapter-nya ada). **`readDuration` > 0** → satu sesi baca (`startedAt = lastRead − durasi`, `activeMs = durasi`) agar statistik waktu baca ikut terisi; kunci dedup (chapter + waktu mulai) deterministik.
- **Tidak diimpor** (dilaporkan di dokumentasi): tracker (app belum punya), repo extension (kunci penanda kita beda), preferensi/ pengaturan app, `viewer`/`chapterFlags`, scanlator yang dikecualikan.

## Rancangan

- `packages/shared/src/backup.ts`: `BackupPreview.mihon` (`null` untuk backup Matane, atau daftar source: `id`, `name`, `manga`, `inLibrary`, `matchedSourceId`); `RestoreResult.unmatched` (`{ name, manga }[]`).
- `packages/shared/src/ipc/contract.ts`: `backup.restore` menerima `sourceMap` (ID Mihon → ID source kita), opsional.
- `apps/desktop/src/main/backup/mihon.ts` (baru): decoder protobuf, `mihonSourceId`, `matchSources`, `convertMihon` (→ `Backup`).
- `apps/desktop/src/main/backup/service.ts`: `preview` dan `restore` mengenali file Mihon, mencocokkan source terpasang, memaksa merge.
- `apps/desktop/src/main/ipc/handlers.ts`: dialog "pilih file" juga menawarkan `.tachibk`.
- Renderer (`BackupSettings.tsx`): tabel pemetaan source di dialog untuk file Mihon, "Replace" dan opsi pengaturan disembunyikan, ringkasan menampilkan source yang dilewati. Teks en + id.
- Docs: ADR 0032, `apps/docs/guide/backup.md`, `CHANGELOG.md`, BRAINSTORM (hapus dari "Setelah v1").

## Pengujian

- Unit (`backup/mihon.test.ts`): file Mihon sintetis (encoder protobuf kecil di test) → decoder, ID source, pencocokan, konversi, restore, impor dua kali tidak mengubah apa pun, sumber yang tidak cocok dilewati.
- Cek manual terhadap file contoh asli lewat skrip sekali pakai (di luar repo): jumlah manga/chapter/riwayat harus cocok dengan hasil `protoc --decode`.
- e2e: tidak dijalankan sekarang (mode perbaikan bug, lihat memori); jalankan `backup.spec.ts` kalau diminta.

## Status

### Selesai (4 Okt 2026), menunggu review

**Dikerjakan**: lihat "Rancangan" di atas; ADR 0032, panduan `apps/docs/guide/backup.md`, CHANGELOG, dan BRAINSTORM sudah diperbarui. Tidak ada commit.

**Pengecekan**: typecheck, lint, format:check, dan unit test (`pnpm test`) lulus; e2e tidak dijalankan.

**File contoh asli** (diuji lewat tes sekali pakai, sudah dihapus; source dipasang palsu): 405 manga, 12.189 chapter, 1.283 riwayat terbaca semua; 5 source dikenali (West Manga lewat nama, Doujindesu dan Everia.club lewat ID Mihon yang dihitung); restore 359 manga / 10.540 chapter dalam ~0,5 detik; impor kedua tidak mengubah apa pun.

**Bug yang ketemu saat uji file asli**: `favorite` tidak ditulis Mihon kalau nilainya bawaan (true), jadi field yang tidak ada = favorit. Tanpa itu semua manga masuk sebagai bukan-library. Sudah diperbaiki dan dites.

**Perubahan di luar rencana**: pesan error untuk file yang bukan backup berubah menjadi "not a Matane or Mihon backup" (tes unit dan `e2e/backup.spec.ts` disesuaikan).

**Tambahan (4 Okt 2026, permintaan pengguna): tombol Install untuk extension yang belum terpasang.** Source Mihon yang tidak cocok dengan source terpasang dicocokkan dengan extension yang ditawarkan repositori (`matchOffers`: ID Mihon dari nama + bahasa extension, lalu nama unik, awalan "Tachiyomi: " diabaikan). Dialog menampilkan tombol "Pasang {nama}" yang membuka dialog install biasa; setelah ada source baru, preview dicocokkan ulang otomatis. Batasan: nama extension di repositori dianggap sama dengan nama source (benar untuk port 1:1); kalau beda, pilih manual setelah memasang. Unit test lulus (295), typecheck, lint, format.

**Belum dicek**: dialog di app yang berjalan (UI baru), dan e2e `backup.spec.ts`.
