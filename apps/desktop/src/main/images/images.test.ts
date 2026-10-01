import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ImageFetchResult } from '@matane/extension-sdk';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { MangaRepository } from '../db/repositories/manga';
import type { SourceService } from '../extensions/sources';
import { ImageCache } from './cache';
import { PageMetaStore } from './page-meta';
import { ImageService } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');

let dir: string;
let connection: DatabaseConnection;
let now: number;
let cache: ImageCache;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-img-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  now = 1000;
  cache = new ImageCache(connection.db, join(dir, 'images'), 100, () => now);
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
    .run();
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const bytes = (size: number, fill = 1) => new Uint8Array(size).fill(fill);

describe('ImageCache', () => {
  it('stores files and serves them back', async () => {
    const put = await cache.put('a', 'page', bytes(10, 7), 'image/png');
    expect(readFileSync(put.path)).toEqual(Buffer.from(bytes(10, 7)));
    await expect(cache.get('a')).resolves.toMatchObject({ contentType: 'image/png', sizeBytes: 10 });
    await expect(cache.get('missing')).resolves.toBeUndefined();
  });

  it('evicts least recently used entries past the limit', async () => {
    await cache.put('a', 'page', bytes(40), null);
    now = 2000;
    await cache.put('b', 'page', bytes(40), null);
    now = 3000;
    await cache.get('a'); // a is now more recent than b
    now = 4000;
    const c = await cache.put('c', 'page', bytes(40), null);
    await cache.evict();
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBeDefined();
    expect(existsSync(c.path)).toBe(true);
    expect(cache.totalBytes()).toBe(80);

    await cache.setMaxBytes(50);
    expect(cache.totalBytes()).toBeLessThanOrEqual(50);
  });

  it('counts and clears one kind of image, leaving the other', async () => {
    const page = await cache.put('page-1', 'page', bytes(30), 'image/png');
    const cover = await cache.put('cover-1', 'browse_cover', bytes(20), 'image/png');
    expect([cache.bytesOf('page'), cache.bytesOf('browse_cover')]).toEqual([30, 20]);
    await cache.clear('page');
    expect([cache.bytesOf('page'), cache.bytesOf('browse_cover')]).toEqual([0, 20]);
    expect(existsSync(page.path)).toBe(false);
    expect(existsSync(cover.path)).toBe(true);
  });

  it('forgets rows whose file was deleted', async () => {
    const put = await cache.put('a', 'page', bytes(5), null);
    rmSync(put.path);
    await expect(cache.get('a')).resolves.toBeUndefined();
    expect(cache.totalBytes()).toBe(0);
  });
});

describe('ImageService', () => {
  function setup(respond: () => Response) {
    const manga = new MangaRepository(connection.db, new DbChanges(() => undefined));
    const reports: ImageFetchResult[] = [];
    const fetchImage = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return respond();
    });
    const sources = {
      source: () => ({ id: 'demo/en', extensionId: 'demo', key: 'en' }),
      imageHeaders: async () => ({ Referer: 'https://example.com/' }),
      reportImage: (_id: string, result: ImageFetchResult) => reports.push(result),
    } as unknown as SourceService;
    const chapters = new ChaptersRepository(connection.db, new DbChanges(() => undefined));
    const service = new ImageService({
      cache,
      meta: new PageMetaStore(connection.db, () => now),
      manga,
      chapters,
      sources,
      fetcher: { fetchImage },
    });
    const [item] = manga.upsertSummaries('demo/en', [
      { url: '/a', title: 'A', thumbnailUrl: 'https://example.com/a.jpg' },
    ]);
    return { service, fetchImage, reports, mangaId: item!.mangaId, manga };
  }

  it('fetches a cover once, caches it and reports the result', async () => {
    const { service, fetchImage, reports, mangaId } = setup(
      () => new Response(bytes(30), { headers: { 'content-type': 'image/jpeg', 'x-cache': 'HIT' } }),
    );
    const [first, second] = await Promise.all([service.cover(mangaId), service.cover(mangaId)]);
    expect(first).toEqual(second);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fetchImage).toHaveBeenCalledWith('demo', 'https://example.com/a.jpg', { Referer: 'https://example.com/' });
    await service.cover(mangaId);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([expect.objectContaining({ success: true, bytes: 30, cached: true })]);
  });

  it('refetches when the source changes the cover URL', async () => {
    const { service, fetchImage, mangaId, manga } = setup(
      () => new Response(bytes(30), { headers: { 'content-type': 'image/jpeg' } }),
    );
    await service.cover(mangaId);
    manga.upsertSummaries('demo/en', [{ url: '/a', title: 'A', thumbnailUrl: 'https://example.com/a2.jpg' }]);
    await service.cover(mangaId);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it('rejects errors and non-images, and reports the failure', async () => {
    const html = setup(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await expect(html.service.cover(html.mangaId)).rejects.toMatchObject({ code: 'parse' });
    expect(html.reports).toEqual([expect.objectContaining({ success: false })]);

    const missing = setup(() => new Response('', { status: 404 }));
    await expect(missing.service.cover(missing.mangaId)).rejects.toMatchObject({ code: 'http', status: 404 });
  });
});

describe('ImageService pages', () => {
  function setup(
    respond: (url: string) => Response,
    transformImage?: (page: { index: number }, bytes: Uint8Array) => Promise<object>,
  ) {
    const changes = new DbChanges(() => undefined);
    const manga = new MangaRepository(connection.db, changes);
    const chapters = new ChaptersRepository(connection.db, changes);
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    const [chapterId] = chapters.sync(mangaId, [{ url: 'c1', name: 'Ch. 1' }]).added;
    let server = 1;
    const fetchPages = vi.fn(async () => {
      server++;
      return [0, 1].map((index) => ({ index, imageUrl: `https://s${server}.example.com/${index}.jpg` }));
    });
    const pagesCall = vi.fn(async () => ({
      pages: [0, 1].map((index) => ({ index, imageUrl: `https://s1.example.com/${index}.jpg` })),
      fromCache: true,
    }));
    const fetchImage = vi.fn(async (_ext: string, url: string) => respond(url));
    const sources = {
      source: () => ({ id: 'demo/en', extensionId: 'demo', key: 'en' }),
      imageHeaders: async () => ({}),
      reportImage: () => undefined,
      pages: pagesCall,
      fetchPages,
      imageUrl: async (_id: string, page: { imageUrl?: string }) => page.imageUrl!,
      hasImageTransform: async () => transformImage !== undefined,
      transformImage: async (_id: string, page: { index: number }, bytes: Uint8Array) => transformImage!(page, bytes),
    } as unknown as SourceService;
    const service = new ImageService({
      cache,
      meta: new PageMetaStore(connection.db, () => now),
      manga,
      chapters,
      sources,
      fetcher: { fetchImage },
    });
    return { service, chapterId: chapterId!, fetchImage, fetchPages, pagesCall };
  }
  const jpeg = () => new Response(bytes(20), { headers: { 'content-type': 'image/jpeg' } });

  it('serves cached pages without asking the source again', async () => {
    const { service, chapterId, fetchImage, pagesCall } = setup(jpeg);
    await service.page(chapterId, 1);
    await service.page(chapterId, 1);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(pagesCall).toHaveBeenCalledTimes(1);
  });

  it('refetches the page list once when a cached image URL expired', async () => {
    const { service, chapterId, fetchImage, fetchPages } = setup((url) =>
      url.startsWith('https://s1.') ? new Response('', { status: 403 }) : jpeg(),
    );
    await expect(service.page(chapterId, 0)).resolves.toMatchObject({ sizeBytes: 20 });
    expect(fetchPages).toHaveBeenCalledTimes(1);
    expect(fetchImage.mock.calls.map((c) => c[1])).toEqual([
      'https://s1.example.com/0.jpg',
      'https://s2.example.com/0.jpg',
    ]);
  });

  it('restores protected pages before caching them, and checks what comes back', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } })
      .png()
      .toBuffer();
    const xored = png.map((b) => b ^ 0x5a);
    const seen: number[] = [];
    const { service, chapterId, fetchImage } = setup(
      () => new Response(xored, { headers: { 'content-type': 'application/octet-stream' } }),
      async (page, bytes) => {
        seen.push(page.index);
        return { bytes: bytes.map((b) => b ^ 0x5a) };
      },
    );
    const served = await service.page(chapterId, 1);
    expect(served).toMatchObject({ contentType: 'image/png', sizeBytes: png.byteLength });
    expect(readFileSync((served as { path: string }).path)).toEqual(png);
    // Cached restored: no second fetch or transform.
    await service.page(chapterId, 1);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([1]);
    await expect(service.pageBytes(chapterId, 1)).resolves.toMatchObject({ contentType: 'image/png' });

    const broken = setup(
      () => new Response(xored, { headers: { 'content-type': 'application/octet-stream' } }),
      async () => ({}),
    );
    // Same chapter (its page 0 is not cached yet), another extension answer.
    await expect(broken.service.page(chapterId, 0)).rejects.toMatchObject({
      code: 'parse',
      message: 'The restored page is not an image',
    });
  });

  it('reports pages that do not exist', async () => {
    const { service, chapterId } = setup(jpeg);
    await expect(service.page(chapterId, 9)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ImageService reader views (crop, segments)', () => {
  const content = { left: 40, top: 50, width: 100, height: 200 };
  const bordered = () =>
    sharp({ create: { width: 200, height: 300, channels: 3, background: '#ffffff' } })
      .composite([
        {
          input: { create: { width: 100, height: 200, channels: 3, background: '#336699' } },
          left: content.left,
          top: content.top,
        },
      ])
      .png()
      .toBuffer();
  const tall = () =>
    sharp({ create: { width: 100, height: 8000, channels: 3, background: '#ff8800' } })
      .png()
      .toBuffer();

  function setup(images: Buffer[], downloaded?: Buffer) {
    const changes = new DbChanges(() => undefined);
    const manga = new MangaRepository(connection.db, changes);
    const chapters = new ChaptersRepository(connection.db, changes);
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    const [chapterId] = chapters.sync(mangaId, [{ url: 'c1', name: 'Ch. 1' }]).added;
    const fetchImage = vi.fn(
      async (_ext: string, url: string) =>
        new Response(new Uint8Array(images[Number(url.at(-5))]!), { headers: { 'content-type': 'image/png' } }),
    );
    const sources = {
      source: () => ({ id: 'demo/en', extensionId: 'demo', key: 'en' }),
      imageHeaders: async () => ({}),
      reportImage: () => undefined,
      pages: async () => ({
        pages: images.map((_, index) => ({ index, imageUrl: `https://example.com/${index}.png` })),
        fromCache: false,
      }),
      imageUrl: async (_id: string, page: { imageUrl?: string }) => page.imageUrl!,
      hasImageTransform: async () => false,
    } as unknown as SourceService;
    const meta = new PageMetaStore(connection.db, () => now);
    const downloads = {
      page: async (_chapterId: number, index: number) =>
        downloaded && index === 0 ? { bytes: downloaded, contentType: 'image/png' } : undefined,
    };
    const service = new ImageService({ cache, meta, manga, chapters, sources, fetcher: { fetchImage }, downloads });
    return { service, meta, chapterId: chapterId!, fetchImage };
  }
  const sizeOf = async (image: Awaited<ReturnType<ImageService['pageView']>>) => {
    const info = await sharp('data' in image ? image.data : image.path).metadata();
    return { width: info.width, height: info.height };
  };

  beforeEach(() => cache.setMaxBytes(100 * 1024 * 1024));

  it('measures pages and crops them on request, remembering both', async () => {
    const { service, chapterId, meta } = setup([await bordered()]);
    await expect(service.preparePage(chapterId, 0, false)).resolves.toEqual({ width: 200, height: 300 });
    expect(service.pageSizes(chapterId, true)).toEqual([]);
    await expect(service.preparePage(chapterId, 0, true)).resolves.toEqual({ width: 100, height: 200 });
    expect(service.pageSizes(chapterId, false)).toEqual([{ index: 0, width: 200, height: 300 }]);
    expect(service.pageSizes(chapterId, true)).toEqual([{ index: 0, width: 100, height: 200 }]);

    const cropped = await service.pageView(chapterId, 0, { crop: true });
    await expect(sizeOf(cropped)).resolves.toEqual({ width: 100, height: 200 });
    await expect(sizeOf(await service.pageView(chapterId, 0, { crop: false }))).resolves.toEqual({
      width: 200,
      height: 300,
    });
    // Cached: the second time is the same file.
    expect(await service.pageView(chapterId, 0, { crop: true })).toEqual(cropped);

    await service.clearCache('page');
    expect(meta.count()).toBe(0);
  });

  it('serves a page without margins as it is when cropping', async () => {
    const { service, chapterId } = setup([await tall()]);
    await expect(service.preparePage(chapterId, 0, true)).resolves.toEqual({ width: 100, height: 8000 });
    const plain = await service.pageView(chapterId, 0, { crop: false });
    expect(await service.pageView(chapterId, 0, { crop: true, segment: undefined })).toEqual(plain);
  });

  it('cuts tall pages into segments, made once and cached', async () => {
    const { service, chapterId } = setup([await tall()]);
    const first = await service.pageView(chapterId, 0, { crop: false, segment: 0 });
    const second = await service.pageView(chapterId, 0, { crop: false, segment: 1 });
    await expect(sizeOf(first)).resolves.toEqual({ width: 100, height: 4000 });
    await expect(sizeOf(second)).resolves.toEqual({ width: 100, height: 4000 });
    expect(await service.pageView(chapterId, 0, { crop: false, segment: 0 })).toEqual(first);
    await expect(service.pageView(chapterId, 0, { crop: false, segment: 2 })).rejects.toMatchObject({
      code: 'not_found',
    });

    // Evicted segments come back from the page.
    await cache.delete((first as { key: string }).key);
    await expect(sizeOf(await service.pageView(chapterId, 0, { crop: false, segment: 0 }))).resolves.toEqual({
      width: 100,
      height: 4000,
    });
  });

  it('works on downloaded pages, which stay untouched', async () => {
    const { service, chapterId, fetchImage } = setup([], await bordered());
    await expect(service.preparePage(chapterId, 0, true)).resolves.toEqual({ width: 100, height: 200 });
    await expect(sizeOf(await service.pageView(chapterId, 0, { crop: true }))).resolves.toEqual({
      width: 100,
      height: 200,
    });
    expect(fetchImage).not.toHaveBeenCalled();
    const original = await service.pageView(chapterId, 0, { crop: false });
    expect('data' in original && original.sizeBytes).toBe((await bordered()).byteLength);
  });

  it('measures again when a different image takes the same place', async () => {
    const images = [await bordered()];
    const { service, chapterId } = setup(images);
    await service.preparePage(chapterId, 0, true);
    const cropped = await service.pageView(chapterId, 0, { crop: true });
    // The page drops out of the cache and the source now has another picture.
    await cache.clear('page');
    images[0] = await tall();
    await expect(service.preparePage(chapterId, 0, true)).resolves.toEqual({ width: 100, height: 8000 });
    await expect(cache.get((cropped as { key: string }).key)).resolves.toBeUndefined();
  });
});
