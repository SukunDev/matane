import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FixtureHost, buildExtension, createFixtureHost, hasFixtures } from '@matane/extension-cli';
import { ExtensionRuntime } from '@matane/extension-runtime';
import type { Chapter, Filter, MangaDetails, MangaPage, Page } from '@matane/extension-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANGA = { url: '/manga/martial-peak/', title: '' };
const FIXTURES = path.join(root, 'test/fixtures');
const RECORD = process.env.MR_RECORD === '1';
const enabled = RECORD || hasFixtures(FIXTURES);
const suite = enabled ? describe : describe.skip;
if (!enabled)
  console.warn(`WestManga tests skipped: no fixtures in ${FIXTURES} (record them with MR_RECORD=1 pnpm test)`);

let host: FixtureHost;
let runtime: ExtensionRuntime;

beforeAll(async () => {
  if (!enabled) return;
  const { code, manifest } = await buildExtension(root, { write: false });
  host = createFixtureHost({
    dir: FIXTURES,
    record: RECORD,
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

const call = <T>(method: string, args: unknown[] = [], prefs: Record<string, unknown> = {}) =>
  runtime.call<T>('id', method, args, { prefs });

suite('listing', () => {
  it('getPopular lists popular manga', async () => {
    const page = await call<MangaPage>('getPopular', [1]);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.hasNextPage).toBe(true);
    for (const item of page.items) {
      expect(item.url).toMatch(/^\/manga\/[a-zA-Z0-9_-]+\/$/);
      expect(item.title).not.toBe('');
    }
  });

  it('getLatest lists updated manga', async () => {
    const page = await call<MangaPage>('getLatest', [1]);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.hasNextPage).toBe(true);
  });
});

suite('search', () => {
  it('searches with query and filters', async () => {
    const filters = await call<Filter[]>('getFilters');
    expect(filters.length).toBeGreaterThan(0);

    const page = await call<MangaPage>('search', [
      'martial',
      1,
      {
        sort: 'Popular',
        country: 'CN',
      },
    ]);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.title.toLowerCase()).toContain('martial');
  });

  it('caches genres in storage', async () => {
    await call<Filter[]>('getFilters');
    expect(host.store.has('genres')).toBe(true);
  });
});

suite('manga', () => {
  it('getMangaDetails parses manga information', async () => {
    const details = await call<MangaDetails>('getMangaDetails', [MANGA]);
    expect(details.url).toBe(MANGA.url);
    expect(details.title).not.toBe('');
    expect(['ongoing', 'completed', 'hiatus', 'unknown']).toContain(details.status);
    expect(details.type).toBe('manhua');
    expect(details.genres).toContain('Manhua');
  });

  it('getChapters returns chapter list', async () => {
    const chapters = await call<Chapter[]>('getChapters', [MANGA]);
    expect(chapters.length).toBeGreaterThan(0);
    for (const chapter of chapters) {
      expect(chapter.url).toMatch(/^\/[a-zA-Z0-9_-]+\/$/);
      expect(chapter.name).toMatch(/^Chapter /);
      expect(typeof chapter.uploadedAt).toBe('number');
    }
  });
});

suite('pages', () => {
  it('getPages returns page images for a chapter', async () => {
    const chapters = await call<Chapter[]>('getChapters', [MANGA]);
    const firstChapter = chapters[0];
    if (!firstChapter) throw new Error('No chapters found');

    const pages = await call<Page[]>('getPages', [firstChapter]);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.index).toBe(0);
    expect(pages[0]?.imageUrl).toMatch(/^https:\/\/.+/);
  });
});

suite('urls', () => {
  it('resolveUrl parses manga urls', async () => {
    await expect(call('resolveUrl', ['https://v1.westmanga.my/comic/martial-peak'])).resolves.toEqual({
      url: '/manga/martial-peak/',
      title: '',
    });
    await expect(call('resolveUrl', ['https://example.com/comic/martial-peak'])).resolves.toBeNull();
  });

  it('getWebUrl formats manga and chapter URLs', async () => {
    await expect(call('getWebUrl', [MANGA])).resolves.toBe('https://v1.westmanga.my/comic/martial-peak');
    await expect(
      call('getWebUrl', [{ url: '/martial-peak-chapter-1-bahasa-indonesia/', name: 'Chapter 1' }]),
    ).resolves.toBe('https://v1.westmanga.my/view/martial-peak-chapter-1-bahasa-indonesia');
  });
});
