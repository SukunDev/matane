import type { MangaDetails, MangaSummary } from '@manga-reader/extension-sdk';
import type { BrowseItem, MangaInfo } from '@manga-reader/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { manga, mangaCategories } from '../schema';

export type MangaRow = typeof manga.$inferSelect;

function parseGenres(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/** Identifies the cover on screen: a custom cover wins over the source's (BRAINSTORM.md §6.2). */
export const coverKeyOf = (row: Pick<MangaRow, 'customCoverPath' | 'thumbnailUrl'>) =>
  row.customCoverPath ?? row.thumbnailUrl;

export function toMangaInfo(row: MangaRow, categoryIds: number[] = []): MangaInfo {
  return {
    id: row.id,
    sourceId: row.sourceId,
    url: row.url,
    title: row.title,
    author: row.author,
    artist: row.artist,
    description: row.description,
    genres: parseGenres(row.genresJson),
    status: row.status,
    type: row.type,
    thumbnailUrl: row.thumbnailUrl,
    coverKey: coverKeyOf(row),
    hasCustomCover: row.customCoverPath !== null,
    inLibrary: row.inLibrary,
    categoryIds,
    lastFetchedAt: row.lastUpdateCheckAt,
  };
}

/** Manga rows are created the first time a source lists them, keyed by `(source_id, url)`. */
export class MangaRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  get(id: number): MangaRow | undefined {
    return this.db.select().from(manga).where(eq(manga.id, id)).get();
  }

  /** Row + categories, as the renderer sees it. */
  info(id: number): MangaInfo | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    const categoryIds = this.db
      .select({ id: mangaCategories.categoryId })
      .from(mangaCategories)
      .where(eq(mangaCategories.mangaId, id))
      .all()
      .map((c) => c.id);
    return toMangaInfo(row, categoryIds);
  }

  findByUrl(sourceId: string, url: string): MangaRow | undefined {
    return this.db
      .select()
      .from(manga)
      .where(and(eq(manga.sourceId, sourceId), eq(manga.url, url)))
      .get();
  }

  /**
   * Stores a browse page and returns it with DB ids. Existing rows get a fresher cover; titles
   * only change for manga outside the library (library titles are the user's reference).
   */
  upsertSummaries(sourceId: string, items: readonly MangaSummary[], now = Date.now()): BrowseItem[] {
    const result: BrowseItem[] = [];
    const seen = new Set<string>();
    this.db.transaction((tx) => {
      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        const thumbnailUrl = item.thumbnailUrl ?? null;
        const existing = tx
          .select()
          .from(manga)
          .where(and(eq(manga.sourceId, sourceId), eq(manga.url, item.url)))
          .get();
        if (!existing) {
          const inserted = tx
            .insert(manga)
            .values({ sourceId, url: item.url, title: item.title, thumbnailUrl, createdAt: now, updatedAt: now })
            .returning({ id: manga.id })
            .get();
          result.push({
            mangaId: inserted.id,
            url: item.url,
            title: item.title,
            thumbnailUrl,
            coverKey: thumbnailUrl,
            inLibrary: false,
          });
          continue;
        }
        const title = !existing.inLibrary && item.title ? item.title : existing.title;
        const cover = thumbnailUrl ?? existing.thumbnailUrl;
        if (title !== existing.title || cover !== existing.thumbnailUrl) {
          tx.update(manga).set({ title, thumbnailUrl: cover, updatedAt: now }).where(eq(manga.id, existing.id)).run();
          this.changes.mark(`manga:${existing.id}`);
        }
        result.push({
          mangaId: existing.id,
          url: item.url,
          title,
          thumbnailUrl: cover,
          coverKey: existing.customCoverPath ?? cover,
          inLibrary: existing.inLibrary,
        });
      }
    });
    return result;
  }

  /** Get-or-create for a single summary (e.g. from resolveUrl). */
  ensure(sourceId: string, summary: MangaSummary, now = Date.now()): number {
    const [item] = this.upsertSummaries(sourceId, [summary], now);
    return item!.mangaId;
  }

  /** Permanent copy of the source cover for library manga (not shown differently, no event). */
  setCoverPath(id: number, path: string | null): void {
    this.db.update(manga).set({ coverPath: path }).where(eq(manga.id, id)).run();
  }

  setCustomCoverPath(id: number, path: string | null): void {
    this.db.update(manga).set({ customCoverPath: path }).where(eq(manga.id, id)).run();
    this.changes.mark(`manga:${id}`, 'library');
  }

  updateDetails(id: number, details: MangaDetails, now = Date.now()): MangaRow {
    const existing = this.get(id);
    if (!existing) throw new Error(`Manga ${id} not found`);
    const row = this.db
      .update(manga)
      .set({
        // Keep the user's library title; fill an empty one (resolveUrl creates rows without titles).
        title: existing.inLibrary && existing.title ? existing.title : details.title || existing.title,
        author: details.author ?? null,
        artist: details.artist ?? null,
        description: details.description ?? null,
        genresJson: JSON.stringify(details.genres ?? []),
        status: details.status,
        type: details.type ?? null,
        thumbnailUrl: details.thumbnailUrl ?? existing.thumbnailUrl,
        lastUpdateCheckAt: now,
        updatedAt: now,
      })
      .where(eq(manga.id, id))
      .returning()
      .get();
    this.changes.mark(`manga:${id}`);
    return row;
  }
}
