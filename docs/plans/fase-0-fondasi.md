# Plan: Fase 0 (Fondasi) Manga Reader

## Context

Semua keputusan desain sudah diambil: `BRAINSTORM.md` (arsitektur, extension, fitur, skema §7, tech stack §8, struktur §9, roadmap §11) dan mockup UI final di `docs/ui/` (16 layar Catppuccin Mocha, HTML + PNG, yang menjadi acuan utama). Folder project masih kosong: belum ada kode dan belum menjadi repo git.

Fase 0 membangun **fondasi yang dipakai semua fase berikutnya**, belum ada fitur baca manga. Hasil akhirnya:
- App Electron yang bisa dijalankan, dengan shell UI sesuai mockup (title bar kustom, sidebar, tema Catppuccin, EN/ID).
- Database SQLite dengan **seluruh skema §7** dan migrasinya.
- Kontrak IPC typed.
- Lint, test, dan CI yang hijau.

Di luar cakupan Fase 0 (masuk Fase 1+): runtime QuickJS, network layer, extension, reader, dan isi halaman yang sesungguhnya.

## Pra-syarat lingkungan

- Node belum ada di PATH. Pasang **Node LTS terbaru** lewat pnpm (`pnpm env use --global lts`), lalu kunci versinya di `package.json` (`devEngines` + `packageManager`) dan `.node-version`, supaya CI dan kontributor memakai versi yang sama.
- **Git**: hanya `git init` (+ `.gitignore`). Tidak ada commit otomatis; kamu yang melakukan commit. Remote GitHub ditambahkan nanti.
- Versi terbaru Electron, electron-vite, Tailwind, TanStack, Drizzle, dan zod **dicek saat setup**, lalu dipakai versi stable terbaru.
- `better-sqlite3` adalah modul native: di-rebuild untuk ABI Electron (`@electron/rebuild` lewat `postinstall`).

## Langkah

Setiap langkah diakhiri dengan pengecekan (`pnpm typecheck` / `pnpm dev`), supaya kamu bisa commit per langkah kalau mau. Isi halaman di Fase 0 hanya **placeholder + empty state**. Halaman yang sesungguhnya dibangun di Fase 1–2 bersama datanya.

### 1. Repo & monorepo
- `git init` (branch `main`, tanpa commit), `.gitignore`, `.editorconfig`, `.gitattributes`.
- `LICENSE` (GPL-3.0) di root. `packages/extension-sdk/LICENSE` (MIT).
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `extensions/*`.
- Root `package.json`: script `dev`, `build`, `lint`, `typecheck`, `test`, `format`. `tsconfig.base.json` dengan `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Kerangka package (baru berisi `package.json`, `tsconfig`, `src/index.ts`):
  - `packages/shared`: tipe domain + kontrak IPC.
  - `packages/extension-sdk`: stub, diisi di Fase 1.
  - `packages/extension-runtime`: stub, diisi di Fase 1.

### 2. App Electron (`apps/desktop`)
- Scaffold dengan **electron-vite** (React + TS), struktur sesuai §9: `src/main/{app,db,…}`, `src/preload`, `src/renderer`.
- `BrowserWindow`:
  - frameless (`titleBarStyle: 'hidden'`, dan `hiddenInset` di macOS);
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`;
  - CSP ketat di `index.html`;
  - ukuran, posisi, dan status maximize jendela diingat (disimpan di tabel `settings`);
  - `minWidth` / `minHeight` diset.
- Instance tunggal (`requestSingleInstanceLock`).

### 3. Tema Catppuccin + UI kit
- **Tailwind v4** + `@catppuccin/tailwindcss`. Token CSS variable: base, mantle, crust, surface0–2, overlay, text, subtext, dan `--accent` (default Mauve), mengikuti nilai di `docs/ui/html/*.html`.
- **shadcn/ui** (Radix) diinisialisasi dengan variabel yang dipetakan ke token Catppuccin.
- `ThemeProvider`:
  - pilihan tema: Mocha (default), Latte, Sistem, AMOLED, dengan Frappé/Macchiato opsional;
  - 14 preset aksen Catppuccin;
  - teks di atas aksen memakai crust (Latte: base);
  - disimpan lewat IPC `settings`.
- Font Inter lokal (`@fontsource-variable/inter`), bukan dari CDN, supaya tetap jalan offline dan lolos CSP.

### 4. Router, state, i18n
- **TanStack Router**, file-based, memakai hash history. Rute placeholder untuk semua menu sidebar:
  - `library`, `updates`, `history`
  - `browse/sources`, `browse/extensions`, `browse/global-search`
  - `downloads`, `bookmarks`, `statistics`, `settings/$section`
  - `manga/$mangaId`
  - `reader/$chapterId` (layout layar penuh tanpa shell)
- TanStack Query client + Zustand store UI (mis. sidebar diciutkan).
- **i18next** + `react-i18next`: `locales/en.json` dan `locales/id.json`. Bahasa awal diambil dari `app.getLocale()` lewat IPC.

### 5. Shell UI dari mockup
Acuan: `docs/ui/html/01-library.html` dan `docs/ui/screens/01-library.png`.
- `TitleBar`:
  - area drag, tombol back/forward, breadcrumb;
  - pemicu pencarian dengan chip "Ctrl K" (command palette-nya sendiri dibuat di Fase 5);
  - indikator status incognito, offline, dan aktivitas;
  - kontrol jendela lewat IPC.
- `Sidebar`: logo + "MangaReader", item menu dengan badge, sub-menu Browse, Settings di bawah, bisa diciutkan.
- Setiap halaman placeholder menampilkan **empty state** ("Belum ada manga di library", …).
- Halaman Settings → General yang **berfungsi**: memilih tema, aksen, dan bahasa. Ini sekaligus membuktikan IPC dan DB berjalan dari ujung ke ujung.

### 6. Kontrak IPC typed
- `packages/shared/src/ipc/contract.ts`: satu objek yang mendefinisikan setiap channel `invoke` (input/output berupa skema **zod**) dan setiap channel `event` (main → renderer).
- Main: `registerIpcHandlers(contract, handlers)`, yang memvalidasi input dengan zod dan menolak channel yang tidak dikenal.
- Preload: `window.api`, dibuat dari kontrak (typed, lewat `contextBridge`).
- Renderer: helper `useIpcQuery` / `useIpcMutation` (TanStack Query) dan `useIpcEvent`.
- Channel awal:
  - `app.getInfo`, `app.getLocale`
  - `window.minimize`, `window.toggleMaximize`, `window.close`, `window.isMaximized`
  - event `window.maximizeChanged`
  - `settings.get`, `settings.set`, event `settings.changed`

### 7. Database (seluruh skema §7)
- `better-sqlite3` + **Drizzle ORM** di `apps/desktop/src/main/db/`:
  - `schema/*.ts`, satu file per kelompok: extension & source, manga/kategori/chapter, progress/history/bookmark, download & cache, tracker, settings;
  - `client.ts`: WAL, `foreign_keys = ON`, file `userData/data.db`;
  - `migrate.ts`: sebelum migrasi, DB di-backup otomatis ke `userData/backups/db/` (simpan 3 terakhir);
  - `repositories/settings.ts`.
- Migrasi dibuat dengan `drizzle-kit generate` dan ikut di-bundle. FTS5 `manga_fts` beserta trigger sinkronisasinya dibuat lewat migrasi SQL kustom.
- Semua index dan unique key dibuat sesuai §7.

### 8. Logging
- `electron-log`: log ke file dengan rotasi. Log dari renderer diteruskan ke main. Handler `uncaughtException` / `unhandledRejection` dipasang.

### 9. Kualitas
- ESLint flat config: `typescript-eslint`, `react-hooks`, dan aturan i18n no-literal-string untuk JSX. Ditambah Prettier.
- **Vitest**:
  - unit test untuk validasi kontrak IPC (zod) dan logika tema;
  - test DB yang menjalankan semua migrasi di SQLite in-memory, lalu memeriksa tabel, index, dan trigger FTS5.
  - Catatan: `better-sqlite3` di-build untuk ABI Electron, jadi test DB dijalankan dengan `ELECTRON_RUN_AS_NODE=1 electron …/vitest` supaya ABI-nya cocok.
- `pnpm typecheck` mencakup semua package.

### 10. CI & dokumentasi
- `.github/workflows/ci.yml` (setiap PR/push, Linux): install pnpm dengan cache, lalu jalankan lint, typecheck, dan test. Build per OS belum masuk (Fase 3).
- `docs/adr/0001–000N`: ADR singkat yang diturunkan dari `BRAINSTORM.md`: monorepo, lisensi, QuickJS sandbox, format extension, IPC contract, SQLite + Drizzle, tema Catppuccin, dan `docs/ui` sebagai acuan desain.
- `README.md` minimal: deskripsi, status "pre-alpha", cara menjalankan dev, disclaimer konten.

## File kunci

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`
- `apps/desktop/electron.vite.config.ts`
- `apps/desktop/src/main/index.ts`, `src/main/app/window.ts`, `src/main/ipc/register.ts`
- `apps/desktop/src/main/db/{client,migrate}.ts`, `src/main/db/schema/*.ts`, `drizzle/` (migrasi)
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/{main.tsx,routes/**,components/shell/{TitleBar,Sidebar}.tsx,theme/**,i18n/**}`
- `packages/shared/src/ipc/contract.ts`
- `.github/workflows/ci.yml`, `docs/adr/*.md`

## Verifikasi

1. `pnpm install` berhasil (termasuk rebuild `better-sqlite3`), lalu `pnpm lint`, `pnpm typecheck`, dan `pnpm test` hijau.
2. `pnpm dev`:
   - jendela frameless terbuka dengan title bar dan sidebar Catppuccin Mocha;
   - bandingkan secara visual dengan `docs/ui/screens/01-library.png` (screenshot app lewat skill `/run`);
   - semua menu sidebar bisa dinavigasi dan menampilkan empty state;
   - tombol minimize, maximize, dan close berfungsi; back/forward jalan.
3. Settings → General:
   - ganti tema (Mocha, Latte, AMOLED), aksen, dan bahasa (EN/ID);
   - restart app, lalu pastikan pilihan tetap tersimpan;
   - ukuran dan posisi jendela juga diingat.
4. `sqlite3 ~/.config/<app>/data.db ".tables"` menampilkan semua tabel §7 dan `manga_fts`. Backup pra-migrasi muncul di `userData/backups/db/`.
5. File log ada di folder log `electron-log`.
6. Workflow CI divalidasi secara lokal (sintaks YAML + langkah yang sama dijalankan manual). Status hijau di GitHub baru bisa dicek setelah remote ditambahkan.

---

## Status pelaksanaan (23 Sep 2026)

**Selesai.** Semua langkah 1–10 sudah dikerjakan dan diverifikasi: lint, format, typecheck, 12 test, build, app berjalan (build dan dev), setting tersimpan setelah restart, dan database berisi seluruh tabel §7 + `manga_fts`.

Penyimpangan dari rencana:
- **Versi toolchain**: memakai TypeScript 6.0 (bukan 7) dan Vite 7 (bukan 8) karena kompatibilitas dengan typescript-eslint dan electron-vite. Dicatat di `docs/adr/0009-toolchain-pins.md`.
- **Preload**: `isolatedEntries` di electron-vite crash kalau output bukan TTY, jadi diganti `externalizeDeps: false` (hasilnya sama, karena entry-nya hanya satu).
- **Electron 44** mengunduh binary-nya secara lazy (saat pertama dipakai), tidak lagi lewat postinstall.
- **Renderer**: di-minify (default electron-vite mematikannya), dan konstanta tema dipindah ke subpath `@manga-reader/shared/theme` supaya zod tidak ikut ter-bundle. Bundle utama turun dari 1,2 MB menjadi 404 KB.
- **README dan ADR** ditulis dalam bahasa Inggris (untuk kontributor open source). Dokumen perencanaan tetap berbahasa Indonesia.
- Tidak ada commit. Repo baru di-`git init`, dan commit dilakukan sendiri.
