import { z } from 'zod';
import {
  MAX_KEYS_PER_ACTION,
  READER_ACTIONS,
  READER_BACKGROUNDS,
  READER_DIRECTIONS,
  READER_FITS,
  READER_MODES,
  READER_TYPES,
  RESOLVED_MODES,
  TAP_ZONES,
} from './reader';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';

/** Reading mode and direction a manga type gets while the global ones are "auto" (§6.1). */
const typeDefaultSchema = (mode: (typeof RESOLVED_MODES)[number], direction: 'ltr' | 'rtl') =>
  z
    .object({
      mode: z.enum(RESOLVED_MODES).catch(mode),
      direction: z.enum(['ltr', 'rtl']).catch(direction),
    })
    .catch({ mode, direction });

export const DEFAULT_TYPE_DEFAULTS = {
  manga: { mode: 'single', direction: 'rtl' },
  manhwa: { mode: 'webtoon', direction: 'ltr' },
  manhua: { mode: 'webtoon', direction: 'ltr' },
  comic: { mode: 'single', direction: 'ltr' },
  other: { mode: 'single', direction: 'ltr' },
} as const satisfies Record<(typeof READER_TYPES)[number], { mode: string; direction: string }>;

const typeDefaultsSchema = z
  .object(
    Object.fromEntries(
      READER_TYPES.map((type) => [
        type,
        typeDefaultSchema(DEFAULT_TYPE_DEFAULTS[type].mode, DEFAULT_TYPE_DEFAULTS[type].direction),
      ]),
    ) as Record<(typeof READER_TYPES)[number], ReturnType<typeof typeDefaultSchema>>,
  )
  .catch(DEFAULT_TYPE_DEFAULTS);
export type ReaderTypeDefaults = z.infer<typeof typeDefaultsSchema>;

/** Colour filters drawn over the pages (CSS filters in the renderer, §6.1). */
export const DEFAULT_READER_FILTERS = { brightness: 100, contrast: 100, grayscale: false, invert: false, warm: 0 };
const filtersSchema = z
  .object({
    /** Percent, 100 = unchanged. */
    brightness: z.number().int().min(30).max(150).catch(100),
    contrast: z.number().int().min(50).max(150).catch(100),
    grayscale: z.boolean().catch(false),
    invert: z.boolean().catch(false),
    /** Sepia in percent: a warmer page for night reading. */
    warm: z.number().int().min(0).max(100).catch(0),
  })
  .catch(DEFAULT_READER_FILTERS);
export type ReaderFilters = z.infer<typeof filtersSchema>;

const keymapSchema = z
  .partialRecord(z.enum(READER_ACTIONS), z.array(z.string().min(1).max(40)).max(MAX_KEYS_PER_ACTION))
  .catch({});
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * Global reader defaults (docs/BRAINSTORM.md §6.1). "auto" mode and direction come from the manga type
 * (`typeDefaults`). A manga can override part of it (`mangaReaderSettingsSchema`). Each field falls
 * back on its own so a stored value from an older version never resets the rest.
 */
export const readerSettingsSchema = z.object({
  mode: z.enum(READER_MODES).catch('auto'),
  direction: z.enum(READER_DIRECTIONS).catch('auto'),
  typeDefaults: typeDefaultsSchema,
  fit: z.enum(READER_FITS).catch('screen'),
  tapZones: z.enum(TAP_ZONES).catch('l'),
  /** Swap the previous and next zones of the preset. */
  invertTapZones: z.boolean().catch(false),
  /** Page modes: the wheel turns the page once a tall page is scrolled to its edge. */
  wheelTurnsPages: z.boolean().catch(true),
  /** Pages loaded ahead of the one on screen. */
  preloadPages: z.number().int().min(1).max(10).catch(4),
  /** Double-page: show the first page alone (covers) and shift pairs by one. */
  shiftDouble: z.boolean().catch(false),
  /** Webtoon column width in CSS px. */
  webtoonWidth: z.number().int().min(320).max(2000).catch(800),
  /** Gap between pages in vertical mode, px. */
  verticalGap: z.number().int().min(0).max(64).catch(16),
  background: z.enum(READER_BACKGROUNDS).catch('black'),
  /** Background with `background: 'custom'`. */
  backgroundColor: hexColorSchema.catch('#1e1e2e'),
  filters: filtersSchema,
  /** Trim uniform white or black margins off pages (main, cached as a variant). */
  cropBorders: z.boolean().catch(false),
  /** Cut very tall pages into segments in webtoon and vertical modes (`pageSegments`). */
  splitTall: z.boolean().catch(true),
  /** Auto-scroll speed in the strip, CSS px per second. */
  autoScrollSpeed: z.number().int().min(20).max(800).catch(120),
  /** The small "page / total" label while the bars are hidden. */
  pageIndicator: z.boolean().catch(true),
  /** Keys changed from `DEFAULT_KEYMAP` (see `effectiveKeymap`). */
  keymap: keymapSchema,
});
export type ReaderSettings = z.infer<typeof readerSettingsSchema>;
export type ReaderMode = ReaderSettings['mode'];

/**
 * Fields a manga can override (docs/BRAINSTORM.md §6.1: global → per type ("auto") → per manga). Tap
 * zones, keys and the like stay global: they are habits of the reader, not properties of the manga.
 */
export const MANGA_READER_KEYS = [
  'mode',
  'direction',
  'fit',
  'shiftDouble',
  'webtoonWidth',
  'verticalGap',
  'background',
  'backgroundColor',
  'filters',
  'cropBorders',
  'splitTall',
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
  backgroundColor: hexColorSchema.optional().catch(undefined),
  filters: filtersSchema.optional().catch(undefined),
  cropBorders: z.boolean().optional().catch(undefined),
  splitTall: z.boolean().optional().catch(undefined),
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
  typeDefaults: DEFAULT_TYPE_DEFAULTS,
  fit: 'screen',
  tapZones: 'l',
  invertTapZones: false,
  wheelTurnsPages: true,
  preloadPages: 4,
  shiftDouble: false,
  webtoonWidth: 800,
  verticalGap: 16,
  background: 'black',
  backgroundColor: '#1e1e2e',
  filters: DEFAULT_READER_FILTERS,
  cropBorders: false,
  splitTall: true,
  autoScrollSpeed: 120,
  pageIndicator: true,
  keymap: {},
};

export const LIBRARY_DISPLAYS = ['compact', 'comfortable', 'cover', 'list'] as const;
const LIBRARY_SORT_KEYS = ['title', 'lastRead', 'latestChapter', 'added', 'unread', 'total'] as const;

/** How the library looks (docs/BRAINSTORM.md §6.2); per-field fallbacks like the reader settings. */
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

/** Global search (docs/BRAINSTORM.md §6.2): which sources, and whether to hide sources without results. */
export const globalSearchSettingsSchema = z.object({
  /** null = the default set: pinned sources and sources with manga in the library. */
  sourceIds: z.array(z.string()).nullable().catch(null),
  onlyWithResults: z.boolean().catch(false),
});
export type GlobalSearchSettings = z.infer<typeof globalSearchSettingsSchema>;

/** What a source migration carries over (docs/BRAINSTORM.md §6.2), remembered between migrations. */
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

/** "Delete after reading" (docs/BRAINSTORM.md §6.4); off by default, it removes files. */
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

/** Downloads (docs/BRAINSTORM.md §6.4); per-field fallbacks like the reader settings. */
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

/** Hours between automatic library update checks; 0 = off (docs/BRAINSTORM.md §6.4). */
export const UPDATE_INTERVALS = [0, 6, 12, 24, 48, 168] as const;

/** The library update checker (docs/BRAINSTORM.md §6.4); per-field fallbacks. */
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

/** The app in the system (docs/BRAINSTORM.md §6.4, §6.6): tray and start at login. */
export const generalSettingsSchema = z.object({
  /** Closing the window hides it to the tray; downloads and update checks go on. */
  closeToTray: z.boolean().catch(false),
  openAtLogin: z.boolean().catch(false),
  /** Started at login: stay in the tray (needs the tray). */
  startHidden: z.boolean().catch(false),
  /** Discord Rich Presence (§6.6): off by default; never for adult sources or while incognito. */
  discord: z
    .object({
      enabled: z.boolean().catch(false),
      /** "Reading manga" instead of the title and chapter. */
      hideTitle: z.boolean().catch(false),
    })
    .catch({ enabled: false, hideTitle: false }),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

/** DNS-over-HTTPS providers (docs/BRAINSTORM.md §6.5); "custom" uses `customUrl`. */
export const DOH_PROVIDERS = ['cloudflare', 'google', 'quad9', 'adguard', 'custom'] as const;
export const DOH_MODES = ['off', 'automatic', 'secure'] as const;
export const PROXY_MODES = ['system', 'direct', 'http', 'socks5'] as const;

export const DEFAULT_NETWORK_SETTINGS = {
  doh: { mode: 'off', provider: 'cloudflare', customUrl: '' },
  proxy: { mode: 'system', host: '', port: null, username: '' },
  userAgent: null,
} as const;

/**
 * Network options (docs/BRAINSTORM.md §6.5): DNS-over-HTTPS (sites blocked through DNS, e.g. by ISPs in
 * Indonesia), a proxy for every session, and a custom User-Agent. The proxy password is not here:
 * it is kept encrypted by main (`safeStorage`) and never sent to the renderer.
 */
export const networkSettingsSchema = z
  .object({
    doh: z
      .object({
        /** "automatic" falls back to the system DNS; "secure" uses DNS-over-HTTPS only. */
        mode: z.enum(DOH_MODES).catch('off'),
        provider: z.enum(DOH_PROVIDERS).catch('cloudflare'),
        customUrl: z.string().max(500).catch(''),
      })
      .catch({ ...DEFAULT_NETWORK_SETTINGS.doh }),
    proxy: z
      .object({
        mode: z.enum(PROXY_MODES).catch('system'),
        host: z.string().max(255).catch(''),
        port: z.number().int().min(1).max(65_535).nullable().catch(null),
        username: z.string().max(255).catch(''),
      })
      .catch({ ...DEFAULT_NETWORK_SETTINGS.proxy }),
    /** Replaces the app's browser User-Agent (an extension's own still wins); null = default. */
    userAgent: z.string().trim().min(1).max(500).nullable().catch(null),
  })
  .catch({
    doh: { ...DEFAULT_NETWORK_SETTINGS.doh },
    proxy: { ...DEFAULT_NETWORK_SETTINGS.proxy },
    userAgent: null,
  });
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;

/** App updates (docs/BRAINSTORM.md §10): download by itself, only tell, or off; stable or beta releases. */
export const updaterSettingsSchema = z.object({
  mode: z.enum(['auto', 'notify', 'off']).catch('auto'),
  /** Beta = GitHub pre-releases too. Every release is a beta for now. */
  channel: z.enum(['stable', 'beta']).catch('beta'),
});
export type UpdaterSettings = z.infer<typeof updaterSettingsSchema>;

/** How often extension repositories are synced (hours). */
export const REPO_SYNC_HOURS = [6, 12, 24, 48, 168] as const;

/**
 * Browse & extensions (docs/BRAINSTORM.md §6.6): adult content stays hidden until turned on, and only
 * extensions and sources in the content languages are shown.
 */
export const browseSettingsSchema = z.object({
  showNsfw: z.boolean().catch(false),
  /** Content languages (ISO codes); null = the UI language and English. */
  languages: z.array(z.string().min(2).max(10)).max(100).nullable().catch(null),
  /** Updates install by themselves after a repository sync. */
  autoUpdateExtensions: z.boolean().catch(false),
  repoSyncHours: z.literal(REPO_SYNC_HOURS).catch(24),
  /** How a source's manga list looks; same choices as the library, kept separately. */
  display: z.enum(LIBRARY_DISPLAYS).catch('comfortable'),
  /** Cover width in CSS px for the grid displays. */
  coverSize: z.number().int().min(100).max(280).catch(160),
});
export type BrowseSettings = z.infer<typeof browseSettingsSchema>;

/** Sources in these "languages" suit every reader. */
const ANY_LANGUAGE = new Set(['all', 'multi', 'other']);

/** The primary subtag of a UI language or locale ("en-US" → "en"). */
export const primaryLanguage = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0] ?? tag;

/** Content languages in effect: the chosen ones, or the UI language and English. */
export function contentLanguages(browse: BrowseSettings, uiLanguage: string): string[] {
  return browse.languages ?? [...new Set([primaryLanguage(uiLanguage), 'en'])];
}

/** Whether an extension or source is shown (repositories, Extensions, Sources, browse, global search). */
export function isContentVisible(
  item: { langs: readonly string[]; nsfw: boolean },
  browse: BrowseSettings,
  uiLanguage: string,
): boolean {
  if (item.nsfw && !browse.showNsfw) return false;
  const wanted = new Set(contentLanguages(browse, uiLanguage).map(primaryLanguage));
  return item.langs.length === 0 || item.langs.some((l) => ANY_LANGUAGE.has(l) || wanted.has(primaryLanguage(l)));
}

/** Page cache size choices in MB (docs/BRAINSTORM.md §6.5, ADR 0014; default 1 GB). */
export const CACHE_SIZES_MB = [256, 512, 1024, 2048, 5120, 10240] as const;

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
  general: generalSettingsSchema,
  /** Limit of the page image cache (LRU), in MB. */
  cacheSizeMb: z.number().int().min(100).max(51_200),
  updater: updaterSettingsSchema,
  browse: browseSettingsSchema,
  network: networkSettingsSchema,
  /** Automatic backups (§6.7): how often, and where (null = `userData/backups`). The last 7 are kept. */
  backup: z
    .object({
      auto: z.enum(['off', 'daily', 'weekly']).catch('daily'),
      folder: z.string().nullable().catch(null),
    })
    .catch({ auto: 'daily', folder: null }),
  /** Settings → Advanced: how much goes into the log file (docs/BRAINSTORM.md §10). */
  advanced: z
    .object({ logLevel: z.enum(['error', 'warn', 'info', 'debug']).catch('info') })
    .catch({ logLevel: 'info' }),
  /** First-run setup (§6.6); profiles from before it count as set up. */
  onboarding: z.object({ done: z.boolean().catch(false) }).catch({ done: false }),
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
  general: {
    closeToTray: false,
    openAtLogin: false,
    startHidden: false,
    discord: { enabled: false, hideTitle: false },
  },
  cacheSizeMb: 1024,
  updater: { mode: 'auto', channel: 'beta' },
  browse: {
    showNsfw: false,
    languages: null,
    autoUpdateExtensions: false,
    repoSyncHours: 24,
    display: 'comfortable',
    coverSize: 160,
  },
  network: {
    doh: { ...DEFAULT_NETWORK_SETTINGS.doh },
    proxy: { ...DEFAULT_NETWORK_SETTINGS.proxy },
    userAgent: null,
  },
  backup: { auto: 'daily', folder: null },
  advanced: { logLevel: 'info' },
  onboarding: { done: false },
};
