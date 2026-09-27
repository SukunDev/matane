// Shapes of library/source data as the renderer sees it (main-owned, served over IPC).
import type { Filter, FilterState, Page, Preference } from '@manga-reader/extension-sdk';
import { z } from 'zod';
import { mangaReaderSettingsSchema } from './settings';

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
  /** Changes whenever the shown cover changes (custom cover or new source cover); null = none. */
  coverKey: z.string().nullable(),
  inLibrary: z.boolean(),
});
export type BrowseItem = z.infer<typeof browseItemSchema>;

export const browseResultSchema = z.object({ items: z.array(browseItemSchema), hasNextPage: z.boolean() });
export type BrowseResult = z.infer<typeof browseResultSchema>;

/**
 * Per-manga scanlator preferences (BRAINSTORM.md §6.2), by scanlator name ("" = no group). Hidden
 * groups disappear from the list, unread counts and navigation; `priority` picks the version of a
 * chapter number when several groups released it.
 */
export const scanlatorPrefsSchema = z.object({
  hidden: z.array(z.string()).catch([]),
  priority: z.array(z.string()).catch([]),
});
export type ScanlatorPrefs = z.infer<typeof scanlatorPrefsSchema>;

export const CHAPTER_SORTS = ['source', 'number', 'date'] as const;

/** How a manga's chapter list is filtered and sorted, remembered per manga. */
export const chapterViewSchema = z.object({
  unreadOnly: z.boolean().catch(false),
  bookmarkedOnly: z.boolean().catch(false),
  downloadedOnly: z.boolean().catch(false),
  /** One scanlator ("" = no group) or null for all. */
  scanlator: z.string().nullable().catch(null),
  sort: z.enum(CHAPTER_SORTS).catch('source'),
  /** Newest / highest first. */
  descending: z.boolean().catch(true),
});
export type ChapterView = z.infer<typeof chapterViewSchema>;

export const DEFAULT_CHAPTER_VIEW: ChapterView = {
  unreadOnly: false,
  bookmarkedOnly: false,
  downloadedOnly: false,
  scanlator: null,
  sort: 'source',
  descending: true,
};

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
  coverKey: z.string().nullable(),
  hasCustomCover: z.boolean(),
  inLibrary: z.boolean(),
  categoryIds: z.array(z.number()),
  /** When details + chapters were last fetched from the source; null for browse-only rows. */
  lastFetchedAt: z.number().nullable(),
  /** Reader override for this manga (§6.1); null = follow the global settings. */
  readerSettings: mangaReaderSettingsSchema.nullable(),
  scanlatorPrefs: scanlatorPrefsSchema,
  /** null = default view. */
  chapterView: chapterViewSchema.nullable(),
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
  readAt: z.number().nullable(),
  bookmarked: z.boolean(),
  lastPage: z.number(),
  totalPages: z.number().nullable(),
  /** Scrolled fraction of `lastPage` in webtoon mode. */
  pageOffset: z.number().nullable(),
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
 * "extensions" · "sources" · "library" · "categories" · "history" · "downloads" · "manga:<id>" ·
 * "chapters:<mangaId>"
 */
export type DbChangeTag =
  | 'extensions'
  | 'sources'
  | 'library'
  | 'categories'
  | 'history'
  | 'downloads'
  | `manga:${number}`
  | `chapters:${number}`;

export const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  sortOrder: z.number(),
  /** Manga in the library with this category. */
  count: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

export const LIBRARY_SORTS = ['title', 'lastRead', 'latestChapter', 'added', 'unread', 'total'] as const;
export type LibrarySortKey = (typeof LIBRARY_SORTS)[number];

export const libraryFiltersSchema = z.object({
  unread: z.boolean().catch(false),
  /** Started but not finished (has history and unread chapters). */
  reading: z.boolean().catch(false),
  /** Has at least one bookmarked chapter (like Mihon's library filter). */
  bookmarked: z.boolean().catch(false),
  /** Has at least one downloaded chapter. */
  downloaded: z.boolean().catch(false),
  status: z.array(z.enum(MANGA_STATUSES)).catch([]),
  sourceIds: z.array(z.string()).catch([]),
});
export type LibraryFilters = z.infer<typeof libraryFiltersSchema>;

/** "all" = every library manga, "default" = those without a category. */
export const libraryTabSchema = z.union([z.literal('all'), z.literal('default'), z.number().int().positive()]);
export type LibraryTab = z.infer<typeof libraryTabSchema>;

export const libraryItemSchema = z.object({
  mangaId: z.number(),
  title: z.string(),
  coverKey: z.string().nullable(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  status: z.enum(MANGA_STATUSES),
  /** Counted per chapter number, so several scanlator versions count once (§6.2). */
  unreadCount: z.number(),
  readCount: z.number(),
  chapterCount: z.number(),
  lastReadAt: z.number().nullable(),
  lastReadChapter: z.string().nullable(),
  latestChapterAt: z.number().nullable(),
  addedAt: z.number().nullable(),
  categoryIds: z.array(z.number()),
  /** Downloaded chapters (finished downloads). */
  downloadedCount: z.number(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const libraryCountsSchema = z.object({
  all: z.number(),
  default: z.number(),
  byCategory: z.record(z.string(), z.number()),
});
export type LibraryCounts = z.infer<typeof libraryCountsSchema>;

/** One row of the History page: the chapter read last in a manga (BRAINSTORM.md §6.3). */
export const historyEntrySchema = z.object({
  mangaId: z.number(),
  title: z.string(),
  /** Custom cover path or the source's cover URL (see `MangaInfo.coverKey`). */
  coverKey: z.string().nullable(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  chapterId: z.number(),
  chapterName: z.string(),
  chapterNumber: z.number().nullable(),
  lastPage: z.number(),
  totalPages: z.number().nullable(),
  read: z.boolean(),
  readAt: z.number(),
  /** Whether the manga still has unread chapters ("Continue" rather than "Read again"). */
  hasUnread: z.boolean(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const continueTargetSchema = z.object({
  chapterId: z.number(),
  kind: z.enum(['start', 'continue', 'next', 'reread']),
});

/** A possible match for a manga in a migration target source. */
export const migrationCandidateSchema = z.object({
  sourceId: z.string(),
  item: browseItemSchema,
  /** Title similarity, 0–1; 1 = the same title once normalized. */
  score: z.number(),
  match: z.enum(['exact', 'similar']),
});
export type MigrationCandidate = z.infer<typeof migrationCandidateSchema>;

/** What `migration.findCandidates` found for one manga across the target sources. */
export const migrationSearchSchema = z.object({
  /** The first exact match in target order, else the most similar one; null = nothing close. */
  best: migrationCandidateSchema.nullable(),
  /** Every close candidate, best first, for "Change". */
  candidates: z.array(migrationCandidateSchema),
  /** Targets whose search failed (e.g. Cloudflare), with the error code for "Verify". */
  errors: z.array(z.object({ sourceId: z.string(), code: z.string(), message: z.string() })),
});
export type MigrationSearch = z.infer<typeof migrationSearchSchema>;

export const migrationResultSchema = z.object({
  fromMangaId: z.number(),
  toMangaId: z.number(),
  status: z.enum(['migrated', 'failed']),
  error: z.string().nullable(),
  /** Read chapters carried over (by number). */
  readMatched: z.number(),
  /** Read or bookmarked chapters with no chapter of the same number in the new source. */
  unmatched: z.array(z.string()),
});
export type MigrationResult = z.infer<typeof migrationResultSchema>;

export const migrationProgressSchema = z.object({
  done: z.number(),
  total: z.number(),
  /** The manga being migrated now (null once finished). */
  current: z.number().nullable(),
});
export type MigrationProgress = z.infer<typeof migrationProgressSchema>;

export const DOWNLOAD_STATUSES = ['queued', 'downloading', 'paused', 'error', 'done'] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];
export const DOWNLOAD_FORMATS = ['cbz', 'folder'] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

/** One chapter in the download queue or on disk (BRAINSTORM.md §6.4). */
export const downloadItemSchema = z.object({
  id: z.number(),
  chapterId: z.number(),
  mangaId: z.number(),
  mangaTitle: z.string(),
  coverKey: z.string().nullable(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  chapterName: z.string(),
  chapterNumber: z.number().nullable(),
  scanlator: z.string().nullable(),
  status: z.enum(DOWNLOAD_STATUSES),
  queueOrder: z.number(),
  pagesDone: z.number(),
  pagesTotal: z.number().nullable(),
  error: z.string().nullable(),
  format: z.enum(DOWNLOAD_FORMATS),
  /** The finished file or folder. */
  path: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type DownloadItem = z.infer<typeof downloadItemSchema>;

export const downloadStatsSchema = z.object({
  queued: z.number(),
  downloading: z.number(),
  paused: z.number(),
  error: z.number(),
  done: z.number(),
  /** Size of the finished downloads on disk. */
  totalBytes: z.number(),
});
export type DownloadStats = z.infer<typeof downloadStatsSchema>;

/** Live progress of the chapters being downloaded, a few times per second. */
export const downloadProgressSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      chapterId: z.number(),
      pagesDone: z.number(),
      pagesTotal: z.number().nullable(),
      /** Bytes of the pages fetched so far. */
      bytes: z.number(),
      bytesPerSecond: z.number(),
    }),
  ),
});
export type DownloadProgress = z.infer<typeof downloadProgressSchema>;

/** Moving the downloads to another folder, one chapter at a time. */
export const downloadMoveProgressSchema = z.object({
  done: z.number(),
  total: z.number(),
  /** Set once the move ended (null while it runs, or when it went fine). */
  error: z.string().nullable(),
  finished: z.boolean(),
});
export type DownloadMoveProgress = z.infer<typeof downloadMoveProgressSchema>;
