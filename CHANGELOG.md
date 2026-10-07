# Changelog

All notable changes to Matane. Versions follow [semver](https://semver.org); betas are published as GitHub pre-releases.

## 0.3.0-beta.1 — unreleased

### Reading

- **Local files:** read CBZ files and folders of images from your computer as a source of their own. Pick the folder in Settings → Browse & extensions → Local files; it has one folder per manga, with chapters as `.cbz`/`.zip` files or sub-folders of images, an optional `cover.jpg` and `ComicInfo.xml` details. Add the manga to the library, keep progress and history, and read with the same reader. Matane only reads inside the folder you chose.

### Library and trackers

- **Two-way tracker sync:** chapters you read on a tracker (on your phone, or on its website) are marked read here, a tracker that is behind gets an update, and the status, score and dates you change on its website are taken over. It runs after the app opens and after the library is checked, and with **Sync now** in Settings → Tracking or in a manga's Tracking dialog. Following a tracker can be switched off per tracker and per manga. Nothing read here is sent while incognito, and what a tracker said is never sent back to it.
- **Kitsu and MangaUpdates tracking:** log in with your username and password in Settings → Tracking (the password goes only to that service and is never kept), link manga from their page, and reading is sent the same way. Kitsu rates in halves; MangaUpdates has no dates.
- **MyAnimeList tracking** (in builds that have a MyAnimeList app registration): the same as AniList, with a login that renews itself, whole-number scores, and a title search of at least 3 letters.
- **AniList tracking:** connect AniList in Settings → Tracking (the login happens in your browser), link a manga to its AniList entry from its page (**Tracking**), and the chapters you read are sent for you. Edit status, score, chapters read and dates there too. Nothing waits on the network: updates are queued, sent when AniList can be reached and retried if it is down, and never sent while incognito. Links are in your backups; the login is not.

### Extensions

- **Templates for Madara and MangaThemesia sites:** the new `@matane/extension-templates` package gives extension authors a ready-made source for each theme, and `mr-ext create <id> --template madara|mangathemesia` scaffolds an extension that is one line of configuration. Paths and CSS selectors can be adjusted, or a single method replaced. The templates follow each theme's default markup. See the extension guide.

## 0.2.0-beta.1 — 2026-10-04

The second beta: sources now come from extension repositories you add, and most of the polish planned for 1.0 is in. Nothing is built into the app, and no repository is added for you.

### Reading and library

- Pages are measured, cropped and cut in the background: no more jumping strip, optional automatic border cropping, and very tall pages shown in parts (smoother webtoons). Downloads stay untouched.
- Zoom (Ctrl+wheel, Ctrl +/−/0, double-click) and drag around a zoomed page; on touch screens, swipe to turn pages and pinch to zoom.
- Every reader key can be remapped (Settings → Reader → Keyboard shortcuts).
- Colour filters (brightness, contrast, warm tint, grayscale, invert) and a custom background, also per manga; a page number while the bars are hidden; auto-scroll for webtoons.
- Default reading mode and direction per kind of manga (manga, manhwa, manhua, comic).
- Right-click a page to save or copy it.
- Webtoon and vertical modes read on in both directions: scrolling up continues into the previous chapter, and the previous/next chapter keys scroll within the strip instead of reloading the reader. Chapters far from the one on screen are unloaded.
- The manga page takes its colour from the cover.
- A source's manga list has a cover size slider and the same display modes as the library (comfortable grid, compact grid, covers only, list); the choice is remembered.
- Statistics: chapters read, reading time, streaks, favourite genres and sources over 30 days, 12 months or all time.

### Getting around

- Command palette (Ctrl+K): pages, settings, your library, recent chapters and actions.
- A short first-run setup (language, theme, content languages, download folder, sources), which can run again from Settings → About.
- What's new: these notes show once after an update, also offline.
- Discord Rich Presence (off by default; hidden for adult sources and in incognito).

### Network and data

- Settings → Network: DNS-over-HTTPS (Cloudflare, Google, Quad9, AdGuard or your own), HTTP/SOCKS5 proxy, a custom User-Agent, and a connection test. Useful where providers block sites through DNS.
- Backup and restore: one file with your library, progress, history, statistics, repositories, extension settings and app settings; merge or replace; daily automatic backups (the last 7 kept).
- Restore can also import a Mihon/Tachiyomi backup (`.tachibk`): library, categories, read chapters, bookmarks, progress, history and reading time. Each source in the backup is matched to an installed source (by Mihon's source id, else by name) and can be changed or skipped in the dialog (an extension that is not installed yet can be installed from there when a repository has it); manga of skipped sources are reported, not imported. Trackers, repositories and app settings are not imported.

### Diagnostics and packages

- Settings → Advanced: log level, the log and crash report folders (crash reports never leave your computer) and "Copy debug info" for bug reports, without your home folder or tokens.
- Settings → About: how Matane was installed, the open source licenses, and links to the documentation and issue tracker.
- New downloads: Windows portable, deb, rpm and tar.gz. Builds that cannot update themselves tell you when a new version is out.
- Documentation site: [mataneorg.github.io/matane](https://mataneorg.github.io/matane/).

### Extensions

- Matane does not ship with, link to, or add any extension repository by itself. Add one by its URL (Extensions → Repositories); a repository is either signed with a key you chose to trust or unverified.
- Extension repositories: add one by its URL, see what it offers, install, update ("Update all") and uninstall extensions. Every repository index is signed (ed25519), unverified ones are asked about before adding and warned about before installing. Every archive must match the signed SHA-256 before anything is written.
- The install dialog shows the repository's trust, its API version and size. Extensions no longer declare the sites they reach: requests are limited to http(s) and still go through the app, so install only extensions from repositories you trust.
- Uninstalling removes an extension's settings, data and cookies; its manga stay in the library as "source not installed" until it comes back.
- Content languages and adult content: extensions and sources in other languages, and adult ones until you turn them on, are hidden in Extensions, Sources, browse, global search and migration.
- Settings → Browse & extensions: content languages, adult content, updating extensions by themselves, how often repositories are checked, and the repository list.
- A live log per extension (its own lines, every request and failed call), with level filter, copy and clear.
- Sites that scramble or encrypt their images work: extensions describe how to restore a page (`transformImage`, with `crypto.aesDecrypt`), the app rebuilds it; restored pages are cached and downloaded as they are shown.
- Extension updates can change how their links look without breaking the library, progress or downloads (`migrateUrl`).

### For extension authors

- `mr-ext repo keygen | build | verify`: reproducible, signed repositories for static hosting (GitHub Pages).
- `mr-ext test` runs `transformImage` on the first page and writes the restored page to `.mr-ext/`; it also accepts built bundles. `mr-ext create --layout standalone | catalog | workspace`.
- The packages are now `@matane/extension-sdk`, `@matane/extension-runtime` and `@matane/extension-cli`, published on npm.
- Guide for writing extensions and publishing a repository of your own: the [extension guide](https://mataneorg.github.io/matane/extensions/).

### Fixes

- The Library filter menu scrolls instead of running off short windows.

## 0.1.0-beta.1 — 2026-09-27

The first beta: everything from Phases 0–3.

### Reading and library

- A built-in source, in a sandboxed extension system (QuickJS); browse, filters, search, open from a URL.
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
