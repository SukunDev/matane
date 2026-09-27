# Brainstorming: Matane (またね), manga reader (Electron)

> Status: brainstorming lengkap, semua topik sudah dibahas — 23 Sep 2026. Siap mulai Fase 0 (nama project menyusul).
> Arah: aplikasi desktop open source untuk membaca manga dari **sumber online** lewat sistem extension, mirip Mihon/Tachiyomi tapi untuk desktop.

---

## 1. Visi singkat

Manga reader desktop yang:
- Membaca dari banyak sumber online lewat **extension** (plugin) yang bisa dipasang/dilepas.
- Punya **library** sendiri: manga yang diikuti, progress baca, riwayat.
- Bisa **download** chapter untuk dibaca offline dan **cek update** chapter baru.
- Mode baca lengkap: single page, double page, webtoon (scroll vertikal), LTR/RTL.
- Rapi, cepat, dan nyaman dipakai dengan keyboard/mouse.

Target pengguna: pembaca manga di PC/laptop (Windows, Linux, macOS) yang ingin pengalaman seperti Mihon di desktop.

---

## 2. Keputusan awal

| Aspek | Pilihan |
|---|---|
| Sumber manga | Online (sistem extension) |
| Tujuan | Rilis open source |
| Frontend | React + Vite |
| Fitur prioritas | Mode baca, library, progress & riwayat, download & update |
| Nama | **Matane (またね)**, "sampai jumpa lagi" (ditetapkan 24 Sep 2026). Identifier teknis ASCII: `productName` `Matane`, folder data `~/.config/Matane` (data lama `MangaReader` dipindah otomatis sekali). Scope paket internal tetap `@manga-reader/*`. Ketersediaan nama di GitHub/Flathub dicek sebelum rilis |
| Lisensi | **App: GPL-3.0**, **SDK, runtime, dan CLI extension (`extension-sdk`, `extension-runtime`, `extension-cli`): MIT**, supaya pembuat extension bebas memilih lisensi (ADR 0002, 0011) |
| Struktur repo | Monorepo **pnpm workspaces** (Turborepo nanti kalau perlu) |
| Router | **TanStack Router** (hash/memory history), search params typed untuk filter |
| IPC | **Kontrak typed buatan sendiri** di `packages/shared` + validasi zod di main. Ada request/response dan event push (progress download, update chapter) |
| Layar sentuh | **Dukungan dasar di reader** (swipe, pinch zoom, tap zone). UI lain cukup mouse/keyboard |

---

## 3. Catatan penting untuk proyek open source

**Masalah legal & sistem extension**
- Jangan sertakan extension untuk situs bajakan di repo utama. Proyek seperti Tachiyomi pernah kena DMCA. Pola yang aman:
  - Repo **app** hanya berisi engine + extension resmi/legal (mis. **MangaDex**, yang punya API publik).
  - Extension lain ada di **repo terpisah** (atau dibuat komunitas) dan dipasang lewat URL repo extension.
- Tulis disclaimer di README: aplikasi tidak meng-host konten apa pun.

**Aturan MangaDex API** (kandidat extension bawaan)
- Ada batas rate limit (sekitar 5 req/detik per IP, beberapa endpoint lebih ketat) → perlu rate limiter per sumber.
- Wajib atribusi / tidak boleh menghapus kredit scanlator.
- Gambar dari MangaDex@Home: disarankan mengirim laporan (endpoint `report`) untuk berhasil/gagal memuat gambar.
- Sebelum implementasi: cek ulang dokumentasi resmi, karena aturannya bisa berubah.

**Lisensi**: App **GPL-3.0** (seperti Mihon), supaya fork tetap open source. `extension-sdk`, `extension-runtime`, dan CLI `mr-ext` **MIT**, supaya extension pihak ketiga tidak ikut terikat GPL (diperluas di Fase 1, ADR 0011).

---

## 4. Arsitektur

```
┌─────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Renderer (React + Vite)                                         │
│   ├─ UI: Library, Browse, Manga Detail, Reader, Downloads, Settings
│   ├─ State: TanStack Query (data server) + Zustand (state UI)   │
│   └─ Memanggil API lewat preload (contextBridge, typed IPC)     │
│                     │                                            │
│                     ▼ IPC                                        │
│  Main process                                                    │
│   ├─ Extension Host  → utilityProcess + QuickJS sandbox (lihat §5)│
│   ├─ Network layer   → net.fetch + rate limit + Cloudflare (§6.5)│
│   ├─ Image protocol  → `manga://` custom protocol + disk cache   │
│   ├─ Database        → SQLite (better-sqlite3 + Drizzle ORM)     │
│   ├─ Download queue  → unduh chapter ke disk (CBZ / folder)      │
│   └─ Update checker  → cek chapter baru terjadwal                │
└──────────────────────────────────────────────────────────────────┘
```

**Alasan penting:**
- **Semua request jaringan lewat main process**: menghindari CORS, bisa set header `Referer`/`User-Agent` (banyak situs gambar menolak tanpa Referer), dan menerapkan rate limit terpusat.
- **Custom protocol untuk gambar** (`protocol.handle('manga', …)`): renderer cukup memakai `<img src="manga://page/...">`, dan main process yang mengurus fetch, cache, dan header. Gambar yang sudah didownload langsung dilayani dari disk.
- **Keamanan Electron**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, dan CSP ketat di renderer. Extension **tidak** boleh jalan di renderer.

---

## 5. Sistem extension (inti proyek)

### 5.0 Keputusan

| Aspek | Keputusan | Alasan |
|---|---|---|
| Format | **Format sendiri (JS/TS), model data meniru Mihon** | Bebas mendesain sendiri, dan porting extension Mihon (Kotlin) ke TS tetap mudah |
| Runtime | **QuickJS (WASM) sejak awal**, dijalankan di dalam `utilityProcess` | Sandbox sungguhan: extension tidak punya akses Node/fs/jaringan kecuali lewat API host. `utilityProcess` memberi isolasi crash |
| Gaya API | **Imperatif** (fungsi/class TS biasa) | Fleksibel untuk semua jenis situs. Template untuk CMS populer (Madara, MangaThemesia) bisa ditambah nanti |
| Keamanan repo | **Hash sha256 + signing ed25519** | Repo resmi terverifikasi, repo lain ditandai "tidak terverifikasi" |

> Catatan: `utilityProcess` saja **bukan** sandbox, karena itu proses Node penuh. Yang memberi keamanan adalah QuickJS. `utilityProcess` hanya menjaga agar extension yang hang atau crash tidak menjatuhkan UI dan main process.

### 5.1 Alur eksekusi

```
Renderer ──IPC──▶ Main ──MessagePort──▶ Extension Host (utilityProcess)
                   ▲                        ├─ QuickJS runtime: ext "mangadex"
                   │                        ├─ QuickJS runtime: ext "komikxyz"
                   │                        └─ ...
                   │   host call: http / html / storage / prefs
                   └────────────────────────┘
        Main mengerjakan: network layer (rate limit, cookie, Cloudflare),
        penyimpanan storage/prefs, log
        Extension host mengerjakan: QuickJS + parsing HTML (cheerio), ADR 0012
```

- **Satu utilityProcess** untuk semua extension, dan **satu QuickJS runtime per extension** (memorinya terpisah dan bisa di-dispose sendiri-sendiri).
- Runtime di-load secara **lazy**, yaitu saat extension pertama kali dipakai, lalu dibongkar setelah idle beberapa menit.
- Batasan per runtime (**final**, dikonfirmasi benchmark `mr-ext bench` di Fase 1; hasilnya di ADR 0003):
  - **Memori**: 64 MB (`setMemoryLimit`).
  - **CPU**: kode sinkron maksimal 2 detik tanpa jeda. Lebih dari itu dihentikan oleh interrupt handler.
  - **Timeout per panggilan**: 30 detik, termasuk menunggu jaringan. Khusus `getChapters` 60 detik, karena manga dengan ratusan chapter butuh banyak request.
- Kalau utilityProcess crash, main process menjalankannya ulang lalu mengembalikan error ke UI. App tetap jalan.
- Fungsi host bersifat async: di dalam QuickJS mereka mengembalikan Promise yang di-resolve setelah main membalas, dan host memanggil `executePendingJobs()` sampai selesai.
- Jaringan **selalu lewat main**, bukan lewat `net` di utilityProcess, supaya request extension memakai session yang sama dengan BrowserWindow untuk menyelesaikan Cloudflare.
- **Session terpisah per extension** (`session.fromPartition('persist:ext-<id>')`): cookie dan hasil solve Cloudflare milik satu extension tidak bisa dipakai extension lain. Konsekuensinya, dua extension untuk domain yang sama harus solve Cloudflare masing-masing. Harga yang wajar untuk isolasi. Saat uninstall, partition-nya ikut dihapus.

### 5.2 Bentuk bundle extension

Satu extension = satu paket berisi:

```
mangadex-1.2.0/
├─ manifest.json
├─ index.js        # bundle ES2020 tunggal (esbuild), tanpa import apa pun
└─ icon.png
```

`manifest.json`:

```jsonc
{
  "id": "mangadex",               // TANPA bahasa; stabil, tidak boleh berubah selamanya
  "name": "MangaDex",
  "version": "1.2.0",             // semver extension
  "apiVersion": 1,                // versi API host; app menolak yang tidak kompatibel
  "nsfw": false,
  "domains": ["api.mangadex.org", "uploads.mangadex.org", "*.mangadex.network"],
  "rateLimit": { "requests": 5, "perMs": 1000 },
  "sources": [                    // satu extension bisa menyediakan beberapa source
    { "key": "en", "lang": "en" },
    { "key": "id", "lang": "id" },
    { "key": "ja", "lang": "ja" }
  ]
}
```

**Skema identitas:**
- **Extension id**: `mangadex`. Unik di seluruh repo dan tidak pernah berubah.
- **Source id**: `<extensionId>/<key>`, misalnya `mangadex/en`. `key` bebas (default-nya kode bahasa), jadi dua source dengan bahasa yang sama tetap bisa dibedakan (mis. `situsx/en-mirror`). Key juga tidak boleh berubah.
- **Manga** unik berdasarkan `(sourceId, url)`, dan **chapter** unik berdasarkan `(mangaId, url)`.

- **`domains` adalah allowlist**: `http` menolak request ke domain di luar daftar ini. Pengguna melihat daftarnya saat install, mirip izin di aplikasi mobile.
- `index.js` mendaftarkan source lewat `export default defineExtension(...)`. Saat build, SDK mengubahnya menjadi assignment ke global yang dibaca host.

### 5.3 Model data (gaya Mihon)

```ts
// `url` = IDENTITAS STABIL yang dipilih extension (nama field mengikuti Mihon).
// Umumnya berupa path relatif terhadap baseUrl (mis. "/title/abc") supaya library tidak rusak
// kalau situs ganti domain, tapi boleh juga ID mentah (mis. UUID MangaDex).
// Untuk tombol "buka di browser", pakai Source.getWebUrl(), jangan menyusun URL dari field ini.

interface MangaSummary {
  url: string;
  title: string;
  thumbnailUrl?: string;
}

interface MangaDetails extends MangaSummary {
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';
  type?: 'manga' | 'manhwa' | 'manhua' | 'comic';  // dipakai untuk default mode baca
}

interface Chapter {
  url: string;
  name: string;
  number?: number;        // -1 / undefined kalau tidak diketahui; app bisa menebak dari name
  scanlator?: string;
  uploadedAt?: number;    // epoch ms
}

interface Page {
  index: number;
  imageUrl?: string;      // langsung URL gambar, atau…
  url?: string;           // …URL halaman yang perlu di-resolve lewat getImageUrl()
}

interface MangaPage {
  items: MangaSummary[];
  hasNextPage: boolean;
}
```

### 5.4 Interface Source

```ts
interface Source {
  baseUrl: string;

  getPopular(page: number): Promise<MangaPage>;
  getLatest?(page: number): Promise<MangaPage>;          // opsional, tidak semua situs punya
  search(query: string, page: number, filters: FilterState): Promise<MangaPage>;
  getFilters?(): Filter[];

  getMangaDetails(manga: MangaSummary): Promise<MangaDetails>;
  getChapters(manga: MangaSummary): Promise<Chapter[]>;  // urutan: terbaru di atas
  getPages(chapter: Chapter): Promise<Page[]>;
  getImageUrl?(page: Page): Promise<string>;             // untuk situs 2 langkah

  imageHeaders?(): Record<string, string>;               // mis. Referer untuk request gambar
  // Preferensi dideklarasikan sekali per extension: defineExtension({ preferences: () => [...] })
  resolveUrl?(url: string): MangaSummary | null;         // "buka dari URL" / deep link
  getWebUrl?(item: MangaSummary | Chapter): string;       // URL lengkap untuk "buka di browser"
                                                         // default: baseUrl + url

  // Dipanggil host setelah setiap fetch gambar, fire-and-forget (mis. laporan MangaDex@Home).
  // Ditambahkan di Fase 1, termasuk apiVersion 1.
  reportImage?(result: ImageFetchResult): Promise<void> | void; // { url, success, bytes, durationMs, cached }

  // Didesain di apiVersion 1, diimplementasikan di Fase 4 (lihat §5.6)
  transformImage?(page: Page, bytes: Uint8Array): Promise<ImageTransform>;
}
```

**Filter** (UI dibuat otomatis oleh app): `text`, `select`, `checkbox`, `tristate` (include/exclude/ignore), `sort` (field + arah), `group`, `header`/`separator`.

**Preference** (halaman setting extension dibuat otomatis oleh app): `switch`, `select`, `multiselect`, `text`.

### 5.5 API host yang tersedia di dalam sandbox

Hanya global berikut yang tersedia. Tidak ada `require`, `fetch`, `process`, maupun `setTimeout` bawaan (kalau perlu, disediakan host).

```ts
http.request({ url, method?, headers?, body?, responseType?: 'text' | 'json' | 'bytes' })
  → Promise<{ status, headers, body }>
http.get(url, opts?) / http.post(url, body, opts?)     // shortcut

html.load(body: string, opts?: { xml?: boolean }) → Doc // parsing di host (cheerio); xml untuk RSS
Doc/Element: .select(css) → Element[], .selectFirst(css), .text(), .attr(name),
             .html(), .absUrl(attr)

storage.get(key) / storage.set(key, value) / storage.remove(key)   // KV per extension
prefs.get(key)                                          // nilai setting dari pengguna
log.debug/info/warn/error(...)                          // muncul di panel log extension
crypto.md5/sha1/sha256(str), crypto.aesDecrypt(bytes, key, iv, mode)   // aes: untuk transformImage
base64.encode/decode(), utf8.encode/decode()
timers.sleep(ms)
```

- **Selector cukup CSS** (cheerio/css-select mendukung `:has()`, `:not()`, `:contains()`). Tidak ada XPath. `RegExp` dan `JSON` sudah tersedia di QuickJS, jadi tidak perlu helper tambahan.
- **`eval` tetap diizinkan** di dalam sandbox, untuk situs yang menyembunyikan daftar gambar di JS ter-obfuscate (packer `eval(function(p,a,c,k,e,d)…)`). Aman, karena tetap berjalan di QuickJS.
- **Parsing HTML di host**: QuickJS jauh lebih lambat dari V8 (±50× untuk loop ketat, hasil benchmark Fase 1), jadi parsing HTML besar tidak dilakukan di dalam sandbox. Parsing berjalan di **extension host (utilityProcess)**, bukan di main, karena setiap `select`/`text()`/`attr()` adalah panggilan host sinkron (ADR 0012). Hasil `html.load` berupa *handle*. Objek DOM-nya tetap di host dan dihapus otomatis setelah panggilan extension selesai.
- **Network layer** menangani: rate limit per extension, retry dengan backoff, cookie jar, `User-Agent` default, dan deteksi Cloudflare. Kalau halaman challenge terdeteksi, challenge diselesaikan lewat BrowserWindow (tersembunyi dulu, tampil kalau perlu), lalu request diulang. Detailnya di §6.5.
- **Error bertipe** yang bisa dilempar extension atau host: `NetworkError`, `HttpError(status)`, `CloudflareError`, `RateLimitedError`, `NotFoundError`, `ParseError`. UI menampilkan pesan yang sesuai.

### 5.6 Gambar yang diacak/dienkripsi

**Status: didesain di apiVersion 1, diimplementasikan di Fase 4.** Tipenya sudah masuk ke SDK sejak awal supaya tidak perlu naik `apiVersion` nanti.

Ada dua jenis situs seperti ini:
1. **Enkripsi byte** (XOR/AES atas file gambar).
2. **Tile shuffle**: gambar dipotong-potong lalu disusun acak, dan urutan aslinya dihitung dari seed atau parameter tertentu.

Mengolah pixel di dalam QuickJS terlalu lambat (harus decode JPEG di JS murni). Karena itu hook ini **mengembalikan instruksi**, dan pekerjaan beratnya dilakukan host:

```ts
type ImageTransform = {
  bytes?: Uint8Array;      // hasil dekripsi byte (dibantu crypto.aesDecrypt dari host)
  tiles?: {                // instruksi susun ulang, dieksekusi host pakai `sharp`
    width: number;         // ukuran kanvas hasil
    height: number;
    ops: Array<{ sx: number; sy: number; w: number; h: number; dx: number; dy: number }>;
  };
};
```

- Host memanggil `transformImage` hanya kalau extension mendefinisikannya. Gambar lain langsung di-stream tanpa lewat sandbox.
- Hasil transform disimpan di **cache** dan di **download**, jadi saat dibaca offline tidak perlu diproses ulang.
- XOR sederhana boleh dikerjakan langsung di QuickJS atas `Uint8Array`. Untuk file beberapa MB masih cukup cepat.

### 5.7 Contoh extension (imperatif)

```ts
import { defineExtension, type Source } from '@manga-reader/extension-sdk';

const BASE = 'https://example-manga.com';

const source: Source = {
  baseUrl: BASE,

  async getPopular(page) {
    const res = await http.get(`${BASE}/popular?page=${page}`);
    const doc = html.load(res.body);
    return {
      items: doc.select('.manga-card').map((el) => ({
        url: el.selectFirst('a')!.attr('href')!,
        title: el.selectFirst('.title')!.text(),
        thumbnailUrl: el.selectFirst('img')?.absUrl('src'),
      })),
      hasNextPage: doc.selectFirst('a.next') !== null,
    };
  },

  // …search, getMangaDetails, getChapters, getPages
};

export default defineExtension({ sources: [source] });
```

### 5.8 Distribusi & signing

**Struktur repo extension** (bisa di-host di GitHub Pages atau static hosting lain):

```
repo/
├─ index.json
├─ index.json.sig           # tanda tangan ed25519 atas isi index.json
└─ extensions/
   ├─ mangadex-1.2.0.zip
   └─ icons/mangadex.png
```

`index.json`:

```jsonc
{
  "name": "Official Extensions",
  "publicKey": "ed25519:…",       // informatif; kepercayaan ditentukan oleh app, bukan dari sini
  "extensions": [
    {
      "id": "mangadex", "name": "MangaDex", "version": "1.2.0", "apiVersion": 1,
      "lang": "en", "nsfw": false,
      "file": "extensions/mangadex-1.2.0.zip",
      "sha256": "…",
      "icon": "extensions/icons/mangadex.png"
    }
  ]
}
```

**Model kepercayaan:**
- App membawa **public key repo resmi** di dalam kode. Kalau `index.json.sig` valid terhadap key tersebut, repo ditandai **Terverifikasi**.
- Pengguna boleh menambah repo lain. Repo seperti ini ditandai **Tidak terverifikasi**, dan pengguna harus menyetujui peringatan sekali. Pengguna juga bisa menambahkan public key repo tersebut secara manual ("trust this key").
- Setiap bundle yang diunduh **wajib cocok dengan sha256** di index. Karena index sudah ditandatangani, bundle ikut terjamin secara tidak langsung.
- Kalau extension dengan `id` yang sama ada di dua repo, pengguna memilih salah satu, dan app mengingat asal repo-nya. Extension tidak boleh diam-diam diperbarui dari repo lain.
- Private key disimpan sebagai **secret di CI** (GitHub Actions) dan hanya dipakai di langkah publish.

**Lifecycle di app:** browse repo → install (tampilkan izin domain + NSFW) → cek update berkala → update → uninstall (hapus bundle, storage, dan prefs, tapi manga di library tetap ada dan ditandai "source tidak terpasang").

### 5.9 Developer experience (SDK)

- **`@manga-reader/extension-sdk`**: tipe TS, `defineExtension`, deklarasi global (`http`, `html`, …) untuk autocomplete.
- **CLI `mr-ext`**:
  - `mr-ext create`: scaffold extension baru.
  - `mr-ext build`: bundle dengan esbuild ke ES2020 lalu validasi (tidak boleh ada `import` yang tersisa, manifest harus valid).
  - `mr-ext test <id>`: menjalankan extension di **runtime QuickJS yang sama** dengan app, lalu memanggil `getPopular` → `getMangaDetails` → `getChapters` → `getPages` dan mencetak hasilnya. Cocok untuk CI repo extension (smoke test harian untuk mendeteksi situs yang rusak).
  - `mr-ext bench`: mengukur waktu panggilan (sandbox vs jaringan), heap QuickJS, dan kasus terburuk sintetis (Fase 1).
  - `mr-ext repo`: membuat `index.json`, hash, dan tanda tangan.
- **Mode dev di app**: "Load extension dari folder", dengan watch + hot reload, dan panel log extension.
- Runtime QuickJS dijadikan **package tersendiri** (`packages/extension-runtime`) supaya bisa dipakai bersama oleh app dan CLI; CLI di `packages/extension-cli`.
- **Test extension dengan fixture**: `createFixtureHost` merekam respons HTTP sekali (`MR_RECORD=1`) lalu memutarnya ulang tanpa jaringan di CI.
- Panduan lengkap: [`docs/extensions.md`](docs/extensions.md).

### 5.10 Keputusan detail & yang masih terbuka

**Sudah diputuskan:**
- [x] Batas: memori 64 MB, CPU sinkron 2 detik, timeout 30 detik (60 detik untuk `getChapters`). **Dikonfirmasi benchmark Fase 1**: kasus terburuk realistis memakai ±6 % heap dan ±40 % budget CPU (ADR 0003).
- [x] `html` API: CSS selector saja + mode XML. `RegExp`/`JSON` bawaan QuickJS, `eval` diizinkan (§5.5).
- [x] Identitas: extension id tanpa bahasa, source id = `extensionId/key`, field tetap bernama `url` (identitas stabil, tidak harus berupa URL), plus `getWebUrl()` (§5.2, §5.3).
- [x] Gambar diacak/dienkripsi: hook `transformImage` berbasis instruksi, didesain sekarang, implementasi Fase 4 (§5.6).
- [x] Cookie: session partition terpisah per extension (§5.1).
- [x] Extension **bawaan** (`extensions/*`, dibundel di app) + **load dari folder** untuk mode dev, sebelum repo tersedia di Fase 4 (ADR 0013).
- [x] Login per source: **ditunda setelah v1**. Kalau nanti dibuat, arahnya login lewat BrowserWindow di partition milik extension tersebut, jadi password tidak melewati extension.

- [x] Hook opsional `migrateUrl(oldUrl, fromVersion)` di apiVersion 1. Dipanggil host setelah extension diperbarui, untuk memperbarui `url` manga/chapter di DB.
- [x] Helper tanggal relatif ("2 hours ago", "kemarin") ada di **SDK** (JS murni, ikut ter-bundle), bukan di host.
- [x] `http` mendukung `body: { form: {...} }` dan `body: { multipart: {...} }`.

## 6. Fitur

### 6.1 Reader

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Lokasi | **Jendela yang sama** (route `/reader/...`) dengan mode fullscreen/immersive |
| Webtoon antar chapter | **Tersambung**: scroll terus ke chapter berikutnya dengan pemisah kecil, dan progress pindah otomatis |
| Kontrol | **Preset tap zone + remap keyboard** |
| Ekstra | Crop border otomatis, filter warna, auto-scroll webtoon, split gambar tinggi |

**Mode baca**
- **Single page** dan **double page** (keduanya di Fase 1), **vertical continuous** (webtoon), dan **vertical dengan gap**.
- Arah LTR/RTL untuk mode halaman.
- Double page:
  - Halaman lebar (spread, lebar > tinggi) otomatis ditampilkan sendirian.
  - Tombol **"geser 1 halaman"** untuk membetulkan pasangan halaman yang tidak pas karena cover.
- Fit: lebar, tinggi, layar, ukuran asli. Zoom dan pan tersedia.
- Webtoon punya **lebar maksimum** (default ±800 px, bisa diatur), supaya tidak terlalu besar di layar lebar.

**Pengaturan berlapis:** default global → default per jenis (manhwa/manhua → webtoon, manga → RTL) → **override per manga** (disimpan di DB).

**Navigasi**
- Keyboard (bisa di-remap): panah, A/D, spasi, PgUp/PgDn, Home/End, `[` `]` untuk ganti chapter, F untuk fullscreen, Esc untuk keluar.
- Mouse: klik tap zone, scroll wheel, Ctrl+scroll untuk zoom.
- Preset tap zone: **L-shape**, **Kindle**, **kiri-kanan**, **tepi**, **nonaktif**. Klik tengah menampilkan/menyembunyikan overlay.
- Sentuh: swipe untuk ganti halaman, pinch untuk zoom, dan tap zone yang sama dengan mouse.

**Overlay UI**
- Bar atas: judul, chapter, tombol kembali.
- Bar bawah: slider halaman, chapter sebelumnya/berikutnya, pengaturan cepat (mode, arah, fit, filter).
- Keduanya sembunyi otomatis. Indikator halaman kecil selalu tampil (bisa dimatikan).

**Transisi chapter**
- Mode halaman: halaman transisi "Selesai: Ch 12 → Berikutnya: Ch 13".
- Mode webtoon: tersambung langsung, dengan pemisah berisi nama chapter.
- **Peringatan chapter hilang** kalau nomornya melompat (mis. Ch 12 → Ch 15).

**Performa & memori**
- Preload 4–5 halaman ke depan dan beberapa halaman awal chapter berikutnya. Pakai `img.decode()` sebelum ditampilkan supaya tidak berkedip.
- Webtoon memakai virtualisasi (`@tanstack/react-virtual` atau `react-virtuoso`). Halaman di luar jangkauan di-unload dari DOM.
- **Split gambar tinggi**: gambar dengan tinggi di atas batas tertentu (mis. > 3× lebar atau > 5000 px) dipotong menjadi beberapa segmen di main process (`sharp`), lalu di-cache. Hasilnya ringan di-render dan bisa di-preload per segmen.

**Pemrosesan gambar** (di main process pakai `sharp`, hasilnya di-cache)
- **Crop border otomatis**: membuang margin putih/hitam (`sharp.trim()` dengan threshold).
- Split gambar tinggi (lihat di atas).
- `transformImage` dari extension (§5.6) dijalankan lebih dulu sebelum crop/split.

**Filter warna** (CSS filter di renderer, murah dan real-time): brightness, kontras, grayscale, invert, sepia/"hangat" untuk malam hari, warna latar (hitam/putih/abu).

**Auto-scroll webtoon**: kecepatan bisa diatur. Jeda dengan spasi atau klik, dan berhenti otomatis di akhir chapter terakhir yang tersedia.

**Progress**: disimpan setiap ganti halaman (dengan debounce). Untuk webtoon dipakai halaman yang paling banyak terlihat di viewport. Chapter ditandai dibaca kalau halaman terakhir sudah terlihat.

**Error & aksi**
- Error per halaman: tombol retry dan pesan singkat. Halaman lain tetap bisa dibaca.
- Klik kanan di halaman: simpan gambar, salin gambar, jadikan cover manga.

### 6.2 Library, detail manga & browse

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Kategori | Satu manga bisa masuk **beberapa kategori** |
| Global search | **Masuk v1** |
| Migrasi source | **Masuk v1** |
| Chapter duplikat | **Tampil semua + filter & prioritas scanlator** |

**Library**
- Tampilan: grid compact, grid comfortable (judul di bawah cover), cover saja, dan list. Ukuran cover diatur dengan slider.
- Kategori tampil sebagai tab. Kategori **"Default"** untuk manga tanpa kategori. Urutan kategori bisa diatur (drag).
- Sort: judul, terakhir dibaca, update terbaru, tanggal ditambahkan, jumlah belum dibaca, total chapter (naik/turun).
- Filter: belum dibaca, sudah didownload, sedang dibaca, status (ongoing/completed), source.
- Pencarian di library: judul, author, genre.
- Badge cover: jumlah belum dibaca, jumlah didownload, ikon source.
- **Multi-select** (Ctrl/Shift+klik): tandai dibaca/belum, atur kategori, download/hapus download, keluarkan dari library.

**Halaman detail manga**
- Cover, judul, author/artist, status, genre (klik → cari genre itu di source yang sama), deskripsi yang bisa diperluas.
- Aksi: **Tambah ke library** (pilih kategori), **Mulai / Lanjut baca (Ch X)**, **Buka di browser** (`getWebUrl`), **Migrasi**, **Refresh**.
- Daftar chapter:
  - Filter: belum dibaca, didownload, bookmark, scanlator.
  - Sort: urutan source, nomor, atau tanggal.
  - Multi-select: tandai dibaca, download, bookmark.
  - Aksi "tandai semua sebelumnya sudah dibaca".
- **Peringatan duplikat**: kalau judul yang sama sudah ada di library dari source lain, app bertanya sebelum menambah.
- **Cover kustom**: pengguna bisa mengganti cover secara lokal.

**Chapter duplikat (beberapa scanlator)**
- Semua versi ditampilkan, lengkap dengan nama scanlator.
- Per manga, pengguna bisa **menyembunyikan scanlator tertentu** dan mengatur **urutan prioritas scanlator**.
- Saat lanjut ke chapter berikutnya, reader memilih **satu versi per nomor chapter**: versi dari scanlator dengan prioritas tertinggi, atau kalau tidak ada, versi dari scanlator yang sama dengan chapter sebelumnya, atau kalau tidak ada juga, versi terbaru.
- Status dibaca dihitung **per nomor chapter**: membaca satu versi menandai versi lain dengan nomor yang sama sebagai dibaca, supaya jumlah "belum dibaca" tidak menggelembung.

**Browse**
- Daftar source dikelompokkan per bahasa. Ada filter bahasa global, source bisa di-pin, dan ada bagian "terakhir dipakai".
- Setiap source punya tab Popular / Latest / Search, dengan panel filter yang dibuat otomatis dari `getFilters()`. Infinite scroll memakai `hasNextPage`.
- Manga yang sudah ada di library diberi tanda di hasil browse.
- **Buka dari URL**: tempel URL situs → `resolveUrl()` di extension yang cocok → langsung ke halaman detail.

**Global search**
- Satu query dijalankan ke semua source yang dipilih (default: source yang di-pin atau yang punya manga di library).
- Jumlah source yang dicari paralel dibatasi (mis. 5), dan rate limit tiap extension tetap berlaku.
- Hasil muncul **bertahap per source** (baris horizontal per source), jadi source yang lambat atau error tidak menghambat yang lain.
- Dipakai ulang oleh fitur migrasi.

**Migrasi source**
1. Pilih satu atau beberapa manga (dari library atau halaman detail) → pilih source tujuan (urutan prioritas).
2. App mencari judul di source tujuan (memakai global search) dan menampilkan kandidat terbaik untuk setiap manga. Pengguna bisa mengganti kandidat atau mencari manual.
3. Opsi yang dipindahkan: **status dibaca** (dicocokkan per nomor chapter), **kategori**, **pengaturan reader**, **cover kustom**, **download** (opsional: hapus download lama).
4. Manga lama **dihapus dari library** atau **dipertahankan** (pilihan pengguna).
- Karena dicocokkan berdasarkan nomor chapter, chapter tanpa nomor yang jelas tidak bisa dipindahkan status dibacanya. Di akhir, app menampilkan ringkasan hasil migrasi.

### 6.3 Progress, history & tracking

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| History | **Per manga** (satu entri = chapter terakhir yang dibaca) |
| Tracker | **Setelah v1**. Tabel dan antrean disiapkan sejak awal |
| Layanan tracker | AniList, MyAnimeList, MangaUpdates, Kitsu |
| Ekstra | Mode incognito, halaman statistik, sinkronisasi dua arah tracker |

**Progress**
- Per chapter: `last_page`, `total_pages`, `read`, `read_at`. Untuk webtoon ditambah **offset di dalam halaman**, supaya posisi scroll bisa dikembalikan persis.
- **Logika "Lanjut baca":**
  1. Chapter terakhir yang dibuka belum selesai → lanjutkan chapter itu.
  2. Sudah selesai → buka chapter belum dibaca berikutnya menurut nomor, mengikuti prioritas scanlator (§6.2).
  3. Belum pernah membaca → mulai dari chapter pertama.
- Aksi: tandai dibaca/belum, "tandai semua sebelumnya sudah dibaca", reset progress.

**History**
- Halaman History: **satu entri per manga** (chapter terakhir + waktu), dikelompokkan per tanggal (Hari ini, Kemarin, …). Setiap entri punya tombol lanjut baca, hapus entri, dan hapus semua.
- Disimpan di tabel `history` (satu baris per manga). Statistik memakai tabel terpisah `reading_sessions`, jadi menghapus history tidak menghapus statistik (§7).

**Waktu baca**: dicatat per sesi. Waktu dihitung hanya saat jendela aktif dan ada interaksi. Kalau tidak ada interaksi lebih dari ±2 menit, sesi dianggap idle.

**Mode incognito**: toggle global (ikon di title bar). Selama aktif, **tidak ada** history, sesi baca, progress, maupun update tracker yang dicatat. Indikatornya selalu terlihat supaya pengguna tidak lupa.

**Bookmark**
- **Bookmark chapter saja**, seperti Mihon: ikon di bar atas reader dan di tiap baris chapter, filter "Ditandai" di daftar chapter, dan filter "Ditandai" di library (manga yang punya chapter bertanda). Ikut terbawa saat migrasi, selama nomor chapter cocok.
- Tidak ada bookmark halaman, tab "Bookmark" di detail, maupun halaman global "Bookmark" (diputuskan saat review Fase 2c; tabel `page_bookmarks` dihapus di migrasi `0002`).

**Halaman statistik**
- Ringkasan: jumlah manga di library, chapter dibaca, total waktu baca, rata-rata per hari.
- Grafik: chapter dibaca & waktu baca per minggu/bulan, dan genre/source yang paling sering dibaca.
- Tidak menghitung data dari sesi incognito.

**Tracker (setelah v1)**
- Login OAuth lewat **browser sistem** → callback via **deep link** `matane://oauth/<service>` (`app.setAsDefaultProtocolClient`). Token disimpan terenkripsi dengan `safeStorage`.
- Satu manga bisa di-link ke satu entri per tracker. Pencarian entri otomatis memakai judul manga.
- **Lokal → tracker**: saat chapter ditandai dibaca, progress di tracker diperbarui kalau nomornya lebih tinggi. Status, skor, dan tanggal mulai/selesai bisa diedit dari app.
- **Tracker → lokal (dua arah)**: saat refresh, kalau progress di tracker lebih tinggi, chapter lokal sampai nomor itu ikut ditandai dibaca. Bisa dimatikan per tracker.
- **Antrean offline**: pembaruan yang gagal disimpan di tabel `tracker_queue` dan dikirim ulang saat online.
- Catatan: API tiap layanan (terutama MangaUpdates dan Kitsu) perlu dicek ulang saat implementasi.

### 6.4 Download & update

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Format | **CBZ + `ComicInfo.xml`** (default), bisa diganti ke **folder gambar** di setting |
| Background | **Tray opsional** ("tutup ke tray", default mati) + opsi jalan saat login |
| Interval update | **12 jam** (pilihan: mati, 6j, 12j, 24j, 48j, mingguan) + cek saat app dibuka kalau interval sudah lewat |
| Otomatis | Auto-download chapter baru, download ahead, hapus setelah dibaca, batas ukuran total |

**Antrean download**
- Disimpan di DB (tabel `downloads`), jadi tidak hilang saat app ditutup. Saat app dibuka lagi, antrean bisa dilanjutkan otomatis (opsional).
- Dua level paralel: **maks 2 chapter** sekaligus (global) dan **maks 4 halaman** per chapter. Keduanya tetap tunduk pada rate limit extension.
- Retry per halaman 3× dengan backoff eksponensial. Kalau tetap gagal, chapter ditandai **error** dengan tombol "coba lagi", dan halaman yang sudah berhasil tidak diunduh ulang.
- Kontrol: pause/resume semua, susun ulang urutan (drag), batal per item atau semua.
- **Penulisan yang aman**: halaman diunduh ke `<chapter>.tmp/`, `transformImage` diterapkan (§5.6), di-zip jadi CBZ, lalu di-rename atomik. Chapter yang setengah jadi tidak akan terbaca sebagai sudah selesai.
- Ruang disk dicek sebelum mulai. Ukuran download ditampilkan per manga dan total.

**Lokasi & struktur**
- `<folder download>/<Source>/<Judul manga>/<Nama chapter>.cbz` (atau folder), dengan nama file disanitasi untuk semua OS.
- **Path disimpan di DB**, tidak dihitung ulang, jadi file tidak "hilang" kalau judul berubah.
- `ComicInfo.xml` berisi: judul, nomor chapter, scanlator, author, genre, arah baca (`Manga=YesAndRightToLeft`), URL web.
- Membaca CBZ lewat custom protocol dengan akses acak ke isi zip (`yauzl`), tanpa ekstrak.
- Kalau folder download dipindah di setting, app menawarkan untuk ikut memindahkan file yang sudah ada.

**Otomatisasi**
- **Auto-download chapter baru**: setelah update check, chapter baru dari manga di kategori yang dipilih (include/exclude) masuk antrean. Bisa dibatasi hanya untuk manga yang sedang dibaca.
- **Download ahead**: saat membaca, N chapter berikutnya (default 2) otomatis diunduh. Hanya untuk manga di library.
- **Hapus setelah dibaca**: chapter yang selesai dibaca dihapus otomatis. Opsi: tunda sampai N chapter setelahnya selesai dibaca, jangan hapus chapter ber-bookmark, dan kecualikan kategori tertentu.
- **Batas ukuran total**: kalau total download melewati batas (mis. 20 GB), app memberi peringatan dan menghentikan auto-download (download manual tetap boleh setelah konfirmasi).

**Update checker**
- Berjalan di main process, hanya untuk manga di library. Jadwal: interval (default 12 jam) + cek saat app dibuka kalau interval sudah lewat + tombol refresh manual (semua / per kategori / per manga).
- **Aturan lewati** (bisa diatur): status completed, belum pernah dibaca, jumlah belum dibaca > N.
- Jumlah source yang dicek paralel dibatasi (mis. 3), rate limit tetap berlaku. Progress tampil di UI (dan di tray).
- Chapter baru = `url` yang belum ada di DB. Chapter **hilang dari source**: kalau sudah didownload atau punya progress/bookmark, tetap disimpan dan ditandai "tidak ada di source". Kalau tidak, dihapus. Status dibaca tetap terjaga karena dihitung per nomor chapter.
- Metadata (cover, deskripsi, status) diperbarui juga (opsional).
- Setelah update check: jalankan `migrateUrl` kalau versi extension berubah, lalu auto-download, lalu notifikasi.
- **Notifikasi desktop** dikelompokkan ("5 chapter baru dari 3 manga"). Klik notifikasi membuka halaman **Updates**.
- **Halaman Updates**: chapter baru dikelompokkan per tanggal, dengan aksi baca, download, dan tandai dibaca (satuan atau massal).

**Tray & background**
- Setting **"Tutup ke tray"** (default mati). Kalau aktif, menutup jendela hanya menyembunyikannya, jadi update check dan download tetap berjalan.
- Menu tray: buka app, cek update sekarang, pause/resume download, status singkat, keluar.
- Setting **"Jalankan saat login"** (`app.setLoginItemSettings`; di Linux lewat file autostart `.desktop`), dengan opsi mulai tersembunyi di tray.
- Catatan: dukungan tray di Linux bergantung pada desktop environment (mis. GNOME butuh ekstensi AppIndicator). Karena itu tray bersifat opsional, dan app tidak boleh bergantung padanya.

### 6.5 Network, cache & custom protocol

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Opsi jaringan | **DNS-over-HTTPS**, **proxy**, **User-Agent kustom** |
| Cache halaman | **1 GB** default (bisa diubah) |
| Cloudflare | **Tersembunyi dulu**, tampilkan jendela kalau ±10 detik belum selesai |

**Network layer (main process)**
- Semua request lewat **network stack Electron** (`net.request`) dengan session partition milik extension (`persist:ext-<id>`). Keuntungannya: memakai network stack Chromium (HTTP/2, sertifikat sistem, proxy, cookie otomatis). Bukan `net.fetch`, karena `net.fetch` menolak `redirect: 'manual'` sehingga redirect tidak bisa dicek satu per satu (ADR 0012).
- **Rate limit**: token bucket per extension (nilai dari manifest, default 10/detik). Gambar memakai bucket terpisah yang lebih longgar (20/detik).
- Timeout per request 20 detik. Retry dengan backoff hanya untuk error jaringan dan 5xx/429 (hormati header `Retry-After`).
- **User-Agent**: default UA Chrome milik Electron **tanpa token "Electron"**. Urutan prioritas: UA kustom dari extension → UA kustom global (setting) → default.
- Validasi **allowlist domain** extension (§5.2) dilakukan di sini, termasuk untuk setiap redirect.

**Cloudflare**
1. Deteksi: header `cf-mitigated: challenge`, atau status 403/503 dengan halaman "Just a moment".
2. Buka BrowserWindow **tersembunyi** di partition extension, dengan **UA yang sama persis** (cookie `cf_clearance` terikat ke UA).
3. Tunggu sampai cookie `cf_clearance` muncul. Kalau ±10 detik belum selesai, **tampilkan jendelanya** dengan pesan "Selesaikan verifikasi untuk <source>".
4. Setelah berhasil, request diulang. Request lain yang kena challenge pada saat yang sama **menunggu satu penyelesaian yang sama**, tidak membuka jendela sendiri-sendiri.
5. Kalau pengguna menutup jendela atau timeout 2 menit, lempar `CloudflareError` dan UI menampilkan tombol "Coba lagi".

**Opsi jaringan (setting)**
- **DNS-over-HTTPS**: `app.configureHostResolver({ secureDnsMode, secureDnsServers })`. Preset: Cloudflare, Google, Quad9, AdGuard, atau URL kustom. Penting untuk pengguna di Indonesia, karena banyak situs diblokir lewat DNS.
- **Proxy**: ikut sistem, HTTP, atau SOCKS5 (host, port, auth opsional). Diterapkan ke semua session, termasuk partition extension (`session.setProxy`).
- **User-Agent kustom**: override UA global. Ada tombol "reset ke default".

**Custom protocol `manga://`**
- Didaftarkan sebagai scheme privileged (`standard`, `secure`, `stream`) sebelum app `ready`.
- `manga://page/<chapterId>/<index>[/seg/<n>]`. Main process memeriksa berurutan:
  1. Sudah didownload → baca dari CBZ/folder.
  2. Ada di cache → sajikan dari cache.
  3. Kalau tidak → `getPages`/`getImageUrl` → fetch dengan `imageHeaders` → `transformImage` (§5.6) → crop/split (§6.1) → simpan ke cache → stream.
- `manga://cover/<mangaId>`: cover kustom → cover permanen → cache → fetch.
- **Renderer tidak pernah request ke internet**: CSP `img-src manga: data:; connect-src 'self'`. Satu-satunya jalan keluar ke internet adalah lewat main.
- **Dimensi halaman** (lebar, tinggi, jumlah segmen) disimpan di metadata cache dan dikirim ke renderer lewat IPC. Dipakai untuk virtualisasi webtoon tanpa layout shift.
- Beberapa request untuk gambar yang sama pada saat bersamaan (mis. preload + tampil) digabung jadi satu fetch.

**Cache**
- **Halaman**: `userData/cache/images`, key dari source + **URL chapter** + index halaman, bukan URL gambar, karena sebagian source (MangaDex@Home) memberi server gambar baru setiap kali; dengan begitu halaman yang sudah di-cache terbuka tanpa jaringan. Metadata di tabel `image_cache`: content-type, ukuran, (nanti) dimensi dan varian crop/split. **LRU** berdasarkan waktu akses terakhir, batas default **1 GB** (ADR 0014).
- **Cover library**: disimpan **permanen** di `userData/covers` (tidak kena LRU), diperbarui saat metadata di-refresh.
- **Cover browse**: cache biasa (ikut LRU).
- **Daftar halaman chapter** (`getPages`) di-cache di DB ±1 jam. Kalau source tidak bisa dihubungi, salinan lama tetap dipakai. Kalau URL gambar dari daftar cache sudah kedaluwarsa (403/404/410), daftar diambil ulang sekali.
- Setiap fetch gambar diikuti `reportImage` extension (fire-and-forget).
- Setting: ukuran cache, penggunaan saat ini, tombol "hapus cache halaman" dan "hapus cache cover browse".

**Offline**
- Dideteksi lewat `net.isOnline()` dan event jaringan. Indikator offline tampil di UI.
- Selama offline: Browse dan global search dinonaktifkan. Library, History, Downloads, dan chapter yang sudah didownload/ter-cache tetap bisa dibaca. Update check ditunda sampai online.

### 6.6 UI/UX, tema, i18n & settings

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Title bar | **Kustom** (frameless). Di macOS tetap memakai traffic light asli (`titleBarStyle: 'hiddenInset'`) |
| Tema | Palet **Catppuccin**: **Mocha** (gelap, default), **Latte** (terang), Frappé & Macchiato (opsional), plus **AMOLED** (Mocha dengan latar `#000`). Aksen default **Mauve**, dengan 14 aksen Catppuccin sebagai preset. **Warna dari cover** di halaman detail |
| UX tambahan | **Command palette (Ctrl+K)**, **onboarding**, **What's new**, **Discord Rich Presence** |

**Layout**
```
┌──────────────────────────────────────────────────────────────┐
│ ◀ ▶  [ Cari… Ctrl+K ]          ●incognito ●offline   _ □ ✕ │  ← title bar kustom (area drag)
├────────────┬─────────────────────────────────────────────────┤
│ Library    │  Toolbar halaman (tab kategori, filter, sort)   │
│ Updates    │                                                 │
│ History    │                                                 │
│ Browse   ▸ │            Konten halaman                       │
│  Sources   │                                                 │
│  Extensions│                                                 │
│  Global    │                                                 │
│ Downloads 3│                                                 │
│ Statistik  │                                                 │
│            │                                                 │
│ Settings   │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```
- Sidebar bisa diciutkan menjadi ikon saja. Reader memakai layar penuh tanpa sidebar.
- Title bar: tombol back/forward, pemicu command palette, indikator **incognito**, **offline**, dan **aktivitas** (update check/download berjalan), serta tombol jendela (Windows/Linux).
- Ukuran, posisi, dan status maximize jendela diingat.

**Tema**
- Palet: **[Catppuccin](https://catppuccin.com/)** (lisensi MIT), diimplementasikan lewat `@catppuccin/tailwindcss` / CSS variable.
- Mode:
  - **Gelap** = Catppuccin **Mocha** (default): base `#1e1e2e`, mantle `#181825`, crust `#11111b`, surface0–2 `#313244` / `#45475a` / `#585b70`, text `#cdd6f4`, subtext `#a6adc8`.
  - **Terang** = Catppuccin **Latte**: base `#eff1f5`, text `#4c4f69`.
  - **Sistem**: Mocha/Latte mengikuti OS.
  - **Frappé** dan **Macchiato**: pilihan tambahan di setting.
  - **AMOLED**: Mocha dengan base/mantle/crust diganti `#000` (bukan bagian resmi Catppuccin).
- **Warna aksen**: default **Mauve** (`#cba6f7` di Mocha, `#8839ef` di Latte). Preset berisi ke-14 aksen Catppuccin: rosewater, flamingo, pink, mauve, red, maroon, peach, yellow, green, teal, sky, sapphire, blue, lavender. Nilainya otomatis mengikuti flavor aktif.
- **Aturan kontras**: aksen Catppuccin gelap berwarna pastel, jadi tombol berlatar aksen memakai teks **crust** (`#11111b`), bukan putih. Di Latte, teks di atas aksen memakai base.
- Warna semantik memakai palet yang sama: sukses = green, peringatan = yellow/peach, error = red, info = blue/sapphire.
- **Warna dari cover**: halaman detail manga mengambil warna dominan cover (diekstrak di main dengan `sharp`, disimpan di DB) untuk latar header dan tombol utama. Kontras dijaga, yaitu warna diturunkan otomatis kalau terlalu terang.
- Semua warna berupa CSS variable (Tailwind + shadcn/ui), jadi tema cukup mengganti variable.

**Command palette (Ctrl+K)**
- Navigasi ke halaman mana pun, cari manga di library (FTS5), lanjut baca item history teratas, jalankan aksi ("Cek update", "Pause download", "Toggle incognito", "Buka setting reader").
- Mengetik lalu `Tab` atau memilih "Cari di source…" langsung membuka global search.

**Onboarding (pertama kali dibuka)**
1. Bahasa UI dan tema.
2. Bahasa konten (menyaring source dan extension yang ditampilkan).
3. Folder download.
4. Tambah repo resmi dan pasang MangaDex (bisa dilewati).
5. Ringkasan singkat kontrol reader.
- Bisa diulang dari Setting → Tentang.

**What's new**: setelah app di-update, dialog berisi catatan perubahan versi itu muncul sekali. Isinya diambil dari changelog yang ikut di-bundle, jadi tetap bisa tampil saat offline.

**Discord Rich Presence** (default **mati**)
- Menampilkan "Membaca <judul> · Ch X" di Discord.
- Opsi privasi: sembunyikan judul (hanya "Sedang membaca manga"), dan otomatis nonaktif untuk manga NSFW dan saat incognito.
- Memakai IPC lokal Discord. Kalau Discord tidak jalan, fitur ini diam saja tanpa error.

**Konten NSFW**: default disembunyikan. Selama toggle belum diaktifkan, extension dan source yang ditandai `nsfw` tidak tampil di repo, browse, maupun global search.

**i18n**
- **i18next** + `react-i18next`. Semua teks dipisah sejak hari pertama (lint rule untuk string literal di JSX).
- Rilis awal: **English + Indonesia**. Default mengikuti bahasa sistem.
- Format tanggal, angka, dan waktu relatif memakai `Intl`.
- Terjemahan dari komunitas lewat Weblate/Crowdin setelah rilis.

**Struktur setting**
- **Umum**: bahasa, tema, aksen, jalankan saat login, tutup ke tray, Discord RPC, NSFW.
- **Library**: tampilan, kategori, interval & aturan update, auto-download per kategori.
- **Reader**: default mode/arah/fit, lebar maksimum webtoon, preload, keybinding, tap zone, filter, auto-scroll.
- **Download**: folder, format, paralel, download ahead, hapus setelah dibaca, batas ukuran.
- **Browse & Extension**: repo, bahasa konten, update extension.
- **Tracking**: akun tracker (setelah v1).
- **Jaringan**: DoH, proxy, User-Agent.
- **Data & penyimpanan**: backup/restore, cache, hapus statistik/history.
- **Lanjutan**: mode dev extension, log, info debug (salin untuk laporan bug).
- **Tentang**: versi, cek update app, lisensi, ulangi onboarding.

**Aksesibilitas & detail**: fokus keyboard selalu terlihat, `prefers-reduced-motion` dihormati, toast in-app (`sonner`), dan setiap halaman punya empty state dan error state yang jelas.

### 6.7 Backup & restore

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Mode restore | **Merge** (default) + opsi **Replace** |
| Auto-backup | **Harian, simpan 7 file** (pilihan: mati, harian, mingguan) |
| Import Mihon/Tachiyomi | **Setelah v1** |

**Format file**: `matane-backup-YYYY-MM-DD.zip`
```
backup.json        # { formatVersion, appVersion, createdAt, data: {...} }
covers/            # cover kustom (nama file = hash natural key manga)
```
- Semua data dirujuk lewat **natural key** (`sourceId` + `url`), bukan ID internal DB.
- `formatVersion` dinaikkan setiap kali struktur berubah. Restore mendukung semua versi lama (migrasi di sisi pembaca).
- Divalidasi dengan skema **zod** saat dibaca. File rusak ditolak dengan pesan yang jelas.

**Isi backup**
- Manga di library: metadata, kategori, chapter (status dibaca, bookmark, progress), pengaturan reader, prefs scanlator, cover kustom.
- Kategori (beserta urutan dan setting-nya).
- History, sesi baca (statistik).
- Repo extension + daftar extension terpasang (id, versi, repo) + prefs & storage extension.
- Setting app.
- Link tracker (`manga_tracks`) **tanpa token**.
- **Tidak termasuk**: file download, cache, token/rahasia. Kalau folder download sama, chapter yang sudah didownload otomatis terhubung lagi (dicocokkan lewat path yang disimpan).

**Restore**
1. Pilih file → **preview**: jumlah manga, kategori, chapter dibaca, extension/source yang belum terpasang.
2. Pilih mode:
   - **Merge** (default): status dibaca = OR, progress = yang terjauh, kategori = gabungan, history = yang terbaru, setting = tidak ditimpa kecuali dicentang.
   - **Replace**: data lama dihapus. Wajib konfirmasi, dan app **otomatis membuat backup** kondisi sekarang sebelum menghapus.
3. Extension yang dibutuhkan tapi belum terpasang: tawarkan install dari repo yang tercatat di backup (atau repo yang sudah ada).
4. Berjalan di **worker thread** dengan progress bar. Hasil akhir berupa ringkasan (berhasil, dilewati, gagal).

**Auto-backup**
- Default **harian**, menyimpan **7 file terakhir**. Folder bisa diatur (default `userData/backups`).
- Dijalankan saat app idle. Kalau terlewat (app tertutup), dijalankan saat app dibuka berikutnya.
- Tip di UI: arahkan folder ke Dropbox/Syncthing/OneDrive untuk "sinkronisasi sederhana" antar perangkat, lalu restore dengan mode merge di perangkat lain.

**Setelah v1**
- **Import `.tachibk`** (Mihon/Tachiyomi: protobuf + gzip). Butuh tabel pemetaan ID source Mihon (Long) → source id kita. Hanya manga dari source yang punya extension di sini yang bisa diimpor, dan sisanya dilaporkan.
- Sinkronisasi antar perangkat yang sesungguhnya.

### 6.8 Lain-lain (setelah v1)
- Dukungan file lokal (CBZ/folder) sebagai "source" bawaan. Mudah ditambahkan karena memakai interface yang sama.

---

## 7. Model data (SQLite)

**Konvensi**
- File: `userData/data.db`, mode **WAL**, `foreign_keys = ON`.
- Primary key internal berupa `INTEGER`. Identitas lintas perangkat/backup memakai **natural key** (`sources.id` + `url`), jadi tidak butuh UUID.
- Waktu: `INTEGER` epoch ms. Boolean: `INTEGER` 0/1. Data fleksibel: `TEXT` JSON.
- Migrasi skema: **Drizzle migrations** yang ikut di-bundle. Sebelum migrasi, DB **di-backup otomatis** (simpan 3 terakhir).
- `better-sqlite3` bersifat sinkron di main process: semua query wajib ber-index. Operasi berat (backup/restore, migrasi source massal) dijalankan di worker thread.

**Extension & source**
```
extension_repos   (id PK, url UNIQUE, name, public_key, trusted, last_fetched_at)
extensions        (id TEXT PK "mangadex", name, version, api_version, repo_id FK, nsfw,
                   enabled, installed_at, updated_at)
extension_storage (extension_id FK, key, value_json)         PK(extension_id, key)
extension_prefs   (extension_id FK, key, value_json)         PK(extension_id, key)
sources           (id TEXT PK "mangadex/en", extension_id, key, name, lang,
                   pinned, last_used_at)
```
`sources` tidak ikut dihapus saat extension di-uninstall, supaya manga di library tetap punya referensi (ditampilkan sebagai "source tidak terpasang").

**Manga, kategori, chapter**
```
manga             (id PK, source_id, url, title, author, artist, description,
                   genres_json, status, type, thumbnail_url,
                   cover_path, custom_cover_path, cover_color,  -- warna dominan (§6.6)
                   in_library, added_at, favorite_order,
                   last_update_check_at, latest_chapter_at,
                   reader_settings_json,      -- override mode/arah/fit/filter (§6.1)
                   scanlator_prefs_json,      -- {hidden:[], priority:[]} (§6.2)
                   chapter_view_json,         -- sort & filter daftar chapter
                   created_at, updated_at)
                   UNIQUE(source_id, url); INDEX(in_library)

categories        (id PK, name, sort_order, settings_json)  -- sort/tampilan, include auto-download/update
manga_categories  (manga_id FK, category_id FK)              PK(manga_id, category_id)

chapters          (id PK, manga_id FK, url, name, number REAL, scanlator,
                   uploaded_at, source_order, fetched_at,
                   read, read_at, bookmarked,
                   last_page, total_pages, page_offset REAL, -- offset webtoon (§6.3)
                   source_missing)                            -- hilang dari source (§6.4)
                   UNIQUE(manga_id, url); INDEX(manga_id, number); INDEX(fetched_at)

page_list_cache   (chapter_id PK FK, pages_json, fetched_at)  -- cache getPages ±1 jam
```
- Status dibaca **per nomor chapter**: saat satu versi ditandai dibaca, versi lain dengan `number` yang sama di manga yang sama ikut ditandai (dalam satu transaksi).
- Halaman **Updates** = `chapters` dari manga di library, diurutkan `fetched_at DESC` (tanpa tabel khusus).
- Manga yang **bukan** di library (hasil browse) juga disimpan supaya halaman detail cepat. Manga tanpa library, history, download, maupun bookmark yang tidak dibuka lebih dari 30 hari dibersihkan berkala.

**Progress, history, statistik** (bookmark = kolom `chapters.bookmarked`)
```
history           (manga_id PK FK, chapter_id FK, read_at)   -- satu entri per manga (§6.3)
reading_sessions  (id PK, manga_id FK, chapter_id FK, started_at, ended_at, active_ms)
```
- `history` dan `reading_sessions` sengaja dipisah. **Menghapus entri history tidak menghapus statistik.** Tombol "hapus semua data statistik" ada terpisah di setting.
- Mode incognito: tidak menulis ke keempat tabel ini maupun ke progress di `chapters`.

**Download & cache**
```
downloads         (id PK, chapter_id UNIQUE FK, status,   -- queued|downloading|paused|error|done
                   queue_order, pages_done, pages_total, error,
                   format, path, size_bytes, created_at, completed_at)
image_cache       (key PK, kind, path, size_bytes, content_type,  -- kind: page|browse_cover
                   width, height, segments, variants_json, last_access_at)
                   INDEX(last_access_at)
```
- Chapter dianggap "didownload" kalau punya baris `downloads` dengan `status = 'done'`.
- LRU cache: hapus berdasarkan `last_access_at` terlama sampai total `size_bytes` di bawah batas.

**Tracker (setelah v1, tabelnya disiapkan dari awal)**
```
tracker_accounts  (service PK, user_id, username, token_encrypted, expires_at)
manga_tracks      (manga_id FK, service, remote_id, remote_url, status, score,
                   progress, started_at, finished_at, sync_back)
                   PK(manga_id, service)
tracker_queue     (id PK, manga_id, service, payload_json, attempts, next_attempt_at)
```

**Setting**
```
settings          (key PK, value_json)   -- termasuk keybinding, tap zone, jaringan, dll.
```

**Pencarian library**: tabel virtual **FTS5** `manga_fts(title, author, genres)` yang disinkronkan dengan trigger, supaya pencarian cepat meski library besar.

---

## 8. Tech stack

| Bagian | Pilihan |
|---|---|
| Bahasa | TypeScript (`strict`) di semua bagian |
| Scaffolding | **electron-vite** (main + preload + renderer dalam satu konfigurasi Vite) |
| Monorepo | **pnpm workspaces** |
| UI | React, **TanStack Router**, **Tailwind CSS** + **shadcn/ui** (Radix), `cmdk` (command palette), `sonner` (toast) |
| State | TanStack Query (data dari IPC) + Zustand (state reader/UI) |
| Virtualisasi | TanStack Virtual / react-virtuoso (grid library, reader webtoon) |
| i18n | i18next + react-i18next (EN + ID) |
| IPC | Kontrak typed sendiri (`packages/shared`) + **zod** |
| DB | **better-sqlite3** + **Drizzle ORM** (migrasi), FTS5 |
| Sandbox extension | **quickjs-emscripten** di `utilityProcess` |
| HTML parsing (host) | cheerio |
| Gambar | **sharp** (crop, split, tile, warna dominan) |
| Zip / CBZ | `yauzl` (baca, akses acak), `yazl` (tulis) |
| Grafik statistik | dipilih saat implementasi (mis. Recharts) |
| Discord RPC | library RPC Discord (dipilih saat implementasi, cek yang masih aktif dirawat) |
| Logging | electron-log (file + rotasi) |
| Test | Vitest (unit/integrasi), Testing Library (komponen kompleks), Playwright `_electron` (E2E) |
| Lint/format | ESLint (typescript-eslint, react-hooks, aturan i18n) + Prettier |
| Rilis | **electron-builder** + **electron-updater**, **release-please**, GitHub Actions |
| Dokumentasi | VitePress (`docs/`) |

---

## 9. Struktur folder (monorepo pnpm)

```
manga-reader/
├─ apps/
│  └─ desktop/
│     ├─ src/main/
│     │  ├─ db/             # skema Drizzle, migrasi, query
│     │  ├─ network/        # net.fetch, rate limit, allowlist, Cloudflare, DoH/proxy
│     │  ├─ extensions/     # extension host (utilityProcess), repo, signing, install
│     │  ├─ protocol/       # manga:// handler, cache LRU, pemrosesan gambar (sharp)
│     │  ├─ downloads/      # antrean, CBZ/folder, otomatisasi
│     │  ├─ updates/        # update checker, notifikasi
│     │  ├─ library/        # progress, history, migrasi, scanlator
│     │  ├─ backup/         # backup/restore (worker thread)
│     │  ├─ trackers/       # (setelah v1)
│     │  └─ app/            # jendela, tray, deep link, auto-update, Discord RPC
│     ├─ src/preload/       # contextBridge API (dibuat dari kontrak IPC)
│     ├─ src/renderer/      # React app (routes, components, i18n, tema)
│     └─ e2e/               # Playwright + extension tiruan + server fixture
├─ packages/
│  ├─ extension-sdk/        # MIT: tipe, defineExtension, helper, deklarasi global
│  ├─ extension-runtime/    # MIT: QuickJS host (dipakai bersama oleh app dan CLI)
│  ├─ extension-cli/        # MIT: CLI mr-ext (create, build, test, bench) + fixture host
│  └─ shared/               # tipe domain & kontrak IPC
├─ extensions/
│  └─ mangadex/             # extension bawaan (legal)
├─ docs/
│  ├─ adr/                  # Architecture Decision Records (diturunkan dari dokumen ini)
│  └─ ...                   # situs dokumentasi VitePress (pengguna + pembuat extension)
└─ BRAINSTORM.md
```

Repo extension komunitas terpisah, memakai `extension-sdk` + `mr-ext`, dengan smoke test harian di CI-nya sendiri.

---

## 10. Kualitas & rilis

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Paket | **Windows**: NSIS + portable. **macOS**: dmg x64 + arm64. **Linux**: AppImage, deb, rpm, **AUR**, **Flatpak** |
| Code signing | **Tanpa signing dulu**. Cara melewati SmartScreen/Gatekeeper didokumentasikan. Dipertimbangkan lagi setelah ada pengguna |
| Channel | **Stable + Beta** (beta = GitHub pre-release, bisa dipilih di setting) |
| Crash reporting | **Lokal saja**. Tidak ada telemetri maupun data yang dikirim keluar |

**Testing**
- **Unit (Vitest)**: rate limiter, pemilihan versi chapter (scanlator), pencocokan migrasi, merge restore, LRU cache, logika "lanjut baca", parsing nomor chapter.
- **DB**: SQLite in-memory dengan migrasi sungguhan.
- **Extension runtime**: extension dijalankan di QuickJS dengan **fixture HTTP** yang direkam. **Test sandbox**: `require`, `process`, request ke domain di luar allowlist, batas memori/CPU, dan timeout harus gagal dengan benar.
- **E2E (Playwright `_electron`)**: browse → detail → baca → tambah ke library → download → baca offline, memakai **extension tiruan** + server fixture lokal. **CI tidak pernah menyentuh situs sungguhan.**
- **Target performa** (dicek manual/benchmark sebelum rilis): startup < 2 detik, library 1.000+ manga lancar di-scroll, memori reader webtoon stabil pada chapter panjang.

**Alur kerja**
- ESLint + Prettier, TypeScript strict, lint rule untuk string literal di JSX (i18n).
- **Conventional Commits** + **release-please**: versi & `CHANGELOG.md` dibuat otomatis (dipakai ulang untuk dialog What's new), sekaligus menangani rilis npm `extension-sdk`.
- Versi app (semver) terpisah dari `apiVersion` extension.

**CI (GitHub Actions)**
- Setiap PR: lint, typecheck, unit/integrasi, E2E (Linux).
- Setiap tag rilis: **build matrix per OS** (Windows, macOS x64, macOS arm64, Linux). Wajib per OS karena `better-sqlite3` dan `sharp` adalah modul native. Hasilnya diunggah ke GitHub Release (pre-release untuk beta).
- Setelah rilis stable: perbarui PKGBUILD **AUR** dan manifest **Flatpak** (Flathub butuh proses review sekali di awal).

**Auto-update**
- `electron-updater` via GitHub Releases. Setting: channel (stable/beta) dan "download otomatis" atau "beri tahu saja".
- Berlaku untuk: Windows NSIS, AppImage. **Tidak** untuk portable, deb, rpm, AUR, dan Flatpak (diupdate lewat package manager masing-masing; app hanya memberi tahu ada versi baru).
- **macOS tanpa signing tidak bisa auto-update**, jadi app hanya memberi tahu dan membuka halaman rilis.

**Logging & crash**
- `electron-log`: log ke file dengan rotasi, level bisa diatur di setting Lanjutan.
- `crashReporter` Electron dengan **upload dimatikan**: dump disimpan lokal.
- Tombol **"Salin info debug"** (versi app/OS/Electron, extension terpasang, potongan log) untuk dilampirkan saat melapor bug.

**Dokumentasi & komunitas**
- README: fitur, screenshot, cara install per OS (termasuk melewati SmartScreen/Gatekeeper), **disclaimer** konten.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, **`SECURITY.md`** (jalur privat untuk melaporkan celah sandbox).
- Situs dokumentasi VitePress: panduan pengguna + **panduan membuat extension** (API host, contoh, `mr-ext`).
- Template issue: bug (dengan info debug), fitur, dan **permintaan source → diarahkan ke repo extension**.
- **ADR** di `docs/adr/`: keputusan-keputusan dari dokumen ini dicatat satu per satu beserta alasannya.

---

## 11. Roadmap

> Cakupan v1 cukup besar. Rilis **beta** dimulai setelah Fase 3, supaya ada umpan balik lebih awal.

**Fase 0: Fondasi**
- Monorepo pnpm, electron-vite, React, Tailwind + shadcn/ui, TanStack Router/Query, Zustand.
- i18n (EN + ID) sejak awal, ESLint/Prettier, TypeScript strict, CI untuk PR.
- SQLite + Drizzle + **seluruh skema §7** + migrasi, kontrak IPC typed, electron-log.
- Shell UI: title bar kustom, sidebar, sistem tema (terang/gelap/sistem).
- Tulis ADR awal dari dokumen ini.

**Fase 1: Extension & membaca** ✅ selesai 23 Sep 2026 (rincian dan penyesuaian: `docs/plans/fase-1-extension-membaca.md`)
- `extension-runtime` (QuickJS) + batas memori/CPU/timeout + **test sandbox**. Benchmark untuk menentukan batas final.
- Extension host di utilityProcess, host API (`http`, `html`, `storage`, `prefs`, `crypto`, …).
- Network layer: `net.request` (bukan `net.fetch`, lihat §6.5), partition per extension, rate limit, allowlist, UA, Cloudflare (tersembunyi → tampil).
- SDK minimal + `mr-ext create/build/test/bench` + extension **MangaDex** (bawaan) + load extension dari folder.
- Browse (daftar source, popular/latest/search, filter, buka dari URL), halaman detail + daftar chapter.
- Reader: single, double, webtoon (tersambung antar chapter), LTR/RTL, fit, lebar maksimum, keyboard, preset tap zone, overlay, halaman transisi + peringatan chapter hilang.
- `manga://` protocol + cache LRU + dimensi halaman (diukur di renderer setelah decode).
- Penutup: benchmark runtime (ADR 0003), E2E dengan extension tiruan + server fixture di CI, `docs/extensions.md`, ADR 0011–0014.

**Fase 2: Library & progress** ✅ selesai 24 Sep 2026 (rincian dan penyesuaian: `docs/plans/fase-2-library-progress.md`)
- Library: tampilan, kategori (multi), sort/filter, pencarian FTS5, multi-select, cover library permanen + cover kustom (ADR 0016).
- Progress (termasuk offset webtoon), logika "lanjut baca", history, sesi baca, bookmark chapter, mode incognito (ADR 0017).
- Pengaturan reader per manga, filter & prioritas scanlator, status baca per nomor chapter (ADR 0015).
- **Global search** dan **migrasi source**.
- Penyesuaian: bookmark cukup per chapter seperti Mihon; bookmark halaman, tab Bookmark, dan halaman global Bookmark dibatalkan (ADR 0018). Nama app ditetapkan **Matane (またね)**. Penilaian kandidat migrasi memakai judul saja karena SDK belum punya judul alternatif.
- Penutup: E2E alur penuh (termasuk restart app) dengan dua extension tiruan, ukur performa 1.000 manga / 50 ribu chapter, ADR 0015–0018.

**Fase 3: Download & update** ✅ selesai 27 Sep 2026 → **beta 0.1.0-beta.1** (rincian dan penyesuaian: `docs/plans/fase-3-download-update.md`)
- Antrean download (persisten, paralel, retry), CBZ + ComicInfo.xml / folder, baca offline, mode offline.
- Otomatisasi: auto-download chapter baru, download ahead, hapus setelah dibaca, batas ukuran.
- Update checker + aturan lewati, halaman Updates, notifikasi, tray opsional, jalan saat login.
- Paket beta: AppImage, NSIS, dmg + auto-update (channel beta).
- Penyesuaian:
  - channel beta memakai flag pre-release GitHub (hanya file `latest*.yml`);
  - "Hapus yang selesai" di halaman Downloads hanya menyembunyikan item, file tetap ada;
  - chapter yang hilang dari source juga dipertahankan kalau ada di history atau statistik;
  - build macOS x64 memakai runner `macos-15-intel`.
- Penutup: E2E alur penuh (download → situs mati → baca offline → chapter baru → Updates → auto-download), ADR 0019–0021, `CHANGELOG.md`, `SECURITY.md`, dan `CONTRIBUTING.md`.

**Fase 4: Ekosistem extension**
- Repo extension (`index.json`), **signing ed25519**, install/update/uninstall + dialog izin domain, filter NSFW.
- Mode dev: load dari folder, hot reload, panel log. `mr-ext repo`.
- Repo extension terpisah + smoke test harian.
- `transformImage` (dekripsi byte + tile shuffle), `migrateUrl`.
- Publikasi `extension-sdk` ke npm + panduan membuat extension.

**Fase 5: Polish & rilis v1.0**
- Reader: crop border, split gambar tinggi, filter warna, auto-scroll, remap keyboard, gesture sentuh.
- Tema AMOLED, warna aksen, warna dari cover. Command palette, onboarding, What's new, Discord RPC, halaman statistik.
- Backup/restore + auto-backup.
- Setting jaringan: DoH, proxy, User-Agent.
- Semua paket (portable, deb, rpm, AUR, Flatpak), dokumentasi lengkap, **nama final**, rilis **v1.0**.

**Setelah v1**
- Tracker: AniList, MyAnimeList, MangaUpdates, Kitsu (termasuk sinkronisasi dua arah).
- Login per source (BrowserWindow).
- Import backup Mihon/Tachiyomi (`.tachibk`).
- Source file lokal (CBZ/folder).
- Template extension untuk CMS populer (Madara, MangaThemesia).
- Sinkronisasi antar perangkat yang sesungguhnya.
- Code signing (kalau pengguna sudah cukup banyak).

---

## 12. Pertanyaan terbuka

**Keputusan yang masih tersisa**
- [ ] **Nama project**: ditentukan sebelum rilis v1.0 (ide: *Koma*, *Yomu*, *Halaman*, *Panelist*, *Mangadesk*). Cek ketersediaan di GitHub/npm/Flathub/AUR.

**Yang perlu diverifikasi saat implementasi**
- [ ] Aturan & rate limit **MangaDex API** terbaru (atribusi, laporan MangaDex@Home).
- [ ] Batas memori/CPU sandbox yang final (benchmark di Fase 1).
- [ ] Library pendukung yang masih aktif dirawat (Discord RPC, grafik).
- [ ] API tracker (terutama MangaUpdates dan Kitsu), saat masuk tahap setelah v1.
- [ ] Persyaratan Flathub untuk app Electron (sandbox Flatpak, portal untuk folder download).

**Semua keputusan lain sudah diambil.** Ringkasannya ada di tabel "Keputusan" di awal setiap bagian (§2, §5.0, §6.1–§6.7, §10).

---

## 13. Risiko

| Risiko | Mitigasi |
|---|---|
| **Cakupan v1 besar** | Beta setelah Fase 3; fitur Fase 5 bisa dipotong/ditunda tanpa mengganggu inti |
| **Situs sumber berubah/rusak** | Update extension terpisah dari app, smoke test harian di repo extension, `migrateUrl` |
| **Cloudflare/anti-bot** | BrowserWindow tersembunyi → tampil, UA konsisten, partition per extension |
| **Pemblokiran ISP (mis. Internet Positif)** | DNS-over-HTTPS dan proxy di setting |
| **Legal/DMCA** | Repo app hanya berisi extension legal (MangaDex); extension lain di repo terpisah; disclaimer |
| **Keamanan extension** | QuickJS sandbox, allowlist domain, signing repo, `SECURITY.md`, test sandbox di CI |
| **Performa QuickJS** | Parsing HTML dan pengolahan gambar di host. Benchmark Fase 1: batas aman dengan ruang besar (ADR 0003) |
| **Performa gambar besar/webtoon panjang** | Virtualisasi, split gambar tinggi, cache disk, `img.decode()` |
| **Modul native (`better-sqlite3`, `sharp`)** | Build matrix per OS/arsitektur di CI; tidak ada cross-compile |
| **App tanpa signing** | Panduan melewati SmartScreen/Gatekeeper; macOS tanpa auto-update; pertimbangkan signing nanti |
| **Tray di Linux tidak konsisten** | Tray opsional; app tidak bergantung padanya |
| **`better-sqlite3` sinkron di main** | Semua query ber-index; operasi berat di worker thread |
