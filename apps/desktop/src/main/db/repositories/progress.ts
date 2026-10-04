import { and, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { chapters } from '../schema';

export interface SavedProgress {
  chapterId: number;
  /** Page to resume at (0-based; first page of a spread). */
  page: number;
  /** Last page seen; reaching the last page marks the chapter read. */
  pageEnd: number;
  total: number;
  /** Scrolled fraction of `page` (webtoon), else null. */
  offset: number | null;
}

/**
 * Reading progress per chapter (docs/BRAINSTORM.md §6.3). Read state is kept **per chapter number**:
 * marking one scanlator's version also marks the others with the same number (§6.2), so unread
 * counts do not double up.
 */
export class ProgressRepository {
  /**
   * Told after chapters of a manga became read (the reader reaching the end, "mark as read", a
   * migration), so trackers can follow (ADR 0035). Not called for restores or marking unread.
   */
  onRead?: (mangaId: number) => void;

  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  /** Stores the position; returns the manga id, and whether the chapter just became read. */
  save(progress: SavedProgress, now = Date.now()): { mangaId: number; finished: boolean } | undefined {
    const row = this.db.select().from(chapters).where(eq(chapters.id, progress.chapterId)).get();
    if (!row) return undefined;
    const page = Math.min(progress.page, progress.total - 1);
    const finished = progress.pageEnd >= progress.total - 1;
    this.db.transaction((tx) => {
      tx.update(chapters)
        .set({ lastPage: page, totalPages: progress.total, pageOffset: progress.offset })
        .where(eq(chapters.id, row.id))
        .run();
      if (finished && !row.read) this.setRead(tx, [row.id], true, now);
    });
    this.changes.mark(`chapters:${row.mangaId}`);
    if (finished && !row.read) this.onRead?.(row.mangaId);
    return { mangaId: row.mangaId, finished: finished && !row.read };
  }

  /** Marks chapters (and their same-number versions) read or unread, clearing positions. */
  markRead(chapterIds: readonly number[], read: boolean, now = Date.now()): void {
    const mangaIds = this.db.transaction((tx) => this.setRead(tx, chapterIds, read, now));
    for (const id of mangaIds) this.changes.mark(`chapters:${id}`);
    if (read) for (const id of mangaIds) this.onRead?.(id);
  }

  /**
   * Chapters read of a manga as a tracker counts them: the highest chapter number read (rounded
   * down), or the number of chapters read when none has a number. Null when nothing is read.
   */
  highestRead(mangaId: number): number | null {
    const row = this.db
      .select({ highest: sql<number | null>`max(${chapters.number})`, count: sql<number>`count(*)` })
      .from(chapters)
      .where(and(eq(chapters.mangaId, mangaId), eq(chapters.read, true)))
      .get();
    if (!row || row.count === 0) return null;
    return row.highest === null ? row.count : Math.floor(row.highest);
  }

  /** Everything before `chapterId`: lower numbers, or older in source order when unnumbered. */
  markPreviousRead(chapterId: number, now = Date.now()): void {
    const row = this.db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
    if (!row) return;
    const older =
      row.number !== null
        ? and(eq(chapters.mangaId, row.mangaId), isNotNull(chapters.number), lt(chapters.number, row.number))
        : and(eq(chapters.mangaId, row.mangaId), gt(chapters.sourceOrder, row.sourceOrder));
    const ids = this.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(older)
      .all()
      .map((r) => r.id);
    if (ids.length > 0) this.markRead(ids, true, now);
  }

  private setRead(
    tx: Pick<AppDatabase, 'select' | 'update'>,
    chapterIds: readonly number[],
    read: boolean,
    now: number,
  ): Set<number> {
    const rows = tx
      .select()
      .from(chapters)
      .where(inArray(chapters.id, [...chapterIds]))
      .all();
    const mangaIds = new Set<number>();
    const values = read
      ? { read: true, readAt: now, lastPage: 0, pageOffset: null }
      : { read: false, readAt: null, lastPage: 0, pageOffset: null };
    for (const row of rows) {
      mangaIds.add(row.mangaId);
      // Same number → same read state, whichever scanlator's version was read.
      const target =
        row.number !== null
          ? and(eq(chapters.mangaId, row.mangaId), eq(chapters.number, row.number))
          : eq(chapters.id, row.id);
      tx.update(chapters)
        .set(read ? { ...values, readAt: sql`coalesce(${chapters.readAt}, ${now})` } : values)
        .where(target)
        .run();
    }
    return mangaIds;
  }
}
