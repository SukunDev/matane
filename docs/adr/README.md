# Architecture Decision Records

Short records of decisions that shape the codebase. The full design discussion (Indonesian) lives in [`BRAINSTORM.md`](../../BRAINSTORM.md).

| # | Decision |
|---|---|
| [0001](0001-pnpm-monorepo.md) | pnpm workspaces monorepo |
| [0002](0002-licensing.md) | GPL-3.0 app, MIT extension SDK |
| [0003](0003-quickjs-extension-sandbox.md) | Extensions run in QuickJS inside a utilityProcess |
| [0004](0004-extension-format.md) | Own extension format with a Mihon-like data model |
| [0005](0005-typed-ipc-contract.md) | Typed IPC contract validated with zod |
| [0006](0006-sqlite-drizzle.md) | SQLite via better-sqlite3 and Drizzle |
| [0007](0007-catppuccin-theme.md) | Catppuccin palette |
| [0008](0008-ui-mockups-source-of-truth.md) | `docs/ui/` is the design source of truth |
| [0009](0009-toolchain-pins.md) | Toolchain versions pinned for compatibility |
| [0010](0010-renderer-data-flow.md) | Renderer data flow: TanStack Query for remote and local reads, Zustand for live state |
| [0011](0011-extension-tooling-mit.md) | Extension runtime and CLI are MIT too |
| [0012](0012-html-parsing-in-extension-host.md) | HTML parsing runs in the extension host; network stays in main |
| [0013](0013-built-in-and-dev-extensions.md) | Built-in extensions and extensions loaded from a folder |
| [0014](0014-image-protocol-and-cache.md) | Images are served through `manga://` from a disk cache |
| [0015](0015-chapter-numbers-and-scanlator-versions.md) | Read status per chapter number, one version per number |
| [0016](0016-library-and-custom-covers.md) | Permanent library covers and custom covers |
| [0017](0017-incognito-boundary.md) | What incognito does and does not record |
| [0018](0018-chapter-bookmarks-only.md) | Chapter bookmarks only, like Mihon |
