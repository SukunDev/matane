# 19. Downloads: CBZ with ComicInfo, written atomically, path stored

Status: Accepted (2026-09-27)

## Context
Phase 3 downloads chapters for offline reading (BRAINSTORM.md §6.4). Other readers (Komga, Kavita, Mihon, CDisplayEx) should be able to open them, a crash must never leave a chapter that looks finished but is not, and renaming a manga must not lose its files.

## Decision
- **CBZ + `ComicInfo.xml`** by default (title, number, scanlator, writer/artist, genres, summary, `Manga=YesAndRightToLeft` for right-to-left, source URL, page count, language), or a plain **folder** of images, as a setting.
- **Atomic writes:** pages go to `<chapter>.tmp/NNN.ext` (each through a `.part` file and a rename), then the folder is zipped to `<chapter>.cbz.part` and renamed, or the folder itself is renamed. Pages already in `.tmp` are kept on pause, error, app quit and folder moves, so a retry only fetches what is missing.
- **Layout:** `<folder>/<Source (LANG)>/<Manga>/<Chapter [group]>.cbz`, names sanitized for every OS (forbidden characters, reserved Windows names, trailing dots, ~120 bytes). The **path is stored** in `downloads.path` and never recomputed; moving the download folder rewrites it.
- **Reading:** downloads come first in `manga://page` and in the page list; CBZ entries are read at random with `yauzl` (a small pool of open archives), no extraction.
- **Queue:** persistent in `downloads`, 1–4 chapters at once (default 2) × 4 pages, retries with backoff for recoverable errors only; the queue waits while offline.

## Consequences
- Downloads are portable and readable elsewhere; a half-written chapter is never mistaken for a finished one.
- `transformImage` (Phase 4) will apply before pages are written, so descrambled images are what is stored.
