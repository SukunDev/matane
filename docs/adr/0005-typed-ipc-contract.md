# 5. Typed IPC contract validated with zod

Status: Accepted (2026-09-23)

## Decision
`packages/shared/src/ipc/contract.ts` declares every renderer→main channel (input/output zod schemas) and main→renderer event. Main validates inputs and rejects untrusted senders (`apps/desktop/src/main/ipc/register.ts`); the sandboxed preload only allowlists channel names from the zod-free `ipc/channels.ts`; the renderer calls `window.api.invoke()` with full typing.

## Consequences
Adding a channel means updating `channels.ts`, `contract.ts` and the handler map — the type checker enforces all three. No `electron-trpc` dependency.
