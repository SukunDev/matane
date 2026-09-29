# Changelog

All notable changes to Matane. Versions follow [semver](https://semver.org); betas are published as GitHub pre-releases.

## 0.2.0-beta.1 — unreleased

Phase 4: the extension ecosystem. The official extension repository and the SDK on npm are prepared and launch later; until then MangaDex stays built in.

### Extensions

- Extension repositories: add one by its URL, see what it offers, install, update ("Update all") and uninstall extensions. Every repository index is signed (ed25519): official (the key built into the app), a key you chose to trust, or unverified (asked before adding, warned before installing). Every archive must match the signed SHA-256 before anything is written.
- The install dialog shows the repository's trust, the sites an extension can reach, its API version and size; an update that reaches a new site asks again.
- Uninstalling removes an extension's settings, data and cookies; its manga stay in the library as "source not installed" until it comes back.
- Content languages and adult content: extensions and sources in other languages, and adult ones until you turn them on, are hidden in Extensions, Sources, browse, global search and migration.
- Settings → Browse & extensions: content languages, adult content, updating extensions by themselves (unless they reach a new site), how often repositories are checked, and the repository list.
- A live log per extension (its own lines, every request and failed call), with level filter, copy and clear.
- Sites that scramble or encrypt their images work: extensions describe how to restore a page (`transformImage`, with `crypto.aesDecrypt`), the app rebuilds it; restored pages are cached and downloaded as they are shown.
- Extension updates can change how their links look without breaking the library, progress or downloads (`migrateUrl`).
- Ready for the official repository: it will be added by itself, and extensions that came with the app move to it by themselves.

### For extension authors

- `mr-ext repo keygen | build | verify`: reproducible, signed repositories for static hosting (GitHub Pages).
- `mr-ext test` runs `transformImage` on the first page and writes the restored page to `.mr-ext/`; it also accepts built bundles. `mr-ext create --layout standalone | catalog | workspace`.
- The packages are now `@matane/extension-sdk`, `@matane/extension-runtime` and `@matane/extension-cli` (published to npm with the official repository).
- Guides: `docs/extensions.md` and `docs/matane-extensions/` (setting up a repository, with templates for its workflows).

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
