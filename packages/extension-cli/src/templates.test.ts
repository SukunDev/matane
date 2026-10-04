import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type HostApi, ExtensionRuntime } from '@matane/extension-runtime';
import type { HttpRequest } from '@matane/extension-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExtension } from './build.js';
import { createExtension } from './create.js';

// The CMS templates run for real: scaffolded with `mr-ext create --template`, bundled, loaded in the
// QuickJS sandbox, and answered by hand-made HTML of each theme's default markup (test/templates/).
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;

const page = (cms: string, name: string) => readFile(path.join(packageDir, 'test/templates', cms, name), 'utf8');

/** What a request returns: HTML by `"METHOD url"`, anything else is a 404. */
type Responses = Record<string, string>;

function host(responses: Responses): HostApi & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async http(request) {
      requests.push(request);
      const body = responses[`${request.method ?? 'GET'} ${request.url}`];
      return { status: body === undefined ? 404 : 200, url: request.url, headers: {}, body: body ?? '' };
    },
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: () => undefined,
  };
}

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Scaffolds, bundles and returns a way to call the source against `responses`. */
async function extension(template: 'madara' | 'mangathemesia', domain: string, edit?: (source: string) => string) {
  const parent = await mkdtemp(path.join(packageDir, '.test-'));
  dirs.push(parent);
  const dir = await createExtension(parent, { id: 'site', domain, lang: 'en', template });
  if (edit) {
    const file = path.join(dir, 'src/index.ts');
    await writeFile(file, edit(await readFile(file, 'utf8')));
  }
  const built = await buildExtension(dir, { write: false });
  return async function open(responses: Responses) {
    const fake = host(responses);
    const runtime = await ExtensionRuntime.create({
      code: built.code,
      manifest: built.manifest,
      host: fake,
      hostInfo: { appName: 'test', appVersion: '0', apiVersion: 1 },
    });
    return {
      requests: fake.requests,
      call: <T>(method: string, ...args: unknown[]) => runtime.call<T>('en', method, args),
      dispose: () => runtime.dispose(),
    };
  };
}

type Items = { items: { url: string; title: string; thumbnailUrl?: string }[]; hasNextPage: boolean };
type Chapters = { url: string; name: string; uploadedAt?: number }[];
type Details = {
  title: string;
  url: string;
  thumbnailUrl?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  status: string;
  type?: string;
};

describe('scaffold', () => {
  it('writes a one-line source on top of the template, with its dependency', async () => {
    const parent = await mkdtemp(path.join(packageDir, '.test-'));
    dirs.push(parent);
    for (const [template, factory] of [
      ['madara', 'madara'],
      ['mangathemesia', 'mangaThemesia'],
    ] as const) {
      const dir = await createExtension(parent, { id: template, domain: 'site.example.org', template });
      const source = await readFile(path.join(dir, 'src/index.ts'), 'utf8');
      expect(source).toContain(`import { ${factory} } from '@matane/extension-templates';`);
      expect(source).toContain("const BASE_URL = 'https://site.example.org';");
      expect(source).toContain(`createSource: () => ${factory}({ baseUrl: BASE_URL })`);
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      };
      expect(manifest.devDependencies).toHaveProperty('@matane/extension-templates');
    }
  });

  it('keeps the plain html scaffold free of the templates package, and refuses unknown templates', async () => {
    const parent = await mkdtemp(path.join(packageDir, '.test-'));
    dirs.push(parent);
    const dir = await createExtension(parent, { id: 'plain' });
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies).not.toHaveProperty('@matane/extension-templates');
    await expect(createExtension(parent, { id: 'odd', template: 'nope' as never })).rejects.toThrow(/template must be/);
  });

  it('uses the layout for the dependency, like the SDK', async () => {
    const parent = await mkdtemp(path.join(packageDir, '.test-'));
    dirs.push(parent);
    const dir = await createExtension(parent, { id: 'ws', template: 'madara', layout: 'workspace' });
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['@matane/extension-templates']).toBe('workspace:*');
  });
});

describe('MangaThemesia', () => {
  const BASE = 'https://mt.example.org';
  let open: Awaited<ReturnType<typeof extension>>;
  beforeAll(async () => {
    open = await extension('mangathemesia', 'mt.example.org');
  });

  it('builds, loads and says what it can do', async () => {
    const source = await open({});
    expect(await source.call('__info')).toEqual({
      baseUrl: BASE,
      capabilities: expect.arrayContaining(['getLatest', 'imageHeaders', 'resolveUrl', 'getWebUrl']),
    });
    source.dispose();
  });

  it('lists popular manga from the archive, once each, with cover and next page', async () => {
    const source = await open({
      [`GET ${BASE}/manga/?page=1&order=popular`]: await page('mangathemesia', 'list.html'),
    });
    const result = await source.call<Items>('getPopular', 1);
    expect(source.requests.map((r) => r.url)).toEqual([`${BASE}/manga/?page=1&order=popular`]);
    expect(result.items).toEqual([
      { url: '/manga/moon-garden/', title: 'Moon Garden', thumbnailUrl: `${BASE}/covers/moon-garden.jpg` },
      { url: '/manga/paper-tigers/', title: 'Paper Tigers', thumbnailUrl: `${BASE}/covers/paper-tigers.jpg` },
    ]);
    expect(result.hasNextPage).toBe(true);
    source.dispose();
  });

  it('lists the latest, and knows the last page', async () => {
    const source = await open({
      [`GET ${BASE}/manga/?page=2&order=update`]: await page('mangathemesia', 'list-last.html'),
    });
    const result = await source.call<Items>('getLatest', 2);
    expect(result.items.map((m) => m.title)).toEqual(['Last One']);
    expect(result.hasNextPage).toBe(false);
    source.dispose();
  });

  it('searches with the query encoded', async () => {
    const url = `${BASE}/page/2/?s=moon%20%26%20garden`;
    const source = await open({ [`GET ${url}`]: await page('mangathemesia', 'list.html') });
    expect((await source.call<Items>('search', 'moon & garden', 2, {})).items).toHaveLength(2);
    expect(source.requests.map((r) => r.url)).toEqual([url]);
    source.dispose();
  });

  it('reads the details of a manga', async () => {
    const source = await open({ [`GET ${BASE}/manga/moon-garden/`]: await page('mangathemesia', 'detail.html') });
    const details = await source.call<Details>('getMangaDetails', { url: '/manga/moon-garden/', title: 'Moon Garden' });
    expect(details).toEqual({
      url: '/manga/moon-garden/',
      title: 'Moon Garden',
      thumbnailUrl: `${BASE}/covers/moon-garden-big.jpg`,
      author: 'Mika Example',
      description: 'A gardener on the moon tends flowers that bloom once a year.',
      genres: ['Fantasy', 'Slice of Life'],
      status: 'ongoing',
      type: 'manhwa',
    });
    source.dispose();
  });

  it('refuses a page that is not a manga', async () => {
    const source = await open({ [`GET ${BASE}/manga/nothing/`]: '<html><body><h1>Oops</h1></body></html>' });
    await expect(source.call('getMangaDetails', { url: '/manga/nothing/', title: 'x' })).rejects.toThrow(
      /not a manga page/,
    );
    source.dispose();
  });

  it('lists chapters newest first, with paths, names and dates of every kind', async () => {
    const source = await open({ [`GET ${BASE}/manga/moon-garden/`]: await page('mangathemesia', 'detail.html') });
    const before = Date.now();
    const chapters = await source.call<Chapters>('getChapters', { url: '/manga/moon-garden/', title: 'Moon Garden' });
    expect(chapters.map((c) => [c.url, c.name])).toEqual([
      ['/moon-garden-chapter-12/', 'Chapter 12'],
      ['/moon-garden-chapter-11/', 'Chapter 11'],
      ['/moon-garden-chapter-10/', 'Chapter 10'],
    ]);
    expect(chapters[0]!.uploadedAt).toBe(Date.UTC(2024, 0, 5));
    expect(Math.abs(chapters[1]!.uploadedAt! - (before - 3 * DAY))).toBeLessThan(60_000);
    expect(chapters[2]!.uploadedAt).toBe(Date.UTC(2023, 0, 5));
    source.dispose();
  });

  it('reads pages from the reader area, preferring lazy attributes and skipping inline placeholders', async () => {
    const source = await open({
      [`GET ${BASE}/moon-garden-chapter-12/`]: await page('mangathemesia', 'chapter-readerarea.html'),
    });
    expect(await source.call('getPages', { url: '/moon-garden-chapter-12/', name: 'Chapter 12' })).toEqual([
      { index: 0, imageUrl: 'https://cdn.example.org/mg/12/001.jpg' },
      { index: 1, imageUrl: 'https://cdn.example.org/mg/12/002.jpg' },
    ]);
    source.dispose();
  });

  it('falls back to the images a script hands to ts_reader', async () => {
    const source = await open({
      [`GET ${BASE}/moon-garden-chapter-11/`]: await page('mangathemesia', 'chapter-script.html'),
    });
    expect(await source.call('getPages', { url: '/moon-garden-chapter-11/', name: 'Chapter 11' })).toEqual([
      { index: 0, imageUrl: 'https://cdn.example.org/mg/11/001.jpg' },
      { index: 1, imageUrl: 'https://cdn.example.org/mg/11/002.jpg' },
      { index: 2, imageUrl: `${BASE}/relative/003.jpg` },
    ]);
    source.dispose();
  });

  it('opens pasted links of its own site, sends a referer and gives web urls', async () => {
    const source = await open({});
    expect(await source.call('resolveUrl', `${BASE}/manga/moon-garden/?utm=1`)).toEqual({
      url: '/manga/moon-garden/',
      title: 'moon garden',
    });
    expect(await source.call('resolveUrl', 'https://other.example.org/manga/x/')).toBeNull();
    expect(await source.call('resolveUrl', `${BASE}/about/`)).toBeNull();
    expect(await source.call('imageHeaders')).toEqual({ Referer: `${BASE}/` });
    expect(await source.call('getWebUrl', { url: '/manga/moon-garden/', title: 'x' })).toBe(
      `${BASE}/manga/moon-garden/`,
    );
    source.dispose();
  });

  it('surfaces a site that is down as an HTTP error', async () => {
    const source = await open({});
    await expect(source.call('getPopular', 1)).rejects.toThrow(/404/);
    source.dispose();
  });
});

describe('Madara', () => {
  const BASE = 'https://md.example.org';
  const MANGA = { url: '/manga/starlight-cafe/', title: 'Starlight Cafe' };
  let open: Awaited<ReturnType<typeof extension>>;
  beforeAll(async () => {
    open = await extension('madara', 'md.example.org');
  });

  it('lists popular manga by views, with lazy covers and next page', async () => {
    const source = await open({ [`GET ${BASE}/manga/page/1/?m_orderby=views`]: await page('madara', 'list.html') });
    const result = await source.call<Items>('getPopular', 1);
    expect(result.items).toEqual([
      { url: '/manga/starlight-cafe/', title: 'Starlight Cafe', thumbnailUrl: `${BASE}/covers/starlight-cafe.jpg` },
      { url: '/manga/iron-lullaby/', title: 'Iron Lullaby', thumbnailUrl: `${BASE}/covers/iron-lullaby.jpg` },
    ]);
    expect(result.hasNextPage).toBe(true);
    source.dispose();
  });

  it('lists the latest, and searches among post types', async () => {
    const source = await open({
      [`GET ${BASE}/manga/page/3/?m_orderby=latest`]: await page('madara', 'list.html'),
      [`GET ${BASE}/page/1/?s=star%20caf%C3%A9&post_type=wp-manga`]: await page('madara', 'search.html'),
    });
    expect((await source.call<Items>('getLatest', 3)).items).toHaveLength(2);
    const found = await source.call<Items>('search', 'star café', 1, {});
    expect(found.items).toEqual([
      { url: '/manga/starlight-cafe/', title: 'Starlight Cafe', thumbnailUrl: `${BASE}/covers/starlight-cafe-s.jpg` },
    ]);
    expect(found.hasNextPage).toBe(false);
    source.dispose();
  });

  it('reads details, without the HOT badge in the title', async () => {
    const source = await open({ [`GET ${BASE}/manga/starlight-cafe/`]: await page('madara', 'detail-inline.html') });
    expect(await source.call<Details>('getMangaDetails', MANGA)).toEqual({
      url: '/manga/starlight-cafe/',
      title: 'Starlight Cafe',
      thumbnailUrl: `${BASE}/covers/starlight-cafe-big.jpg`,
      author: 'Rin Example',
      description: 'A cafe that opens only under starlight.',
      genres: ['Comedy', 'Drama'],
      status: 'completed',
      type: 'manga',
    });
    source.dispose();
  });

  it('reads the chapters printed on the page, with dates from text and from titles', async () => {
    const source = await open({ [`GET ${BASE}/manga/starlight-cafe/`]: await page('madara', 'detail-inline.html') });
    const now = Date.now();
    const chapters = await source.call<Chapters>('getChapters', MANGA);
    expect(chapters.map((c) => [c.url, c.name])).toEqual([
      ['/manga/starlight-cafe/chapter-3/', 'Chapter 3'],
      ['/manga/starlight-cafe/chapter-2/', 'Chapter 2'],
      ['/manga/starlight-cafe/chapter-1/', 'Chapter 1'],
    ]);
    expect(chapters[0]!.uploadedAt).toBe(Date.UTC(2024, 0, 5));
    expect(Math.abs(chapters[1]!.uploadedAt! - (now - 3 * DAY))).toBeLessThan(60_000);
    expect(Math.abs(chapters[2]!.uploadedAt! - (now - DAY))).toBeLessThan(60_000);
    expect(source.requests).toHaveLength(1);
    source.dispose();
  });

  const IRON = { url: '/manga/iron-lullaby/', title: 'Iron Lullaby' };

  it('asks the chapters endpoint when the page has none', async () => {
    const source = await open({
      [`GET ${BASE}/manga/iron-lullaby/`]: await page('madara', 'detail-ajax.html'),
      [`POST ${BASE}/manga/iron-lullaby/ajax/chapters/`]: await page('madara', 'ajax-chapters.html'),
    });
    const chapters = await source.call<Chapters>('getChapters', IRON);
    expect(chapters.map((c) => c.name)).toEqual(['Chapter 2', 'Chapter 1']);
    expect(chapters[1]!.uploadedAt).toBe(Date.UTC(2024, 0, 1));
    const post = source.requests.find((r) => r.method === 'POST')!;
    expect(post.headers).toMatchObject({
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/manga/iron-lullaby/`,
    });
    source.dispose();
  });

  it('falls back to admin-ajax with the manga id for older versions of the theme', async () => {
    const source = await open({
      [`GET ${BASE}/manga/iron-lullaby/`]: await page('madara', 'detail-ajax.html'),
      [`POST ${BASE}/manga/iron-lullaby/ajax/chapters/`]: '',
      [`POST ${BASE}/wp-admin/admin-ajax.php`]: await page('madara', 'ajax-chapters.html'),
    });
    expect((await source.call<Chapters>('getChapters', IRON)).map((c) => c.name)).toEqual(['Chapter 2', 'Chapter 1']);
    expect(source.requests.at(-1)).toMatchObject({
      method: 'POST',
      body: { form: { action: 'manga_get_chapters', manga: '42' } },
    });
    source.dispose();
  });

  it('can be told never to ask ajax, or to go straight to it', async () => {
    const never = await (
      await extension('madara', 'md.example.org', (code) =>
        code.replace(
          'createSource: () => madara({ baseUrl: BASE_URL })',
          "createSource: () => madara({ baseUrl: BASE_URL, chaptersAjax: 'never' })",
        ),
      )
    )({ [`GET ${BASE}/manga/iron-lullaby/`]: await page('madara', 'detail-ajax.html') });
    expect(await never.call('getChapters', IRON)).toEqual([]);
    expect(never.requests).toHaveLength(1);
    never.dispose();

    const always = await (
      await extension('madara', 'md.example.org', (code) =>
        code.replace(
          'createSource: () => madara({ baseUrl: BASE_URL })',
          "createSource: () => madara({ baseUrl: BASE_URL, chaptersAjax: 'always' })",
        ),
      )
    )({
      [`GET ${BASE}/manga/starlight-cafe/`]: await page('madara', 'detail-inline.html'),
      [`POST ${BASE}/manga/starlight-cafe/ajax/chapters/`]: await page('madara', 'ajax-chapters.html'),
    });
    // The page has chapters, but ajax was asked for: its answer wins.
    expect((await always.call<Chapters>('getChapters', MANGA)).map((c) => c.name)).toEqual(['Chapter 2', 'Chapter 1']);
    always.dispose();
  });

  it('takes the template configuration: another archive path and selectors', async () => {
    const custom = await (
      await extension('madara', 'md.example.org', (code) =>
        code.replace(
          'createSource: () => madara({ baseUrl: BASE_URL })',
          "createSource: () => madara({ baseUrl: BASE_URL, listPath: '/series', popularOrder: 'trending', selectors: { item: '.page-item-detail:first-child' } })",
        ),
      )
    )({ [`GET ${BASE}/series/page/1/?m_orderby=trending`]: await page('madara', 'list.html') });
    expect((await custom.call<Items>('getPopular', 1)).items.map((m) => m.title)).toEqual(['Starlight Cafe']);
    custom.dispose();
  });

  it('reads pages from the reading content, trimming the whitespace some sites put in data-src', async () => {
    const source = await open({ [`GET ${BASE}/manga/iron-lullaby/chapter-2/`]: await page('madara', 'chapter.html') });
    expect(await source.call('getPages', { url: '/manga/iron-lullaby/chapter-2/', name: 'Chapter 2' })).toEqual([
      { index: 0, imageUrl: 'https://cdn.example.org/ic/2/01.jpg' },
      { index: 1, imageUrl: 'https://cdn.example.org/ic/2/02.jpg' },
    ]);
    source.dispose();
  });

  it('opens pasted links of its own site', async () => {
    const source = await open({});
    expect(await source.call('resolveUrl', `${BASE}/manga/starlight-cafe/chapter-1/`)).toEqual({
      url: '/manga/starlight-cafe/',
      title: 'starlight cafe',
    });
    expect(await source.call('resolveUrl', `${BASE}/manga/`)).toBeNull();
    expect(await source.call('imageHeaders')).toEqual({ Referer: `${BASE}/` });
    source.dispose();
  });
});
