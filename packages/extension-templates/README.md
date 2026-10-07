# @matane/extension-templates

Ready-made sources for [Matane](https://github.com/mataneorg/matane) extensions that read sites built on two popular WordPress themes: **Madara** and **MangaThemesia**. Each template is one function that returns a complete `Source` (popular, latest, search, details, chapters, pages, pasted links), so an extension is a line of configuration.

```sh
npx @matane/extension-cli create my-site --template madara --domain my-site.example
```

```ts
import { defineExtension } from '@matane/extension-sdk';
import { madara } from '@matane/extension-templates';

export default defineExtension({
  createSource: () => madara({ baseUrl: 'https://my-site.example' }),
});
```

The templates read each theme's default markup. A site that changed it can adjust the CSS selectors and paths in the config, or replace a single method:

```ts
createSource: () => ({
  ...madara({ baseUrl, selectors: { pageImage: '.chapter-images img' } }),
  search: async (query, page) => {
    /* the site's own search */
  },
}),
```

- `madara(config)`: archive listings, `m_orderby`, chapters from the page or the theme's ajax endpoints.
- `mangaThemesia(config)`: `?order=` listings, chapter list, pages from the reader area or the `ts_reader` script.

The templates run inside Matane's sandbox like any extension and are bundled into it by `mr-ext build`. They contain no site: point them at sites you have the right to read. The full guide: [Templates](https://mataneorg.github.io/matane/extensions/templates). MIT.
