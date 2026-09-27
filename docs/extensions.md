# Writing extensions

> Draft for extension API version **1** (Phase 1). Repositories, signing and installing from a URL arrive in Phase 4; until then extensions are either built in (`extensions/*`) or loaded from a folder.

An extension is a small JavaScript bundle plus a `manifest.json`. It turns a website into one or more **sources**: lists of manga, details, chapters and page images. Extensions run in a **QuickJS sandbox** (ADR 0003): no Node.js, no `fetch`, no DOM. Everything that touches the outside world goes through a few host APIs (`http`, `html`, `storage`, …) that the app controls.

The SDK (`@manga-reader/extension-sdk`), the runtime and the `mr-ext` CLI are MIT-licensed (ADR 0011), so your extension can use any license.

## Quick start

```sh
pnpm exec mr-ext create my-site --domain example.com --lang en --dir extensions
cd extensions/my-site
pnpm install
pnpm exec mr-ext build           # → dist/index.js + dist/manifest.json
pnpm exec mr-ext test            # popular → details → chapters → pages → first image, against the real site
```

Try it in the app: **Settings → Advanced → Load from folder** and pick the extension folder. The app watches `dist/` and reloads the extension every time `mr-ext build` rewrites it. A folder that is not built yet is listed with an error until you build it.

## Project layout

```
my-site/
├─ manifest.json      # identity, allowlist, sources
├─ icon.png           # optional, square, at most 512 KB (shown in the app and repositories)
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ env.d.ts        # import '@manga-reader/extension-sdk/globals' (types for http, html, …)
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
import { type MangaPage, defineExtension } from '@manga-reader/extension-sdk';

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

These globals are the only way out of the sandbox (types come from `@manga-reader/extension-sdk/globals`):

| Global | API |
|---|---|
| `http` | `request({ url, method, headers, body, responseType })` never throws on status; `get(url, opts)` / `post(url, body, opts)` throw `HttpError` for non-2xx. `body` is a string, `{ json }` or `{ form }`; `responseType` is `text` (default), `json` or `bytes` (base64). |
| `html` | `html.load(body, { baseUrl, xml })` → element with `select(css)`, `selectFirst(css)`, `text()`, `html()`, `attr(name)`, `absUrl(name)`. Parsing happens on the host (cheerio); handles are only valid during the current call. |
| `storage` | `get/set/remove` of JSON values, per extension, persisted (tokens, cached tag lists). |
| `prefs` | `prefs.get(key)`: current value of a preference (default applied). |
| `log`, `console` | Messages go to the app log (`[ext] [my-site] …`). |
| `crypto`, `base64`, `utf8` | `md5/sha1/sha256` (hex), encode/decode helpers. |
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

- `mr-ext test [dir]`: runs the reading flow against the real site and prints a summary. Options: `-s <source>`, `-q <query>`, `-u <web url>` (tests `resolveUrl`), `--pref key=value`, `--filter id=value`, `--no-image`, `-v` (every request).
- **Fixture tests** (what CI runs): use `createFixtureHost` from `@manga-reader/extension-cli` with Vitest; `MR_RECORD=1 pnpm test` records missing responses into `test/fixtures/`, later runs replay them without network. See `extensions/mangadex/test/`.
- `mr-ext bench [dir]`: call times (sandbox vs network), heap after each call, and synthetic worst cases. `--fixtures <dir> --manga <url>` makes it repeatable offline.

## Publishing a repository

Extensions reach users through a repository: a static folder (GitHub Pages works) with a signed index.

```
repo/
├─ index.json            # name, extensions (id, version, langs, nsfw, domains, sha256, …)
├─ index.json.sig        # ed25519 signature over the exact bytes of index.json
└─ extensions/
   ├─ my-site-1.0.0.zip  # manifest.json + index.js (+ icon.png), nothing else
   └─ icons/my-site.png
```

```sh
mr-ext repo keygen --out repo-key.pem        # once; prints the public key (ed25519:…)
mr-ext repo build ext/a ext/b -o public --name "My Extensions" --key repo-key.pem
mr-ext repo verify public --public-key ed25519:…   # or a URL: https://you.github.io/repo
```

- **Keep the private key out of git.** In CI, put the PEM in a secret and pass it as `$MR_REPO_KEY` instead of `--key`. `keygen` refuses to overwrite an existing key.
- `repo build` takes extension folders with sources (`src/index.ts`, built and minified) or already built ones (`manifest.json` + `index.js`). It rewrites the output folder completely, and refuses a non-empty folder that is not a repository.
- Builds are reproducible: the same extensions give byte-identical archives and index, so a rebuild only changes what really changed.
- `repo verify` checks what the app checks: the signature, the index, and each archive's size, sha256, contents and manifest (it must match the index). Any problem exits with code 1.
- The app trusts a repository through keys it knows (the official key, or one the user chose to trust); the `publicKey` in `index.json` is only informative. `--unsigned` builds a repository the app will call unverified.

## Being a good citizen

- Follow the site's rules: API terms, rate limits, required `User-Agent` (MangaDex, for example, forbids browser User-Agents and asks for `reportImage` reports).
- Keep `rateLimit` conservative. The app also retries 429/5xx for you, honouring `Retry-After`.
- Do not bypass paywalls or scrape sites that forbid it. Extensions that break these rules will not be accepted into official repositories.
