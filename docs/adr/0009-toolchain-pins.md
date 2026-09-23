# 9. Toolchain versions pinned for compatibility

Status: Accepted (2026-09-23)

## Context
At setup time the newest TypeScript (7.x) was not supported by typescript-eslint (`<6.1`), and electron-vite 5 only supported Vite ≤ 7 while `@vitejs/plugin-react` 6 required Vite 8.

## Decision
Use TypeScript 6.0, Vite 7 with `@vitejs/plugin-react` 5, electron-vite 5, Electron 44, Node 24 LTS (managed by pnpm, pinned in `.node-version`). Revisit when typescript-eslint and electron-vite catch up.

## Notes
electron-vite's `isolatedEntries` crashes when stdout is not a TTY (e.g. CI), so the single-entry preload is bundled with `externalizeDeps: false` instead.
