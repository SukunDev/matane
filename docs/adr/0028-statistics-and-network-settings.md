# 28. Statistics from reading sessions; network settings applied everywhere

Status: Accepted (2026-10-02)

## Context
Phase 5 adds the statistics page (BRAINSTORM.md §6.3, mockup 14) and Settings → Network (§6.5): DNS-over-HTTPS, a proxy and a custom User-Agent, which matter most where ISPs block sites through DNS.

## Decision
- **What counts as read**: a chapter marked read *and* opened in a reading session. Marking a list read, migration and the per-number read status of other scanlator versions add nothing; incognito records no session, so it counts nothing either. Reading time is the sessions' active time (idle gaps excluded, ADR 0017).
- **Computed in main on demand** (`stats.overview`): sessions of the period by the indexed `started_at`, finished chapters through the distinct chapter ids of the sessions, then grouped in JavaScript by local day or month. 1,000 manga, 50,000 chapters and 20,000 sessions take about 90 ms. No cache: sessions send no change events, the page asks again when it opens. Clearing statistics deletes the sessions only.
- **One measure per chart**: chapters *or* hours per bucket, switched by a toggle, on one axis (the mockup's bars-plus-line on two scales is the classic misleading chart). Every chart has a tooltip and a table view; the sources breakdown uses the first four slots of a categorical palette validated for colour-blind separation in both schemes, the rest as "Other".
- **DNS-over-HTTPS** is app-wide (`app.configureHostResolver`); without a usable server it stays off. Custom servers must be https and are kept as typed (DoH templates).
- **Proxy everywhere**: `app.setProxy` (requests without a session), the default session, and every `persist:ext-*` session, including ones created later (the first request of a new session waits for its proxy). Open connections are closed so a change applies at once. Chromium skips loopback addresses; tests turn that off (`MATANE_E2E_PROXY_LOOPBACK`).
- **Proxy password**: kept in main only, `enc:` with `safeStorage`, or `plain:` where the system has no keyring (common on Linux window managers), which the settings page states. It answers the `login` event of `net.request` (extension traffic) and `app` (Cloudflare windows), only for proxy challenges.
- **User-Agent**: a global one replaces the browser default for sessions and extension requests; an extension's own User-Agent still wins.

## Consequences
- The app's own requests through `net.fetch` (repositories, update checks) use the proxy but cannot answer a proxy password; an authenticating proxy works for sources, images and Cloudflare.
- "Test connection" loads Example Source's ping endpoint, so it fails where Example Source itself is blocked: that is the point of the test.
