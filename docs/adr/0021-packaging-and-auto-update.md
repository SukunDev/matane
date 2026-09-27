# 21. Packaging with electron-builder, auto-update from GitHub releases, no signing yet

Status: Accepted (2026-09-27)

## Context
The first beta (end of Phase 3) needs installers for Windows, macOS and Linux and a way to update (BRAINSTORM.md §10). There is no budget for code-signing certificates yet, and no telemetry is wanted.

## Decision
- **electron-builder 26** (`apps/desktop/electron-builder.yml`): AppImage (Linux), NSIS (Windows x64, per-user, installation folder can be changed), dmg x64 + arm64 (macOS). `better-sqlite3` is unpacked from the asar; built-in extensions ship in `resources/extensions` (their built `dist/`); migrations ship inside the asar. `pnpm dist` / `pnpm dist:linux` build locally.
- **Release CI** (`.github/workflows/release.yml`) on a `v*` tag: a draft release, one build job per OS (native modules need it; macOS x64 on `macos-15-intel`, arm64 on `macos-15`), then the release is published — as a **pre-release** when the tag has a suffix (`-beta.1`). The existing CI workflow is unchanged.
- **electron-updater 6** for NSIS and AppImage: from GitHub releases, `allowPrerelease` on the beta channel (GitHub's pre-release flag is the channel, so only `latest*.yml` files are published), checks 30 s after start and every 6 h. Settings: download by itself (default), only tell, or off; stable or beta (default beta while every release is a beta). The update installs on "Restart to update" or on quit.
- **No signing:** macOS without a signature cannot update itself, so macOS, the Windows portable build and Linux packages other than AppImage only learn about a newer release (GitHub releases API) and link to it. The README explains the SmartScreen and Gatekeeper steps.
- `MATANE_UPDATE_FEED` points the updater at a generic feed (local testing).
- No telemetry: the only requests are the release feed and GitHub's releases API.

## Consequences
- Users see SmartScreen/Gatekeeper warnings until the builds are signed (planned after v1 if there are enough users).
- The two macOS jobs both upload `latest-mac.yml`; it is not used (macOS only gets notified), so the overwrite is harmless.
- release-please (automatic versions and changelog) is postponed; `CHANGELOG.md` is written by hand for now.
