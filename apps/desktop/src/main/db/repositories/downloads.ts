import type { DownloadFormat, DownloadItem, DownloadStats, DownloadStatus } from '@manga-reader/shared';
import { and, asc, desc, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { chapters, downloads, manga, sources } from '../schema';
import { coverKeyOf } from './manga';

export type DownloadRow = typeof downloads.$inferSelect;

/** Statuses of chapters still to download (not finished, not failed). */
const PENDING: DownloadStatus[] = ['queued', 'downloading', 'paused'];

/**
 * The download queue and finished downloads (BRAINSTORM.md §6.4, §7). A chapter has at most one
 * row; it is downloaded when that row is `done`.
 */
export class DownloadsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  get(id: number): DownloadRow | undefined {
    return this.db.select().from(downloads).where(eq(downloads.id, id)).get();
  }

  byChapter(chapterId: number): DownloadRow | undefined {
    return this.db.select().from(downloads).where(eq(downloads.chapterId, chapterId)).get();
  }

  /** Queues chapters at the end; chapters that already have a row keep it. Returns the new ids. */
  enqueue(chapterIds: readonly number[], format: DownloadFormat, now = Date.now()): number[] {
    const added = this.db.transaction((tx) => {
      const existing = new Set(
        tx
          .select({ chapterId: downloads.chapterId })
          .from(downloads)
          .where(inArray(downloads.chapterId, [...chapterIds]))
          .all()
          .map((r) => r.chapterId),
      );
      let order =
        tx
          .select({ max: sql<number | null>`MAX(${downloads.queueOrder})` })
          .from(downloads)
          .get()?.max ?? 0;
      const ids: number[] = [];
      for (const chapterId of new Set(chapterIds)) {
        if (existing.has(chapterId)) continue;
        const row = tx
          .insert(downloads)
          .values({ chapterId, status: 'queued', queueOrder: ++order, format, createdAt: now })
          .returning({ id: downloads.id })
          .get();
        ids.push(row.id);
      }
      return ids;
    });
    if (added.length > 0) this.changes.mark('downloads');
    return added;
  }

  /** The next queued chapter, skipping those already running. */
  next(running: readonly number[]): DownloadRow | undefined {
    return this.db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.status, 'queued'), running.length > 0 ? notInArray(downloads.id, [...running]) : undefined),
      )
      .orderBy(asc(downloads.queueOrder), asc(downloads.id))
      .limit(1)
      .get();
  }

  setStatus(ids: readonly number[], status: DownloadStatus, from?: readonly DownloadStatus[]): number {
    if (ids.length === 0) return 0;
    const changed = this.db
      .update(downloads)
      .set({ status, ...(status === 'queued' ? { error: null } : {}) })
      .where(and(inArray(downloads.id, [...ids]), from ? inArray(downloads.status, [...from]) : undefined))
      .run().changes;
    if (changed > 0) this.changes.mark('downloads');
    return changed;
  }

  /** Every row in one of `from` statuses → `status` (pause/resume all). */
  setAllStatus(status: DownloadStatus, from: readonly DownloadStatus[]): number[] {
    const rows = this.db
      .update(downloads)
      .set({ status })
      .where(inArray(downloads.status, [...from]))
      .returning({ id: downloads.id })
      .all();
    if (rows.length > 0) this.changes.mark('downloads');
    return rows.map((r) => r.id);
  }

  /** Downloads that were running when the app quit go back to the queue. */
  resetInterrupted(): void {
    this.setAllStatus('queued', ['downloading']);
  }

  progress(id: number, pagesDone: number, pagesTotal: number): void {
    this.db.update(downloads).set({ pagesDone, pagesTotal }).where(eq(downloads.id, id)).run();
  }

  complete(id: number, path: string, sizeBytes: number, pagesTotal: number, now = Date.now()): void {
    this.db
      .update(downloads)
      .set({ status: 'done', path, sizeBytes, pagesDone: pagesTotal, pagesTotal, error: null, completedAt: now })
      .where(eq(downloads.id, id))
      .run();
    this.changes.mark('downloads');
  }

  fail(id: number, error: string): void {
    this.db.update(downloads).set({ status: 'error', error }).where(eq(downloads.id, id)).run();
    this.changes.mark('downloads');
  }

  remove(ids: readonly number[]): void {
    if (ids.length === 0) return;
    this.db
      .delete(downloads)
      .where(inArray(downloads.id, [...ids]))
      .run();
    this.changes.mark('downloads');
  }

  /** New order for the given rows (first to last); the others keep theirs, after them. */
  reorder(ids: readonly number[]): void {
    this.db.transaction((tx) => {
      ids.forEach((id, index) =>
        tx
          .update(downloads)
          .set({ queueOrder: index + 1 })
          .where(eq(downloads.id, id))
          .run(),
      );
      const rest = tx
        .select({ id: downloads.id })
        .from(downloads)
        .where(ids.length > 0 ? notInArray(downloads.id, [...ids]) : undefined)
        .orderBy(asc(downloads.queueOrder))
        .all();
      rest.forEach((row, index) =>
        tx
          .update(downloads)
          .set({ queueOrder: ids.length + index + 1 })
          .where(eq(downloads.id, row.id))
          .run(),
      );
    });
    this.changes.mark('downloads');
  }

  rowsForChapters(chapterIds: readonly number[]): DownloadRow[] {
    if (chapterIds.length === 0) return [];
    return this.db
      .select()
      .from(downloads)
      .where(inArray(downloads.chapterId, [...chapterIds]))
      .all();
  }

  /** The finished download now lives at `path` (the download folder moved). */
  relocate(id: number, path: string): void {
    this.db.update(downloads).set({ path }).where(eq(downloads.id, id)).run();
    this.changes.mark('downloads');
  }

  /** Something outside the rows changed what lists show (finished downloads cleared from the page). */
  touch(): void {
    this.changes.mark('downloads');
  }

  /** Rows with a finished file (moving the download folder, deleting a manga's downloads). */
  done(): DownloadRow[] {
    return this.db.select().from(downloads).where(eq(downloads.status, 'done')).all();
  }

  /**
   * Queue first (in order), then finished downloads, newest first. `completedAfter` leaves out
   * downloads finished before it (cleared from the Downloads page).
   */
  list(options: { mangaId?: number; completedAfter?: number } = {}): DownloadItem[] {
    const rows = this.db
      .select({
        download: downloads,
        mangaId: manga.id,
        mangaTitle: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        customCoverPath: manga.customCoverPath,
        sourceId: manga.sourceId,
        sourceName: sources.name,
        chapterName: chapters.name,
        chapterNumber: chapters.number,
        scanlator: chapters.scanlator,
      })
      .from(downloads)
      .innerJoin(chapters, eq(chapters.id, downloads.chapterId))
      .innerJoin(manga, eq(manga.id, chapters.mangaId))
      .leftJoin(sources, eq(sources.id, manga.sourceId))
      .where(
        and(
          options.mangaId === undefined ? undefined : eq(manga.id, options.mangaId),
          options.completedAfter === undefined
            ? undefined
            : or(ne(downloads.status, 'done'), gt(downloads.completedAt, options.completedAfter)),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${downloads.status} = 'done' THEN 1 ELSE 0 END`,
        // The queue by its order; finished downloads by completion time only.
        sql`CASE WHEN ${downloads.status} = 'done' THEN NULL ELSE ${downloads.queueOrder} END`,
        desc(downloads.completedAt),
        asc(downloads.id),
      )
      .all();
    return rows.map(({ download, thumbnailUrl, customCoverPath, ...row }) => ({
      ...row,
      id: download.id,
      chapterId: download.chapterId,
      coverKey: coverKeyOf({ thumbnailUrl, customCoverPath }),
      status: download.status,
      queueOrder: download.queueOrder,
      pagesDone: download.pagesDone,
      pagesTotal: download.pagesTotal,
      error: download.error,
      format: download.format,
      path: download.path,
      sizeBytes: download.sizeBytes,
      createdAt: download.createdAt,
      completedAt: download.completedAt,
    }));
  }

  stats(): DownloadStats {
    const counts = Object.fromEntries(
      this.db
        .select({ status: downloads.status, n: sql<number>`COUNT(*)`, bytes: sql<number>`SUM(${downloads.sizeBytes})` })
        .from(downloads)
        .groupBy(downloads.status)
        .all()
        .map((r) => [r.status, r]),
    );
    const count = (status: DownloadStatus) => counts[status]?.n ?? 0;
    return {
      queued: count('queued'),
      downloading: count('downloading'),
      paused: count('paused'),
      error: count('error'),
      done: count('done'),
      totalBytes: counts['done']?.bytes ?? 0,
    };
  }

  errorIds(): number[] {
    return this.db
      .select({ id: downloads.id })
      .from(downloads)
      .where(eq(downloads.status, 'error'))
      .all()
      .map((r) => r.id);
  }

  /** Ids of rows still waiting or running (not finished, not failed). */
  pendingIds(): number[] {
    return this.db
      .select({ id: downloads.id })
      .from(downloads)
      .where(inArray(downloads.status, PENDING))
      .all()
      .map((r) => r.id);
  }
}
