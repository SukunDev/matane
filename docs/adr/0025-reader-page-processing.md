# 25. Reader page processing: sizes, border crop and tall-page segments in main

Status: Accepted (2026-10-01)

## Context
The reader measured pages only after the image decoded in the renderer, so a webtoon strip jumped as pages arrived and a saved position inside a long page could only be restored once that page had loaded. Phase 5 adds automatic border crop and splitting very tall pages (docs/BRAINSTORM.md §6.1), both of which need the pixels, and must also work for downloaded chapters read offline.

## Decision
- **Sizes and crop boxes live in `page_meta`**, keyed like the page's cache entry (`page:<sourceId>:<chapter url hash>:<index>`), apart from `image_cache` so pages of downloaded chapters (never cached) have them too. Each row records the byte size of the image it was measured on: a different image under the same key is measured again and its old crops and segments are dropped. The unused `width`/`height`/`segments`/`variants_json` columns of `image_cache` are removed (migration 0004). At most 200 000 rows are kept, least recently read first out; clearing the page cache clears them too.
- **The renderer asks before it shows**: `reader.preparePage` fetches the page (or reads the download), measures it with sharp (EXIF orientation applied), computes the crop box when asked, and returns the size as shown. `reader.pageSizes` returns what is already known for a chapter (no network), so pages read before are laid out at their real size at once.
- **Border crop** (`reader.cropBorders`, off by default, per manga too): margins count when the corners are white (luminance ≥ 225) or black (≤ 30); each side is trimmed while a row or column is margin except for at most 0.5 % of its pixels (JPEG noise). Crops of less than 4 px on every side, or leaving less than a quarter of the page, are not made. Computed in JavaScript over one greyscale decode, so the rule is exact and testable.
- **Tall pages** (`reader.splitTall`, on by default; webtoon and vertical modes only): `pageSegments(width, height)` in `@manga-reader/shared` cuts pages over 5000 px into equal parts of at most 4000 px. Main cuts and the renderer lays out with the same function. A page stays one item for position and progress (the offset is a fraction of the whole page); its segments are stacked `<img>`s with their aspect ratio set, loading lazily as they come near.
- **Variants are cached images**: `manga://page/<chapterId>/<index>[/seg/<n>][?crop=1]` serves `<key>#c0` (cropped), `<key>#s<n>` or `<key>#cs<n>` (segments, all made from one decode), stored in the image cache under the LRU like pages. Made again from the page (or the download) when evicted; the page itself and the download are never changed. The order is `transformImage` (before caching, ADR 0024) → crop → cut.
- Variants keep the page's format: JPEG (q90) and WebP (q90) stay as they are, AVIF/HEIF becomes WebP, the rest PNG.

## Consequences
- Opening a page costs one small IPC round trip before the image request; pages already known need none.
- A crop or segment set takes cache space next to its page; turning crop on doubles the cache use of the pages read with it.
- The crop rule is deliberately conservative (uniform white/black only); coloured margins and page numbers inside the margin stop the trim at that side.
