// Replays recorded MangaDex responses from test/fixtures. To refresh them: `MR_RECORD=1 pnpm test`
// after deleting the stale files (only missing fixtures are fetched).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FixtureHost, buildExtension, createFixtureHost, hasFixtures } from '@matane/extension-cli';
import { ExtensionRuntime } from '@matane/extension-runtime';
import type { Chapter, Filter, HttpResponse, MangaDetails, MangaPage, Page } from '@matane/extension-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Small series with chapters in both languages (keeps fixtures tiny). */
const MANGA = { url: '5272da37-6c69-4ecc-a1e0-d25db7b3e80f', title: '' };
const REPORT_URL = 'https://api.mangadex.network/report';
const FIXTURES = path.join(root, 'test/fixtures');
const RECORD = process.env.MR_RECORD === '1';
/** Without recorded responses (and not recording) the suite is skipped rather than failing. */
const enabled = RECORD || hasFixtures(FIXTURES);
const suite = enabled ? describe : describe.skip;
if (!enabled)
  console.warn(`MangaDex tests skipped: no fixtures in ${FIXTURES} (record them with MR_RECORD=1 pnpm test)`);

const KEPT_LANGS = ['en', 'id', 'ja-ro'];

/** Recorded listings carry descriptions and alt titles in dozens of languages; keep the ones tests use. */
function shrink(response: HttpResponse): HttpResponse {
  const body = response.body as { data?: unknown } | null;
  const items = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  for (const item of items as {
    attributes?: { description?: Record<string, string>; altTitles?: Record<string, string>[] };
  }[]) {
    const attributes = item.attributes;
    if (!attributes) continue;
    if (attributes.description) {
      attributes.description = Object.fromEntries(
        Object.entries(attributes.description)
          .filter(([lang]) => KEPT_LANGS.includes(lang))
          .map(([lang, text]) => [lang, text.slice(0, 300)]),
      );
    }
    if (attributes.altTitles) {
      attributes.altTitles = attributes.altTitles.filter((t) =>
        Object.keys(t).some((lang) => KEPT_LANGS.includes(lang)),
      );
    }
  }
  return response;
}

let host: FixtureHost;
let runtime: ExtensionRuntime;

beforeAll(async () => {
  if (!enabled) return;
  const { code, manifest } = await buildExtension(root, { write: false });
  host = createFixtureHost({
    dir: FIXTURES,
    record: RECORD,
    shrink,
    stub: (request) =>
      request.url === REPORT_URL ? { status: 200, url: request.url, headers: {}, body: '' } : undefined,
  });
  runtime = await ExtensionRuntime.create({
    code,
    manifest,
    host,
    hostInfo: { appName: 'Matane', appVersion: '0.0.0-test', apiVersion: 1 },
  });
}, 30_000);

afterAll(() => runtime?.dispose());

beforeEach(() => {
  if (host) host.requests.length = 0;
});

const call = <T>(source: 'en' | 'id', method: string, args: unknown[] = [], prefs: Record<string, unknown> = {}) =>
  runtime.call<T>(source, method, args, { prefs });

/** Query parameters of the n-th request, decoded, as [key, value] pairs. */
function params(index = 0): [string, string][] {
  const url = host.requests[index]?.url ?? '';
  const query = url.split('?')[1] ?? '';
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]);
}
const values = (index: number, key: string) =>
  params(index)
    .filter(([k]) => k === key)
    .map(([, v]) => v);

suite('listing', () => {
  it('getPopular lists safe manga with chapters in the source language, by follows', async () => {
    const page = await call<MangaPage>('en', 'getPopular', [1]);
    expect(page.items).toHaveLength(24);
    expect(page.hasNextPage).toBe(true);
    for (const item of page.items) {
      expect(item.url).toMatch(UUID);
      expect(item.title).not.toBe('');
      expect(item.thumbnailUrl).toMatch(/^https:\/\/uploads\.mangadex\.org\/covers\/[0-9a-f-]{36}\/.+\.512\.jpg$/);
    }
    expect(host.requests[0]?.url).toMatch(/^https:\/\/api\.mangadex\.org\/manga\?/);
    expect(values(0, 'order[followedCount]')).toEqual(['desc']);
    expect(values(0, 'availableTranslatedLanguage[]')).toEqual(['en']);
    expect(values(0, 'contentRating[]')).toEqual(['safe', 'suggestive']);
    expect(values(0, 'offset')).toEqual(['0']);
  });

  it('identifies itself with the app User-Agent, never a browser one', async () => {
    await call('id', 'getPopular', [1]);
    expect(host.requests[0]?.headers?.['User-Agent']).toBe('Matane/0.0.0-test');
    expect(values(0, 'availableTranslatedLanguage[]')).toEqual(['id']);
    await expect(call('en', 'imageHeaders')).resolves.toEqual({ 'User-Agent': 'Matane/0.0.0-test' });
  });

  it('getLatest orders by latest upload and pages with offsets', async () => {
    await call<MangaPage>('en', 'getLatest', [2]);
    expect(values(0, 'order[latestUploadedChapter]')).toEqual(['desc']);
    expect(values(0, 'offset')).toEqual(['24']);
  });
});

suite('search', () => {
  it('maps filters onto query parameters', async () => {
    const filters = await call<Filter[]>('en', 'getFilters');
    const tags = filters.flatMap((f) => (f.type === 'group' && f.id.startsWith('tags.') ? f.filters : []));
    const [action, comedy] = [
      tags.find((t) => 'label' in t && t.label === 'Action'),
      tags.find((t) => 'label' in t && t.label === 'Comedy'),
    ];
    if (!action || !('id' in action) || !comedy || !('id' in comedy)) throw new Error('tags missing');

    host.requests.length = 0;
    await call<MangaPage>('en', 'search', [
      'frieren',
      1,
      {
        [action.id]: 'include',
        [comedy.id]: 'exclude',
        'status.completed': true,
        'rating.suggestive': false,
        'origin.zh': true,
        sort: { value: 'rating', ascending: true },
      },
    ]);
    expect(values(0, 'title')).toEqual(['frieren']);
    expect(values(0, 'includedTags[]')).toEqual([action.id.slice(4)]);
    expect(values(0, 'excludedTags[]')).toEqual([comedy.id.slice(4)]);
    expect(values(0, 'status[]')).toEqual(['completed']);
    expect(values(0, 'contentRating[]')).toEqual(['safe']);
    expect(values(0, 'originalLanguage[]')).toEqual(['zh', 'zh-hk']);
    expect(values(0, 'order[rating]')).toEqual(['asc']);
  });

  it('caches the tag list in extension storage', async () => {
    await call<Filter[]>('en', 'getFilters');
    expect(host.requests).toHaveLength(0);
    expect(host.store.has('tags')).toBe(true);
  });

  it('falls back from relevance to popularity without a query', async () => {
    await call<MangaPage>('en', 'search', ['', 1, {}]);
    expect(values(0, 'order[relevance]')).toEqual([]);
    expect(values(0, 'order[followedCount]')).toEqual(['desc']);
  });

  it('opens a pasted manga link directly', async () => {
    const page = await call<MangaPage>('en', 'search', [`https://mangadex.org/title/${MANGA.url}/some-slug`, 1, {}]);
    expect(page.items.map((m) => m.url)).toEqual([MANGA.url]);
    expect(host.requests[0]?.url).toMatch(new RegExp(`/manga/${MANGA.url}\\?`));
  });
});

suite('manga', () => {
  it('getMangaDetails parses the entity', async () => {
    const details = await call<MangaDetails>('en', 'getMangaDetails', [MANGA]);
    expect(details.url).toBe(MANGA.url);
    expect(details.title).not.toBe('');
    expect(details.author).toBeTruthy();
    expect(details.description).toBeTruthy();
    expect(details.genres?.length).toBeGreaterThan(0);
    expect(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown']).toContain(details.status);
    expect(details.type).toBe('manga');
    expect(values(0, 'includes[]')).toEqual(['cover_art', 'author', 'artist']);
  });

  it.each(['en', 'id'] as const)('getChapters (%s) returns the translated feed, newest first', async (lang) => {
    const chapters = await call<Chapter[]>(lang, 'getChapters', [MANGA]);
    expect(chapters.length).toBeGreaterThan(0);
    for (const chapter of chapters) {
      expect(chapter.url).toMatch(UUID);
      expect(chapter.name).not.toBe('');
      expect(typeof chapter.uploadedAt).toBe('number');
    }
    const numbers = chapters.map((c) => c.number).filter((n): n is number => n !== undefined);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(values(0, 'translatedLanguage[]')).toEqual([lang]);
    expect(values(0, 'includeExternalUrl')).toEqual(['0']);
  });
});

suite('pages', () => {
  let chapter: Chapter;
  beforeAll(async () => {
    [chapter] = (await call<Chapter[]>('en', 'getChapters', [MANGA])) as [Chapter];
  });

  it('builds image URLs from the at-home server', async () => {
    const pages = await call<Page[]>('en', 'getPages', [chapter]);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.map((p) => p.index)).toEqual(pages.map((_, i) => i));
    expect(pages[0]?.imageUrl).toMatch(/^https:\/\/.+\/data\/[0-9a-f]+\/.+\.(png|jpe?g|gif|webp)$/);
    expect(host.requests[0]?.url).toBe(`https://api.mangadex.org/at-home/server/${chapter.url}`);
  });

  it('uses data-saver images when the preference is on', async () => {
    const pages = await call<Page[]>('en', 'getPages', [chapter], { dataSaver: true });
    expect(pages[0]?.imageUrl).toMatch(/\/data-saver\/[0-9a-f]+\//);
  });
});

suite('urls', () => {
  it('resolveUrl accepts title links only', async () => {
    await expect(
      call('en', 'resolveUrl', [`https://mangadex.org/title/${MANGA.url.toUpperCase()}/slug`]),
    ).resolves.toEqual({
      url: MANGA.url,
      title: '',
    });
    await expect(call('en', 'resolveUrl', ['https://mangadex.org/chapter/abc'])).resolves.toBeNull();
    await expect(call('en', 'resolveUrl', ['https://example.com/title/x'])).resolves.toBeNull();
  });

  it('getWebUrl links manga and chapters', async () => {
    await expect(call('en', 'getWebUrl', [MANGA])).resolves.toBe(`https://mangadex.org/title/${MANGA.url}`);
    await expect(call('en', 'getWebUrl', [{ url: 'c1', name: 'Ch. 1' }])).resolves.toBe(
      'https://mangadex.org/chapter/c1',
    );
  });
});

suite('reportImage', () => {
  const result = { success: true, bytes: 1234, durationMs: 250, cached: true };

  it('reports MangaDex@Home images', async () => {
    await call('en', 'reportImage', [{ ...result, url: 'https://abc.xyz.mangadex.network:443/data/h/1.png' }]);
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]).toMatchObject({
      url: REPORT_URL,
      method: 'POST',
      body: {
        json: {
          url: 'https://abc.xyz.mangadex.network:443/data/h/1.png',
          success: true,
          bytes: 1234,
          duration: 250,
          cached: true,
        },
      },
    });
  });

  it('skips images served by mangadex.org itself', async () => {
    await call('en', 'reportImage', [{ ...result, url: 'https://uploads.mangadex.org/data/h/1.png' }]);
    expect(host.requests).toHaveLength(0);
  });
});
