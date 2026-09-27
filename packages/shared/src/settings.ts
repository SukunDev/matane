import { z } from 'zod';
import { READER_BACKGROUNDS, READER_DIRECTIONS, READER_FITS, READER_MODES, TAP_ZONES } from './reader';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';

/**
 * Global reader defaults (BRAINSTORM.md §6.1). "auto" picks from the manga type: manhwa/manhua read
 * as webtoon, manga right-to-left. A manga can override part of it (`mangaReaderSettingsSchema`). Each field falls back on
 * its own so a stored value from an older version never resets the rest.
 */
export const readerSettingsSchema = z.object({
  mode: z.enum(READER_MODES).catch('auto'),
  direction: z.enum(READER_DIRECTIONS).catch('auto'),
  fit: z.enum(READER_FITS).catch('screen'),
  tapZones: z.enum(TAP_ZONES).catch('l'),
  /** Double-page: show the first page alone (covers) and shift pairs by one. */
  shiftDouble: z.boolean().catch(false),
  /** Webtoon column width in CSS px. */
  webtoonWidth: z.number().int().min(320).max(2000).catch(800),
  /** Gap between pages in vertical mode, px. */
  verticalGap: z.number().int().min(0).max(64).catch(16),
  background: z.enum(READER_BACKGROUNDS).catch('black'),
});
export type ReaderSettings = z.infer<typeof readerSettingsSchema>;
export type ReaderMode = ReaderSettings['mode'];

/**
 * Fields a manga can override (BRAINSTORM.md §6.1: global → per type ("auto") → per manga). Tap zones
 * stay global: they are a habit of the reader, not a property of the manga.
 */
export const MANGA_READER_KEYS = [
  'mode',
  'direction',
  'fit',
  'shiftDouble',
  'webtoonWidth',
  'verticalGap',
  'background',
] as const satisfies readonly (keyof ReaderSettings)[];
export type MangaReaderKey = (typeof MANGA_READER_KEYS)[number];

/** A manga's override, stored in `manga.reader_settings_json`. Invalid fields are dropped. */
export const mangaReaderSettingsSchema = z.object({
  mode: z.enum(READER_MODES).optional().catch(undefined),
  direction: z.enum(READER_DIRECTIONS).optional().catch(undefined),
  fit: z.enum(READER_FITS).optional().catch(undefined),
  shiftDouble: z.boolean().optional().catch(undefined),
  webtoonWidth: z.number().int().min(320).max(2000).optional().catch(undefined),
  verticalGap: z.number().int().min(0).max(64).optional().catch(undefined),
  background: z.enum(READER_BACKGROUNDS).optional().catch(undefined),
});
export type MangaReaderSettings = z.infer<typeof mangaReaderSettingsSchema>;

/** Global settings with a manga's override on top (undefined fields keep the global value). */
export function effectiveReaderSettings(global: ReaderSettings, override: MangaReaderSettings | null): ReaderSettings {
  if (!override) return global;
  const merged = { ...global };
  for (const key of MANGA_READER_KEYS) {
    if (override[key] !== undefined) Object.assign(merged, { [key]: override[key] });
  }
  return merged;
}

/** The override a manga gets from "Save as default for this manga": the current values of every field. */
export function toMangaReaderSettings(settings: ReaderSettings): MangaReaderSettings {
  return Object.fromEntries(MANGA_READER_KEYS.map((key) => [key, settings[key]])) as MangaReaderSettings;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: 'auto',
  direction: 'auto',
  fit: 'screen',
  tapZones: 'l',
  shiftDouble: false,
  webtoonWidth: 800,
  verticalGap: 16,
  background: 'black',
};

export const LIBRARY_DISPLAYS = ['compact', 'comfortable', 'cover', 'list'] as const;
const LIBRARY_SORT_KEYS = ['title', 'lastRead', 'latestChapter', 'added', 'unread', 'total'] as const;

/** How the library looks (BRAINSTORM.md §6.2); per-field fallbacks like the reader settings. */
export const librarySettingsSchema = z.object({
  display: z.enum(LIBRARY_DISPLAYS).catch('comfortable'),
  /** Cover width in CSS px for the grid displays. */
  coverSize: z.number().int().min(100).max(280).catch(160),
  sort: z.enum(LIBRARY_SORT_KEYS).catch('lastRead'),
  ascending: z.boolean().catch(false),
  unreadOnly: z.boolean().catch(false),
  readingOnly: z.boolean().catch(false),
  bookmarkedOnly: z.boolean().catch(false),
  downloadedOnly: z.boolean().catch(false),
  status: z.array(z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'])).catch([]),
  sourceIds: z.array(z.string()).catch([]),
});
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  display: 'comfortable',
  coverSize: 160,
  sort: 'lastRead',
  ascending: false,
  unreadOnly: false,
  readingOnly: false,
  bookmarkedOnly: false,
  downloadedOnly: false,
  status: [],
  sourceIds: [],
};

/** Global search (BRAINSTORM.md §6.2): which sources, and whether to hide sources without results. */
export const globalSearchSettingsSchema = z.object({
  /** null = the default set: pinned sources and sources with manga in the library. */
  sourceIds: z.array(z.string()).nullable().catch(null),
  onlyWithResults: z.boolean().catch(false),
});
export type GlobalSearchSettings = z.infer<typeof globalSearchSettingsSchema>;

/** What a source migration carries over (BRAINSTORM.md §6.2), remembered between migrations. */
export const migrationOptionsSchema = z.object({
  /** Read status and progress, matched by chapter number. */
  readStatus: z.boolean().catch(true),
  categories: z.boolean().catch(true),
  readerSettings: z.boolean().catch(true),
  customCover: z.boolean().catch(true),
  /** Chapter bookmarks, matched by chapter number. */
  bookmarks: z.boolean().catch(true),
  /** Remove the old manga from the library afterwards (else keep both). */
  removeOld: z.boolean().catch(true),
});
export type MigrationOptions = z.infer<typeof migrationOptionsSchema>;

export const DEFAULT_MIGRATION_OPTIONS: MigrationOptions = {
  readStatus: true,
  categories: true,
  readerSettings: true,
  customCover: true,
  bookmarks: true,
  removeOld: true,
};

export const migrationSettingsSchema = z.object({
  /** Target sources in priority order; empty = pinned sources. */
  targets: z.array(z.string()).catch([]),
  options: migrationOptionsSchema.catch(DEFAULT_MIGRATION_OPTIONS),
});
export type MigrationSettings = z.infer<typeof migrationSettingsSchema>;

/** "Delete after reading" (BRAINSTORM.md §6.4); off by default, it removes files. */
export const deleteAfterReadSchema = z.object({
  enabled: z.boolean().catch(false),
  /** Wait until this many later chapters are read too (0 = delete as soon as it is read). */
  delay: z.number().int().min(0).max(5).catch(0),
  /** Never delete bookmarked chapters. */
  keepBookmarked: z.boolean().catch(true),
  /** Manga in these categories keep their downloads. */
  excludeCategoryIds: z.array(z.number().int()).catch([]),
});
export type DeleteAfterRead = z.infer<typeof deleteAfterReadSchema>;

export const DEFAULT_DELETE_AFTER_READ: DeleteAfterRead = {
  enabled: false,
  delay: 0,
  keepBookmarked: true,
  excludeCategoryIds: [],
};

/** Downloads (BRAINSTORM.md §6.4); per-field fallbacks like the reader settings. */
export const downloadSettingsSchema = z.object({
  /** null = the default, `Documents/Matane`. */
  folder: z.string().min(1).nullable().catch(null),
  format: z.enum(['cbz', 'folder']).catch('cbz'),
  /** Carry on with the queue when the app starts. */
  resumeOnStart: z.boolean().catch(true),
  /** Chapters downloaded at once (each with 4 pages at once). */
  parallel: z.number().int().min(1).max(4).catch(2),
  /** While reading a library manga, queue this many next chapters (0 = off). */
  ahead: z.number().int().min(0).max(10).catch(2),
  deleteAfterRead: deleteAfterReadSchema.catch(DEFAULT_DELETE_AFTER_READ),
  /** Total size of the downloads, in GB, past which automatic downloads stop; null = no limit. */
  limitGb: z.number().positive().max(100_000).nullable().catch(null),
});
export type DownloadSettings = z.infer<typeof downloadSettingsSchema>;

/** Hours between automatic library update checks; 0 = off (BRAINSTORM.md §6.4). */
export const UPDATE_INTERVALS = [0, 6, 12, 24, 48, 168] as const;

/** The library update checker (BRAINSTORM.md §6.4); per-field fallbacks. */
export const updateSettingsSchema = z.object({
  intervalHours: z.literal(UPDATE_INTERVALS).catch(12),
  /** Skip rules for "check library" (not for a single manga). */
  skipCompleted: z.boolean().catch(true),
  skipNotStarted: z.boolean().catch(false),
  /** Skip manga with more unread chapters than this; null = off. */
  skipUnreadOver: z.number().int().min(1).max(10_000).nullable().catch(null),
  /** Also update title-independent details (cover, description, status). */
  refreshMetadata: z.boolean().catch(true),
  notify: z.boolean().catch(true),
  /** Queue new chapters for download (categories can include/exclude themselves). */
  autoDownload: z.boolean().catch(false),
  /** Only for manga with at least one chapter read. */
  autoDownloadOnlyReading: z.boolean().catch(false),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  intervalHours: 12,
  skipCompleted: true,
  skipNotStarted: false,
  skipUnreadOver: null,
  refreshMetadata: true,
  notify: true,
  autoDownload: false,
  autoDownloadOnlyReading: false,
};

/** A category's own settings (`categories.settings_json`). */
export const categorySettingsSchema = z.object({
  /** Auto-download of new chapters: include only these categories, or never these; null = default. */
  autoDownload: z.enum(['include', 'exclude']).nullable().catch(null),
});
export type CategorySettings = z.infer<typeof categorySettingsSchema>;

export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENTS),
  /** `null` follows the operating system language. */
  language: z.enum(LANGUAGES).nullable(),
  sidebarCollapsed: z.boolean(),
  reader: readerSettingsSchema,
  /** While on, nothing about reading is recorded: progress, history, sessions (§6.3). */
  incognito: z.boolean(),
  library: librarySettingsSchema,
  globalSearch: globalSearchSettingsSchema,
  migration: migrationSettingsSchema,
  downloads: downloadSettingsSchema,
  updates: updateSettingsSchema,
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mocha',
  accent: 'mauve',
  language: null,
  sidebarCollapsed: false,
  reader: DEFAULT_READER_SETTINGS,
  incognito: false,
  library: DEFAULT_LIBRARY_SETTINGS,
  globalSearch: { sourceIds: null, onlyWithResults: false },
  migration: { targets: [], options: DEFAULT_MIGRATION_OPTIONS },
  downloads: {
    folder: null,
    format: 'cbz',
    resumeOnStart: true,
    parallel: 2,
    ahead: 2,
    deleteAfterRead: DEFAULT_DELETE_AFTER_READ,
    limitGb: null,
  },
  updates: DEFAULT_UPDATE_SETTINGS,
};
