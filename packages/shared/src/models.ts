// Shapes of library/source data as the renderer sees it (main-owned, served over IPC).
import type { Filter, FilterState, Page, Preference } from '@manga-reader/extension-sdk';
import { z } from 'zod';

export type { Filter, FilterState, Page, Preference };

export const MANGA_STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'] as const;
export const MANGA_TYPES = ['manga', 'manhwa', 'manhua', 'comic'] as const;

/** `<extensionId>/<sourceKey>`, e.g. "mangadex/en". */
export const sourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9-]+$/, 'source id');

export const extensionEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number(),
  nsfw: z.boolean(),
  enabled: z.boolean(),
  /** Bundled with the app, or loaded from a folder in developer mode. */
  origin: z.enum(['builtin', 'dev']),
  path: z.string(),
  /** Why the extension could not be loaded (bad manifest, missing bundle, …). */
  error: z.string().nullable(),
  sourceIds: z.array(z.string()),
});
export type ExtensionEntry = z.infer<typeof extensionEntrySchema>;

export const sourceEntrySchema = z.object({
  id: z.string(),
  extensionId: z.string(),
  key: z.string(),
  name: z.string(),
  lang: z.string(),
  pinned: z.boolean(),
  lastUsedAt: z.number().nullable(),
  /** False when the extension is gone; its manga stay in the library. */
  installed: z.boolean(),
});
export type SourceEntry = z.infer<typeof sourceEntrySchema>;

export const sourceCapabilitiesSchema = z.object({
  baseUrl: z.string(),
  /** Optional Source methods the extension implements, e.g. "getLatest". */
  capabilities: z.array(z.string()),
});
export type SourceCapabilities = z.infer<typeof sourceCapabilitiesSchema>;

export const browseItemSchema = z.object({
  mangaId: z.number(),
  url: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  inLibrary: z.boolean(),
});
export type BrowseItem = z.infer<typeof browseItemSchema>;

export const browseResultSchema = z.object({ items: z.array(browseItemSchema), hasNextPage: z.boolean() });
export type BrowseResult = z.infer<typeof browseResultSchema>;

export const mangaInfoSchema = z.object({
  id: z.number(),
  sourceId: z.string(),
  url: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  artist: z.string().nullable(),
  description: z.string().nullable(),
  genres: z.array(z.string()),
  status: z.enum(MANGA_STATUSES),
  type: z.enum(MANGA_TYPES).nullable(),
  thumbnailUrl: z.string().nullable(),
  inLibrary: z.boolean(),
  /** When details + chapters were last fetched from the source; null for browse-only rows. */
  lastFetchedAt: z.number().nullable(),
});
export type MangaInfo = z.infer<typeof mangaInfoSchema>;

export const chapterInfoSchema = z.object({
  id: z.number(),
  mangaId: z.number(),
  url: z.string(),
  name: z.string(),
  number: z.number().nullable(),
  scanlator: z.string().nullable(),
  uploadedAt: z.number().nullable(),
  sourceOrder: z.number(),
  read: z.boolean(),
  bookmarked: z.boolean(),
  lastPage: z.number(),
  totalPages: z.number().nullable(),
  sourceMissing: z.boolean(),
});
export type ChapterInfo = z.infer<typeof chapterInfoSchema>;

const sortValueSchema = z.object({ value: z.string(), ascending: z.boolean() });
export const filterStateSchema = z.record(z.string(), z.union([z.string(), z.boolean(), sortValueSchema]));

/** Lets the renderer cancel a slow source call (TanStack Query's AbortSignal → `requests.cancel`). */
export const requestIdSchema = z.string().min(1).max(64).optional();

export const cloudflareStatusSchema = z.object({
  extensionId: z.string(),
  /** solving: hidden window working · shown: needs the user · solved/failed: done. */
  state: z.enum(['solving', 'shown', 'solved', 'failed']),
});
export type CloudflareStatus = z.infer<typeof cloudflareStatusSchema>;

/**
 * Entity tags carried by `db.changed` (ADR 0010). The renderer maps them to query keys.
 * "extensions" · "sources" · "manga:<id>" · "chapters:<mangaId>"
 */
export type DbChangeTag = 'extensions' | 'sources' | `manga:${number}` | `chapters:${number}`;
