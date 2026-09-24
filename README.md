# MangaReader

> Working name. Pre-alpha: you can browse MangaDex and read chapters; library and progress come next.

An open-source desktop manga reader (Windows, macOS, Linux) with a sandboxed extension system, library, reading progress, downloads and update checks — think Mihon, for the desktop.

**Disclaimer:** this application does not host or distribute any content. Sources are provided by extensions; the main repository only ships extensions for services that allow it.

## Status

Phases 0 and 1 are done: Electron shell with the Catppuccin UI, typed IPC and SQLite; the QuickJS extension sandbox with MangaDex built in; browse, filters and manga details; and the reader (single, double, webtoon, RTL) with an offline image cache. See the [roadmap in `BRAINSTORM.md` §11](BRAINSTORM.md) and the plans for [Phase 0](docs/plans/fase-0-fondasi.md), [Phase 1](docs/plans/fase-1-extension-membaca.md) and [Phase 2](docs/plans/fase-2-library-progress.md) (next: library & progress).

## Development

Requirements: [pnpm](https://pnpm.io) 12 and Node 24 LTS (`pnpm env use --global lts`), plus a C/C++ toolchain and Python for native modules.

```sh
pnpm install      # also downloads Electron and rebuilds better-sqlite3 for it
pnpm dev          # start the app with hot reload
pnpm lint         # ESLint
pnpm typecheck    # TypeScript (all packages)
pnpm test         # Vitest
pnpm e2e          # Playwright end-to-end tests of the built app (fake local site, no network)
```

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
