# 3. Extensions run in QuickJS inside a utilityProcess

Status: Accepted (2026-09-23) — implemented in Phase 1

## Context
Community extensions are untrusted code. A `utilityProcess` alone is a full Node process and gives crash isolation, not security.

## Decision
Every extension runs in its own QuickJS (WASM) runtime hosted by one `utilityProcess`. Extensions only see host APIs (`http`, `html`, `storage`, `prefs`, …); network runs in main and HTML parsing in the extension host ([ADR 0012](0012-html-parsing-in-extension-host.md)). Memory/CPU/time limits per runtime. See docs/BRAINSTORM.md §5.

## Consequences
Extension authors write sandbox-safe JS only (no `require`, no Node APIs). HTML parsing must happen host-side because QuickJS is slow.

## Update: limits after the Phase 1 benchmark (2026-09-23)
Measured with `mr-ext bench` (Example Source, recorded fixtures and live, 5–9 runs; Node 24, QuickJS via quickjs-emscripten 0.32):

| Case | Sandbox time p50 / p95 | Heap needed |
|---|---|---|
| Example Source calls (popular, details, chapters, pages), live | ≤ 11 / 24 ms; wall time is network (p95 ≈ 0.5 s) | < 1 MB |
| Synthetic: 2.9 MB JSON feed → 10k chapters | 237 / 242 ms | ≤ 4 MB |
| Synthetic: 1 MB HTML, 3k cards → 9k `html` bridge calls | 608 / 798 ms | ≤ 2 MB |
| Synthetic: 5M-iteration CPU loop | 334 / 338 ms | ≤ 2 MB |
| Creating a runtime | 5 ms (first one ~45 ms incl. WASM init) | 0.1 MB |

**Final limits (unchanged): 64 MB heap, 2 s of uninterrupted synchronous code, 30 s per call (60 s for `getChapters`).** The worst realistic case uses ~6 % of the heap and ~40 % of the CPU budget; network-bound calls stay far below the timeouts. QuickJS is roughly 50–60× slower than V8 on tight loops, which confirms keeping HTML parsing out of the sandbox.

The benchmark also found a quickjs-emscripten 0.32 bug: when a promise job grows WASM memory, `executePendingJobs` reads a detached typed-array view and creates a stray context that makes `dispose()` abort. The runtime disposes such contexts after every job run (regression test in `runtime.test.ts`).
