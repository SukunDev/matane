import type { StatsOverview, StatsRange } from '@manga-reader/shared';
import type Database from 'better-sqlite3';
import { coverKeyOf } from '../db/repositories/manga';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_GENRES = 5;
const TOP_MANGA = 5;

/** Local midnight of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
}

/** The local day ("2026-10-01") of a time, for streaks. */
const dayKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/**
 * Consecutive reading days ending today, or yesterday when nothing was read yet today (the streak
 * is still alive), and the longest run.
 */
export function streaks(days: Set<string>, now: number): { current: number; best: number } {
  let current = 0;
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  while (days.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days]
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y!, m! - 1, d!).getTime();
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { current, best };
}

interface SessionRow {
  mangaId: number;
  startedAt: number;
  activeMs: number;
}

interface ReadRow {
  mangaId: number;
  readAt: number;
}

interface MangaRow {
  id: number;
  title: string;
  author: string | null;
  genresJson: string | null;
  sourceId: string;
  customCoverPath: string | null;
  thumbnailUrl: string | null;
}

/**
 * Reading statistics (BRAINSTORM.md §6.3, mockup 14), from `reading_sessions` (time) and chapters
 * finished in the reader (read, with a session). Queries are bounded by the indexed `started_at`;
 * the rest is counted here.
 */
export class StatsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  overview(range: StatsRange): StatsOverview {
    const now = this.now();
    const today = startOfDay(now);
    const from =
      range === 'week'
        ? addDays(today, -6)
        : range === 'month'
          ? addDays(today, -29)
          : range === 'year'
            ? addMonths(startOfMonth(now), -11)
            : null;

    const sessions = this.sqlite
      .prepare(
        `SELECT manga_id AS mangaId, started_at AS startedAt, active_ms AS activeMs FROM reading_sessions
         WHERE started_at >= ? AND active_ms > 0`,
      )
      .all(from ?? 0) as SessionRow[];
    const read = this.sqlite
      .prepare(
        `WITH opened AS (SELECT DISTINCT chapter_id FROM reading_sessions)
         SELECT c.manga_id AS mangaId, c.read_at AS readAt FROM chapters c JOIN opened o ON o.chapter_id = c.id
         WHERE c.read = 1 AND c.read_at IS NOT NULL AND c.read_at >= ?`,
      )
      .all(from ?? 0) as ReadRow[];

    // Buckets: days for a week or a month, months for a year or everything.
    const unit = range === 'week' || range === 'month' ? 'day' : 'month';
    // All time starts at the month of the first reading (a loop: there can be many rows).
    let earliest = now;
    for (const session of sessions) earliest = Math.min(earliest, session.startedAt);
    for (const row of read) earliest = Math.min(earliest, row.readAt);
    const first = from ?? startOfMonth(earliest);
    const starts: number[] = [];
    for (let start = first; start <= now; start = unit === 'day' ? addDays(start, 1) : addMonths(start, 1)) {
      starts.push(start);
    }
    const series = starts.map((start) => ({ start, chapters: 0, ms: 0 }));
    const index = new Map(starts.map((start, i) => [start, i]));
    const bucketOf = (ms: number) => series[index.get(unit === 'day' ? startOfDay(ms) : startOfMonth(ms)) ?? -1];
    for (const session of sessions) {
      const bucket = bucketOf(session.startedAt);
      if (bucket) bucket.ms += session.activeMs;
    }
    for (const row of read) {
      const bucket = bucketOf(row.readAt);
      if (bucket) bucket.chapters++;
    }

    // Per manga: time and chapters; then genres and sources from the manga rows.
    const perManga = new Map<number, { ms: number; chapters: number }>();
    const of = (id: number) => {
      let entry = perManga.get(id);
      if (!entry) perManga.set(id, (entry = { ms: 0, chapters: 0 }));
      return entry;
    };
    for (const session of sessions) of(session.mangaId).ms += session.activeMs;
    for (const row of read) of(row.mangaId).chapters++;
    const ids = [...perManga.keys()];
    const rows = new Map<number, MangaRow>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const found = this.sqlite
        .prepare(
          `SELECT id, title, author, genres_json AS genresJson, source_id AS sourceId,
                  custom_cover_path AS customCoverPath, thumbnail_url AS thumbnailUrl
           FROM manga WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .all(...chunk) as MangaRow[];
      for (const row of found) rows.set(row.id, row);
    }
    const genresOf = (row: MangaRow | undefined): string[] => {
      try {
        const parsed: unknown = JSON.parse(row?.genresJson ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
      } catch {
        return [];
      }
    };

    const genreCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    for (const [id, entry] of perManga) {
      if (entry.chapters === 0) continue;
      const row = rows.get(id);
      for (const genre of genresOf(row)) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + entry.chapters);
      if (row) sourceCounts.set(row.sourceId, (sourceCounts.get(row.sourceId) ?? 0) + entry.chapters);
    }
    const genres = [...genreCounts]
      .map(([name, chapters]) => ({ name, chapters }))
      .sort((a, b) => b.chapters - a.chapters || a.name.localeCompare(b.name));
    const sourceNames = new Map(
      (this.sqlite.prepare('SELECT id, name FROM sources').all() as { id: string; name: string }[]).map((s) => [
        s.id,
        s.name,
      ]),
    );

    const topManga = [...perManga]
      .filter(([id]) => rows.has(id))
      .sort(([, a], [, b]) => b.ms - a.ms || b.chapters - a.chapters)
      .slice(0, TOP_MANGA)
      .map(([id, entry]) => {
        const row = rows.get(id)!;
        return {
          mangaId: id,
          title: row.title,
          coverKey: coverKeyOf(row),
          author: row.author,
          genres: genresOf(row).slice(0, 2),
          chapters: entry.chapters,
          ms: entry.ms,
        };
      });

    const library = this.sqlite
      .prepare(
        `SELECT count(*) AS total,
                coalesce(sum(EXISTS (SELECT 1 FROM history h WHERE h.manga_id = m.id)
                         AND EXISTS (SELECT 1 FROM chapters c WHERE c.manga_id = m.id AND c.read = 0)), 0) AS reading
         FROM manga m WHERE m.in_library = 1`,
      )
      .get() as { total: number; reading: number };
    const allDays = new Set(
      (
        this.sqlite.prepare('SELECT started_at AS startedAt FROM reading_sessions WHERE active_ms > 0').all() as {
          startedAt: number;
        }[]
      ).map((row) => dayKey(row.startedAt)),
    );

    return {
      range,
      from,
      days: Math.max(1, Math.round((startOfDay(now) - startOfDay(first)) / DAY_MS) + 1),
      chaptersRead: read.length,
      readingMs: sessions.reduce((sum, s) => sum + s.activeMs, 0),
      library,
      streak: streaks(allDays, now),
      unit,
      series,
      genres: genres.slice(0, TOP_GENRES),
      otherGenreChapters: genres.slice(TOP_GENRES).reduce((sum, g) => sum + g.chapters, 0),
      topManga,
      sources: [...sourceCounts]
        .map(([sourceId, chapters]) => ({ sourceId, name: sourceNames.get(sourceId) ?? sourceId, chapters }))
        .sort((a, b) => b.chapters - a.chapters),
    };
  }

  /** Forgets every reading session (Settings → Data). Progress, read status and history stay. */
  clear(): void {
    this.sqlite.prepare('DELETE FROM reading_sessions').run();
  }
}
