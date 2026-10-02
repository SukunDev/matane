# Writing extensions

> Extension API version **1**. Users install extensions from signed repositories (Extensions → Repositories), developers load them from a folder.
>
> **Not on npm yet:** the `@matane/*` packages are ready (`pnpm pack` builds them) but are published together with the official repository, after the app's remaining phases ([Milestone 4f](https://github.com/SukunDev/matane/blob/main/docs/plans/fase-4-ekosistem-extension.md)). Until then, develop inside this repository (`extensions/<id>`, with `--layout workspace`).

An extension is a small JavaScript bundle plus a `manifest.json`. It turns a website into one or more **sources**: lists of manga, details, chapters and page images. Extensions run in a **QuickJS sandbox** (ADR 0003): no Node.js, no `fetch`, no DOM. Everything that touches the outside world goes through a few host APIs (`http`, `html`, `storage`, …) that the app controls.

The SDK (`@matane/extension-sdk`), the runtime and the `mr-ext` CLI are MIT-licensed (ADR 0011), so your extension can use any license.

## Quick start

With the packages from npm (once published):

```sh
npx @matane/extension-cli create my-site --domain example.com --lang en
cd my-site
npm install
npx mr-ext build                 # → dist/index.js + dist/manifest.json
npx mr-ext test                  # popular → details → chapters → pages → first image, against the real site
```

Inside this repository (or a workspace such as matane-extensions), pick the layout that matches: `--layout workspace` here (dependencies `workspace:*`), `--layout catalog` in matane-extensions (versions from the workspace catalog). Both extend the root `tsconfig.base.json`; the default `standalone` layout writes a complete `tsconfig.json`.

```sh
pnpm exec mr-ext create my-site --domain example.com --lang en --dir extensions --layout workspace
pnpm install && pnpm --filter my-site exec mr-ext build
```

Try it in the app: **Extensions → Load from folder** (or Settings → Advanced) and pick the extension folder. The app watches `dist/` and reloads the extension every time `mr-ext build` rewrites it; **View logs** on its row shows its log lines, requests and failed calls live. A folder that is not built yet is listed with an error until you build it.

`mr-ext test` also accepts an already built folder (`manifest.json` + `index.js`).

## Project layout

```
my-site/
├─ manifest.json      # identity, allowlist, sources
├─ icon.png           # optional, square, at most 512 KB (shown in the app and repositories)
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ env.d.ts        # import '@matane/extension-sdk/globals' (types for http, html, …)
   └─ index.ts        # export default defineExtension({ … })
```

`mr-ext build` bundles `src/index.ts` with esbuild into a single ES2020 script. Dependencies are bundled too, as long as they do not need Node.js (`fs`, `Buffer`, …); the build fails if anything is left unresolved.

## manifest.json

```json
{
  "id": "my-site",
  "name": "My Site",
  "version": "1.0.0",
  "apiVersion": 1,
  "nsfw": false,
  "domains": ["example.com", "*.cdn-example.net"],
  "rateLimit": { "requests": 2, "perMs": 1000 },
  "sources": [{ "key": "en", "lang": "en", "name": "My Site" }]
}
```

| Field | Notes |
|---|---|
| `id` | Lowercase letters, digits, dashes. **Never changes** and never contains a language. |
| `version` | Semver. Bump it on every release. |
| `description` | Optional, one line (max 200 characters) for the Extensions page. |
| `apiVersion` | Extension API version the bundle targets. The app refuses newer ones. |
| `domains` | Allowlist for every request, **including every redirect hop and every image**. `*.cdn.net` matches subdomains only; list the bare domain separately if needed. |
| `rateLimit` | Requests per window for API/page calls (default 10/s). Images use a separate, looser bucket. |
| `sources` | One per language/variant. The source id is `<extension id>/<key>`, e.g. `my-site/en`. |

## The source interface

```ts
import { type MangaPage, defineExtension } from '@matane/extension-sdk';

export default defineExtension({
  preferences: () => [{ type: 'switch', key: 'hd', label: 'HD images', default: true }],
  createSource: (info) => ({            // info = { key, lang, name } from the manifest
    baseUrl: 'https://example.com',
    async getPopular(page) { … },       // → MangaPage
    async search(query, page, filters) { … },
    async getMangaDetails(manga) { … }, // → MangaDetails
    async getChapters(manga) { … },     // → Chapter[], newest first
    async getPages(chapter) { … },      // → Page[]
  }),
});
```

Required: `getPopular`, `search`, `getMangaDetails`, `getChapters`, `getPages`. Optional:

| Method | Used for |
|---|---|
| `getLatest(page)` | The "Latest" tab (hidden when missing). |
| `getFilters()` | The filter panel; see below. May be async (e.g. load tags once and cache them in `storage`). |
| `getImageUrl(page)` | Pages that only have a `url` and need another request to find the image. |
| `imageHeaders()` | Extra headers for images (`Referer`, or your own `User-Agent`). |
| `resolveUrl(url)` | "Open from URL": map a pasted web link to `{ url, title }`, or `null`. Synchronous and offline. |
| `getWebUrl(item)` | "Open in browser" for a manga or chapter. Defaults to `baseUrl + url`. |
| `reportImage(result)` | Called after every image fetch (`{ url, success, bytes, durationMs, cached }`), fire-and-forget. |

### Data rules

- **`url` is the identity** of a manga or chapter within a source. Keep it stable: prefer a path relative to `baseUrl` (so a domain move does not break libraries) or an id. Changing it orphans users' libraries and progress.
- Chapters are returned **newest first**. Set `number` when you know it (it drives next/previous chapter and "missing chapter" warnings), `scanlator` when the site has groups, and `uploadedAt` as epoch milliseconds (`parseRelativeDate` from the SDK handles "3 hours ago" / "3 jam lalu").
- `MangaDetails.type` (`manga`, `manhwa`, `manhua`, `comic`) picks the default reading mode: manhwa/manhua open as a webtoon strip, manga right-to-left.
- Page `index` starts at 0. Give each page an `imageUrl`, or a `url` plus `getImageUrl`.
- Everything returned is validated by the app. Malformed optional fields are dropped; missing required ones fail the call with a "parse" error that the user sees.

## Host APIs

These globals are the only way out of the sandbox (types come from `@matane/extension-sdk/globals`):

| Global | API |
|---|---|
| `http` | `request({ url, method, headers, body, responseType })` never throws on status; `get(url, opts)` / `post(url, body, opts)` throw `HttpError` for non-2xx. `body` is a string, `{ json }` or `{ form }`; `responseType` is `text` (default), `json` or `bytes` (base64). |
| `html` | `html.load(body, { baseUrl, xml })` → element with `select(css)`, `selectFirst(css)`, `text()`, `html()`, `attr(name)`, `absUrl(name)`. Parsing happens on the host (cheerio); handles are only valid during the current call. |
| `storage` | `get/set/remove` of JSON values, per extension, persisted (tokens, cached tag lists). |
| `prefs` | `prefs.get(key)`: current value of a preference (default applied). |
| `log`, `console` | Messages go to the app log (`[ext] [my-site] …`) and the extension's log panel (Extensions → ⋮ → View logs), next to every request it makes and every failed call. |
| `crypto` | `md5/sha1/sha256` (hex); `aesDecrypt(data, key, { mode: 'cbc' \| 'ctr' \| 'ecb', iv, padding })` → `Uint8Array`, done by the host (key of 16/24/32 bytes; bytes may be a `Uint8Array`, a number array or a UTF-8 string). |
| `base64`, `utf8` | `encode/decode` for text; `base64.decodeBytes(text)` → `Uint8Array` and `base64.encodeBytes(bytes)` for binary data (e.g. an `http` response with `responseType: 'bytes'`). |
| `timers` | `timers.sleep(ms)` (max 30 s). There is no `setTimeout`. |
| `host` | `{ appName, appVersion, apiVersion }`, e.g. for a descriptive User-Agent. |

Requests use a Chrome-like User-Agent unless you set one (`mr-ext test` sends `mr-ext/<version>` instead). Cookies live in a session private to your extension. Cloudflare challenges are detected and solved by the app (a window appears if the user has to help), after which the request is retried.

### Errors

Throw the SDK's error classes when you can; the app turns them into messages and actions:

| Error | Shown as |
|---|---|
| `NetworkError`, `HttpError(status)` | "Could not reach the source" / "HTTP 503" + Try again |
| `CloudflareError` | "Cloudflare check required" + Verify |
| `RateLimitedError` | "Too many requests" |
| `NotFoundError` | "Not found on the source" |
| `ParseError` | "The source returned something unexpected" (use it when the page layout changed) |

Anything else becomes a generic extension error with your message.

## Scrambled or encrypted images

Some sites encrypt their image files or cut pages into shuffled tiles. Implement `transformImage(page, bytes)`: it receives the fetched bytes of a page and returns **instructions**; the host does the pixel work (decoding pixels in the sandbox would be far too slow).

```ts
transformImage(page, bytes) {
  // 1. Encrypted file: return the real bytes (XOR in JS is fine; use crypto.aesDecrypt for AES).
  const data = crypto.aesDecrypt(bytes, KEY, { mode: 'cbc', iv: IV });
  // 2. Shuffled tiles: say where each rectangle of the (decrypted) image goes.
  const { width, height } = readPngSize(data);
  return { bytes: data, tiles: { width, height, ops: [{ sx: 0, sy: 0, w: 100, h: 100, dx: 100, dy: 0 } /* … */] } };
}
```

- Return `{}` to keep an image as it is; `bytes` and `tiles` can be used alone or together (tiles apply to `bytes` when both are given).
- `tiles.ops` copies rectangles from the source image (`sx`, `sy`, `w`, `h`) to a new `width` × `height` canvas (`dx`, `dy`); rectangles outside either are an error. The result keeps the original format (JPEG, PNG, WebP, AVIF; GIF becomes PNG).
- Only sources that define `transformImage` go through it. Encrypted responses may have any content type; the restored image is checked instead.
- The restored image is what gets cached and downloaded, so reading offline never needs your extension again.
- `mr-ext test` calls it for the first page and writes the restored page to `.mr-ext/<source>-page-1.<ext>` so you can look at it.

## Changing how urls look

`url` values are stored in the user's library, history and downloads, so they must stay stable. When a new version has to change them anyway (the site moved to new ids, or you want a prefix), implement `migrateUrl(url, kind, fromVersion)`:

```ts
migrateUrl(url, kind, fromVersion) {
  if (!fromVersion.startsWith('1.')) return null; // already in the new form
  return kind === 'manga' ? `/series${url}` : `/read${url}`;
}
```

- The host calls it once after the version changes, for every stored manga and chapter of your sources (in batches), and writes all answers in one transaction. If the app closes midway, nothing is changed and it runs again at the next start.
- Return `null` or the same url to keep one; a url that would collide with another row is kept too. Both show in the log panel (`migrateUrl 1.2.0 → 2.0.0: 12 manga and 340 chapters updated, 0 kept`).
- `fromVersion` is the version whose urls are stored, which may be several releases back: handle every older form, and never touch urls that are already new.
- It must be synchronous and fast (it runs under the same CPU limit as other calls).

## Filters and preferences

`getFilters()` returns a list of `header`, `separator`, `text`, `select`, `checkbox`, `tristate`, `sort` and `group` filters; the app renders the panel. The chosen values reach `search(query, page, filters)` as a flat object keyed by filter id, containing **only values that differ from the default** (tri-state: `'include' | 'exclude'`, sort: `{ value, ascending }`). A group whose children are all tri-states renders as chips; all checkboxes, as a two-column grid.

`preferences()` declares extension-wide settings (`switch`, `select`, `multiselect`, `text`). Users change them in **Extensions → ⚙**, and you read them with `prefs.get(key)`.

## Limits

Per extension (ADR 0003, confirmed by the Phase 1 benchmark):

- **64 MB** QuickJS heap.
- **2 s** of synchronous code without awaiting; longer stretches are interrupted.
- **30 s** per call including network (`getChapters`: 60 s).

QuickJS is roughly 50× slower than V8 on tight loops, so keep heavy work (HTML parsing!) in the host APIs. A 3 MB JSON feed with 10k chapters takes ~0.25 s; a 1 MB HTML page with 9k `html` calls ~0.6 s.

## Testing

- `mr-ext test [dir]`: runs the reading flow against the real site and prints a summary. Options: `-s <source>`, `-q <query>`, `-u <web url>` (tests `resolveUrl`), `--pref key=value`, `--filter id=value`, `--no-image`, `--out <dir>` (where a page restored by `transformImage` is written), `-v` (every request).
- **Fixture tests** (what CI runs): use `createFixtureHost` from `@matane/extension-cli` with Vitest; `MR_RECORD=1 pnpm test` records missing responses into `test/fixtures/`, later runs replay them without network. See [`extensions/mangadex/test/`](https://github.com/SukunDev/matane/tree/main/extensions/mangadex/test).
- `mr-ext bench [dir]`: call times (sandbox vs network), heap after each call, and synthetic worst cases. `--fixtures <dir> --manga <url>` makes it repeatable offline.

Ready to share it? See [Publishing a repository](./repository).

## Being a good citizen

- Follow the site's rules: API terms, rate limits, required `User-Agent` (MangaDex, for example, forbids browser User-Agents and asks for `reportImage` reports).
- Keep `rateLimit` conservative. The app also retries 429/5xx for you, honouring `Retry-After`.
- Do not bypass paywalls or scrape sites that forbid it. Extensions that break these rules will not be accepted into official repositories.
