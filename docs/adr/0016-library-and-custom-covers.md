# 16. Permanent library covers and custom covers

Status: Accepted (2026-09-24)

## Context
Covers come through the `manga://` image cache (ADR 0014), which evicts least-recently-used files at 1 GB. A library that loses its covers after heavy reading, or while offline, looks broken. Users also want their own cover for a manga (BRAINSTORM.md §6.2, §6.5).

## Decision
- **Library manga keep a permanent copy** of their source cover in `userData/covers/<mangaId>-<hash of the cover URL>.<ext>`, outside the LRU cache. It is taken when the manga is added (and whenever a new source cover is served) and deleted when the manga leaves the library.
- **Custom covers** live in `userData/covers/custom/<mangaId>-<timestamp>.<ext>`, copied from a picked file or from a cached reader page ("Set as cover" in the page context menu). The file type is sniffed from its bytes (PNG, JPEG, GIF, WebP, AVIF; max 20 MB). Custom covers survive leaving the library; "Reset cover" deletes them.
- Lookup order for `manga://cover/<id>`: custom → permanent library copy → cache → fetch.
- The renderer identifies a cover by `coverKey` (custom path ?? source cover URL) and appends a short hash of it to the URL, so Chromium never shows a stale image after a change.

## Consequences
- Covers of library manga show offline and after clearing the image cache (verified against Example Source).
- Paths are stored absolutely in the database; moving the data folder (the MangaReader → Matane rename) rewrites them.
- Migration copies a custom cover to the new manga.
