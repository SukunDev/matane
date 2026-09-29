import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Chapter } from '@matane/extension-sdk';
import type { ExtensionManifest } from '@matane/extension-sdk/manifest';
import type { DbChangeTag } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../changes';
import { type DatabaseConnection, openDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ChaptersRepository } from '../repositories/chapters';
import { ExtensionsRepository } from '../repositories/extensions';
import { MangaRepository, toMangaInfo } from '../repositories/manga';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');

const manifest: ExtensionManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  apiVersion: 1,
  nsfw: false,
  domains: ['example.com'],
  sources: [
    { key: 'en', lang: 'en', name: 'Demo' },
    { key: 'id', lang: 'id', name: 'Demo' },
  ],
};

let dir: string;
let connection: DatabaseConnection;
let emitted: DbChangeTag[][];
let changes: DbChanges;
let extensions: ExtensionsRepository;
let manga: MangaRepository;
let chapters: ChaptersRepository;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-repo-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  emitted = [];
  changes = new DbChanges((tags) => emitted.push(tags));
  extensions = new ExtensionsRepository(connection.db, changes);
  manga = new MangaRepository(connection.db, changes);
  chapters = new ChaptersRepository(connection.db, changes);
  extensions.upsert(manifest, 1);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ExtensionsRepository', () => {
  it('upserts extensions and keeps sources a new version dropped', () => {
    extensions.upsert({ ...manifest, version: '2.0.0', sources: [{ key: 'en', lang: 'en', name: 'Demo EN' }] }, 2);
    expect(extensions.get('demo')).toMatchObject({ version: '2.0.0', installedAt: 1, updatedAt: 2 });
    expect(extensions.listSources().map((s) => [s.id, s.name])).toEqual([
      ['demo/en', 'Demo EN'],
      ['demo/id', 'Demo'],
    ]);
  });

  it('stores JSON storage values and preferences per extension', () => {
    extensions.setStorage('demo', 'token', { a: 1 });
    expect(extensions.getStorage('demo', 'token')).toEqual({ a: 1 });
    expect(extensions.getStorage('demo', 'missing')).toBeNull();
    extensions.removeStorage('demo', 'token');
    expect(extensions.getStorage('demo', 'token')).toBeNull();

    extensions.setPref('demo', 'dataSaver', true);
    extensions.setPref('demo', 'dataSaver', false);
    expect(extensions.getPrefs('demo')).toEqual({ dataSaver: false });
  });
});

describe('MangaRepository', () => {
  it('creates manga from browse pages and reuses them by (source, url)', () => {
    const first = manga.upsertSummaries('demo/en', [
      { url: '/a', title: 'A', thumbnailUrl: 'https://example.com/a.jpg' },
      { url: '/b', title: 'B' },
      { url: '/a', title: 'duplicate on the page' },
    ]);
    expect(first.map((m) => m.url)).toEqual(['/a', '/b']);
    const again = manga.upsertSummaries('demo/en', [{ url: '/a', title: 'A renamed' }]);
    expect(again[0]).toMatchObject({
      mangaId: first[0]!.mangaId,
      title: 'A renamed',
      thumbnailUrl: 'https://example.com/a.jpg',
    });
    // Same url in another source is another manga.
    expect(manga.ensure('demo/id', { url: '/a', title: 'A' })).not.toBe(first[0]!.mangaId);
  });

  it('keeps library titles and fills details', () => {
    const id = manga.ensure('demo/en', { url: '/a', title: 'Mine' });
    connection.sqlite.prepare('UPDATE manga SET in_library = 1 WHERE id = ?').run(id);
    manga.upsertSummaries('demo/en', [{ url: '/a', title: 'Source title' }]);
    const row = manga.updateDetails(
      id,
      { url: '/a', title: 'Source title', status: 'ongoing', genres: ['Action'], author: 'X', type: 'manhwa' },
      50,
    );
    expect(toMangaInfo(row)).toMatchObject({
      title: 'Mine',
      status: 'ongoing',
      genres: ['Action'],
      author: 'X',
      type: 'manhwa',
      lastFetchedAt: 50,
    });
  });
});

describe('ChaptersRepository', () => {
  const ch = (url: string, number?: number, extra: Partial<Chapter> = {}): Chapter => ({
    url,
    name: `Ch. ${number ?? url}`,
    number,
    uploadedAt: number ? number * 1000 : undefined,
    ...extra,
  });

  it('adds new chapters, updates changed ones and flags the missing', async () => {
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    const first = chapters.sync(mangaId, [ch('c3', 3), ch('c2', 2), ch('c1', 1)]);
    expect(first).toMatchObject({ updated: 0, missing: 0 });
    expect(first.added).toHaveLength(3);

    connection.sqlite.prepare("UPDATE chapters SET read = 1, last_page = 7 WHERE url = 'c1'").run();
    connection.sqlite.prepare("UPDATE chapters SET bookmarked = 1 WHERE url = 'c2'").run();
    const second = chapters.sync(mangaId, [ch('c4', 4), ch('c3', 3, { scanlator: 'Group' }), ch('c1', 1)]);
    expect(second.added).toHaveLength(1);
    expect(second.missing).toBe(1);
    // c3 changed scanlator and order; c1 moved from order 2 to 2 (unchanged) → 1 or 2 updates.
    expect(second.updated).toBeGreaterThanOrEqual(1);

    const rows = chapters.list(mangaId);
    expect(rows.map((r) => [r.url, r.sourceOrder, r.sourceMissing])).toEqual([
      ['c4', 0, false],
      ['c3', 1, false],
      ['c1', 2, false],
      ['c2', 1, true],
    ]);
    // Reading state survives a sync.
    expect(rows.find((r) => r.url === 'c1')).toMatchObject({ read: true, lastPage: 7 });
    expect(manga.get(mangaId)?.latestChapterAt).toBe(4000);

    // A chapter that comes back loses the flag.
    expect(
      chapters.sync(mangaId, [ch('c4', 4), ch('c3', 3, { scanlator: 'Group' }), ch('c2', 2), ch('c1', 1)]).added,
    ).toEqual([]);
    expect(chapters.list(mangaId).every((r) => !r.sourceMissing)).toBe(true);

    await flush();
    expect(emitted.flat()).toContain(`chapters:${mangaId}`);
  });

  it('deletes dropped chapters nothing refers to, and keeps those with reading traces', () => {
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    const ids = chapters.sync(mangaId, [
      ch('c6', 6),
      ch('c5', 5),
      ch('c4', 4),
      ch('c3', 3),
      ch('c2', 2),
      ch('c1', 1),
    ]).added;
    const [c6, c5, c4, c3, c2] = ids as [number, number, number, number, number];
    const run = (query: string, ...params: unknown[]) => connection.sqlite.prepare(query).run(...params);
    run('UPDATE chapters SET read = 1 WHERE id = ?', c6);
    run('UPDATE chapters SET last_page = 3 WHERE id = ?', c5);
    run("INSERT INTO downloads (chapter_id, status, created_at) VALUES (?, 'queued', 0)", c4);
    run('INSERT INTO history (manga_id, chapter_id, read_at) VALUES (?, ?, 0)', mangaId, c3);
    run('INSERT INTO reading_sessions (manga_id, chapter_id, started_at) VALUES (?, ?, 0)', mangaId, c2);

    const result = chapters.sync(mangaId, [ch('c7', 7)]);
    expect(result).toMatchObject({ missing: 5, removed: 1 });
    expect(chapters.list(mangaId).map((r) => [r.url, r.sourceMissing])).toEqual([
      ['c7', false],
      ['c6', true],
      ['c5', true],
      ['c4', true],
      ['c3', true],
      ['c2', true],
    ]);

    // An empty list from the source deletes nothing.
    expect(chapters.sync(mangaId, [])).toMatchObject({ removed: 0 });
    expect(chapters.list(mangaId)).toHaveLength(6);
  });

  it('does not emit changes for a no-op sync', async () => {
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    chapters.sync(mangaId, [ch('c1', 1)]);
    await flush();
    emitted.length = 0;
    expect(chapters.sync(mangaId, [ch('c1', 1)])).toEqual({ added: [], updated: 0, missing: 0, removed: 0 });
    await flush();
    expect(emitted).toEqual([]);
  });

  it('caches page lists with an expiry', () => {
    const mangaId = manga.ensure('demo/en', { url: '/a', title: 'A' });
    const [chapterId] = chapters.sync(mangaId, [ch('c1', 1)]).added;
    const pages = [{ index: 0, imageUrl: 'https://example.com/1.jpg' }];
    chapters.cachePages(chapterId!, pages, 1000);
    expect(chapters.getCachedPages(chapterId!, 500, 1400)).toEqual(pages);
    expect(chapters.getCachedPages(chapterId!, 500, 1600)).toBeUndefined();
    expect(chapters.get(chapterId!)?.totalPages).toBe(1);
    chapters.dropCachedPages(chapterId!);
    expect(chapters.getCachedPages(chapterId!, 500, 1400)).toBeUndefined();
  });
});

describe('DbChanges', () => {
  it('coalesces tags into one event per tick', async () => {
    await flush();
    emitted.length = 0;
    changes.mark('sources');
    changes.mark('sources', 'manga:1');
    await flush();
    expect(emitted).toEqual([['sources', 'manga:1']]);
  });
});
