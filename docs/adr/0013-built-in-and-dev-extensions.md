# 13. Built-in extensions and extensions loaded from a folder

Status: Accepted (2026-09-23)

## Context
Extension repositories, signing and updates arrive in Phase 4 (BRAINSTORM.md §5.7), but Phase 1 needs a working source and extension authors need a tight edit → try loop.

## Decision
- **Built-in**: every folder in `extensions/*` is a first-party extension built with `mr-ext build`. In development the app reads `extensions/<id>/dist`; packaged builds ship them as `resources/extensions/<id>` (electron-builder `extraResources`, to be wired with packaging). MangaDex is the first one.
- **Dev folders** (Settings → Advanced, or `extensions.loadDevFolder`): a folder containing either `dist/` or `manifest.json` + `index.js`. It overrides a built-in with the same id, is watched, and reloads when `mr-ext build` rewrites it. A folder that is not built yet stays listed with its error.
- Both kinds are recorded in the `extensions`/`sources` tables; sources outlive their extension so library entries survive an uninstall.

## Consequences
- The registry has one code path for both kinds; Phase 4 adds a third origin ("repo") with signature checks.
- Dev folders are trusted only in the sense that the user picked them; they still run in the same sandbox with the same allowlist.
