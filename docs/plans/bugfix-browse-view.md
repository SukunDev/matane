# Bug fix: tampilan manga list (Browse) — zoom cover & mode tampilan

Dicatat 2026-10-03, setelah fitur slider + mode tampilan di Browse (`CoverViewControls`, `MangaGrid`, `useBrowseView`) selesai dan dijalankan di app hasil build.

## Hasil test

- `e2e/library.spec.ts` + `e2e/reading.spec.ts` (termasuk browse + infinite scroll): 18/18 lolos. Tidak ada yang menyentuh fitur baru, jadi tidak menangkap bug di bawah.
- `e2e/browse-view.spec.ts` (baru): 8 test fitur + 2 test bug di bawah. Awalnya 2 test bug gagal; sekarang semua lolos (3× berturut-turut).

## Bug

### 1. Slider melompat mundur / langkah hilang saat tombol panah ditahan — DIPERBAIKI
- **Gejala:** tahan ← / → pada slider (key repeat ~30 ms): nilai di input mundur satu langkah, langkah berikutnya mulai dari nilai lama. 10 tekan cepat dari 100 berakhir di ±190, bukan 200. Dengan jeda ≥30 ms semuanya benar.
- **Diukur:** jeda 0 ms → `input` tertinggal 10 dari nilai tersimpan (mis. input 180, tersimpan 190); jeda 30/100/600 ms → sinkron.
- **Dugaan penyebab:** `useUpdateSettings` (`lib/ipc.ts:34`) memasang respons `settings.set` ke cache di `onSuccess`. Respons lama (170) bisa tiba setelah optimistic update yang lebih baru (180) dan menimpanya; `CoverSizeSlider` lalu membaca `value` lama. Setiap `commit` juga membangun patch dari closure `browse` yang bisa basi (`{ ...browse, ...patch }`).
- **Cakupan:** pola yang sama ada di slider Library (`useLibrarySettings`); bukan khusus Browse.
- **Perbaikan:**
  - `lib/ipc.ts`: `useUpdateSettings` punya `mutationKey`; helper baru `receiveSettings` tidak menimpa cache dengan respons/broadcast `settings.changed` selama masih ada penyimpanan yang berjalan (hanya yang terakhir yang mendarat). `routes/__root.tsx` memakainya untuk event `settings.changed`.
  - `useBrowseView` dan `useLibrarySettings` membangun patch dari cache saat dipanggil, bukan dari closure render.
  - `CoverViewControls`: slider memakai state lokal; tombol disimpan sekali setelah jeda 200 ms, drag disimpan saat dilepas.
- **Repro:** test `holding an arrow key on the slider ends on the last step`.

### 2. Header Browse berganti tinggi saat pindah antara grid dan list — DIPERBAIKI
- **Gejala:** pada lebar jendela ±1000 px (jendela di-tile Hyprland), kontrol baru membuat baris tab/search/filter terlalu lebar sehingga `flex-wrap-reverse` memecah header menjadi dua baris (kontrol di atas, tab di bawah; tinggi ±186 px). Di mode list slider hilang dan semuanya muat satu baris (±153 px), jadi header dan isi halaman melompat, dan tombol mode tampilan berpindah dari bawah kursor.
- **Seharusnya:** tinggi header tidak bergantung pada mode; sebelum fitur ini, search + filter muat satu baris dengan tab.
- **Lokasi:** `SourceBrowsePage.tsx` baris tab (`mb-2 ml-auto flex ...`), `CoverViewControls`.
- **Perbaikan:** kontrol dipindah ke baris judul (di samping Refresh) sehingga baris tab/search/filter kembali seperti sebelum fitur ini.
- **Repro:** test `the header keeps its height when switching between grid and list`.

### 3. Kecil: tinggi cover berbeda 1–2 px antar kolom — BUKAN BUG
- Diukur: tinggi tiap kartu sama (256.13 px); selisih 1–2 px di screenshot hanya pembulatan piksel pada lebar kolom pecahan (170.75 px). Tidak diubah.

## Belum dicek
- Badge "In library" di mode compact/list pada item yang benar-benar ada di library.
- Tampilan di window sempit (<900 px) dan di Library setelah refactor (selain e2e yang lolos).
- Global Search dan dialog migrasi (tidak diubah, tapi memakai `MangaCard`/`MangaCardSkeleton` yang kini punya prop `display`).
