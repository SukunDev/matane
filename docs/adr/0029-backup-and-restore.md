# 29. Backup and restore: natural keys, merge rules, restored in steps in main

Status: Accepted (2026-10-02)

## Context
Phase 5 adds backup and restore (docs/BRAINSTORM.md §6.7): a file that brings a library to another profile or computer, merges into an existing one, or replaces it, plus automatic backups.

## Decision
- **Format**: a zip with `backup.json` (zod schema `backupSchema`, `formatVersion: 1`, in `@manga-reader/shared/backup`) and `covers/` (custom covers). Rows are referred to by natural keys: source id + manga url, chapter url within its manga, category names, repository urls, extension ids. A newer `formatVersion` is refused with "update the app first"; readers keep accepting every older version (migrated on read when the format changes).
- **Contents**: manga in the library (all chapters), plus manga that history or reading sessions point at (only those chapters); categories with their settings; read status, bookmarks, progress; per-manga reader settings, scanlator preferences and chapter view; history; reading sessions; tracker links (never tokens); finished downloads by path; sources; repositories (url, name, trusted key); installed extensions with their preferences and storage; app settings. Not the downloaded files, caches, or secrets (the proxy password).
- **Merge** (default): read and bookmarked = either; progress = the furthest (page, then offset); categories = both; history = the newer entry; sessions are added once (same chapter and start); metadata, per-manga settings and custom covers here win and the backup only fills gaps; extension preferences already set here stay. App settings only when asked, and never the download and backup folders. Restoring the same backup twice changes nothing.
- **Replace**: a safety backup (`matane-before-restore-…`) is written first, then manga and categories are removed (their chapters, history, sessions, links, tracks and download records go with them) and the backup is merged into the empty library.
- **Downloads** come back when their file is still at the stored path (same machine, or the same synced folder).
- **Extensions not installed** keep their preferences and storage under a pending settings key; they are applied (without overwriting) when the extension is installed, or at start when it already is. The restore summary offers to install them from the repositories (the backup's repositories are added, unsynced, and synced right after).
- **In main, in steps**, not in a worker thread: better-sqlite3 is synchronous in main, so a second writer would hold locks the main thread then blocks on. Restoring runs in transactions of 50 manga with a turn for the event loop in between: 1,000 manga with 50,000 chapters restore in under a second, no step longer than ~300 ms (the first one parses `backup.json`).
- **Automatic backups**: daily (default), weekly or off, into `userData/backups` or a chosen folder; checked a minute after start and hourly, so a missed one runs soon after opening; the newest 7 automatic ones are kept, by the time stamp in their names (synced folders rewrite file times). Manual and safety backups are never rotated away.

## Consequences
- Every new table or column that holds user data needs a place in `backupSchema` (and a new `formatVersion` when the structure changes).
- Restoring on a machine where the download folder differs relinks nothing; the chapters show as not downloaded.
