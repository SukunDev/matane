import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Chapter } from '@manga-reader/extension-sdk';
import { DEFAULT_LIBRARY_SETTINGS } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { CategoriesRepository } from '../db/repositories/categories';
import { ChaptersRepository } from '../db/repositories/chapters';
import { HistoryRepository } from '../db/repositories/history';
import { type LibraryQuery, LibraryRepository, ftsQuery, normalizeTitle } from '../db/repositories/library';
import { MangaRepository } from '../db/repositories/manga';
import { ProgressRepository } from '../db/repositories/progress';
import { CoverStore, sniffImage } from '../images/covers';

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

const query = (patch: Partial<LibraryQuery> = {}): LibraryQuery => ({
  tab: 'all',
  sort: 'title',
  ascending: true,
  filters: { unread: false, reading: false, bookmarked: false, status: [], sourceIds: [] },
  ...patch,
});
const titles = (patch?: Partial<LibraryQuery>) => library.list(query(patch)).map((i) => i.title);
const ch = (url: string, number?: number, scanlator?: string): Chapter => ({ url, name: url, number, scanlator });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-library-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  for (const [id, name] of [
    ['demo/en', 'Demo EN'],
    ['demo/id', 'Demo ID'],
  ] as const) {
    connection.sqlite
      .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES (?, 'demo', ?, ?, 'en')")
      .run(id, id.split('/')[1], name);
  }
  const changes = new DbChanges(() => undefined);
  manga = new MangaRepository(connection.db, changes);
  chapters = new ChaptersRepository(connection.db, changes);
  progress = new ProgressRepository(connection.db, changes);
  history = new HistoryRepository(connection.db, changes);
  library = new LibraryRepository(connection.db, changes);
  categories = new CategoriesRepository(connection.db, changes);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const alpha = manga.ensure('demo/en', { url: '/alpha', title: 'Alpha Blade' });
  const beta = manga.ensure('demo/en', { url: '/beta', title: 'Beta Garden' });
  const gamma = manga.ensure('demo/id', { url: '/gamma', title: 'Gamma "Quoted" Tale' });
  manga.updateDetails(
    alpha,
    { url: '/alpha', title: 'Alpha Blade', status: 'ongoing', author: 'Ren Kaito', genres: ['Action'] },
    1,
  );
  manga.updateDetails(beta, { url: '/beta', title: 'Beta Garden', status: 'completed', genres: ['Comedy'] }, 1);
  manga.updateDetails(gamma, { url: '/gamma', title: 'Gamma "Quoted" Tale', status: 'ongoing', genres: [] }, 1);
  // Alpha: chapter 2 exists in two scanlator versions → 3 chapters, not 4.
  const a = chapters.sync(alpha, [ch('a3', 3), ch('a2x', 2, 'X'), ch('a2y', 2, 'Y'), ch('a1', 1)]).added;
  chapters.sync(beta, [ch('b1', 1)]);
  library.add(alpha, [], 100);
  library.add(beta, [], 200);
  library.add(gamma, [], 300);
  return { alpha, beta, gamma, a };
}

describe('LibraryRepository', () => {
  it('counts chapters per number, so scanlator versions count once', () => {
    const { alpha, a } = seed();
    progress.markRead([a[1]!], true); // one version of chapter 2
    history.touch(alpha, a[1]!, 50);
    const item = library.list(query()).find((i) => i.mangaId === alpha)!;
    expect(item).toMatchObject({
      chapterCount: 3,
      readCount: 1,
      unreadCount: 2,
      sourceName: 'Demo EN',
      lastReadAt: 50,
    });
  });

  it('filters by tab, status, source, unread, reading and bookmarked', () => {
    const { alpha, beta, a } = seed();
    const cat = categories.create('Favourites');
    library.setCategories([alpha], [cat.id]);
    expect(titles({ tab: cat.id })).toEqual(['Alpha Blade']);
    expect(titles({ tab: 'default' })).toEqual(['Beta Garden', 'Gamma "Quoted" Tale']);
    expect(titles({ filters: { ...query().filters, status: ['completed'] } })).toEqual(['Beta Garden']);
    expect(titles({ filters: { ...query().filters, sourceIds: ['demo/id'] } })).toEqual(['Gamma "Quoted" Tale']);
    progress.markRead(
      chapters.list(beta).map((c) => c.id),
      true,
    );
    expect(titles({ filters: { ...query().filters, unread: true } })).toEqual(['Alpha Blade']);
    history.touch(alpha, a[0]!, 10);
    expect(titles({ filters: { ...query().filters, reading: true } })).toEqual(['Alpha Blade']);
    expect(titles({ filters: { ...query().filters, bookmarked: true } })).toEqual([]);
    chapters.setBookmarked([a[0]!], true);
    expect(titles({ filters: { ...query().filters, bookmarked: true } })).toEqual(['Alpha Blade']);
  });

  it('searches title, author and genres by word prefix, safely', () => {
    seed();
    expect(titles({ query: 'alp' })).toEqual(['Alpha Blade']);
    expect(titles({ query: 'kaito' })).toEqual(['Alpha Blade']);
    expect(titles({ query: 'comedy' })).toEqual(['Beta Garden']);
    expect(titles({ query: '"quoted' })).toEqual(['Gamma "Quoted" Tale']);
    expect(titles({ query: 'alpha garden' })).toEqual([]);
    expect(ftsQuery('  ')).toBeNull();
  });

  it('sorts, with nulls last', () => {
    const { alpha, a } = seed();
    history.touch(alpha, a[0]!, 999);
    expect(titles({ sort: 'added', ascending: false })).toEqual(['Gamma "Quoted" Tale', 'Beta Garden', 'Alpha Blade']);
    expect(titles({ sort: 'lastRead', ascending: false })[0]).toBe('Alpha Blade');
    expect(titles({ sort: 'total', ascending: false })[0]).toBe('Alpha Blade');
  });

  it('counts per tab and removes manga from the library', () => {
    const { alpha, beta } = seed();
    const cat = categories.create('Reading');
    library.setCategories([alpha, beta], [cat.id]);
    expect(library.counts()).toEqual({ all: 3, default: 1, byCategory: { [cat.id]: 2 } });
    library.remove([beta]);
    expect(library.counts()).toEqual({ all: 2, default: 1, byCategory: { [cat.id]: 1 } });
    expect(manga.info(beta)).toMatchObject({ inLibrary: false, categoryIds: [] });
    // Adding again keeps the first "added" time.
    library.add(alpha, [], 5_000);
    expect(manga.get(alpha)?.addedAt).toBe(100);
  });

  it('finds duplicates from other sources by normalized title', () => {
    const { alpha } = seed();
    const copy = manga.ensure('demo/id', { url: '/alpha-id', title: 'alpha-blade!' });
    library.add(copy, []);
    expect(library.findDuplicates(alpha).map((m) => m.id)).toEqual([copy]);
    expect(normalizeTitle('Café  Déjà-Vu!')).toBe('cafedejavu');
  });
});

describe('CategoriesRepository', () => {
  it('creates, renames, reorders and deletes', () => {
    const a = categories.create(' Reading ');
    const b = categories.create('Plan to read');
    categories.rename(a.id, 'Now reading');
    categories.reorder([b.id, a.id]);
    expect(categories.list().map((c) => [c.name, c.sortOrder])).toEqual([
      ['Plan to read', 0],
      ['Now reading', 1],
    ]);
    categories.delete(b.id);
    expect(categories.list().map((c) => c.name)).toEqual(['Now reading']);
  });
});

describe('CoverStore', () => {
  it('keeps a permanent copy per source cover and replaces it when the cover changes', async () => {
    const id = manga.ensure('demo/en', { url: '/c', title: 'C', thumbnailUrl: 'https://x/1.png' });
    const cached = join(dir, 'cached.png');
    writeFileSync(cached, PNG);
    const store = new CoverStore(join(dir, 'covers'), manga);
    await store.persist(manga.get(id)!, { key: 'k', path: cached, contentType: 'image/png', sizeBytes: PNG.length });
    const first = manga.get(id)!.coverPath!;
    expect(readFileSync(first)).toEqual(PNG);
    expect(await store.library(manga.get(id)!)).toMatchObject({ contentType: 'image/png' });
    manga.upsertSummaries('demo/en', [{ url: '/c', title: 'C', thumbnailUrl: 'https://x/2.png' }]);
    expect(await store.library(manga.get(id)!)).toBeUndefined(); // stale copy is not served
    await store.persist(manga.get(id)!, { key: 'k', path: cached, contentType: 'image/png', sizeBytes: PNG.length });
    expect(existsSync(first)).toBe(false);
    await store.drop(id);
    expect(manga.get(id)?.coverPath).toBeNull();
  });

  it('sets and resets custom covers, rejecting non-images', async () => {
    const id = manga.ensure('demo/en', { url: '/c', title: 'C', thumbnailUrl: 'https://x/1.png' });
    const store = new CoverStore(join(dir, 'covers'), manga);
    const text = join(dir, 'notes.png');
    writeFileSync(text, 'not really a png');
    await expect(store.setCustom(id, text)).rejects.toMatchObject({ code: 'parse' });
    const image = join(dir, 'mine.png');
    writeFileSync(image, PNG);
    await store.setCustom(id, image);
    const info = manga.info(id)!;
    expect(info.hasCustomCover).toBe(true);
    expect(info.coverKey).toBe(manga.get(id)!.customCoverPath);
    expect(await sniffImage(info.coverKey!)).toEqual({ type: 'image/png', ext: '.png' });
    await store.resetCustom(id);
    expect(manga.info(id)).toMatchObject({ hasCustomCover: false, coverKey: 'https://x/1.png' });
  });
});

it('library settings defaults are valid', () => {
  expect(DEFAULT_LIBRARY_SETTINGS.display).toBe('comfortable');
});
