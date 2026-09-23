# 1. pnpm workspaces monorepo

Status: Accepted (2026-09-23)

## Context
The app, the extension SDK, the QuickJS runtime (shared by the app and the `mr-ext` CLI) and shared IPC types must evolve together.

## Decision
One repository with pnpm workspaces: `apps/*`, `packages/*`, `extensions/*`. Workspace packages export TypeScript sources and are bundled by their consumers; no Turborepo until builds get slow.

## Consequences
Cross-package changes land atomically. Electron's main process must bundle (not externalize) `@manga-reader/*` packages — see `apps/desktop/electron.vite.config.ts`.
