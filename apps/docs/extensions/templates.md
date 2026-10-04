# Templates (Madara, MangaThemesia)

A lot of manga sites run on one of two WordPress themes, **Madara** and **MangaThemesia**. Their pages share a structure, so writing the same selectors again and again is wasted work. `@matane/extension-templates` holds one source for each theme; an extension for a site on that theme becomes one line of configuration.

## Quick start

```sh
npx @matane/extension-cli create my-site --template madara --domain my-site.example --lang en
cd my-site && npm install
npx mr-ext build
npx mr-ext test
```

`--template` is `html` (the default: selectors written by hand, see [Writing extensions](/extensions/)), `madara` or `mangathemesia`. The scaffold:

```ts
import { defineExtension } from '@matane/extension-sdk';
import { madara } from '@matane/extension-templates';

export default defineExtension({
  createSource: () => madara({ baseUrl: 'https://my-site.example' }),
});
```

The template runs inside the sandbox like any extension: `mr-ext build` bundles it into your `dist/index.js` (about 12 KB), so nothing changes for the app or for the repository you publish to.

## What a template does

Each template returns a complete [`Source`](/extensions/#the-source-interface): `getPopular`, `getLatest`, `search`, `getMangaDetails`, `getChapters`, `getPages`, `imageHeaders` (a `Referer` of the site), `resolveUrl` (pasted links of the site) and `getWebUrl`. Manga and chapters are stored as paths (`/manga/some-title/`), so a site that changes domain only needs a new `baseUrl`.

|                 | Madara                                                                                                              | MangaThemesia                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Listings        | `/manga/page/N/?m_orderby=views` and `latest`                                                                       | `/manga/?page=N&order=popular` and `update`                                 |
| Search          | `/page/N/?s=…&post_type=wp-manga`                                                                                   | `/page/N/?s=…`                                                              |
| Details         | Title, cover, author, artist, genres, status, type, description                                                     | The same, from the info block                                               |
| Chapters        | From the manga's page; when it has none, the theme's `ajax/chapters/` endpoint, then `admin-ajax.php` (older themes) | From the chapter list of the manga's page                                   |
| Pages           | `.reading-content` images, whichever lazy-loading attribute they use                                                | `#readerarea` images, or the images a `ts_reader.run({…})` script hands over |

Dates written as "3 days ago", "yesterday" or a calendar date (English or Indonesian month names) become chapter dates.

## When a site differs

The templates read each theme's **default markup**. Sites change themes, plugins and CSS, so the first `mr-ext test` against a real site may find something missing. Three ways to adapt, from small to big:

**Selectors and paths.** Every CSS selector the template uses is in its config:

```ts
madara({
  baseUrl: 'https://my-site.example',
  listPath: '/series/', // where the archive lives
  popularOrder: 'trending', // m_orderby of the popular listing
  chaptersAjax: 'always', // 'auto' (default), 'always' or 'never'
  selectors: { pageImage: '.chapter-images img' },
});
```

```ts
mangaThemesia({
  baseUrl: 'https://my-site.example',
  listPath: '/comics/',
  popularOrder: 'rating', // `order` of the popular listing
  latestOrder: 'update',
  selectors: { item: '.series-grid .card', chapter: '.chapter-list li' },
});
```

The defaults are exported as `MADARA_SELECTORS` and `MANGATHEMESIA_SELECTORS`.

**One method.** The template returns a plain object, so replace what differs and keep the rest:

```ts
createSource: () => ({
  ...mangaThemesia({ baseUrl: BASE_URL }),
  async getPages(chapter) {
    // the site's own way of listing pages
  },
}),
```

**Extra features.** Filters (`getFilters`), scrambled images (`transformImage`) and `migrateUrl` are not part of the templates; add them next to the template's methods as in [Writing extensions](/extensions/).

## Testing

Test with `mr-ext test` against the real site while you adapt it, and record fixtures for CI as described in [Writing extensions](/extensions/#testing). The templates themselves are tested in the Matane repository against hand-made pages that follow each theme's default markup; they do not contain, or link to, any site.

::: tip You choose the site
A template only knows a theme, not a site. Point it at sites you have the right to read, and publish the extension in a repository of your own ([Publishing a repository](/extensions/repository)).
:::
