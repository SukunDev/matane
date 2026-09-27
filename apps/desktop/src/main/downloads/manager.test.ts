import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DownloadProgress } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { DownloadsRepository } from '../db/repositories/downloads';
import { MangaRepository } from '../db/repositories/manga';
import { DownloadReader } from './archive';
import { DownloadManager, MAX_CHAPTERS, MAX_PAGES, PAGE_RETRIES } from './manager';
import { DownloadStore } from './store';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let dir: string;
let folder: string;
let connection: DatabaseConnection;
let repo: DownloadsRepository;
let store: DownloadStore;
let manager: DownloadManager;
let mangaId: number;
let chapterIds: number[];
let pagesPerChapter: number;
/** Called before each page fetch; may throw or wait. */
let onFetch: (chapterId: number, index: number) => Promise<void> | void;
let fetched: string[];
let active: { chapters: Map<number, number>; pages: number; maxPages: number; maxChapters: number };
let progress: DownloadProgress[];
let free: number;

function createManager(format: 'cbz' | 'folder' = 'cbz') {
  const changes = new DbChanges(() => undefined);
  const manga = new MangaRepository(connection.db, changes);
  const chapters = new ChaptersRepository(connection.db, changes);
  return new DownloadManager({
    repo,
    store,
    manga,
    chapters,
    source: () => ({ name: 'Demo', lang: 'en' }),
    pages: async () =>
      Array.from({ length: pagesPerChapter }, (_, index) => ({ index, imageUrl: `https://x/${index}` })),
    pageBytes: async (chapterId, index) => {
      active.chapters.set(chapterId, (active.chapters.get(chapterId) ?? 0) + 1);
      active.pages++;
      active.maxPages = Math.max(active.maxPages, Math.max(...active.chapters.values()));
      active.maxChapters = Math.max(active.maxChapters, [...active.chapters.values()].filter((n) => n > 0).length);
      try {
        await onFetch(chapterId, index);
        fetched.push(`${chapterId}:${index}`);
        return { bytes: PNG, contentType: 'image/png' };
      } finally {
        active.pages--;
        active.chapters.set(chapterId, active.chapters.get(chapterId)! - 1);
      }
    },
    settings: () => ({ folder, format }),
    rightToLeft: () => true,
    onProgress: (p) => progress.push(p),
    freeBytes: async () => free,
    sleep: async () => undefined,
  });
}

const status = (chapterId: number) => repo.byChapter(chapterId)?.status;
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-dl-'));
  folder = join(dir, 'Matane');
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
    .run();
  const changes = new DbChanges(() => undefined);
  const manga = new MangaRepository(connection.db, changes);
  const chapters = new ChaptersRepository(connection.db, changes);
  mangaId = manga.ensure('demo/en', { url: '/m', title: 'Demo: Manga' });
  chapterIds = chapters.sync(mangaId, [
    { url: 'c3', name: 'Ch. 3', number: 3 },
    { url: 'c2', name: 'Ch. 2', number: 2 },
    { url: 'c1', name: 'Ch. 1', number: 1, scanlator: 'Group' },
  ]).added;
  repo = new DownloadsRepository(connection.db, changes);
  store = new DownloadStore(repo, new DownloadReader());
  pagesPerChapter = 6;
  onFetch = () => undefined;
  fetched = [];
  active = { chapters: new Map(), pages: 0, maxPages: 0, maxChapters: 0 };
  progress = [];
  free = Number.MAX_SAFE_INTEGER;
  manager = createManager();
});

afterEach(async () => {
  await manager.stop();
  await store.reader.closeAll();
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('DownloadManager', () => {
  it('downloads chapters two at a time, four pages each, into CBZ files', async () => {
    // Slow pages so the queue really overlaps.
    onFetch = () => new Promise((r) => setTimeout(r, 5));
    manager.start(true);
    manager.enqueue(chapterIds);
    await manager.idle();

    expect(active.maxChapters).toBe(MAX_CHAPTERS);
    expect(active.maxPages).toBe(MAX_PAGES);
    for (const id of chapterIds) expect(status(id)).toBe('done');
    const chapterDir = join(folder, 'Demo (EN)', 'Demo_ Manga');
    expect(readdirSync(chapterDir).sort()).toEqual(['Ch. 1 [Group].cbz', 'Ch. 2.cbz', 'Ch. 3.cbz']);
    const row = repo.byChapter(chapterIds[2]!)!;
    expect(row).toMatchObject({ pagesDone: 6, pagesTotal: 6, path: join(chapterDir, 'Ch. 1 [Group].cbz') });
    expect(row.sizeBytes).toBeGreaterThan(0);

    // The stored chapter reads back without the network.
    const pages = await store.pages(chapterIds[0]!);
    expect(pages).toHaveLength(6);
    expect((await store.page(chapterIds[0]!, 5))?.bytes).toEqual(PNG);
    expect(progress.some((p) => p.items.length > 0)).toBe(true);
    expect(repo.stats()).toMatchObject({ done: 3, queued: 0 });
  });

  it('retries a page with backoff and fails the chapter after the last retry, keeping finished pages', async () => {
    let flaky = 2;
    let attemptsOn4 = 0;
    onFetch = (_chapter, index) => {
      if (index === 1 && flaky-- > 0) throw new AppError('network', 'reset');
      if (index === 4) {
        attemptsOn4++;
        throw new AppError('http', 'Image request failed with HTTP 503', 503);
      }
    };
    manager.start(true);
    manager.enqueue([chapterIds[0]!]);
    await manager.idle();

    const row = repo.byChapter(chapterIds[0]!)!;
    expect(row.status).toBe('error');
    expect(row.error).toContain('503');
    expect(fetched.filter((f) => f.endsWith(':1'))).toHaveLength(1); // succeeded on the third try
    expect(fetched.length).toBe(5);
    expect(attemptsOn4).toBe(PAGE_RETRIES + 1);

    // Retry only fetches what is missing.
    onFetch = () => undefined;
    fetched = [];
    manager.retry([row.id]);
    await manager.idle();
    expect(status(chapterIds[0]!)).toBe('done');
    expect(fetched).toEqual([`${chapterIds[0]}:4`]);
  });

  it('does not retry errors that will not go away', async () => {
    let calls = 0;
    onFetch = () => {
      calls++;
      throw new AppError('parse', 'Expected an image but got text/html');
    };
    pagesPerChapter = 1;
    manager.start(true);
    manager.enqueue([chapterIds[0]!]);
    await manager.idle();
    expect(status(chapterIds[0]!)).toBe('error');
    expect(calls).toBe(1);
  });

  it('pauses, keeps the pages and resumes where it stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    onFetch = (_chapter, index) => (index >= 2 ? gate : undefined);
    manager.start(true);
    manager.enqueue([chapterIds[0]!]);
    while (fetched.length < 2) await tick();
    manager.pause();
    release();
    await manager.idle();
    expect(status(chapterIds[0]!)).toBe('paused');
    const tmp = readdirSync(join(folder, 'Demo (EN)', 'Demo_ Manga'));
    expect(tmp).toEqual(['Ch. 3.tmp']);

    fetched = [];
    onFetch = () => undefined;
    manager.resume();
    await manager.idle();
    expect(status(chapterIds[0]!)).toBe('done');
    expect(fetched.every((f) => !f.endsWith(':0') && !f.endsWith(':1'))).toBe(true);
  });

  it('cancels a download and deletes finished ones, removing empty folders', async () => {
    manager.start(true);
    manager.enqueue([chapterIds[0]!]);
    await manager.idle();
    const path = repo.byChapter(chapterIds[0]!)!.path!;
    expect(existsSync(path)).toBe(true);
    await store.page(chapterIds[0]!, 0); // opens the archive (it must be closed before deleting)

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    onFetch = () => gate;
    manager.enqueue([chapterIds[1]!]);
    while (status(chapterIds[1]!) !== 'downloading') await tick();
    await manager.cancel([repo.byChapter(chapterIds[1]!)!.id]);
    release();
    await manager.idle();
    expect(repo.byChapter(chapterIds[1]!)).toBeUndefined();

    await manager.delete([chapterIds[0]!]);
    expect(repo.byChapter(chapterIds[0]!)).toBeUndefined();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(folder, 'Demo (EN)'))).toBe(false);
  });

  it('puts interrupted downloads back in the queue on start, or pauses them', async () => {
    repo.enqueue([chapterIds[0]!, chapterIds[1]!], 'cbz');
    repo.setStatus([repo.byChapter(chapterIds[0]!)!.id], 'downloading');
    // A partial page from the previous run.
    const tmp = join(folder, 'Demo (EN)', 'Demo_ Manga', 'Ch. 3.tmp');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, '001.png'), PNG);
    writeFileSync(join(tmp, '002.png.part'), PNG.subarray(0, 3));

    manager.start(false);
    expect(repo.stats()).toMatchObject({ paused: 2, downloading: 0 });
    manager.resume();
    await manager.idle();
    expect(status(chapterIds[0]!)).toBe('done');
    // The finished page was kept; the half-written one fetched again.
    expect(fetched.filter((f) => f.startsWith(`${chapterIds[0]}:`)).sort()).toEqual(
      [1, 2, 3, 4, 5].map((i) => `${chapterIds[0]}:${i}`),
    );
  });

  it('writes a folder download and refuses to start without free space', async () => {
    await manager.stop();
    manager = createManager('folder');
    manager.start(true);
    manager.enqueue([chapterIds[0]!]);
    await manager.idle();
    const path = repo.byChapter(chapterIds[0]!)!.path!;
    expect(readdirSync(path).sort()).toEqual([
      '001.png',
      '002.png',
      '003.png',
      '004.png',
      '005.png',
      '006.png',
      'ComicInfo.xml',
    ]);

    free = 10;
    manager.enqueue([chapterIds[1]!]);
    await manager.idle();
    expect(repo.byChapter(chapterIds[1]!)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('disk space'),
    });
  });
});
