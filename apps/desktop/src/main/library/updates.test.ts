import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_UPDATE_SETTINGS, type UpdateProgress, type UpdateSettings } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { LibraryRepository } from '../db/repositories/library';
import { MangaRepository } from '../db/repositories/manga';
import { UpdatesRepository } from '../db/repositories/updates';
import { MAX_PARALLEL, UpdateService, autoDownloads, nextCheckAt, notificationText, skipReason } from './updates';

const HOUR = 3_600_000;
const migrationsFolder = resolve(__dirname, '../../../drizzle');

describe('update schedule and rules', () => {
  it('is due when the interval passed, right away the first time, never when off', () => {
    expect(nextCheckAt(null, 12, 1000)).toBe(1000);
    expect(nextCheckAt(5000, 12, 6000)).toBe(5000 + 12 * HOUR);
    expect(nextCheckAt(5000, 0, 6000)).toBeNull();
  });

  it('skips completed, never started and too-unread manga as configured', () => {
    const target = { status: 'ongoing' as const, started: true, unread: 3 };
    const rules = { skipCompleted: true, skipNotStarted: true, skipUnreadOver: 5 };
    expect(skipReason(target, rules)).toBeNull();
    expect(skipReason({ ...target, status: 'completed' }, rules)).toBe('completed');
    expect(skipReason({ ...target, status: 'completed' }, { ...rules, skipCompleted: false })).toBeNull();
    expect(skipReason({ ...target, started: false }, rules)).toBe('notStarted');
    expect(skipReason({ ...target, unread: 6 }, rules)).toBe('unread');
    expect(skipReason({ ...target, unread: 6 }, { ...rules, skipUnreadOver: null })).toBeNull();
  });

  it('downloads new chapters by category: exclude wins, include narrows, default is all', () => {
    const none = new Map([[1, { autoDownload: null }]]);
    expect(autoDownloads([], none)).toBe(true);
    const withExclude = new Map([
      [1, { autoDownload: 'exclude' as const }],
      [2, { autoDownload: null }],
    ]);
    expect(autoDownloads([1, 2], withExclude)).toBe(false);
    expect(autoDownloads([2], withExclude)).toBe(true);
    const withInclude = new Map([
      [1, { autoDownload: 'include' as const }],
      [2, { autoDownload: null }],
    ]);
    expect(autoDownloads([1], withInclude)).toBe(true);
    expect(autoDownloads([2], withInclude)).toBe(false);
    expect(autoDownloads([], withInclude)).toBe(false);
  });

  it('groups the notification', () => {
    expect(notificationText('en', 5, ['A', 'B', 'C'])).toEqual({
      title: '5 new chapters from 3 manga',
      body: 'A, B, C',
    });
    expect(notificationText('en', 1, ['A'])).toEqual({ title: '1 new chapter from 1 manga', body: 'A' });
    expect(notificationText('id', 9, ['A', 'B', 'C', 'D', 'E'])).toEqual({
      title: '9 chapter baru dari 5 manga',
      body: 'A, B, C dan 2 lainnya',
    });
  });
});

let dir: string;
let connection: DatabaseConnection;
let manga: MangaRepository;
let chapters: ChaptersRepository;
let library: LibraryRepository;
let repo: UpdatesRepository;
let now: number;

const ch = (url: string, number: number, extra: Record<string, unknown> = {}) => ({
  url,
  name: `Ch. ${number}`,
  number,
  ...extra,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-updates-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
    .run();
  const changes = new DbChanges(() => undefined);
  manga = new MangaRepository(connection.db, changes);
  chapters = new ChaptersRepository(connection.db, changes);
  library = new LibraryRepository(connection.db, changes);
  repo = new UpdatesRepository(connection.db);
  now = 1_000_000;
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A library manga with chapters 1–2 from before it was added. */
function libraryManga(title: string, extra: { status?: 'completed' } = {}): number {
  const id = manga.ensure('demo/en', { url: `/${title}`, title });
  if (extra.status) connection.sqlite.prepare('UPDATE manga SET status = ? WHERE id = ?').run(extra.status, id);
  chapters.sync(id, [ch(`${title}-2`, 2), ch(`${title}-1`, 1)], now - 10);
  library.add(id, [], now);
  return id;
}

describe('UpdatesRepository', () => {
  it('lists chapters first seen after the manga joined the library, newest first, without hidden scanlators', () => {
    const a = libraryManga('Alpha');
    const b = libraryManga('Beta');
    chapters.sync(a, [ch('Alpha-3', 3), ch('Alpha-2', 2), ch('Alpha-1', 1)], now + 100);
    chapters.sync(
      b,
      [ch('Beta-4', 4, { scanlator: 'Hidden' }), ch('Beta-3', 3), ch('Beta-2', 2), ch('Beta-1', 1)],
      now + 200,
    );
    manga.setScanlatorPrefs(b, { hidden: ['Hidden'], priority: [] });
    // Not in the library: never listed.
    const outside = manga.ensure('demo/en', { url: '/out', title: 'Out' });
    chapters.sync(outside, [ch('Out-1', 1)], now + 300);

    expect(repo.list().map((e) => [e.mangaTitle, e.chapterName, e.fetchedAt])).toEqual([
      ['Beta', 'Ch. 3', now + 200],
      ['Alpha', 'Ch. 3', now + 100],
    ]);
    expect(repo.list({ since: now + 150 }).map((e) => e.mangaTitle)).toEqual(['Beta']);
    expect(repo.unseen(0)).toBe(2);
    connection.sqlite.prepare("UPDATE chapters SET read = 1 WHERE url = 'Beta-3'").run();
    expect(repo.unseen(0)).toBe(1);
  });

  it('gives the targets of a check with what the skip rules need', () => {
    const a = libraryManga('Alpha');
    const b = libraryManga('Beta', { status: 'completed' });
    connection.sqlite.prepare("UPDATE chapters SET read = 1 WHERE url = 'Alpha-1'").run();
    expect(repo.targets({ kind: 'all' })).toEqual([
      { mangaId: a, title: 'Alpha', status: 'unknown', unread: 1, started: true, categoryIds: [] },
      { mangaId: b, title: 'Beta', status: 'completed', unread: 2, started: false, categoryIds: [] },
    ]);
    expect(repo.targets({ kind: 'manga', mangaIds: [b] }).map((t) => t.title)).toEqual(['Beta']);
  });
});

describe('UpdateService', () => {
  let store: Map<string, unknown>;
  let settings: UpdateSettings;
  let online: boolean;
  let focused: boolean;
  let progress: UpdateProgress[];
  let refresh: (mangaId: number, signal: AbortSignal) => Promise<{ newChapterIds: number[] }>;
  let active: number;
  let maxActive: number;
  const enqueueAuto = vi.fn((_ids: number[]) => true);
  const notify = vi.fn();

  function service() {
    return new UpdateService({
      repo,
      settings: () => settings,
      store: {
        get: (key, fallback) => (store.has(key) ? store.get(key) : fallback) as never,
        set: (k, v) => store.set(k, v),
      },
      refresh: async (mangaId, signal) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          return await refresh(mangaId, signal);
        } finally {
          active--;
        }
      },
      chapters: (mangaId) => chapters.list(mangaId),
      hiddenScanlators: () => [],
      categories: () => new Map(),
      enqueueAuto,
      notify,
      language: () => 'en',
      isOnline: () => online,
      focused: () => focused,
      onProgress: (p) => progress.push(p),
      changed: () => undefined,
      now: () => now,
    });
  }

  beforeEach(() => {
    store = new Map();
    settings = { ...DEFAULT_UPDATE_SETTINGS };
    online = true;
    focused = true;
    progress = [];
    active = 0;
    maxActive = 0;
    enqueueAuto.mockClear();
    notify.mockClear();
  });

  it('checks three manga at a time, reports progress and errors per manga, and remembers the check', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E'].map((t) => libraryManga(t));
    refresh = async (mangaId) => {
      await new Promise((r) => setTimeout(r, 5));
      if (mangaId === ids[1]) throw new AppError('network', 'Source down');
      if (mangaId !== ids[0]) return { newChapterIds: [] };
      const added = chapters.sync(mangaId, [ch('A-3', 3), ch('A-2', 2), ch('A-1', 1)], now + 1).added;
      return { newChapterIds: added };
    };
    const updates = service();
    expect(updates.check({ kind: 'all' })).toEqual({ started: true, reason: null });
    expect(updates.check({ kind: 'all' })).toEqual({ started: false, reason: 'running' });
    await updates.idle();

    expect(maxActive).toBe(MAX_PARALLEL);
    expect(progress.at(-1)).toMatchObject({ running: false, done: 5, total: 5, newChapters: 1, errors: 1 });
    expect(progress.some((p) => p.current.length > 1)).toBe(true);
    const status = updates.status();
    expect(status).toMatchObject({ progress: null, lastCheckAt: now, nextCheckAt: now + 12 * HOUR, unseen: 1 });
    expect(status.lastResult).toMatchObject({
      checked: 5,
      newChapters: 1,
      mangaWithNew: 1,
      cancelled: false,
      errors: [{ mangaId: ids[1], title: 'B', message: 'Source down' }],
    });
    // Manual check with the window focused: no notification.
    expect(notify).not.toHaveBeenCalled();
    now += 10;
    updates.markSeen();
    expect(updates.status().unseen).toBe(0);
  });

  it('applies the skip rules to the library but not to one manga', async () => {
    libraryManga('Open');
    const done = libraryManga('Done', { status: 'completed' });
    const checked: number[] = [];
    refresh = async (mangaId) => {
      checked.push(mangaId);
      return { newChapterIds: [] };
    };
    const updates = service();
    updates.check({ kind: 'all' });
    await updates.idle();
    expect(checked).not.toContain(done);
    checked.length = 0;
    updates.check({ kind: 'manga', mangaIds: [done] });
    await updates.idle();
    expect(checked).toEqual([done]);
  });

  it('cancels: running manga stop, the rest never start', async () => {
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((t) => libraryManga(t));
    let started = 0;
    refresh = (_id, signal) => {
      started++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new AppError('cancelled', 'x'))),
      );
    };
    const updates = service();
    updates.check({ kind: 'all' });
    await new Promise((r) => setTimeout(r, 5));
    updates.cancel();
    await updates.idle();
    expect(started).toBe(MAX_PARALLEL);
    expect(updates.status().lastResult).toMatchObject({ cancelled: true, errors: [] });
  });

  it('runs on schedule when due and online, then downloads and notifies', async () => {
    const id = libraryManga('A');
    connection.sqlite.prepare("UPDATE chapters SET read = 1 WHERE url = 'A-1'").run();
    settings = { ...settings, autoDownload: true };
    refresh = async (mangaId) => ({
      newChapterIds: chapters.sync(mangaId, [ch('A-3', 3), ch('A-2', 2), ch('A-1', 1)], now + 1).added,
    });
    const updates = service();
    store.set('updates.lastCheckAt', now - 11 * HOUR);
    updates.tick();
    await updates.idle();
    expect(updates.status().lastResult).toBeNull(); // not due yet

    now += 2 * HOUR;
    online = false;
    updates.tick();
    await updates.idle();
    expect(updates.status().lastResult).toBeNull(); // offline: waits

    online = true;
    updates.tick();
    await updates.idle();
    const newId = chapters.list(id).find((c) => c.url === 'A-3')!.id;
    expect(enqueueAuto).toHaveBeenCalledWith([newId]);
    expect(notify).toHaveBeenCalledWith({ title: '1 new chapter from 1 manga', body: 'A' });
    expect(updates.status().lastCheckAt).toBe(now);
  });

  it('refuses a manual check offline, and notifies a manual check only when unfocused', async () => {
    libraryManga('A');
    refresh = async (mangaId) => ({
      newChapterIds: chapters.sync(mangaId, [ch('A-3', 3), ch('A-2', 2), ch('A-1', 1)], now + 1).added,
    });
    const updates = service();
    online = false;
    expect(updates.check({ kind: 'all' })).toEqual({ started: false, reason: 'offline' });
    online = true;
    focused = false;
    updates.check({ kind: 'all' });
    await updates.idle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).not.toHaveBeenCalled(); // auto-download is off by default
  });
});
