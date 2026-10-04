import type { Chapter, Page } from '@matane/extension-sdk';
import type { ChapterInfo } from '@manga-reader/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { chapters, downloads, history, manga, pageListCache, readingSessions } from '../schema';

export type ChapterRow = typeof chapters.$inferSelect;

export interface ChapterSyncResult {
  /** Ids of chapters seen for the first time, newest first. */
  added: number[];
  updated: number;
  /** Chapters the source no longer lists, kept and flagged `source_missing` (see `sync`). */
  missing: number;
  /** Chapters the source no longer lists that nothing referred to, deleted. */
  removed: number;
}

export function toChapterInfo(row: ChapterRow): ChapterInfo {
  return {
    id: row.id,
    mangaId: row.mangaId,
    url: row.url,
    name: row.name,
    number: row.number,
    scanlator: row.scanlator,
    uploadedAt: row.uploadedAt,
    sourceOrder: row.sourceOrder,
    read: row.read,
    readAt: row.readAt,
    bookmarked: row.bookmarked,
    lastPage: row.lastPage,
    totalPages: row.totalPages,
    pageOffset: row.pageOffset,
    sourceMissing: row.sourceMissing,
  };
}

export class ChaptersRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  /** Source order (newest first); chapters the source dropped go last since their order is stale. */
  list(mangaId: number): ChapterRow[] {
    return this.db
      .select()
      .from(chapters)
      .where(eq(chapters.mangaId, mangaId))
      .orderBy(asc(chapters.sourceMissing), asc(chapters.sourceOrder), asc(chapters.id))
      .all();
  }

  get(id: number): ChapterRow | undefined {
    return this.db.select().from(chapters).where(eq(chapters.id, id)).get();
  }

  /**
   * Makes the stored chapter list match the source (which lists newest first). Reading state is
   * never touched. A chapter the source dropped (docs/BRAINSTORM.md §6.4) stays, flagged, when it is
   * read, bookmarked, has progress, a download, or is in the history or statistics; otherwise it
   * is deleted. An empty list from the source deletes nothing (more likely a broken source).
   */
  sync(mangaId: number, incoming: readonly Chapter[], now = Date.now()): ChapterSyncResult {
    const result: ChapterSyncResult = { added: [], updated: 0, missing: 0, removed: 0 };
    this.db.transaction((tx) => {
      const existing = new Map(
        tx
          .select()
          .from(chapters)
          .where(eq(chapters.mangaId, mangaId))
          .all()
          .map((row) => [row.url, row]),
      );
      const seen = new Set<string>();
      let order = 0;
      for (const chapter of incoming) {
        if (!chapter.url || seen.has(chapter.url)) continue;
        seen.add(chapter.url);
        const values = {
          name: chapter.name,
          number: chapter.number ?? null,
          scanlator: chapter.scanlator ?? null,
          uploadedAt: chapter.uploadedAt ?? null,
          sourceOrder: order++,
          sourceMissing: false,
        };
        const row = existing.get(chapter.url);
        if (!row) {
          const inserted = tx
            .insert(chapters)
            .values({ mangaId, url: chapter.url, fetchedAt: now, ...values })
            .returning({ id: chapters.id })
            .get();
          result.added.push(inserted.id);
        } else if (
          row.name !== values.name ||
          row.number !== values.number ||
          row.scanlator !== values.scanlator ||
          row.uploadedAt !== values.uploadedAt ||
          row.sourceOrder !== values.sourceOrder ||
          row.sourceMissing
        ) {
          tx.update(chapters).set(values).where(eq(chapters.id, row.id)).run();
          result.updated++;
        }
      }
      const gone = [...existing.values()].filter((row) => !seen.has(row.url));
      const kept =
        incoming.length === 0 || gone.length === 0
          ? new Set(gone.map((row) => row.id))
          : new Set(
              tx
                .select({ id: chapters.id })
                .from(chapters)
                .where(
                  and(
                    inArray(
                      chapters.id,
                      gone.map((row) => row.id),
                    ),
                    sql`(${chapters.read} = 1 OR ${chapters.bookmarked} = 1 OR ${chapters.lastPage} > 0
                      OR ${chapters.pageOffset} IS NOT NULL
                      OR EXISTS (SELECT 1 FROM ${downloads} WHERE ${downloads.chapterId} = ${chapters.id})
                      OR EXISTS (SELECT 1 FROM ${history} WHERE ${history.chapterId} = ${chapters.id})
                      OR EXISTS (SELECT 1 FROM ${readingSessions} WHERE ${readingSessions.chapterId} = ${chapters.id}))`,
                  ),
                )
                .all()
                .map((r) => r.id),
            );
      for (const row of gone) {
        if (!kept.has(row.id)) {
          tx.delete(chapters).where(eq(chapters.id, row.id)).run();
          result.removed++;
        } else if (!row.sourceMissing) {
          tx.update(chapters).set({ sourceMissing: true }).where(eq(chapters.id, row.id)).run();
          result.missing++;
        }
      }
      tx.update(manga)
        .set({
          latestChapterAt: sql`(SELECT MAX(${chapters.uploadedAt}) FROM ${chapters} WHERE ${chapters.mangaId} = ${mangaId} AND ${chapters.sourceMissing} = 0)`,
        })
        .where(eq(manga.id, mangaId))
        .run();
    });
    if (result.added.length > 0 || result.updated > 0 || result.missing > 0 || result.removed > 0) {
      this.changes.mark(`chapters:${mangaId}`);
    }
    return result;
  }

  setBookmarked(chapterIds: readonly number[], bookmarked: boolean): void {
    const rows = this.db
      .update(chapters)
      .set({ bookmarked })
      .where(inArray(chapters.id, [...chapterIds]))
      .returning({ mangaId: chapters.mangaId })
      .all();
    for (const mangaId of new Set(rows.map((r) => r.mangaId))) this.changes.mark(`chapters:${mangaId}`);
  }

  // ------------------------------------------------------------ page list cache

  getCachedPages(chapterId: number, maxAgeMs: number, now = Date.now()): Page[] | undefined {
    const row = this.db.select().from(pageListCache).where(eq(pageListCache.chapterId, chapterId)).get();
    if (!row || now - row.fetchedAt > maxAgeMs) return undefined;
    try {
      return JSON.parse(row.pagesJson) as Page[];
    } catch {
      return undefined;
    }
  }

  cachePages(chapterId: number, pages: readonly Page[], now = Date.now()): void {
    const pagesJson = JSON.stringify(pages);
    this.db
      .insert(pageListCache)
      .values({ chapterId, pagesJson, fetchedAt: now })
      .onConflictDoUpdate({ target: pageListCache.chapterId, set: { pagesJson, fetchedAt: now } })
      .run();
    const row = this.db
      .update(chapters)
      .set({ totalPages: pages.length })
      .where(eq(chapters.id, chapterId))
      .returning({ mangaId: chapters.mangaId })
      .get();
    if (row) this.changes.mark(`chapters:${row.mangaId}`);
  }

  dropCachedPages(chapterId: number): void {
    this.db.delete(pageListCache).where(eq(pageListCache.chapterId, chapterId)).run();
  }
}
