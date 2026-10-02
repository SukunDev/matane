# Contributing

Thanks for helping! Matane is early (beta), so please open an issue before large changes. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Requirements: [pnpm](https://pnpm.io) 12, Node 24 LTS (`pnpm env use --global lts`), and a C/C++ toolchain with Python for native modules.

```sh
pnpm install      # also downloads Electron and rebuilds better-sqlite3 for it
pnpm dev          # the app with hot reload
```

## Before a pull request

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm e2e
```

- E2E tests run the built app against a fake local site; CI never touches real sources.
- User-visible text goes through i18next (`apps/desktop/src/renderer/src/i18n/locales/en.json` and `id.json`); a lint rule catches literal strings in JSX.
- UI follows the mockups in `docs/ui/` (ADR 0008). Bigger decisions get an ADR in `docs/adr/`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`…).

## Extensions

Source requests and extension code belong in the extension repository (Phase 4). To write one, see the [extension guide](https://sukundev.github.io/matane/extensions/) (source in `apps/docs/extensions/`). The documentation site is `apps/docs` (VitePress: `pnpm --filter @manga-reader/docs dev`).

## Releases

Maintainers tag `vX.Y.Z` (or `vX.Y.Z-beta.N`); `.github/workflows/release.yml` builds every OS and publishes the GitHub release. Update `CHANGELOG.md` and `apps/desktop/package.json` first. `pnpm dist:linux` builds an AppImage locally (`apps/desktop/release/`).

## License

By contributing you agree that your contribution is licensed like the part of the repository it touches: GPL-3.0 for the app, MIT for `packages/extension-*` and the built-in extensions.
