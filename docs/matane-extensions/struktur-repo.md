# Struktur dan cara kerja `matane-extensions`

## Tata letak

```
matane-extensions/
├─ package.json            # skrip repo:build / repo:verify, devDependencies @matane/*
├─ pnpm-workspace.yaml     # extensions/*, versi bersama lewat "catalog"
├─ tsconfig.base.json
├─ .node-version
├─ .gitignore              # node_modules, dist, public, .mr-ext
├─ README.md               # untuk pengguna: URL repo, daftar extension, cara melapor
├─ CONTRIBUTING.md         # untuk pembuat extension: aturan dan checklist PR
├─ scripts/
│  └─ check-versions.mjs   # gagal kalau extension berubah tanpa naik versi
├─ .github/workflows/
│  ├─ ci.yml               # PR/push: format, typecheck, test, build repo (tanpa tanda tangan), cek versi
│  ├─ publish.yml          # push ke main: build + tanda tangan + verifikasi → GitHub Pages
│  └─ smoke.yml            # tiap hari: mr-ext test ke situs asli → issue kalau rusak
└─ extensions/
   └─ mangadex/            # dipindah dari repo matane (extensions/mangadex)
      ├─ manifest.json
      ├─ icon.png          # persegi, ≤ 512 KB (baru; MangaDex belum punya)
      ├─ package.json
      ├─ tsconfig.json, tsconfig.test.json
      ├─ src/…
      └─ test/             # test dengan fixture (fixture tidak di-commit, lihat di bawah)
```

Semua file di atas (kecuali isi `extensions/mangadex`) ada di [`templates/`](templates). Kerangka satu extension ada di [`templates/extension/`](templates/extension).

## Aturan setiap extension

Ini juga isi checklist PR di `CONTRIBUTING.md`:

- **`id` tidak pernah berubah** (huruf kecil, angka, tanda minus, tanpa bahasa). Mengganti id sama dengan extension baru, dan library pengguna kehilangan source-nya.
- **Naikkan `version`** di `manifest.json` setiap kali ada perubahan yang dikirim ke pengguna. App hanya menawarkan update kalau versinya naik. Workflow CI menolak perubahan tanpa kenaikan versi (`scripts/check-versions.mjs`).
- **`nsfw: true`** untuk situs dewasa. Extension seperti ini tersembunyi sampai pengguna menyalakan konten NSFW.
- **`rateLimit`** mengikuti aturan situs (MangaDex: 5 request/detik).
- **Format `url` stabil.** Kalau terpaksa berubah, implementasikan `migrateUrl` dan tulis cara migrasinya di PR (lihat "Changing how urls look" di [`docs/extensions.md`](../extensions.md)).
- **`icon.png`** persegi (disarankan 96–256 px), ≤ 512 KB, tanpa logo yang dilarang situsnya.
- **Tidak menembus paywall** dan tidak melanggar aturan situs (lihat "Being a good citizen" di panduan).

## Test dan fixture

- `pnpm test` menjalankan test setiap extension di QuickJS yang sama dengan app, memakai **fixture**: respons HTTP yang direkam sekali (`MR_RECORD=1 pnpm test`) lalu diputar ulang tanpa jaringan.
- Fixture **tidak di-commit** (isinya konten situs pihak ketiga). Tanpa fixture, suite dilewati dengan peringatan, sama seperti di repo matane sekarang. CI tetap memastikan setiap extension **bisa dibangun** dan ter-typecheck, sedangkan kebenaran terhadap situs asli dijaga oleh smoke test harian.
- Pembuat extension merekam fixture di komputernya sendiri saat mengembangkan.

## Versi paket `@matane/*`

- Semua extension memakai versi SDK/CLI/runtime yang sama lewat `catalog:` di `pnpm-workspace.yaml`, jadi cukup satu tempat untuk menaikkannya.
- `apiVersion` di manifest harus ≤ versi API yang didukung app. Extension dengan `apiVersion` lebih tinggi ditolak saat dibangun (`mr-ext`) dan saat dipasang (app).
- Menaikkan versi SDK bisa mengubah hasil bundle (misalnya versi esbuild berbeda). Kalau cek versi di CI mengeluh, naikkan versi patch extension yang terdampak.

## Workflow

### CI (`ci.yml`): setiap push dan PR

1. `pnpm install --frozen-lockfile`, `format:check`, `typecheck`, `test`.
2. `pnpm repo:build:unsigned` membangun semua extension menjadi repo di `public/` tanpa tanda tangan, sama seperti yang akan diterbitkan.
3. `node scripts/check-versions.mjs "$REPO_URL"` membandingkan hasil build dengan `index.json` yang sedang terbit:
   - extension yang zip-nya berubah tetapi versinya sama → **gagal**;
   - versi turun → **gagal**;
   - `REPO_URL` belum diisi atau belum ada yang terbit → dilewati.

Build dibuat reproducible (zip tanpa kompresi dengan timestamp tetap, dan index terurut), jadi "zip berubah" berarti isinya memang berubah.

### Publish (`publish.yml`): push ke `main` (atau manual)

1. Install, test, lalu `pnpm repo:build`, yang membaca kunci dari secret `MR_REPO_KEY` dan **gagal** kalau secret kosong. Tidak pernah ada repo tak bertanda tangan yang terbit.
2. `mr-ext repo verify public --public-key "$MR_REPO_PUBLIC_KEY"` membuktikan tanda tangan cocok dengan kunci yang ditanam di app sebelum apa pun terbit.
3. `public/` diunggah sebagai artifact Pages, lalu di-deploy (`actions/deploy-pages`).

Setiap publish mengganti seluruh isi Pages. Zip versi lama ikut hilang, dan itu aman karena index hanya menyebut versi terbaru. App mengecek ulang ke server setiap sinkron (`cache: no-cache`), jadi cache 10 menit GitHub Pages tidak menahan update.

### Smoke (`smoke.yml`): setiap hari 03:17 UTC (atau manual)

- `mr-ext test` untuk setiap extension terhadap situs aslinya: popular → detail → chapter → halaman → gambar pertama (dan `transformImage` kalau ada).
- Kalau ada yang gagal, workflow membuka issue "Smoke test failing: `<id>`" (atau menambah komentar pada issue yang masih terbuka) beserta 60 baris log terakhir, lalu workflow ditandai gagal.
- Issue ditutup manual setelah perbaikan terbit.
