# Changelog

All notable changes to Matane. Versions follow [semver](https://semver.org); betas are published as GitHub pre-releases.

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
