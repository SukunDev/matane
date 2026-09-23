# 3. Extensions run in QuickJS inside a utilityProcess

Status: Accepted (2026-09-23) — implemented in Phase 1

## Context
Community extensions are untrusted code. A `utilityProcess` alone is a full Node process and gives crash isolation, not security.

## Decision
Every extension runs in its own QuickJS (WASM) runtime hosted by one `utilityProcess`. Extensions only see host APIs (`http`, `html`, `storage`, `prefs`, …); network and HTML parsing run in main. Memory/CPU/time limits per runtime. See BRAINSTORM.md §5.

## Consequences
Extension authors write sandbox-safe JS only (no `require`, no Node APIs). HTML parsing must happen host-side because QuickJS is slow.
