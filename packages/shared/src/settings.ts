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
  status: [],
  sourceIds: [],
};

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
};
