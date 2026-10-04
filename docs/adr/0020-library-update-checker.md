# 20. Library update checker in main, "new" = seen after joining the library

Status: Accepted (2026-09-27)

## Context
Users follow ongoing manga and want to know about new chapters without opening each one (docs/BRAINSTORM.md §6.4), also while the window is closed to the tray. Sources are rate-limited and sometimes down.

## Decision
- **`UpdateService` in main**, on a schedule (off / 6 / 12 (default) / 24 / 48 h / weekly), at start when the interval passed, and on demand (library, category, selected manga). Offline, the scheduled check waits.
- **Three manga at a time**, cancellable, errors kept per manga. **Skip rules** (completed — on by default —, not started, too many unread) apply to library and category checks, not to a single manga. The last check, the last result and when the Updates page was seen live in `settings` (non-app keys).
- **New chapters** are chapters of library manga with `fetched_at > manga.added_at`: no schema change, and the chapters a manga had when added never show up.
- Chapters the **source dropped** stay (flagged) when read, bookmarked, with progress, a download, a history entry or reading sessions; otherwise they are deleted. An empty chapter list from a source deletes nothing.
- Afterwards: optional **auto-download** by category (exclude wins; include narrows) through the automatic queue (size limit applies), and a grouped **desktop notification** — always for automatic checks, for manual ones only when the window is in the background; clicking it opens Updates.

## Consequences
- The Updates page and the sidebar badge are plain queries; no extra tables.
- A chapter first seen when opening a library manga's page also counts as new (it is).
