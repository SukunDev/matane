import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { pageMeta } from '../db/schema';
import type { Box, Size } from './processing';

export interface PageMeta extends Size {
  /** Size in bytes of the image this was measured on. */
  bytes: number;
  /** Undefined until computed; the whole page when there is nothing to crop. */
  crop: Box | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Page sizes and crop boxes (`page_meta`, ADR 0025), keyed like the page's cache entry
 * (`page:<sourceId>:<chapter url hash>:<index>`). Rows used in the last day are not touched again,
 * so reading does not write on every page.
 */
export class PageMetaStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): PageMeta | undefined {
    const row = this.db.select().from(pageMeta).where(eq(pageMeta.key, key)).get();
    if (!row) return undefined;
    if (this.now() - row.accessedAt > DAY_MS) {
      this.db.update(pageMeta).set({ accessedAt: this.now() }).where(eq(pageMeta.key, key)).run();
    }
    return toMeta(row);
  }

  /** Every known page under a key prefix (one chapter), by index. */
  list(prefix: string): { index: number; meta: PageMeta }[] {
    return this.db
      .select()
      .from(pageMeta)
      .where(and(gte(pageMeta.key, prefix), lt(pageMeta.key, `${prefix}\uffff`)))
      .all()
      .map((row) => ({ index: Number(row.key.slice(prefix.length)), meta: toMeta(row) }))
      .filter(({ index }) => Number.isInteger(index) && index >= 0);
  }

  /** Records a freshly measured image; any crop box of a previous image is dropped. */
  put(key: string, bytes: number, size: Size): void {
    const values = {
      bytes,
      width: size.width,
      height: size.height,
      cropLeft: null,
      cropTop: null,
      cropWidth: null,
      cropHeight: null,
      accessedAt: this.now(),
    };
    this.db
      .insert(pageMeta)
      .values({ key, ...values })
      .onConflictDoUpdate({ target: pageMeta.key, set: values })
      .run();
  }

  setCrop(key: string, box: Box): void {
    this.db
      .update(pageMeta)
      .set({ cropLeft: box.left, cropTop: box.top, cropWidth: box.width, cropHeight: box.height })
      .where(eq(pageMeta.key, key))
      .run();
  }

  delete(key: string): void {
    this.db.delete(pageMeta).where(eq(pageMeta.key, key)).run();
  }

  clear(): void {
    this.db.delete(pageMeta).run();
  }

  /** Keeps (about) the `max` most recently used rows; rows used at the same moment go together. */
  prune(max: number): void {
    const cutoff = this.db
      .select({ accessedAt: pageMeta.accessedAt })
      .from(pageMeta)
      .orderBy(desc(pageMeta.accessedAt))
      .limit(1)
      .offset(max)
      .get();
    if (cutoff) this.db.delete(pageMeta).where(lte(pageMeta.accessedAt, cutoff.accessedAt)).run();
  }

  count(): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(pageMeta)
        .get()?.n ?? 0
    );
  }
}

function toMeta(row: typeof pageMeta.$inferSelect): PageMeta {
  const crop =
    row.cropLeft !== null && row.cropTop !== null && row.cropWidth !== null && row.cropHeight !== null
      ? { left: row.cropLeft, top: row.cropTop, width: row.cropWidth, height: row.cropHeight }
      : undefined;
  return { bytes: row.bytes, width: row.width, height: row.height, crop };
}
