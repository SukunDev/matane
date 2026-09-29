import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Chapter } from '@matane/extension-sdk';
import type { DbChangeTag } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { HistoryRepository } from '../db/repositories/history';
import { MangaRepository } from '../db/repositories/manga';
import { ProgressRepository } from '../db/repositories/progress';
import { IDLE_MS, SessionRecorder } from './sessions';
import { ReadingService } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');

let dir: string;
let connection: DatabaseConnection;
let emitted: DbChangeTag[];
let now: number;
let chapters: ChaptersRepository;
let progress: ProgressRepository;
let history: HistoryRepository;
let sessions: SessionRecorder;
let incognito: boolean;
let reading: ReadingService;
let mangaId: number;
/** Chapter ids by label: "1", "2a"/"2b" (two scanlators), "3". */
let ids: Record<string, number>;

const ch = (url: string, number: number | undefined, scanlator?: string): Chapter => ({
  url,
  name: `Ch. ${number ?? url}`,
  number,
  scanlator,
});
const row = (id: number) =>
  connection.sqlite.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Record<string, number | null>;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-reading-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
    .run();
  emitted = [];
  now = 1_000_000;
  const changes = new DbChanges((tags) => emitted.push(...tags));
  const manga = new MangaRepository(connection.db, changes);
  chapters = new ChaptersRepository(connection.db, changes);
  progress = new ProgressRepository(connection.db, changes);
  history = new HistoryRepository(connection.db, changes);
  sessions = new SessionRecorder(connection.db, () => now);
  incognito = false;
  reading = new ReadingService({ progress, history, sessions, chapters, incognito: () => incognito, now: () => now });
  mangaId = manga.ensure('demo/en', { url: '/m', title: 'Demo Manga' });
  // Source order: newest first.
  const added = chapters.sync(mangaId, [ch('c3', 3), ch('c2b', 2, 'B'), ch('c2a', 2, 'A'), ch('c1', 1)]).added;
  ids = { '3': added[0]!, '2b': added[1]!, '2a': added[2]!, '1': added[3]! };
});

afterEach(() => {
  sessions.end();
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ProgressRepository / ReadingService', () => {
  it('saves the position and records history', async () => {
    reading.saveProgress({ chapterId: ids['1']!, page: 4, pageEnd: 5, total: 20, offset: null });
    expect(row(ids['1']!)).toMatchObject({ last_page: 4, total_pages: 20, read: 0 });
    expect(history.list()).toEqual([
      expect.objectContaining({ mangaId, chapterId: ids['1'], title: 'Demo Manga', sourceName: 'Demo', lastPage: 4 }),
    ]);
    await flush();
    expect(emitted).toEqual(expect.arrayContaining([`chapters:${mangaId}`, 'history']));
  });

  it('marks a chapter read on its last page, and its other scanlator version too', () => {
    reading.saveProgress({ chapterId: ids['2a']!, page: 18, pageEnd: 19, total: 20, offset: null });
    expect(row(ids['2a']!)).toMatchObject({ read: 1, read_at: now, last_page: 0 });
    expect(row(ids['2b']!)).toMatchObject({ read: 1 });
    expect(row(ids['3']!)).toMatchObject({ read: 0 });
  });

  it('keeps webtoon offsets and resets positions when marking unread', () => {
    reading.saveProgress({ chapterId: ids['3']!, page: 7, pageEnd: 7, total: 30, offset: 0.4 });
    expect(row(ids['3']!)).toMatchObject({ last_page: 7, page_offset: 0.4 });
    reading.markRead([ids['3']!], true);
    reading.markRead([ids['3']!], false);
    expect(row(ids['3']!)).toMatchObject({ read: 0, read_at: null, last_page: 0, page_offset: null });
  });

  it('marks everything before a chapter as read', () => {
    reading.markPreviousRead(ids['3']!);
    expect([ids['1'], ids['2a'], ids['2b'], ids['3']].map((id) => row(id!).read)).toEqual([1, 1, 1, 0]);
  });

  it('picks the chapter to continue', () => {
    expect(reading.continueTarget(mangaId)).toEqual({ chapterId: ids['1'], kind: 'start' });
    reading.saveProgress({ chapterId: ids['1']!, page: 3, pageEnd: 3, total: 10, offset: null });
    expect(reading.continueTarget(mangaId)).toEqual({ chapterId: ids['1'], kind: 'continue' });
    reading.saveProgress({ chapterId: ids['1']!, page: 9, pageEnd: 9, total: 10, offset: null });
    // Chapter 2 exists twice (A and B); without prefs the newest upload (the source's first).
    expect(reading.continueTarget(mangaId)).toEqual({ chapterId: ids['2b'], kind: 'next' });
    const withPrefs = new ReadingService({
      progress,
      history,
      sessions,
      chapters,
      scanlatorPrefs: () => ({ hidden: [], priority: ['A'] }),
      incognito: () => false,
    });
    expect(withPrefs.continueTarget(mangaId)).toEqual({ chapterId: ids['2a'], kind: 'next' });
  });

  it('writes nothing while incognito', async () => {
    incognito = true;
    reading.saveProgress({ chapterId: ids['1']!, page: 9, pageEnd: 9, total: 10, offset: null });
    reading.heartbeat(ids['1']!);
    expect(row(ids['1']!)).toMatchObject({ last_page: 0, read: 0 });
    expect(history.list()).toEqual([]);
    expect(connection.sqlite.prepare('SELECT COUNT(*) AS n FROM reading_sessions').get()).toEqual({ n: 0 });
    // Explicit edits still apply.
    reading.markRead([ids['1']!], true);
    expect(row(ids['1']!).read).toBe(1);
  });

  it('removes and clears history, and searches by title', () => {
    reading.saveProgress({ chapterId: ids['1']!, page: 1, pageEnd: 1, total: 10, offset: null });
    expect(history.list({ query: 'demo' })).toHaveLength(1);
    expect(history.list({ query: '100%' })).toHaveLength(0);
    history.remove(mangaId);
    expect(history.list()).toEqual([]);
    reading.saveProgress({ chapterId: ids['1']!, page: 2, pageEnd: 2, total: 10, offset: null });
    history.clear();
    expect(history.list()).toEqual([]);
  });

  it('tells whether a history entry still has unread chapters', () => {
    reading.saveProgress({ chapterId: ids['3']!, page: 9, pageEnd: 9, total: 10, offset: null });
    expect(history.list()[0]).toMatchObject({ read: true, hasUnread: true, coverKey: null });
    reading.markRead([ids['1']!, ids['2a']!], true);
    expect(history.list()[0]?.hasUnread).toBe(false);
  });
});

describe('SessionRecorder', () => {
  const sessionRows = () =>
    connection.sqlite
      .prepare('SELECT chapter_id, started_at, ended_at, active_ms FROM reading_sessions ORDER BY id')
      .all();

  it('accumulates active time and ends idle sessions without counting the gap', () => {
    vi.useFakeTimers();
    try {
      reading.heartbeat(ids['1']!);
      now += 30_000;
      reading.heartbeat(ids['1']!);
      now += 20_000;
      reading.heartbeat(ids['1']!);
      expect(sessionRows()).toEqual([
        { chapter_id: ids['1'], started_at: 1_000_000, ended_at: null, active_ms: 50_000 },
      ]);
      vi.advanceTimersByTime(IDLE_MS + 1);
      expect(sessionRows()[0]).toMatchObject({ ended_at: 1_050_000, active_ms: 50_000 });
      // Coming back after a long pause starts a new session.
      now += IDLE_MS * 3;
      reading.heartbeat(ids['1']!);
      expect(sessionRows()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a new session when the chapter changes', () => {
    reading.heartbeat(ids['1']!);
    now += 10_000;
    reading.heartbeat(ids['3']!);
    now += 5_000;
    reading.endSession();
    // The 10 s on chapter 1 and the 5 s after the last heartbeat on chapter 3 both count.
    expect(sessionRows()).toEqual([
      { chapter_id: ids['1'], started_at: 1_000_000, ended_at: 1_010_000, active_ms: 10_000 },
      { chapter_id: ids['3'], started_at: 1_010_000, ended_at: 1_015_000, active_ms: 5_000 },
    ]);
  });
});
