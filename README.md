<p align="center"><img src="docs/assets/logo.png" width="128" alt=""></p>

# Matane (またね)

> **Beta** (0.1): browse MangaDex, read, keep a library with reading progress, download chapters for offline reading and get told about new chapters. Expect rough edges; please [report them](https://github.com/SukunDev/matane/issues).

_Matane_ is Japanese for "see you later": close the app now and pick up on the same page next time.

An open-source desktop manga reader (Windows, macOS, Linux) with a sandboxed extension system, library, reading progress, downloads and update checks — think Mihon, for the desktop.

**Disclaimer:** this application does not host or distribute any content. Sources are provided by extensions; the main repository only ships extensions for services that allow it.

## Install

Download the latest release from [GitHub Releases](https://github.com/SukunDev/matane/releases) (betas are marked "Pre-release").

| OS                            | File                                              | Updates                      |
| ----------------------------- | ------------------------------------------------- | ---------------------------- |
| Linux                         | `Matane-<version>-linux-x86_64.AppImage`          | installs them itself         |
| Windows 10/11                 | `Matane-<version>-win-x64.exe` (installer)        | installs them itself         |
| macOS (Apple silicon / Intel) | `Matane-<version>-mac-arm64.dmg` / `-mac-x64.dmg` | tells you, links the release |

The builds are **not code-signed yet**, so your OS will warn the first time:

- **Linux:** make the AppImage executable (`chmod +x Matane-*.AppImage`, or Properties → "Allow executing") and run it. Some distributions need `libfuse2`.
- **Windows:** SmartScreen shows "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** open the dmg and drag Matane to Applications. The first launch is blocked ("cannot verify the developer" / "is damaged"): open **System Settings → Privacy & Security** and click **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Matane.app` in Terminal.

Your data lives in the app data folder (`~/.config/Matane`, `%APPDATA%\Matane`, `~/Library/Application Support/Matane`); downloads go to `Documents/Matane` unless you pick another folder. Nothing is sent anywhere except requests to the sources you use and the update check against GitHub releases.

## Status

Phases 0–3 are done (first beta):

- **Foundation:** Electron shell with the Catppuccin UI, typed IPC and SQLite.
- **Extensions & reading:** the QuickJS extension sandbox with MangaDex built in; browse, filters and manga details; the reader (single, double, webtoon, RTL) with an offline image cache.
- **Library & progress:** library with categories, sort/filter, full-text search, multi-select and permanent/custom covers; reading progress and "continue reading"; history with an incognito mode; chapter bookmarks; per-manga reader settings and scanlator preferences; global search and source migration.
- **Downloads & updates:** CBZ/folder downloads with a managed queue, download ahead, delete after reading and a size limit; the library update checker with the Updates page, notifications and auto-download; tray, start at login, offline mode; installers with auto-update.

See the [roadmap in `BRAINSTORM.md` §11](BRAINSTORM.md), the phase plans in [`docs/plans/`](docs/plans), the [changelog](CHANGELOG.md) and the [architecture decisions](docs/adr/README.md). Next: the extension ecosystem (Phase 4).

## Development

Requirements: [pnpm](https://pnpm.io) 12 and Node 24 LTS (`pnpm env use --global lts`), plus a C/C++ toolchain and Python for native modules.

```sh
pnpm install      # also downloads Electron and rebuilds better-sqlite3 for it
pnpm dev          # start the app with hot reload
pnpm lint         # ESLint
pnpm typecheck    # TypeScript (all packages)
pnpm test         # Vitest
pnpm e2e          # Playwright end-to-end tests of the built app (fake local site, no network)
pnpm dist:linux   # build an AppImage into apps/desktop/release/ (pnpm dist: this OS's installers)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request, and [`SECURITY.md`](SECURITY.md) to report a vulnerability.

Writing an extension? See [`docs/extensions.md`](docs/extensions.md).

Project layout:

```
apps/desktop/          Electron app (main, preload, React renderer)
packages/shared/       Domain types and the typed IPC contract
packages/extension-sdk/      Extension author SDK (MIT)
packages/extension-runtime/  QuickJS sandbox host (MIT)
packages/extension-cli/      mr-ext: create, build, test, bench extensions (MIT)
extensions/mangadex/   Built-in MangaDex extension
docs/extensions.md     Extension authoring guide
docs/adr/              Architecture decision records
docs/ui/               UI mockups (design source of truth)
```

## License

[GPL-3.0](LICENSE). The extension SDK, runtime and CLI (`packages/extension-*`) and the built-in extensions are [MIT](packages/extension-sdk/LICENSE).
