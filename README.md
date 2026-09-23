# MangaReader

> Working name. Pre-alpha — nothing to read yet.

An open-source desktop manga reader (Windows, macOS, Linux) with a sandboxed extension system, library, reading progress, downloads and update checks — think Mihon, for the desktop.

**Disclaimer:** this application does not host or distribute any content. Sources are provided by extensions; the main repository only ships extensions for services that allow it.

## Status

Phase 0 (foundation) is in place: Electron shell with the Catppuccin UI, typed IPC, SQLite schema and migrations, EN/ID translations. See the [roadmap in `BRAINSTORM.md` §11](BRAINSTORM.md) and the [Phase 0 plan](docs/plans/fase-0-fondasi.md).

## Development

Requirements: [pnpm](https://pnpm.io) 12 and Node 24 LTS (`pnpm env use --global lts`), plus a C/C++ toolchain and Python for native modules.

```sh
pnpm install      # also downloads Electron and rebuilds better-sqlite3 for it
pnpm dev          # start the app with hot reload
pnpm lint         # ESLint
pnpm typecheck    # TypeScript (all packages)
pnpm test         # Vitest
```

Project layout:

```
apps/desktop/          Electron app (main, preload, React renderer)
packages/shared/       Domain types and the typed IPC contract
packages/extension-sdk/      Extension author SDK (MIT) — Phase 1
packages/extension-runtime/  QuickJS sandbox host — Phase 1
docs/adr/              Architecture decision records
docs/ui/               UI mockups (design source of truth)
```

## License

[GPL-3.0](LICENSE). The extension SDK in `packages/extension-sdk` is [MIT](packages/extension-sdk/LICENSE).
