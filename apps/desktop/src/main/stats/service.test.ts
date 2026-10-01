import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { StatsService, startOfDay, streaks } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let dir: string;
let connection: DatabaseConnection;
/** 1 Oct 2026, 15:00 local time. */
const NOW = new Date(2026, 9, 1, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 12) => startOfDay(NOW) - daysAgo * DAY + hour * HOUR;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-stats-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  const db = connection.sqlite;
  db.prepare(
    "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('a/en', 'a', 'en', 'Source A', 'en')",
  ).run();
  db.prepare(
    "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('b/en', 'b', 'en', 'Source B', 'en')",
  ).run();
  const manga = db.prepare(
    `INSERT INTO manga (source_id, url, title, author, genres_json, in_library, thumbnail_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ongoing', 0, 0)`,
  );
  manga.run('a/en', '/one', 'One', 'Ann', JSON.stringify(['Action', 'Fantasy']), 1, 'https://a/1.jpg');
  manga.run('b/en', '/two', 'Two', null, JSON.stringify(['Romance']), 1, null);
  manga.run('a/en', '/three', 'Three', null, '[]', 0, null);
  const chapter = db.prepare(
    `INSERT INTO chapters (manga_id, url, name, source_order, read, read_at, fetched_at) VALUES (?, ?, ?, 0, ?, ?, 0)`,
  );
  // One: chapters 1-3 read in the reader (2 today, 1 forty days ago), 4 marked read without reading.
  chapter.run(1, 'c1', 'Ch. 1', 1, at(0));
  chapter.run(1, 'c2', 'Ch. 2', 1, at(0, 13));
  chapter.run(1, 'c3', 'Ch. 3', 1, at(40));
  chapter.run(1, 'c4', 'Ch. 4', 1, at(0));
  chapter.run(1, 'c5', 'Ch. 5', 0, null);
  // Two: one chapter read yesterday; Three: opened, not finished.
  chapter.run(2, 'd1', 'Ch. 1', 1, at(1));
  chapter.run(3, 'e1', 'Ch. 1', 0, null);
  const session = db.prepare(
    'INSERT INTO reading_sessions (manga_id, chapter_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?)',
  );
  session.run(1, 1, at(0), at(0) + HOUR, HOUR);
  session.run(1, 2, at(0, 13), at(0, 13) + HOUR / 2, HOUR / 2);
  session.run(1, 3, at(40), at(40) + HOUR, HOUR);
  session.run(2, 6, at(1), at(1) + HOUR / 4, HOUR / 4);
  session.run(3, 7, at(2), at(2) + 1000, 0); // opened, no active time: not a reading day
  db.prepare('INSERT INTO history (manga_id, chapter_id, read_at) VALUES (1, 2, ?)').run(at(0));
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('StatsService', () => {
  const stats = () => new StatsService(connection.sqlite, () => NOW);

  it('counts chapters finished in the reader and the time, for the last 7 days by day', () => {
    const week = stats().overview('week');
    expect(week.unit).toBe('day');
    expect(week.series).toHaveLength(7);
    expect(week.series[0]!.start).toBe(startOfDay(NOW) - 6 * DAY);
    expect(week.chaptersRead).toBe(3); // two today, one yesterday; not the one only marked read
    expect(week.readingMs).toBe(HOUR + HOUR / 2 + HOUR / 4);
    expect(week.series.at(-1)).toMatchObject({ chapters: 2, ms: HOUR * 1.5 });
    expect(week.series.at(-2)).toMatchObject({ chapters: 1, ms: HOUR / 4 });
    expect(week.days).toBe(7);
  });

  it('goes back 12 months by month, and all time from the first reading', () => {
    const year = stats().overview('year');
    expect(year.unit).toBe('month');
    expect(year.series).toHaveLength(12);
    expect(year.chaptersRead).toBe(4);
    const all = stats().overview('all');
    expect(all.from).toBeNull();
    expect(all.series[0]!.start).toBe(new Date(2026, 7, 1).getTime()); // August, forty days ago
    expect(all.series.reduce((sum, b) => sum + b.chapters, 0)).toBe(4);
  });

  it('ranks genres, manga and sources', () => {
    const all = stats().overview('all');
    expect(all.genres).toEqual([
      { name: 'Action', chapters: 3 },
      { name: 'Fantasy', chapters: 3 },
      { name: 'Romance', chapters: 1 },
    ]);
    expect(all.topManga.map((m) => [m.title, m.chapters, m.ms])).toEqual([
      ['One', 3, HOUR * 2.5],
      ['Two', 1, HOUR / 4],
    ]);
    expect(all.topManga[0]).toMatchObject({
      author: 'Ann',
      genres: ['Action', 'Fantasy'],
      coverKey: 'https://a/1.jpg',
    });
    expect(all.sources).toEqual([
      { sourceId: 'a/en', name: 'Source A', chapters: 3 },
      { sourceId: 'b/en', name: 'Source B', chapters: 1 },
    ]);
  });

  it('counts the library, what is being read, and the streak', () => {
    const month = stats().overview('month');
    expect(month.library).toEqual({ total: 2, reading: 1 });
    expect(month.streak).toEqual({ current: 2, best: 2 });
  });

  it('is empty for a new profile, and forgets sessions when cleared', () => {
    const service = stats();
    service.clear();
    const all = service.overview('all');
    expect(all.chaptersRead).toBe(0);
    expect(all.readingMs).toBe(0);
    expect(all.series).toHaveLength(1); // just this month
    expect(all.streak).toEqual({ current: 0, best: 0 });
  });
});

describe('streaks', () => {
  const key = (daysAgo: number) => {
    const d = new Date(startOfDay(NOW) - daysAgo * DAY + HOUR);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };

  it('keeps a streak alive until the end of today, and finds the best run', () => {
    expect(streaks(new Set([key(1), key(2), key(3)]), NOW)).toEqual({ current: 3, best: 3 });
    expect(streaks(new Set([key(0), key(1), key(5), key(6), key(7), key(8)]), NOW)).toEqual({ current: 2, best: 4 });
    expect(streaks(new Set([key(2)]), NOW)).toEqual({ current: 0, best: 1 });
  });
});

describe('StatsService at library scale', () => {
  it('answers for 1,000 manga, 50,000 chapters and 20,000 sessions quickly', () => {
    const db = connection.sqlite;
    db.prepare('DELETE FROM reading_sessions').run();
    const manga = db.prepare(
      `INSERT INTO manga (source_id, url, title, genres_json, in_library, status, created_at, updated_at)
       VALUES ('a/en', ?, ?, '["Action","Drama"]', 1, 'ongoing', 0, 0)`,
    );
    const chapter = db.prepare(
      'INSERT INTO chapters (manga_id, url, name, source_order, read, read_at, fetched_at) VALUES (?, ?, ?, 0, ?, ?, 0)',
    );
    const session = db.prepare(
      'INSERT INTO reading_sessions (manga_id, chapter_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?)',
    );
    db.transaction(() => {
      for (let m = 0; m < 1000; m++) {
        const mangaId = Number(manga.run(`/bulk/${m}`, `Bulk ${m}`).lastInsertRowid);
        for (let c = 0; c < 50; c++) {
          const read = c < 20;
          const when = NOW - ((m * 50 + c) % 400) * DAY;
          const chapterId = Number(
            chapter.run(mangaId, `bulk/${m}/${c}`, `Ch. ${c}`, read ? 1 : 0, read ? when : null).lastInsertRowid,
          );
          if (read) session.run(mangaId, chapterId, when, when + 600_000, 600_000);
        }
      }
    })();
    const service = new StatsService(connection.sqlite, () => NOW);
    const started = performance.now();
    const all = service.overview('all');
    const month = service.overview('month');
    const elapsed = performance.now() - started;
    expect(all.chaptersRead).toBe(20_000);
    expect(month.chaptersRead).toBeGreaterThan(0);
    expect(all.topManga).toHaveLength(5);
    expect(elapsed).toBeLessThan(1500);
  });
});
