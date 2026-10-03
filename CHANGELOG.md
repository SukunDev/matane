# Changelog

All notable changes to Matane. Versions follow [semver](https://semver.org); betas are published as GitHub pre-releases.

## Unreleased

- Webtoon and vertical modes now read on in both directions: scrolling up continues into the previous chapter, and the previous/next chapter keys scroll within the strip instead of reloading the reader. Chapters far from the one on screen are unloaded.

## 0.2.0-beta.1 — 2026-10-02

The second beta: sources now come from the official extension repository ([SukunDev/matane-extensions](https://github.com/SukunDev/matane-extensions)), added by itself, and most of the polish planned for 1.0 is in. Nothing is built into the app anymore: MangaDex from 0.1 moves to the repository by itself and keeps your library and progress.

### Reading and library

- Pages are measured, cropped and cut in the background: no more jumping strip, optional automatic border cropping, and very tall pages shown in parts (smoother webtoons). Downloads stay untouched.
- Zoom (Ctrl+wheel, Ctrl +/−/0, double-click) and drag around a zoomed page; on touch screens, swipe to turn pages and pinch to zoom.
- Every reader key can be remapped (Settings → Reader → Keyboard shortcuts).
- Colour filters (brightness, contrast, warm tint, grayscale, invert) and a custom background, also per manga; a page number while the bars are hidden; auto-scroll for webtoons.
- Default reading mode and direction per kind of manga (manga, manhwa, manhua, comic).
- Right-click a page to save or copy it.
- The manga page takes its colour from the cover.
- Statistics: chapters read, reading time, streaks, favourite genres and sources over 30 days, 12 months or all time.

### Getting around

- Command palette (Ctrl+K): pages, settings, your library, recent chapters and actions.
- A short first-run setup (language, theme, content languages, download folder, sources), which can run again from Settings → About.
- What's new: these notes show once after an update, also offline.
- Discord Rich Presence (off by default; hidden for adult sources and in incognito).

### Network and data

- Settings → Network: DNS-over-HTTPS (Cloudflare, Google, Quad9, AdGuard or your own), HTTP/SOCKS5 proxy, a custom User-Agent, and a connection test. Useful where providers block sites through DNS.
- Backup and restore: one file with your library, progress, history, statistics, repositories, extension settings and app settings; merge or replace; daily automatic backups (the last 7 kept).

### Diagnostics and packages

- Settings → Advanced: log level, the log and crash report folders (crash reports never leave your computer) and "Copy debug info" for bug reports, without your home folder or tokens.
- Settings → About: how Matane was installed, the open source licenses, and links to the documentation and issue tracker.
- New downloads: Windows portable, deb, rpm and tar.gz. Builds that cannot update themselves tell you when a new version is out.
- Documentation site: [sukundev.github.io/matane](https://sukundev.github.io/matane/).

### Extensions

- Extension repositories: add one by its URL, see what it offers, install, update ("Update all") and uninstall extensions. Every repository index is signed (ed25519): official (the key built into the app), a key you chose to trust, or unverified (asked before adding, warned before installing). Every archive must match the signed SHA-256 before anything is written.
- The install dialog shows the repository's trust, the sites an extension can reach, its API version and size; an update that reaches a new site asks again.
- Uninstalling removes an extension's settings, data and cookies; its manga stay in the library as "source not installed" until it comes back.
- Content languages and adult content: extensions and sources in other languages, and adult ones until you turn them on, are hidden in Extensions, Sources, browse, global search and migration.
- Settings → Browse & extensions: content languages, adult content, updating extensions by themselves (unless they reach a new site), how often repositories are checked, and the repository list.
- A live log per extension (its own lines, every request and failed call), with level filter, copy and clear.
- Sites that scramble or encrypt their images work: extensions describe how to restore a page (`transformImage`, with `crypto.aesDecrypt`), the app rebuilds it; restored pages are cached and downloaded as they are shown.
- Extension updates can change how their links look without breaking the library, progress or downloads (`migrateUrl`).
- The official repository is added by itself and offers MangaDex, WestManga, Ainz Scans ID and Aarlas. Extensions that came with the app move to it by themselves ("handoff"): MangaDex from 0.1 keeps your library, progress and settings.

### For extension authors

- `mr-ext repo keygen | build | verify`: reproducible, signed repositories for static hosting (GitHub Pages).
- `mr-ext test` runs `transformImage` on the first page and writes the restored page to `.mr-ext/`; it also accepts built bundles. `mr-ext create --layout standalone | catalog | workspace`.
- The packages are now `@matane/extension-sdk`, `@matane/extension-runtime` and `@matane/extension-cli`, published on npm.
- Guides: the [extension guide](https://sukundev.github.io/matane/extensions/) and `docs/matane-extensions/` (setting up a repository, with templates for its workflows).

### Fixes

- The Library filter menu scrolls instead of running off short windows.

## 0.1.0-beta.1 — 2026-09-27

The first beta: everything from Phases 0–3.

### Reading and library

- MangaDex built in, in a sandboxed extension system (QuickJS); browse, filters, search, open from a URL.
- Reader: single page, double page, webtoon (continuous across chapters), right-to-left, fit modes, tap zones, keyboard.
- Library with categories, sort and filters, full-text search, multi-select, permanent and custom covers.
- Reading progress and "continue reading", history, incognito mode, chapter bookmarks, per-manga reader settings, hidden and preferred scanlators.
- Global search across sources and migration between sources.

### Downloads

- Download chapters as CBZ (with `ComicInfo.xml`) or folders and read them offline; written atomically, so a half-written chapter never looks finished.
- Downloads page: queue per manga, pause/resume/cancel, drag (or Alt+↑/↓) to reorder, retry, completed and error tabs.
- Download ahead while reading, delete after reading, a total size limit, and moving the download folder with its files.

### Updates

- Library update checker (every 12 hours by default, at start when due, or on demand) with skip rules, three manga at a time.
- Updates page grouped by day, a sidebar badge, grouped desktop notifications, and auto-download of new chapters per category.

### Desktop

- Optional close-to-tray with a tray menu, start at login (optionally hidden), offline mode, activity indicator in the title bar.
- Settings → Data & storage: page cache size and usage, clear caches, open the data and log folders.
- App updates from GitHub releases (AppImage and Windows installer install them; macOS and other builds get a link).
- English and Indonesian.
