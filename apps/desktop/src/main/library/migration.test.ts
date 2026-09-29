import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Chapter } from '@matane/extension-sdk';
import { DEFAULT_MIGRATION_OPTIONS, type MigrationProgress } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { CategoriesRepository } from '../db/repositories/categories';
import { ChaptersRepository, toChapterInfo } from '../db/repositories/chapters';
import { HistoryRepository } from '../db/repositories/history';
import { LibraryRepository } from '../db/repositories/library';
import { MangaRepository } from '../db/repositories/manga';
import { ProgressRepository } from '../db/repositories/progress';
import { CoverStore } from '../images/covers';
import { MigrationService, titleSimilarity } from './migration';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let dir: string;
let connection: DatabaseConnection;
let manga: MangaRepository;
let chapters: ChaptersRepository;
let progress: ProgressRepository;
let history: HistoryRepository;
let library: LibraryRepository;
let categories: CategoriesRepository;
let covers: CoverStore;
/** Search results per source, and the chapters `refreshManga` "fetches" per manga url. */
let search: Record<string, { url: string; title: string }[] | Error>;
let remoteChapters: Record<string, Chapter[]>;
let removed: number[];
let service: MigrationService;

const ch = (url: string, number?: number, scanlator?: string): Chapter => ({
  url,
  name: `Ch. ${number ?? url}`,
  number,
  scanlator,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-migration-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  for (const [id, name] of [
    ['old/en', 'Old'],
    ['new/en', 'New'],
    ['other/en', 'Other'],
  ] as const) {
    connection.sqlite
      .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES (?, ?, 'en', ?, 'en')")
      .run(id, id.split('/')[0], name);
  }
  const changes = new DbChanges(() => undefined);
  manga = new MangaRepository(connection.db, changes);
  chapters = new ChaptersRepository(connection.db, changes);
  progress = new ProgressRepository(connection.db, changes);
  history = new HistoryRepository(connection.db, changes);
  library = new LibraryRepository(connection.db, changes);
  categories = new CategoriesRepository(connection.db, changes);
  covers = new CoverStore(join(dir, 'covers'), manga);
  search = {};
  remoteChapters = {};
  removed = [];
  service = new MigrationService({
    manga,
    chapters,
    progress,
    history,
    library,
    libraryService: {
      remove: async (ids) => {
        removed.push(...ids);
        library.remove(ids);
      },
    },
    sources: {
      browse: async ({ sourceId }) => {
        const result = search[sourceId] ?? [];
        if (result instanceof Error) throw result;
        return { items: manga.upsertSummaries(sourceId, result), hasNextPage: false };
      },
      refreshManga: async (mangaId) => {
        const row = manga.get(mangaId)!;
        const list = remoteChapters[row.url];
        if (!list) throw new AppError('network', 'offline');
        chapters.sync(mangaId, list);
        return { manga: manga.info(mangaId)!, newChapterIds: [] };
      },
    },
    covers,
    images: { cover: async () => Promise.reject(new Error('no network in tests')) },
    transaction: (work) => connection.sqlite.transaction(work)(),
  });
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('titleSimilarity', () => {
  it('is 1 for the same title once normalized, and graded otherwise', () => {
    expect(titleSimilarity('Sousou no Frieren', 'sousou-no FRIEREN!')).toBe(1);
    expect(titleSimilarity('Pokémon Adventures', 'Pokemon adventures')).toBe(1);
    expect(titleSimilarity('Echoes in Crimson', 'Echoes of Crimson Sun')).toBeGreaterThan(0.6);
    expect(titleSimilarity('Echoes in Crimson', 'Paper Lantern Detective')).toBeLessThan(0.3);
    expect(titleSimilarity('', 'x')).toBe(0);
  });
});

describe('MigrationService.findCandidates', () => {
  it('stops at the first target with an exact match and keeps the rest as candidates', async () => {
    const from = manga.ensure('old/en', { url: '/a', title: 'Blade of the Ashen Sky' });
    search['new/en'] = [
      { url: '/x', title: 'Blade of the Ashen Sky!' },
      { url: '/y', title: 'Blade of Ashen Skies' },
      { url: '/z', title: 'Unrelated Story' },
    ];
    search['other/en'] = [{ url: '/o', title: 'Blade of the Ashen Sky' }];
    const result = await service.findCandidates(from, ['new/en', 'other/en']);
    expect(result.best).toMatchObject({ sourceId: 'new/en', match: 'exact', item: { url: '/x' } });
    expect(result.candidates.map((c) => c.item.url)).toEqual(['/x', '/y']);
  });

  it('searches every target without an exact match, reports failures and skips the own source', async () => {
    const from = manga.ensure('old/en', { url: '/a', title: 'Echoes in Crimson' });
    search['old/en'] = [{ url: '/self', title: 'Echoes in Crimson' }];
    search['new/en'] = new AppError('cloudflare', 'challenge');
    search['other/en'] = [{ url: '/o', title: 'Echoes of Crimson Sun' }];
    const result = await service.findCandidates(from, ['old/en', 'new/en', 'other/en']);
    expect(result.best).toMatchObject({ sourceId: 'other/en', match: 'similar' });
    expect(result.best!.score).toBeLessThan(1);
    expect(result.errors).toEqual([{ sourceId: 'new/en', code: 'cloudflare', message: 'challenge' }]);
    search['other/en'] = [{ url: '/p', title: 'Paper Lantern Detective' }];
    expect((await service.findCandidates(from, ['other/en'])).best).toBeNull();
  });
});

describe('MigrationService.run', () => {
  function setup() {
    const from = manga.ensure('old/en', { url: '/old', title: 'Old Title' });
    // Old source: 1–4 and an unnumbered extra; 2 exists twice.
    const old = chapters.sync(from, [
      ch('o4', 4),
      ch('o3', 3),
      ch('o2b', 2, 'B'),
      ch('o2a', 2, 'A'),
      ch('extra'),
      ch('o1', 1),
    ]).added;
    const ids = { '4': old[0]!, '3': old[1]!, '2b': old[2]!, '2a': old[3]!, extra: old[4]!, '1': old[5]! };
    const cat = categories.create('Favourites');
    library.add(from, [cat.id], 100);
    progress.markRead([ids['1'], ids['2a'], ids.extra], true);
    progress.save({ chapterId: ids['3'], page: 5, pageEnd: 5, total: 20, offset: 0.25 });
    history.touch(from, ids['3'], 5000);
    chapters.setBookmarked([ids['4'], ids['2b']], true);
    manga.setReaderSettings(from, { mode: 'webtoon' });
    const target = manga.ensure('new/en', { url: '/new', title: 'Old Title' });
    // New source: 1, 2 and 3 (no 4), in two versions of 3.
    remoteChapters['/new'] = [ch('n3x', 3, 'X'), ch('n3y', 3, 'Y'), ch('n2', 2), ch('n1', 1)];
    return { from, target, ids, cat };
  }
  const byNumber = (mangaId: number) =>
    chapters
      .list(mangaId)
      .map(toChapterInfo)
      .map((c) => [c.number, c.scanlator, c.read, c.bookmarked, c.lastPage]);

  it('moves read status, progress, history, bookmarks, categories and reader settings by chapter number', async () => {
    const { from, target, cat } = setup();
    const events: MigrationProgress[] = [];
    const [result] = await service.run([{ fromMangaId: from, toMangaId: target }], DEFAULT_MIGRATION_OPTIONS, (p) =>
      events.push(p),
    );
    expect(result).toMatchObject({ status: 'migrated', readMatched: 2 });
    // The unnumbered extra was read; chapter 4 was bookmarked; neither exists in the new source.
    expect(result!.unmatched.sort()).toEqual(['Ch. 4', 'Ch. extra']);
    expect(byNumber(target)).toEqual([
      [3, 'X', false, false, 5], // in progress, same page count (unknown in the new source)
      [3, 'Y', false, false, 0],
      [2, null, true, true, 0],
      [1, null, true, false, 0],
    ]);
    expect(history.entry(target)).toMatchObject({ readAt: 5000 });
    const info = manga.info(target)!;
    expect(info).toMatchObject({ inLibrary: true, categoryIds: [cat.id], readerSettings: { mode: 'webtoon' } });
    expect(removed).toEqual([from]);
    expect(manga.info(from)?.inLibrary).toBe(false);
    expect(events).toEqual([
      { done: 0, total: 1, current: from },
      { done: 1, total: 1, current: null },
    ]);
  });

  it('carries only the chosen data and can keep the old manga', async () => {
    const { from, target } = setup();
    const [result] = await service.run(
      [{ fromMangaId: from, toMangaId: target }],
      {
        readStatus: false,
        categories: false,
        readerSettings: false,
        customCover: false,
        bookmarks: false,
        removeOld: false,
      },
      () => undefined,
    );
    expect(result).toMatchObject({ status: 'migrated', readMatched: 0, unmatched: [] });
    expect(byNumber(target).every(([, , read, bookmarked]) => !read && !bookmarked)).toBe(true);
    expect(manga.info(target)).toMatchObject({ inLibrary: true, categoryIds: [], readerSettings: null });
    expect(manga.info(from)?.inLibrary).toBe(true);
    expect(removed).toEqual([]);
  });

  it('copies the custom cover and reports a failed pair without stopping the others', async () => {
    const { from, target } = setup();
    const file = join(dir, 'cover.png');
    writeFileSync(file, PNG);
    await covers.setCustom(from, file);
    const broken = manga.ensure('old/en', { url: '/broken', title: 'Broken' });
    const offline = manga.ensure('new/en', { url: '/offline', title: 'Broken' }); // no remote chapters
    const results = await service.run(
      [
        { fromMangaId: broken, toMangaId: offline },
        { fromMangaId: from, toMangaId: target },
      ],
      DEFAULT_MIGRATION_OPTIONS,
      () => undefined,
    );
    expect(results.map((r) => r.status)).toEqual(['failed', 'migrated']);
    expect(results[0]!.error).toBe('offline');
    const copied = manga.get(target)!.customCoverPath;
    expect(copied).not.toBeNull();
    expect(copied).not.toBe(manga.get(from)!.customCoverPath);
  });
});
