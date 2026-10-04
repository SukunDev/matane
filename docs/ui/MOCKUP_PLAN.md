# Rencana Mockup UI (Stitch)

Sumber keputusan: `docs/BRAINSTORM.md` §6.1–§6.7. Mockup dibuat di Google Stitch, lalu hasilnya (link/screenshot) dicatat di bagian bawah file ini.

## Design brief (dipakai untuk semua layar)

- **Platform**: aplikasi desktop (Electron), jendela 1440×900. Bukan web, bukan mobile.
- **Gaya**: modern, bersih, padat informasi tapi tidak ramai. Mirip gabungan Mihon (Android) dan aplikasi desktop modern (Linear, Arc).
- **Tema utama mockup**: **gelap** (dark). Varian terang dan AMOLED dibuat untuk 1–2 layar saja.
- **Warna aksen**: satu warna aksen (default: biru/violet). Komponen mengikuti gaya shadcn/ui (Radix): radius sedang, border halus, tipografi Inter.
- **Title bar kustom** (frameless) setinggi ±40 px: back/forward, kolom "Cari… Ctrl+K" di tengah, indikator incognito/offline/aktivitas, tombol jendela (min/max/close) di kanan.
- **Sidebar kiri** yang bisa diciutkan: Library, Updates, History, Browse (Sources, Extensions, Global search), Downloads (badge angka), Statistik (menu Bookmark dihapus di Fase 2c, bookmark cukup per chapter seperti Mihon); Settings di bawah.
- **Bahasa UI di mockup**: Inggris (bahasa default rilis), dengan konten contoh manga fiktif.
- **Konten**: gunakan judul dan cover manga **fiktif**, jangan pakai judul atau karya asli.

## Daftar layar

| # | Layar | Poin penting | Prioritas |
|---|---|---|---|
| 1 | **Library** | Tab kategori, toolbar (search, filter, sort, mode tampilan), grid cover comfortable, badge belum dibaca/didownload/ikon source, satu item dalam mode multi-select | Wajib |
| 2 | **Detail manga** | Header dengan warna dari cover, cover besar, judul, author, status, genre chip, deskripsi, tombol "Continue reading Ch 42", Add to library, Open in browser, Migrate. Daftar chapter dengan filter scanlator, status dibaca, bookmark, ikon download | Wajib |
| 3 | **Reader – single page** | Layar penuh tanpa sidebar, overlay atas (judul, chapter) dan bawah (slider halaman, prev/next chapter, pengaturan cepat), indikator halaman | Wajib |
| 4 | **Reader – webtoon** | Scroll vertikal, lebar maksimum di tengah, pemisah antar chapter "Chapter 13 → Chapter 14", panel pengaturan cepat terbuka (mode, arah, fit, filter warna) | Wajib |
| 5 | **Browse – source** | Tab Popular/Latest/Search, panel filter di kanan (select, checkbox, tristate, sort), grid hasil dengan tanda "In library" | Wajib |
| 6 | **Global search** | Kolom query besar, hasil per source dalam baris horizontal, satu source masih loading, satu source error | Tinggi |
| 7 | **Updates** | Chapter baru dikelompokkan per tanggal, aksi baca/download/tandai dibaca, tombol refresh + progress update check | Tinggi |
| 8 | **Downloads** | Antrean dengan progress per chapter, status (downloading, queued, paused, error + retry), pause/resume all, total ukuran | Tinggi |
| 9 | **Extensions** | Daftar repo (Verified / Unverified), extension terpasang + tersedia, tombol install/update, dialog install (kepercayaan repo, versi, ukuran) | Tinggi |
| 10 | **History** | Dikelompokkan Today/Yesterday/…, tombol resume per entri | Sedang |
| 11 | **Settings – Reader** | Navigasi setting di kiri, form di kanan: default mode, lebar maksimum webtoon, preset tap zone (preview visual), keybinding | Sedang |
| 12 | **Command palette** | Overlay Ctrl+K di atas Library: hasil manga, navigasi, aksi | Sedang |
| 13 | **Onboarding** | Wizard langkah 2/5 (bahasa konten) | Sedang |
| 14 | **Statistik** | Kartu ringkasan + grafik chapter per bulan + genre teratas | Rendah |
| 15 | **Migrasi source** | Daftar manga → kandidat di source tujuan, opsi yang dipindahkan | Rendah |

Urutan kerja: layar 1–5 dulu untuk mengunci gaya visual, lalu 6–9, lalu sisanya. **Status: ke-15 layar selesai (16 file, termasuk 9b).**

## Hasil

**Project Stitch**: "Manga Reader Desktop" (`projects/17943198718103042488`).

**Design system aktif**: **"Catppuccin Mocha · Mauve"** (`assets/2269793196279229207`). Palet resmi [Catppuccin](https://catppuccin.com/) Mocha: base `#1e1e2e`, mantle `#181825`, crust `#11111b`, surface0 `#313244`, text `#cdd6f4`, aksen **Mauve** `#cba6f7` (teks di atas Mauve = crust). Design system lama "Manga Reader Dark" (violet `#7C6CF2`, `assets/11234992256524705421`) sudah tidak dipakai.

- `screens/`: screenshot final (versi Catppuccin), dirender dari HTML dengan Chrome headless.
- `html/`: HTML final tiap layar (referensi implementasi: struktur, class Tailwind, warna).

| # | Layar | File | Screen ID Stitch (final) | Catatan |
|---|---|---|---|---|
| 1 | Library | `01-library` | `65d127ec4cf2472d9947f9d5f9f82124` | Cover diganti versi bersih |
| 2 | Detail manga | `02-detail` | `7bda56fe863047c4b006e7a1dc1ca696` | |
| 3 | Reader – single page (RTL) | `03-reader-single` | `958bab3a923545f4867859d34ceffc34` | Label arah: "Left to right / Right to left" |
| 4 | Reader – webtoon | `04-reader-webtoon` | `c0acb2b3f16640d2b8abe3099461a9aa` | |
| 5 | Browse – source | `05-browse` | `e29e2fc707324ccfaf75aeb5f1b89e23` | Cover diganti versi bersih; "Erudite / Mature" dihapus; "Loading more titles" |
| 6 | Global search | `06-global-search` | `a01f2d12eb3445fa895e6acb97f90043` | Render halaman penuh; cover diganti versi bersih |
| 7 | Updates | `07-updates` | `e9534da175324f1da99ef6ed9fa1db64` | |
| 8 | Downloads | `08-downloads` | `174d8b2703b9410f8b4e2fa4eaa03a1c` | |
| 9 | Extensions – daftar + panel Repositories | `09-extensions` | `3fd544a3bafe455685192cdb104bd918` | Di Stitch masih ada sisa violet hardcoded. Versi lokal sudah diganti Mauve |
| 9b | Extensions – dialog install | `09b-extensions-install-dialog` | `8c683fce484e44989be628fe2549a2c3` | |
| 10 | History | `10-history` | `67343d6cc9144115bda97516c04eb4a3` | |
| 11 | Settings – Reader | `11-settings-reader` | `f20dfba86636482a9e237aa002e2c015` | Render halaman penuh |
| 12 | Command palette | `12-command-palette` | `f9053a559e7d4bc397a203cb760e6322` | |
| 13 | Onboarding (langkah 2/5) | `13-onboarding` | `737d6b3a1c9e4b668ee82b94de28ccf4` | |
| 14 | Statistik | `14-statistics` | `5b4f25c146ca49a383736b8ff55a77d5` | Render lebih tinggi |
| 15 | Migrasi source | `15-migration` | `b0807a88256140bf84c97f132e70c3f9` | |

Semua file lokal (`screens/*.png`, `html/*.html`) berasal dari versi final di atas, **ditambah perbaikan lokal** (lihat "Perbaikan lokal" di bawah). **`docs/ui/` adalah acuan utama**: versi di Stitch belum memuat perbaikan-perbaikan ini.

**Perbaikan lokal** (hanya di `docs/ui/`, tidak di Stitch):
- Badge shortcut di title bar diseragamkan menjadi "Ctrl K" satu baris (bukan ⌘K), dan hint ganda "Ctrl+K" di placeholder dihapus.
- Reader: label arah "Left to right / Right to left" supaya tidak terlipat.
- Browse: opsi "Erudite / Mature" dihapus (NSFW default tersembunyi), teks "Loading more titles".
- Subtitle versi ("Desktop v2.4") di bawah logo sidebar dihapus.
- Settings: "saved to config.json" → "Changes are saved automatically" (setting disimpan di SQLite).
- Statistik: badge "SYNCED" dihapus (v1 belum punya sync).
- Library, Browse, Global search: cover yang berisi potongan UI diganti cover bersih hasil generate Stitch (aset gambar di project). Judul kartu yang berbeda disamakan dengan lettering cover: "Phantom Thread", "Starry Potion Shop", "Warden of the Frozen Peaks", "Wings of the Ashfall", "The Ash Herbalist".
- Warna violet lama yang hardcoded diganti Mauve, dan teks di atas Mauve memakai crust. Daftar layar yang disimpan di Stitch ada di tabel di atas; layar duplikat/lama di project Stitch diabaikan.

**Catatan proses**
- Stitch sering timeout saat generate/edit, tapi hasilnya tetap jadi dan baru muncul di `list_screens` beberapa menit kemudian. Jangan langsung kirim ulang, supaya tidak ada duplikat.
- `edit_screens` membuat **layar baru** (judul berakhiran "Refined"), bukan menimpa layar lama.
- Di project Stitch ada layar duplikat/lama (versi awal Library & Detail). Yang dipakai hanya ID di tabel di atas.
- Screenshot Stitch hanya menampilkan area 1440×1152. Untuk layar yang lebih panjang, HTML-nya diunduh lalu dirender penuh dengan `google-chrome-stable --headless=new --window-size=1440,<tinggi> --screenshot`. Cara ini juga bisa dipakai untuk menyembunyikan dialog/overlay.
- `apply_design_system` langsung mengembalikan layar baru (tanpa timeout), tapi warna yang ditulis hardcoded di HTML (mis. `#7C6CF2`, `text-white` di atas aksen) tidak ikut berubah, jadi perlu dicek dengan `grep`.
- Varian warna `NEUTRAL` membuat aksen jadi abu-abu, jadi design system memakai `overridePrimaryColor`.

**Keputusan visual yang muncul dari mockup** (dibawa ke implementasi)
- Logo dan nama app ada di atas sidebar. Title bar berisi breadcrumb, back/forward, search, indikator status, dan kontrol jendela.
- Halaman detail: header diberi warna dari cover, dan meta berisi status, tipe, source, bahasa.
- Reader: panel "Reader settings" di kanan sebagai drawer. Tap zone menampilkan hint "Next (RTL) / Menu / Previous".
- Webtoon: rail navigasi chapter di sisi kanan, dan pill progress chapter di bawah.
- Browse: panel filter di kanan dengan genre tri-state (include hijau / exclude merah).
