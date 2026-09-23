# 10. Renderer data flow: TanStack Query for remote and local reads, Zustand for live state

Status: Accepted (2026-09-23)

## Context
TanStack Query is built for data owned by someone else: slow, may fail, may change without notice. The renderer sees three kinds of data:

1. **Remote extension data** (browse lists, search, manga details, chapter lists fetched from sources): slow, rate-limited, can fail (network, Cloudflare), paginated. This is exactly TanStack Query's use case: `useInfiniteQuery` + `hasNextPage` for browse, `useQueries` for per-source global search status, request dedup, cancellation, retries.
2. **Local data owned by main** (library, history, chapters, finished downloads, settings, app/window info): the renderer cannot read SQLite directly, so every read is still async IPC that needs loading/error state, dedup and optimistic updates. But main is the source of truth and changes it on its own (update checker, downloads, migration), so time-based staleness is meaningless.
3. **High-frequency, transient state** (download progress, update-check progress, reader state, online status): changes many times per second and is not "fetched" at all.

## Decision
- **Remote data** uses TanStack Query with the global defaults from `createQueryClient()` in `apps/desktop/src/renderer/src/lib/query.ts` (`retry: 2`, no refetch on window focus).
- **Local data** uses TanStack Query as a read cache controlled by main: every such query spreads `localQueryDefaults` (`staleTime: Infinity`, `retry: false`) and is defined next to the others in `lib/ipc.ts`. It never refetches by itself. Main pushes changes over IPC events and the renderer either writes the payload into the cache (`settings.changed`, `window.maximizeChanged`) or invalidates matching keys. From Phase 2, a generic `db.changed` event carries entity tags (for example `{ manga: [12] }`, `{ library: true }`); the tag → query-key mapping lives in one renderer module so invalidation is never scattered.
- **Transient state** lives in Zustand stores fed by IPC events and never enters the TanStack Query cache.

## Consequences
- New queries must pick a category: local ones spread `localQueryDefaults`, remote ones rely on the defaults.
- Any main-side write that can affect a local query must emit an event; forgetting it shows up as stale UI, so write paths should go through repositories that emit `db.changed`.
- Page images never go through TanStack Query; they are served by the `manga://` protocol (BRAINSTORM.md §6.5).
