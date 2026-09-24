import type { HistoryEntry } from '@manga-reader/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { chapters, history, manga, sources } from '../schema';
import { coverKeyOf } from './manga';

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
export const escapeLike = (text: string) => text.replace(/[%_\\]/g, (c) => `\\${c}`);

/** One row per manga: the chapter read last (BRAINSTORM.md §6.3). Statistics live elsewhere. */
export class HistoryRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  touch(mangaId: number, chapterId: number, now = Date.now()): void {
    this.db
      .insert(history)
      .values({ mangaId, chapterId, readAt: now })
      .onConflictDoUpdate({ target: history.mangaId, set: { chapterId, readAt: now } })
      .run();
    this.changes.mark('history');
  }

  /** Chapter read last in a manga, if any. */
  lastChapterId(mangaId: number): number | null {
    return this.db.select().from(history).where(eq(history.mangaId, mangaId)).get()?.chapterId ?? null;
  }

  /** Newest first; `query` matches the manga title. */
  list(options: { query?: string; limit?: number } = {}): HistoryEntry[] {
    const query = options.query?.trim();
    const rows = this.db
      .select({
        mangaId: manga.id,
        title: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        customCoverPath: manga.customCoverPath,
        sourceId: manga.sourceId,
        sourceName: sources.name,
        chapterId: chapters.id,
        chapterName: chapters.name,
        chapterNumber: chapters.number,
        lastPage: chapters.lastPage,
        totalPages: chapters.totalPages,
        read: chapters.read,
        readAt: history.readAt,
        // Unread chapters of hidden scanlators don't count (§6.2).
        hasUnread: sql<number>`EXISTS (
          SELECT 1 FROM ${chapters} u WHERE u.manga_id = ${manga.id} AND u.read = 0 AND u.source_missing = 0
            AND coalesce(u.scanlator, '') NOT IN (
              SELECT value FROM json_each(coalesce(${manga.scanlatorPrefsJson}, '{}'), '$.hidden')
            )
        )`,
      })
      .from(history)
      .innerJoin(manga, eq(manga.id, history.mangaId))
      .innerJoin(chapters, eq(chapters.id, history.chapterId))
      .leftJoin(sources, eq(sources.id, manga.sourceId))
      .where(query ? sql`${manga.title} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'` : undefined)
      .orderBy(desc(history.readAt))
      .limit(options.limit ?? 200)
      .all();
    return rows.map(({ thumbnailUrl, customCoverPath, hasUnread, ...row }) => ({
      ...row,
      coverKey: coverKeyOf({ thumbnailUrl, customCoverPath }),
      hasUnread: hasUnread === 1,
    }));
  }

  remove(mangaId: number): void {
    this.db.delete(history).where(eq(history.mangaId, mangaId)).run();
    this.changes.mark('history');
  }

  clear(): void {
    this.db.delete(history).run();
    this.changes.mark('history');
  }
}
