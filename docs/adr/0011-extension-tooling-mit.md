# 11. Extension runtime and CLI are MIT too

Status: Accepted (2026-09-23), extends [0002](0002-licensing.md)

## Context
ADR 0002 made only `extension-sdk` MIT. Extension authors also run `packages/extension-runtime` (the QuickJS sandbox) and `packages/extension-cli` (`mr-ext create/build/test/bench`) on their own machines, and other apps may want to host the same extensions. Under GPL, merely bundling the CLI into an extension's dev tooling would raise licensing questions for authors who want a different license.

## Decision
`extension-sdk`, `extension-runtime` and `extension-cli` are MIT (each package has its own `LICENSE`). The app (`apps/desktop`) and `packages/shared` stay GPL-3.0-only. Built-in extensions in `extensions/*` are MIT as well.

## Consequences
- MIT code may flow into the app, never the other way: the runtime must not import from `apps/desktop` or `packages/shared` (it does not; it only depends on the SDK).
- The runtime is embeddable by other hosts; the app-specific parts (network layer, Cloudflare, SQLite, IPC) live in the GPL app.
