# Checklist Bersih-bersih Project Stitch

Project: **"Manga Reader Desktop"** (`projects/17943198718103042488`)

API Stitch tidak punya fitur hapus, ganti nama, atau pindah layar, jadi langkah ini dikerjakan manual di UI Stitch.
**Cara cepat mengenali**: layar yang **disimpan** memakai palet Catppuccin (latar biru-keunguan `#1e1e2e`, aksen ungu pastel/Mauve). Layar yang **dihapus** memakai palet lama (latar hampir hitam, aksen violet tua `#7C6CF2`).

## ✅ Simpan (16 layar final), susun berurutan seperti ini

Saran tata letak di kanvas: baris 1 = 01–05 (alur membaca), baris 2 = 06–09b (browse & manajemen), baris 3 = 10–15 (history, setting, & fitur pendukung).

| Urutan | Judul di Stitch | Screen ID |
|---|---|---|
| 01 | Manga Library - Desktop Refined *(versi Catppuccin)* | `65d127ec4cf2472d9947f9d5f9f82124` |
| 02 | Blade of the Ashen Sky - Manga Detail Refined *(versi Catppuccin)* | `7bda56fe863047c4b006e7a1dc1ca696` |
| 03 | Blade of the Ashen Sky - Manga Reader RTL **(Catppuccin Mocha)** | `958bab3a923545f4867859d34ceffc34` |
| 04 | Spirit Garden Academy - Webtoon Reader **(Catppuccin Mocha)** | `c0acb2b3f16640d2b8abe3099461a9aa` |
| 05 | MangaReader - Browse Example Source (EN) *(versi Catppuccin)* | `e29e2fc707324ccfaf75aeb5f1b89e23` |
| 06 | MangaReader - Global Search Refined *(versi Catppuccin)* | `a01f2d12eb3445fa895e6acb97f90043` |
| 07 | MangaReader - Updates *(versi Catppuccin)* | `e9534da175324f1da99ef6ed9fa1db64` |
| 08 | MangaReader - Downloads *(versi Catppuccin)* | `174d8b2703b9410f8b4e2fa4eaa03a1c` |
| 09 | MangaReader - Extensions *(versi Catppuccin, dengan panel Repositories)* | `3fd544a3bafe455685192cdb104bd918` |
| 09b | MangaReader - Browse / Extensions **(Catppuccin Mocha)** *(dialog install)* | `8c683fce484e44989be628fe2549a2c3` |
| 10 | MangaReader - History (Catppuccin Mocha) *(versi lebar penuh)* | `67343d6cc9144115bda97516c04eb4a3` |
| 11 | MangaReader - Settings / Reader (Catppuccin Mocha) *(tap zone berlabel Prev/Next)* | `f20dfba86636482a9e237aa002e2c015` |
| 12 | MangaReader - Command Palette (Catppuccin Mocha) | `f9053a559e7d4bc397a203cb760e6322` |
| 13 | MangaReader - Setup / Content Languages (Catppuccin Mocha) | `737d6b3a1c9e4b668ee82b94de28ccf4` |
| 14 | MangaReader - Statistics (Catppuccin Mocha) | `5b4f25c146ca49a383736b8ff55a77d5` |
| 15 | MangaReader - Source Migration (Catppuccin Mocha) | `b0807a88256140bf84c97f132e70c3f9` |

Saran: ganti nama layar di Stitch sesuai kolom "Urutan" (mis. `01 Library`, `02 Detail`, …) supaya gampang dicari.

## 🗑️ Hapus (22 layar lama/duplikat)

| Judul di Stitch | Screen ID | Alasan |
|---|---|---|
| Manga Library - Desktop | `72a4915cabc3449caa37b09a7eb335ec` | Versi pertama (logo JUMP, nama situs asli) |
| Manga Library - Desktop Refined *(violet, cover lama dengan logo JUMP)* | `341bd2c4a53f4ba8b6dd2070cf989f65` | Kandidat A yang tidak dipilih |
| Manga Library - Desktop Refined *(violet, ada "Local Daemon active")* | `f69a01c0686d49a09b6227c2a04735b8` | Kandidat B yang tidak dipilih |
| Manga Library - Desktop Refined *(violet)* | `5a181d5e9f6c43c1af03dcaf450b9c8d` | Diganti versi Catppuccin |
| Blade of the Ashen Sky - Manga Detail | `0d33e451b44b45adbce0f17f551ee58e` | Versi pertama (logo JUMP, rating) |
| Blade of the Ashen Sky - Manga Detail | `b914a2a5a4f444168395293f4cfb523f` | Duplikat dari request yang timeout |
| Blade of the Ashen Sky - Manga Detail Refined *(violet)* | `18c5bea2dac641e39b8691f937e105df` | Diganti versi Catppuccin |
| Blade of the Ashen Sky - Manga Reader Fullscreen | `ad04e5ae038d49febfb5c98593bc0a2f` | Versi pertama (halaman terpotong) |
| Blade of the Ashen Sky - Manga Reader RTL Refined *(violet)* | `7b291a20cd2a42ef9dd8beb7f8e1ac95` | Diganti versi Catppuccin |
| Blade of the Ashen Sky - Manga Reader RTL Refined *(campuran)* | `6fe30ca7a1024b34b5e6b172eaf90046` | Hasil apply-theme yang masih violet |
| Spirit Garden Academy - Webtoon Reader Continuous Mode *(violet)* | `fd6d80df79bb41a7bf26939d3a399593` | Diganti versi Catppuccin |
| Spirit Garden Academy - Webtoon Reader Continuous Mode *(campuran)* | `d0c4624a92534606b1d94483f1d29eed` | Hasil apply-theme yang masih violet |
| MangaReader - Browse Example Source (EN) *(violet)* | `576f73d8f9ca47a6878015897afaf518` | Diganti versi Catppuccin |
| MangaReader - Global Search | `9a8a90fb43d3427b9de3e3d7be458fad` | Versi pertama (ada rating) |
| MangaReader - Global Search Refined *(violet)* | `f7576ea4daa940dfaad9988de845aebd` | Diganti versi Catppuccin |
| MangaReader - Updates *(violet)* | `dcdb26e5daa84cf386dd51f3ede83c95` | Diganti versi Catppuccin |
| MangaReader - Downloads *(violet)* | `66c29c2e7b644296b5e95232666672f9` | Diganti versi Catppuccin |
| MangaReader - Browse / Extensions *(violet, dialog)* | `a007580f5388456493af8ef1fb76a7fa` | Diganti versi Catppuccin |
| MangaReader - Browse / Extensions *(campuran, dialog)* | `8a446d236b134aa6b823501aa51de742` | Hasil apply-theme yang masih violet |
| MangaReader - Extensions *(violet, daftar)* | `d238f623cbd044ddbf8ea65b0a9f3fad` | Diganti versi Catppuccin |
| MangaReader - History (Catppuccin Mocha) *(versi kolom sempit)* | `bde7809f4e1a4dc69cc8599717214a91` | Duplikat. Dipilih versi lebar penuh |
| MangaReader - Settings / Reader (Catppuccin Mocha) *(tap zone tanpa label)* | `3e365822ba4a4a07b58eb2ae9d1ecd1e` | Duplikat. Dipilih versi dengan label |

## ⚠️ Aset gambar (5), sebaiknya **disimpan**

Ini gambar hasil generate (cover dan halaman manga fiktif) yang dipakai di dalam layar. Karena tidak jelas apakah layar tetap menampilkan gambarnya kalau aset ini dihapus, pindahkan saja ke pojok kanvas.

| Judul (awal prompt) | Screen ID |
|---|---|
| High-end Japanese manga book cover… "Blade of the Ashen Sky"… | `f28e612c803848debd472523df1f85cd` |
| Manga volume cover art… "Blade of the Ashen Sky"… | `878b1b7975144196a19d13f9ee1e3410` |
| High contrast fictional black and white manga page… | `efdc2d4197ca49ea8c63da1b1e9b2a5f` |
| High quality vertical scroll… "Spirit Garden Academy"… | `3895e04e7b294f309b375870a1235c9f` |
| Vertical scroll… "Spirit Garden Academy" Chapter 14… | `125baef40c2d489688aa1af6a38e753c` |

## Design system

- **Simpan**: "Catppuccin Mocha · Mauve" (`assets/2269793196279229207`).
- **Hapus**: "Manga Reader Dark" (`assets/11234992256524705421`, violet lama).
