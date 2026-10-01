import type { MangaDetails, MangaSummary } from '@matane/extension-sdk';
import {
  type BrowseItem,
  type ChapterView,
  type MangaInfo,
  type MangaReaderSettings,
  type ScanlatorPrefs,
  chapterViewSchema,
  mangaReaderSettingsSchema,
  scanlatorPrefsSchema,
} from '@manga-reader/shared';
import type { z } from 'zod';
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

/** A JSON column read with its schema; null when empty or unreadable. */
function parseJson<T extends z.ZodType>(schema: T, json: string | null): z.output<T> | null {
  if (!json) return null;
  try {
    const result = schema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export const scanlatorPrefsOf = (row: Pick<MangaRow, 'scanlatorPrefsJson'>): ScanlatorPrefs =>
  parseJson(scanlatorPrefsSchema, row.scanlatorPrefsJson) ?? { hidden: [], priority: [] };

/** Identifies the cover on screen: a custom cover wins over the source's (BRAINSTORM.md §6.2). */
export const coverKeyOf = (row: Pick<MangaRow, 'customCoverPath' | 'thumbnailUrl'>) =>
  row.customCoverPath ?? row.thumbnailUrl;

/**
 * The dominant colour of the cover on screen ("#rrggbb"), stored with the cover key it was taken
 * from: a new cover (from the source or custom) makes it stale until measured again.
 */
export function coverColorOf(row: Pick<MangaRow, 'coverColor' | 'customCoverPath' | 'thumbnailUrl'>): string | null {
  if (!row.coverColor) return null;
  const space = row.coverColor.indexOf(' ');
  const key = coverKeyOf(row);
  return space > 0 && key !== null && row.coverColor.slice(space + 1) === key ? row.coverColor.slice(0, space) : null;
}

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
    coverColor: coverColorOf(row),
    hasCustomCover: row.customCoverPath !== null,
    inLibrary: row.inLibrary,
    categoryIds,
    lastFetchedAt: row.lastUpdateCheckAt,
    readerSettings: parseJson(mangaReaderSettingsSchema, row.readerSettingsJson),
    scanlatorPrefs: scanlatorPrefsOf(row),
    chapterView: parseJson(chapterViewSchema, row.chapterViewJson),
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

  /** Records the colour of the cover under `key` (see `coverColorOf`). */
  setCoverColor(id: number, color: string, key: string): void {
    this.db
      .update(manga)
      .set({ coverColor: `${color} ${key}` })
      .where(eq(manga.id, id))
      .run();
    this.changes.mark(`manga:${id}`);
  }

  setCustomCoverPath(id: number, path: string | null): void {
    this.db.update(manga).set({ customCoverPath: path }).where(eq(manga.id, id)).run();
    this.changes.mark(`manga:${id}`, 'library');
  }

  /** Reader override for this manga (BRAINSTORM.md §6.1); null goes back to the global settings. */
  setReaderSettings(id: number, settings: MangaReaderSettings | null): void {
    const empty = !settings || Object.values(settings).every((value) => value === undefined);
    this.db
      .update(manga)
      .set({ readerSettingsJson: empty ? null : JSON.stringify(settings) })
      .where(eq(manga.id, id))
      .run();
    this.changes.mark(`manga:${id}`);
  }

  /** Hidden and preferred scanlators change the list, unread counts, history and "continue". */
  setScanlatorPrefs(id: number, prefs: ScanlatorPrefs): void {
    const empty = prefs.hidden.length === 0 && prefs.priority.length === 0;
    this.db
      .update(manga)
      .set({ scanlatorPrefsJson: empty ? null : JSON.stringify(prefs) })
      .where(eq(manga.id, id))
      .run();
    this.changes.mark(`manga:${id}`, `chapters:${id}`);
  }

  setChapterView(id: number, view: ChapterView | null): void {
    this.db
      .update(manga)
      .set({ chapterViewJson: view ? JSON.stringify(view) : null })
      .where(eq(manga.id, id))
      .run();
    this.changes.mark(`manga:${id}`);
  }

  /** Checked for new chapters without taking the details (metadata updates are off). */
  touchChecked(id: number, now = Date.now()): void {
    this.db.update(manga).set({ lastUpdateCheckAt: now }).where(eq(manga.id, id)).run();
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
