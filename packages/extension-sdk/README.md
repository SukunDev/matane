# @matane/extension-sdk

Types and helpers for writing extensions for [Matane](https://github.com/SukunDev/matane), the open-source desktop manga reader. Extensions are small TypeScript bundles that run in Matane's sandbox (QuickJS): no Node.js APIs, no file access, and all network access through the app (http and https only, with rate limits).

```sh
npx @matane/extension-cli create my-site --domain my-site.example
```

```ts
import { defineExtension } from '@matane/extension-sdk';

export default defineExtension({
  createSource: () => ({
    baseUrl: 'https://my-site.example',
    async getPopular(page) {
      const doc = html.load((await http.get(`https://my-site.example/popular?page=${page}`)).body);
      return {
        items: doc.select('.card').map((el) => ({ url: el.attr('href')!, title: el.text() })),
        hasNextPage: false,
      };
    },
    // search, getMangaDetails, getChapters, getPages…
  }),
});
```

- `@matane/extension-sdk`: `defineExtension`, the data types (`Source`, `MangaDetails`, `Chapter`, `Page`, filters, preferences, `ImageTransform`) and the SDK errors.
- `@matane/extension-sdk/globals`: types of the sandbox globals (`http`, `html`, `storage`, `prefs`, `log`, `crypto`, `base64`, `utf8`, `timers`, `host`). Add `import '@matane/extension-sdk/globals'` to a `.d.ts` file of your extension.
- For sites on the Madara or MangaThemesia themes, see [`@matane/extension-templates`](https://www.npmjs.com/package/@matane/extension-templates).
- `@matane/extension-sdk/manifest` and `/repo`: the `manifest.json` and repository index schemas (tooling and the app).

The full guide: [the extension guide](https://sukundev.github.io/matane/extensions/). MIT.
