# 14. Images are served through `manga://` from a disk cache

Status: Accepted (2026-09-23)

## Context
The renderer must never hotlink images (BRAINSTORM.md §6.5; Example Source also forbids it): requests need the source's headers, session cookies, allowlist and rate limit, and reading should work offline once pages were seen.

## Decision
- A privileged `manga://` scheme is handled in main: `manga://cover/<mangaId>` and `manga://page/<chapterId>/<index>`.
- Images are fetched by main through the extension's network (own rate bucket for images), stored in `userData/cache/images` and indexed in `image_cache`; LRU eviction at 1 GB (becomes a setting later).
- Cache keys: covers by the cover URL (a new cover is a new key; the renderer adds `?v=<hash>` so Chromium does not show a stale one); pages by source + chapter URL + index, **not** the image URL, because some sources (Example@Home) hand out a new server every visit. Cached pages therefore open with no network at all.
- Page lists are cached ~1 h; when the source is unreachable a stale list is used. If a cached image URL has expired (403/404/410), the list is fetched again once.
- After every image fetch the extension's optional `reportImage` hook runs fire-and-forget (Example@Home reporting).

## Consequences
- The CSP allows `img-src manga:` only; `fetch()` to `manga://` stays blocked.
- Concurrent requests for one image share a single fetch; failures surface as HTTP status + `x-error-code` so the reader can offer a retry.
