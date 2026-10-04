import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { type IMAGE_CACHE_KINDS, imageCache } from '../db/schema';

export type ImageKind = (typeof IMAGE_CACHE_KINDS)[number];

export interface CachedImage {
  key: string;
  path: string;
  contentType: string | null;
  sizeBytes: number;
}

/**
 * Disk cache for proxied images (`userData/cache/images`), indexed by the `image_cache` table.
 * Least-recently-used entries are evicted once the total passes `maxBytes` (docs/BRAINSTORM.md §6.5).
 */
export class ImageCache {
  private evicting: Promise<void> | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly dir: string,
    private maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  setMaxBytes(maxBytes: number): Promise<void> {
    this.maxBytes = maxBytes;
    return this.evict();
  }

  /** Returns the cached file and marks it as recently used; drops rows whose file vanished. */
  async get(key: string): Promise<CachedImage | undefined> {
    const row = this.db.select().from(imageCache).where(eq(imageCache.key, key)).get();
    if (!row) return undefined;
    const exists = await stat(row.path).then(
      () => true,
      () => false,
    );
    if (!exists) {
      this.db.delete(imageCache).where(eq(imageCache.key, key)).run();
      return undefined;
    }
    this.db.update(imageCache).set({ lastAccessAt: this.now() }).where(eq(imageCache.key, key)).run();
    return { key, path: row.path, contentType: row.contentType, sizeBytes: row.sizeBytes };
  }

  async put(key: string, kind: ImageKind, bytes: Uint8Array, contentType: string | null): Promise<CachedImage> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, createHash('sha1').update(key).digest('hex'));
    // Write-then-rename so a crash never leaves a truncated image behind a valid row.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    const values = { kind, path, sizeBytes: bytes.byteLength, contentType, lastAccessAt: this.now() };
    this.db
      .insert(imageCache)
      .values({ key, ...values })
      .onConflictDoUpdate({ target: imageCache.key, set: values })
      .run();
    void this.evict();
    return { key, path, contentType, sizeBytes: bytes.byteLength };
  }

  async delete(key: string): Promise<void> {
    const row = this.db.delete(imageCache).where(eq(imageCache.key, key)).returning().get();
    if (row) await rm(row.path, { force: true });
  }

  /** Removes every entry whose key starts with `prefix` (the variants of a page). */
  async deletePrefix(prefix: string): Promise<void> {
    const rows = this.db
      .delete(imageCache)
      .where(and(gte(imageCache.key, prefix), lt(imageCache.key, `${prefix}\uffff`)))
      .returning()
      .all();
    for (const row of rows) await rm(row.path, { force: true });
  }

  /** Bytes used by one kind of image (Settings → Data & storage). */
  bytesOf(kind: ImageKind): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${imageCache.sizeBytes}), 0)` })
      .from(imageCache)
      .where(eq(imageCache.kind, kind))
      .get();
    return row?.total ?? 0;
  }

  /** Empties one kind (reader pages, or browse covers). */
  async clear(kind: ImageKind): Promise<void> {
    const rows = this.db.delete(imageCache).where(eq(imageCache.kind, kind)).returning().all();
    for (const row of rows) await rm(row.path, { force: true });
  }

  totalBytes(): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${imageCache.sizeBytes}), 0)` })
      .from(imageCache)
      .get();
    return row?.total ?? 0;
  }

  /** Removes least-recently-used entries until the cache fits. Runs one pass at a time. */
  evict(): Promise<void> {
    this.evicting ??= this.evictNow().finally(() => (this.evicting = null));
    return this.evicting;
  }

  private async evictNow(): Promise<void> {
    let total = this.totalBytes();
    while (total > this.maxBytes) {
      const batch = this.db.select().from(imageCache).orderBy(asc(imageCache.lastAccessAt)).limit(50).all();
      if (batch.length === 0) return;
      for (const row of batch) {
        if (total <= this.maxBytes) break;
        this.db.delete(imageCache).where(eq(imageCache.key, row.key)).run();
        await rm(row.path, { force: true });
        total -= row.sizeBytes;
      }
    }
  }
}
