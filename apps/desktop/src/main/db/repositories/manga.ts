import type { MangaDetails, MangaSummary } from '@manga-reader/extension-sdk';
import type { BrowseItem, MangaInfo } from '@manga-reader/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { manga } from '../schema';

export type MangaRow = typeof manga.$inferSelect;

function parseGenres(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export function toMangaInfo(row: MangaRow): MangaInfo {
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
    inLibrary: row.inLibrary,
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
          result.push({ mangaId: inserted.id, url: item.url, title: item.title, thumbnailUrl, inLibrary: false });
          continue;
        }
        const title = !existing.inLibrary && item.title ? item.title : existing.title;
        const cover = thumbnailUrl ?? existing.thumbnailUrl;
        if (title !== existing.title || cover !== existing.thumbnailUrl) {
          tx.update(manga).set({ title, thumbnailUrl: cover, updatedAt: now }).where(eq(manga.id, existing.id)).run();
          this.changes.mark(`manga:${existing.id}`);
        }
        result.push({ mangaId: existing.id, url: item.url, title, thumbnailUrl: cover, inLibrary: existing.inLibrary });
      }
    });
    return result;
  }

  /** Get-or-create for a single summary (e.g. from resolveUrl). */
  ensure(sourceId: string, summary: MangaSummary, now = Date.now()): number {
    const [item] = this.upsertSummaries(sourceId, [summary], now);
    return item!.mangaId;
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
