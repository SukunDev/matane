import type {
  LibraryCounts,
  LibraryFilters,
  LibraryItem,
  LibrarySortKey,
  LibraryTab,
  MangaInfo,
} from '@manga-reader/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { manga, mangaCategories } from '../schema';
import { type MangaRow, coverKeyOf, toMangaInfo } from './manga';

export interface LibraryQuery {
  tab: LibraryTab;
  sort: LibrarySortKey;
  ascending: boolean;
  filters: LibraryFilters;
  query?: string;
}

interface Row {
  mangaId: number;
  title: string;
  customCoverPath: string | null;
  thumbnailUrl: string | null;
  sourceId: string;
  sourceName: string | null;
  status: LibraryItem['status'];
  addedAt: number | null;
  latestChapterAt: number | null;
  lastReadAt: number | null;
  lastReadChapter: string | null;
  chapterCount: number;
  readCount: number;
  categoryIds: string | null;
}

const ORDER: Record<LibrarySortKey, string> = {
  title: 'title COLLATE NOCASE',
  lastRead: 'lastReadAt',
  latestChapter: 'latestChapterAt',
  added: 'addedAt',
  unread: '(chapterCount - readCount)',
  total: 'chapterCount',
};

/**
 * "one piece" → `"one"* "piece"*`: every word must match, as a prefix, in title/author/genres.
 * Quotes are doubled so user input can never break out of the FTS5 string syntax.
 */
export function ftsQuery(text: string): string | null {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, '""')}"*`);
  return words.length > 0 ? words.join(' ') : null;
}

/** Lowercase, accents and punctuation stripped: "Kage no Jitsuryokusha ni Naritakute!" ≈ "kage no jitsuryokusha…". */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Library membership, categories and the library view (BRAINSTORM.md §6.2). */
export class LibraryRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  list(options: LibraryQuery): LibraryItem[] {
    const { filters } = options;
    const where = [sql`m.in_library = 1`];
    if (options.tab === 'default') {
      where.push(sql`NOT EXISTS (SELECT 1 FROM manga_categories mc WHERE mc.manga_id = m.id)`);
    } else if (typeof options.tab === 'number') {
      where.push(
        sql`EXISTS (SELECT 1 FROM manga_categories mc WHERE mc.manga_id = m.id AND mc.category_id = ${options.tab})`,
      );
    }
    if (filters.status.length > 0) {
      where.push(
        sql`m.status IN (${sql.join(
          filters.status.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    }
    if (filters.sourceIds.length > 0) {
      where.push(
        sql`m.source_id IN (${sql.join(
          filters.sourceIds.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    }
    if (filters.bookmarked) {
      where.push(sql`EXISTS (SELECT 1 FROM chapters b WHERE b.manga_id = m.id AND b.bookmarked = 1)`);
    }
    const fts = options.query ? ftsQuery(options.query) : null;
    if (fts) where.push(sql`m.id IN (SELECT rowid FROM manga_fts WHERE manga_fts MATCH ${fts})`);

    const outer = [sql`1 = 1`];
    if (filters.unread) outer.push(sql`chapterCount > readCount`);
    if (filters.reading) outer.push(sql`lastReadAt IS NOT NULL AND chapterCount > readCount`);
    const direction = options.ascending ? sql.raw('ASC') : sql.raw('DESC');

    // Chapters count once per number (several scanlator versions of one chapter, §6.2); a number
    // is read when any of its versions is. Hidden scanlators don't count.
    const rows = this.db.all<Row>(sql`
      WITH hidden AS (
        SELECT m.id AS manga_id, j.value AS name
        FROM manga m, json_each(m.scanlator_prefs_json, '$.hidden') j
        WHERE m.in_library = 1 AND m.scanlator_prefs_json IS NOT NULL
      ),
      counts AS (
        SELECT manga_id,
          COUNT(DISTINCT coalesce(CAST(number AS TEXT), 'id' || id)) AS total,
          COUNT(DISTINCT CASE WHEN read = 1 THEN coalesce(CAST(number AS TEXT), 'id' || id) END) AS done
        FROM chapters ch
        WHERE source_missing = 0 AND manga_id IN (SELECT id FROM manga WHERE in_library = 1)
          AND NOT EXISTS (
            SELECT 1 FROM hidden h WHERE h.manga_id = ch.manga_id AND h.name = coalesce(ch.scanlator, '')
          )
        GROUP BY manga_id
      ),
      lib AS (
        SELECT m.id AS mangaId, m.title AS title, m.custom_cover_path AS customCoverPath,
          m.thumbnail_url AS thumbnailUrl, m.source_id AS sourceId, s.name AS sourceName, m.status AS status,
          m.added_at AS addedAt, m.latest_chapter_at AS latestChapterAt,
          h.read_at AS lastReadAt, hc.name AS lastReadChapter,
          coalesce(c.total, 0) AS chapterCount, coalesce(c.done, 0) AS readCount,
          (SELECT group_concat(mc.category_id) FROM manga_categories mc WHERE mc.manga_id = m.id) AS categoryIds
        FROM manga m
        LEFT JOIN sources s ON s.id = m.source_id
        LEFT JOIN counts c ON c.manga_id = m.id
        LEFT JOIN history h ON h.manga_id = m.id
        LEFT JOIN chapters hc ON hc.id = h.chapter_id
        WHERE ${sql.join(where, sql` AND `)}
      )
      SELECT * FROM lib
      WHERE ${sql.join(outer, sql` AND `)}
      ORDER BY ${sql.raw(ORDER[options.sort])} ${direction} NULLS LAST, title COLLATE NOCASE ASC
    `);
    return rows.map((row) => ({
      mangaId: row.mangaId,
      title: row.title,
      coverKey: coverKeyOf(row),
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      status: row.status,
      unreadCount: row.chapterCount - row.readCount,
      readCount: row.readCount,
      chapterCount: row.chapterCount,
      lastReadAt: row.lastReadAt,
      lastReadChapter: row.lastReadChapter,
      latestChapterAt: row.latestChapterAt,
      addedAt: row.addedAt,
      categoryIds: row.categoryIds ? row.categoryIds.split(',').map(Number) : [],
    }));
  }

  counts(): LibraryCounts {
    const total = this.db.get<{ all: number; uncategorized: number }>(sql`
      SELECT COUNT(*) AS "all",
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM manga_categories mc WHERE mc.manga_id = m.id) THEN 1 ELSE 0 END) AS uncategorized
      FROM manga m WHERE m.in_library = 1
    `);
    const perCategory = this.db.all<{ categoryId: number; n: number }>(sql`
      SELECT mc.category_id AS categoryId, COUNT(*) AS n
      FROM manga_categories mc JOIN manga m ON m.id = mc.manga_id
      WHERE m.in_library = 1 GROUP BY mc.category_id
    `);
    return {
      all: total?.all ?? 0,
      default: total?.uncategorized ?? 0,
      byCategory: Object.fromEntries(perCategory.map((c) => [String(c.categoryId), c.n])),
    };
  }

  /** Puts a manga in the library (keeping the first `added_at`) with exactly these categories. */
  add(mangaId: number, categoryIds: readonly number[], now = Date.now()): void {
    this.db.transaction((tx) => {
      tx.update(manga)
        .set({ inLibrary: true, addedAt: sql`coalesce(${manga.addedAt}, ${now})` })
        .where(eq(manga.id, mangaId))
        .run();
      this.replaceCategories(tx, [mangaId], categoryIds);
    });
    this.changes.mark('library', `manga:${mangaId}`);
  }

  remove(mangaIds: readonly number[]): void {
    this.db.transaction((tx) => {
      tx.update(manga)
        .set({ inLibrary: false })
        .where(inArray(manga.id, [...mangaIds]))
        .run();
      tx.delete(mangaCategories)
        .where(inArray(mangaCategories.mangaId, [...mangaIds]))
        .run();
    });
    this.changes.mark('library', ...mangaIds.map((id) => `manga:${id}` as const));
  }

  setCategories(mangaIds: readonly number[], categoryIds: readonly number[]): void {
    this.db.transaction((tx) => this.replaceCategories(tx, mangaIds, categoryIds));
    this.changes.mark('library', 'categories', ...mangaIds.map((id) => `manga:${id}` as const));
  }

  /** Other library manga (from other sources) whose normalized title matches. */
  findDuplicates(mangaId: number): MangaInfo[] {
    const row = this.db.select().from(manga).where(eq(manga.id, mangaId)).get();
    if (!row) return [];
    const key = normalizeTitle(row.title);
    if (!key) return [];
    return this.db
      .select()
      .from(manga)
      .where(and(eq(manga.inLibrary, true), sql`${manga.id} != ${mangaId}`))
      .all()
      .filter((other: MangaRow) => other.sourceId !== row.sourceId && normalizeTitle(other.title) === key)
      .map((other) => toMangaInfo(other));
  }

  private replaceCategories(
    tx: Pick<AppDatabase, 'delete' | 'insert'>,
    mangaIds: readonly number[],
    categoryIds: readonly number[],
  ): void {
    tx.delete(mangaCategories)
      .where(inArray(mangaCategories.mangaId, [...mangaIds]))
      .run();
    const rows = mangaIds.flatMap((mangaId) =>
      [...new Set(categoryIds)].map((categoryId) => ({ mangaId, categoryId })),
    );
    if (rows.length > 0) tx.insert(mangaCategories).values(rows).onConflictDoNothing().run();
  }
}
