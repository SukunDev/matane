# Developing Matane

This page is for people who want to build Matane from source, fix something or add a feature. If you only want to read manga, the [README](README.md) and the [user guide](https://sukundev.github.io/matane/) are what you need.

Before opening a pull request, read [`CONTRIBUTING.md`](CONTRIBUTING.md) (rules and checks) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Project layout](#project-layout)
- [How the app fits together](#how-the-app-fits-together)
- [Testing](#testing)
- [Translations](#translations)
- [Writing an extension](#writing-an-extension)
- [Documentation site](#documentation-site)
- [Building installers](#building-installers)
- [Releases and packaging](#releases-and-packaging)
- [Design decisions and plans](#design-decisions-and-plans)

## Requirements

- [pnpm](https://pnpm.io) 12 (the exact version is pinned in `packageManager` in `package.json`)
- Node 24 LTS (see `.node-version`; `pnpm env use --global lts` installs it)
- A C/C++ toolchain and Python, because `better-sqlite3` is a native module that is rebuilt for Electron
- Linux only, for the end-to-end tests: a display, or `xvfb-run` on a headless machine

## Getting started

```sh
git clone https://github.com/SukunDev/matane.git
cd matane
pnpm install      # also downloads Electron and rebuilds better-sqlite3 for it
pnpm dev          # starts the app with hot reload
```

The app stores its library, settings and cache in the normal app data folder (`~/.config/Matane`, `%APPDATA%\Matane`, `~/Library/Application Support/Matane`). To keep a development build away from your real library on Linux, start it with another profile folder, for example `XDG_CONFIG_HOME=/tmp/matane-dev pnpm dev`.

Matane ships without any extension, so a fresh development profile has no sources. Add an extension repository from **Extensions** in the app, or build your own (see [Writing an extension](#writing-an-extension)).

## Commands

Run these from the repository root.

| Command                                     | What it does                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                                  | Start the desktop app with hot reload                                      |
| `pnpm build`                                | Build every package                                                        |
| `pnpm lint`                                 | ESLint (includes a rule that rejects literal strings in JSX)               |
| `pnpm format` / `pnpm format:check`         | Prettier, write or check                                                   |
| `pnpm typecheck`                            | TypeScript for every package                                               |
| `pnpm test`                                 | Unit tests (Vitest) in every package                                       |
| `pnpm e2e`                                  | Playwright end-to-end tests of the built app (fake local site, no network) |
| `pnpm dist`                                 | Build installers for the current OS into `apps/desktop/release/`           |
| `pnpm dist:linux`                           | Build a Linux AppImage into `apps/desktop/release/`                        |
| `pnpm --filter @manga-reader/desktop bench` | Benchmark script in `apps/desktop/scripts/bench`                           |
| `pnpm --filter @manga-reader/docs dev`      | Run the documentation site locally                                         |

The checks CI runs on every push and pull request (`.github/workflows/ci.yml`):

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm e2e
```

## Project layout

```
apps/
  desktop/                     Electron app (package @manga-reader/desktop)
    src/main/                  Main process: db, library, reading, downloads, extensions,
                               images, network, backup, stats, ipc, app (window, tray, updater)
    src/preload/               Sandboxed preload; exposes window.api to the renderer
    src/renderer/src/          React UI: routes, features, components, stores, i18n, theme
    src/extension-host/        Runs the extension sandbox in its own process
    e2e/                       Playwright specs; e2e/support has the fake site and app launcher
    drizzle/                   SQL migrations (Drizzle ORM, SQLite)
    scripts/bench/             Benchmarks
    build-tools/               Build helpers (open source licence list)
    electron-builder.yml       Installer configuration
  docs/                        Documentation site (VitePress): user guide and extension guide
packages/
  shared/                      Domain types and the typed IPC contract (zod)
  extension-sdk/               Types and helpers for extension authors (MIT)
  extension-runtime/           QuickJS sandbox host (MIT)
  extension-cli/               mr-ext: create, build, test, bench and publish extensions (MIT)
packaging/                     AUR and Flathub packages and the scripts that update them
docs/
  adr/                         Architecture decision records
  plans/                       Phase plans
  ui/                          UI mockups (the design source of truth)
  extensions.md                Extension notes
```

The repository is a pnpm workspace (`apps/*` and `packages/*`). The app is GPL-3.0; `packages/extension-*` are MIT so that anyone can write extensions without licence worries ([ADR 0002](docs/adr/0002-licensing.md), [ADR 0011](docs/adr/0011-extension-tooling-mit.md)).

## How the app fits together

**Three Electron layers.** The _main_ process owns everything that touches the machine: the SQLite database, files, network, downloads, notifications, tray and updates. The _renderer_ is a React app (TanStack Router and Query, Tailwind with Catppuccin) and never touches Node directly. A sandboxed _preload_ script is the only bridge.

**Typed IPC.** Every renderer-to-main call and every main-to-renderer event is declared once in `packages/shared/src/ipc/contract.ts` with zod schemas. The main process validates inputs and rejects untrusted senders (`apps/desktop/src/main/ipc/register.ts`); the renderer calls `window.api.invoke()` with full types. To add a channel, update `channels.ts`, `contract.ts` and the handler map in `apps/desktop/src/main/ipc/handlers.ts`; the type checker tells you if you forgot one ([ADR 0005](docs/adr/0005-typed-ipc-contract.md)).

**Database.** SQLite through `better-sqlite3` and Drizzle ORM. Migrations live in `apps/desktop/drizzle/` ([ADR 0006](docs/adr/0006-sqlite-drizzle.md)).

**Extensions.** An extension is a small JavaScript bundle that runs inside a QuickJS sandbox, in a separate Electron `utilityProcess` (`apps/desktop/src/extension-host/`, started from `src/main/extensions/host-client.ts`). It has no direct network or file access; it asks the host to fetch pages and parse HTML, and each website needs the user's permission. Extensions come from signed (ed25519) repositories that the user adds by URL; the app ships none ([ADR 0003](docs/adr/0003-quickjs-extension-sandbox.md), [0004](docs/adr/0004-extension-format.md), [0022](docs/adr/0022-extension-repositories-and-trust.md), [0023](docs/adr/0023-extension-install-lifecycle.md)).

**Images.** Pages are served through a custom protocol with an on-disk cache. Scrambled or encrypted images are rebuilt by an extension's `transformImage` with `sharp`, and the reader crops borders and cuts very tall pages in the background ([ADR 0014](docs/adr/0014-image-protocol-and-cache.md), [0024](docs/adr/0024-image-transform-with-sharp.md), [0025](docs/adr/0025-reader-page-processing.md)).

**UI.** The interface follows the mockups in `docs/ui/` ([ADR 0008](docs/adr/0008-ui-mockups-source-of-truth.md)). Renderer code is grouped by feature in `apps/desktop/src/renderer/src/features/` (library, reader, browse, downloads, updates, statistics and so on), with shared pieces in `components/`.

## Testing

- **Unit tests** (`pnpm test`): Vitest, next to the code as `*.test.ts`. They run in plain Node; `better-sqlite3` is an N-API module, so the same binary works in Node and Electron.
- **End-to-end tests** (`pnpm e2e`): Playwright launches the built app and drives it against a fake local site in `apps/desktop/e2e/support/site.ts`. Nothing touches the network or a real source. `pnpm e2e` builds first. On headless Linux, run `xvfb-run -a pnpm e2e`. To run one spec: `pnpm --filter @manga-reader/desktop exec playwright test e2e/library.spec.ts`.
- CI never uses real sources. Keep new tests the same way.

## Translations

All user-visible text goes through i18next. The strings are in `apps/desktop/src/renderer/src/i18n/locales/`: `en.json` and `id.json`. A lint rule fails the build on literal strings in JSX, so add the key to both files. A new language means a new JSON file there, added to `resources` in `i18n/index.ts` and to `LANGUAGES` in `packages/shared/src/theme.ts`.

## Writing an extension

The extension SDK, runtime and CLI are published on npm as `@matane/extension-sdk`, `@matane/extension-runtime` and `@matane/extension-cli`. This repository does not host any extension; publish yours in a repository of your own.

```sh
mr-ext create      # scaffold a new extension
mr-ext build       # bundle it
mr-ext test        # run it in the same sandbox the app uses
mr-ext bench       # measure it
mr-ext repo keygen # make a signing key for a repository
mr-ext repo build  # build and sign a repository
mr-ext repo verify # check a repository
```

The full walkthrough, with the API reference, is the [extension guide](https://sukundev.github.io/matane/extensions/) (source in `apps/docs/extensions/`).

## Documentation site

`apps/docs` is a [VitePress](https://vitepress.dev) site with the user guide (`guide/`) and the extension guide (`extensions/`). It is published to <https://sukundev.github.io/matane/> by `.github/workflows/docs.yml` when something under `apps/docs/` changes on `main`.

```sh
pnpm --filter @manga-reader/docs dev       # live preview
pnpm --filter @manga-reader/docs build     # production build
```

## Building installers

`electron-builder` is configured in `apps/desktop/electron-builder.yml`.

```sh
pnpm dist:linux   # AppImage into apps/desktop/release/
pnpm dist         # this OS's installers: exe and portable on Windows, dmg on macOS, AppImage/deb/rpm/tar.gz on Linux
```

Builds are not code-signed yet. How the app learns it was installed through a package manager, and what it does about updates in each case, is in [ADR 0021](docs/adr/0021-packaging-and-auto-update.md).

## Releases and packaging

Maintainers update `CHANGELOG.md` and the version in `apps/desktop/package.json`, then push a tag `vX.Y.Z` (or `vX.Y.Z-beta.N`). `.github/workflows/release.yml` builds every OS and publishes the GitHub release. The extension packages are published to npm separately, by pushing a tag like `sdk-v0.1.0` (`.github/workflows/publish-sdk.yml`).

Two Linux packages live outside GitHub releases and are submitted by hand after each release: the AUR package `matane-bin` and the Flathub app `dev.sukun.matane`. The steps are in [`packaging/README.md`](packaging/README.md).

## Design decisions and plans

- [Architecture decision records](docs/adr/README.md): why things are the way they are. Bigger decisions get an ADR; copy the format of an existing one.
- [`docs/plans/`](docs/plans): the phase plans.
- [`docs/BRAINSTORM.md`](docs/BRAINSTORM.md): the original product notes and roadmap (§11).
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version.
