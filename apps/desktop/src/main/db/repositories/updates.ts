import type { MANGA_STATUSES, UpdateEntry, UpdateScope } from '@manga-reader/shared';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { coverKeyOf, scanlatorPrefsOf } from './manga';

type MangaStatus = (typeof MANGA_STATUSES)[number];

/** A library manga an update check may cover, with what the skip rules look at. */
export interface UpdateTarget {
  mangaId: number;
  title: string;
  status: MangaStatus;
  /** Unread chapter numbers (versions count once), chapters the source dropped left out. */
  unread: number;
  /** Read at least one chapter, or opened one (history). */
  started: boolean;
  categoryIds: number[];
}

/** Most entries the Updates page lists (the newest). */
const LIST_LIMIT = 2000;

/**
 * Queries behind the update checker and the Updates page (docs/BRAINSTORM.md §6.4, §7): new chapters are
 * chapters of library manga first seen after the manga joined the library (`fetched_at >
 * added_at`), so the chapters it already had never show up, with no schema change.
 */
export class UpdatesRepository {
  constructor(private readonly db: AppDatabase) {}

  targets(scope: UpdateScope): UpdateTarget[] {
    const where =
      scope.kind === 'category'
        ? sql`AND EXISTS (SELECT 1 FROM manga_categories mc WHERE mc.manga_id = m.id AND mc.category_id = ${scope.categoryId})`
        : scope.kind === 'manga'
          ? sql`AND m.id IN (${sql.join(
              scope.mangaIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql``;
    const rows = this.db.all<{
      mangaId: number;
      title: string;
      status: MangaStatus;
      unread: number;
      started: number;
      categoryIds: string | null;
    }>(sql`
      SELECT m.id AS mangaId, m.title AS title, m.status AS status,
        (SELECT COUNT(DISTINCT coalesce(c.number, -c.id)) FROM chapters c
          WHERE c.manga_id = m.id AND c.read = 0 AND c.source_missing = 0) AS unread,
        (EXISTS (SELECT 1 FROM chapters c WHERE c.manga_id = m.id AND c.read = 1)
          OR EXISTS (SELECT 1 FROM history h WHERE h.manga_id = m.id)) AS started,
        (SELECT group_concat(mc.category_id) FROM manga_categories mc WHERE mc.manga_id = m.id) AS categoryIds
      FROM manga m
      WHERE m.in_library = 1 ${where}
      ORDER BY m.title COLLATE NOCASE
    `);
    return rows.map((row) => ({
      ...row,
      started: row.started === 1,
      categoryIds: row.categoryIds ? row.categoryIds.split(',').map(Number) : [],
    }));
  }

  /**
   * New chapters, newest first (then by manga and source order). Chapters of hidden scanlators
   * and chapters the source dropped are left out. `since` keeps only those first seen after it.
   */
  list(options: { categoryId?: number; since?: number } = {}): UpdateEntry[] {
    const rows = this.db.all<{
      chapterId: number;
      mangaId: number;
      mangaTitle: string;
      thumbnailUrl: string | null;
      customCoverPath: string | null;
      scanlatorPrefsJson: string | null;
      sourceId: string;
      sourceName: string | null;
      chapterName: string;
      chapterNumber: number | null;
      scanlator: string | null;
      fetchedAt: number;
      read: number;
      lastPage: number;
      totalPages: number | null;
    }>(sql`
      SELECT c.id AS chapterId, m.id AS mangaId, m.title AS mangaTitle, m.thumbnail_url AS thumbnailUrl,
        m.custom_cover_path AS customCoverPath, m.scanlator_prefs_json AS scanlatorPrefsJson,
        m.source_id AS sourceId, s.name AS sourceName, c.name AS chapterName, c.number AS chapterNumber,
        c.scanlator AS scanlator, c.fetched_at AS fetchedAt, c.read AS read, c.last_page AS lastPage,
        c.total_pages AS totalPages
      FROM chapters c
      JOIN manga m ON m.id = c.manga_id
      LEFT JOIN sources s ON s.id = m.source_id
      WHERE m.in_library = 1 AND m.added_at IS NOT NULL AND c.fetched_at > m.added_at AND c.source_missing = 0
        ${options.since === undefined ? sql`` : sql`AND c.fetched_at > ${options.since}`}
        ${
          options.categoryId === undefined
            ? sql``
            : sql`AND EXISTS (SELECT 1 FROM manga_categories mc WHERE mc.manga_id = m.id AND mc.category_id = ${options.categoryId})`
        }
      ORDER BY c.fetched_at DESC, m.title COLLATE NOCASE, c.source_order ASC
      LIMIT ${LIST_LIMIT}
    `);
    return rows
      .filter((row) => !scanlatorPrefsOf(row).hidden.includes(row.scanlator ?? ''))
      .map(({ thumbnailUrl, customCoverPath, scanlatorPrefsJson: _prefs, read, ...row }) => ({
        ...row,
        read: read === 1,
        coverKey: coverKeyOf({ thumbnailUrl, customCoverPath }),
      }));
  }

  /** Unread new chapters first seen after `since` (the sidebar badge). */
  unseen(since: number): number {
    return this.list({ since }).filter((entry) => !entry.read).length;
  }
}
