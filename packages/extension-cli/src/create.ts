import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SDK_API_VERSION } from '@matane/extension-sdk';
import { CLI_VERSION } from './node-host.js';

/**
 * Where the extension lives: on its own (dependencies from npm, a complete tsconfig), or inside a
 * pnpm workspace whose root has `tsconfig.base.json` (matane-extensions: `catalog:` versions; the
 * Matane monorepo itself: `workspace:*`).
 */
export type CreateLayout = 'standalone' | 'catalog' | 'workspace';

export interface CreateOptions {
  id: string;
  name?: string;
  domain?: string;
  lang?: string;
  layout?: CreateLayout;
}

/** A tsconfig for an extension outside any workspace (same rules as the Matane packages). */
const STANDALONE_TSCONFIG = {
  compilerOptions: {
    target: 'ES2020',
    lib: ['ES2020'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    types: [],
    strict: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src'],
};

/** Scaffolds an HTML-scraping extension in `<parent>/<id>`. */
export async function createExtension(parent: string, options: CreateOptions): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.id)) throw new Error('id must use lowercase letters, digits and dashes');
  const dir = path.resolve(parent, options.id);
  const existing = await readdir(dir).catch(() => []);
  if (existing.length > 0) throw new Error(`${dir} already exists and is not empty`);

  const name = options.name ?? options.id;
  const domain = options.domain ?? 'example.com';
  const lang = options.lang ?? 'en';
  const layout = options.layout ?? 'standalone';
  const dependency = layout === 'standalone' ? `^${CLI_VERSION}` : layout === 'catalog' ? 'catalog:' : 'workspace:*';
  const files: Record<string, string> = {
    'manifest.json': json({
      id: options.id,
      name,
      version: '0.1.0',
      apiVersion: SDK_API_VERSION,
      nsfw: false,
      domains: [domain],
      rateLimit: { requests: 2, perMs: 1000 },
      sources: [{ key: lang, lang, name }],
    }),
    'package.json': json({
      name: options.id,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { build: 'mr-ext build', test: 'mr-ext test', typecheck: 'tsc -p tsconfig.json' },
      devDependencies: {
        '@matane/extension-cli': dependency,
        '@matane/extension-sdk': dependency,
        ...(layout === 'standalone' ? { typescript: '^6.0.0' } : {}),
      },
    }),
    'tsconfig.json': json(
      layout === 'standalone'
        ? STANDALONE_TSCONFIG
        : { extends: '../../tsconfig.base.json', compilerOptions: { lib: ['ES2020'], types: [] }, include: ['src'] },
    ),
    'src/env.d.ts':
      "// Sandbox globals (http, html, storage, prefs, …) injected by the host.\nimport '@matane/extension-sdk/globals';\n",
    'src/index.ts': template(domain),
    '.gitignore': 'node_modules/\ndist/\n# Pages restored by transformImage during `mr-ext test`\n.mr-ext/\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const template = (
  domain: string,
) => `import { type MangaPage, type HtmlElement, defineExtension } from '@matane/extension-sdk';

const BASE_URL = 'https://${domain}';

function parseList(doc: HtmlElement): MangaPage {
  const items = doc.select('.manga-card').map((card) => ({
    url: card.selectFirst('a')?.attr('href') ?? '',
    title: card.selectFirst('.title')?.text().trim() ?? '',
    thumbnailUrl: card.selectFirst('img')?.absUrl('src'),
  }));
  return { items, hasNextPage: doc.selectFirst('.pagination .next') !== null };
}

async function load(path: string): Promise<HtmlElement> {
  const response = await http.get(BASE_URL + path);
  return html.load(response.body as string, { baseUrl: BASE_URL });
}

export default defineExtension({
  createSource: () => ({
    baseUrl: BASE_URL,

    async getPopular(page) {
      return parseList(await load(\`/popular?page=\${page}\`));
    },

    async search(query, page) {
      return parseList(await load(\`/search?q=\${encodeURIComponent(query)}&page=\${page}\`));
    },

    async getMangaDetails(manga) {
      const doc = await load(manga.url);
      return {
        ...manga,
        title: doc.selectFirst('h1')?.text().trim() ?? manga.title,
        description: doc.selectFirst('.description')?.text().trim(),
        genres: doc.select('.genres a').map((a) => a.text().trim()),
        status: 'unknown',
      };
    },

    async getChapters(manga) {
      const doc = await load(manga.url);
      return doc.select('.chapters a').map((a) => ({ url: a.attr('href') ?? '', name: a.text().trim() }));
    },

    async getPages(chapter) {
      const doc = await load(chapter.url);
      return doc.select('.reader img').map((img, index) => ({ index, imageUrl: img.absUrl('src') }));
    },
  }),
});
`;
