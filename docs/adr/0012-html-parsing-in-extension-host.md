# 12. HTML parsing runs in the extension host; network stays in main

Status: Accepted (2026-09-23), amends [0003](0003-quickjs-extension-sandbox.md)

## Context
ADR 0003 put both networking and HTML parsing in main. While implementing Phase 1, `html` turned out to be a synchronous, very chatty API: every `select`, `text()` and `attr()` is a host call (a 3k-card listing makes ~9k calls). Routing each of those through the main process would add two IPC hops per call and block main's event loop with cheerio work.

## Decision
- **HTML parsing** (cheerio) runs inside the extension host utilityProcess, next to QuickJS. `html.load` returns a handle; DOM objects stay host-side and are dropped when the extension call ends.
- **Networking** stays in main (`ExtensionFetcher` on `net.request` with a per-extension session): http(s) only, checked on every redirect hop (the domain allowlist this ADR first described was dropped, see [0031](0031-no-domain-allowlist.md)), token-bucket rate limit, retries honouring `Retry-After`, Cloudflare challenges solved in a window that shares the session and User-Agent.
- Storage, preferences and logging are also served by main over the host ↔ main RPC.

## Consequences
- Main never parses untrusted HTML; a pathological page can at worst stall the extension host, which is restartable (calls in flight fail with `host_crashed`).
- Benchmark (ADR 0003 update): 9k bridge calls take ~0.6 s of sandbox time in-process, which would be far slower across IPC.
- Electron's `net.fetch` rejects `redirect: 'manual'` ("Redirect was cancelled"), so the fetcher uses `net.request` and its `redirect` event to see each hop.
