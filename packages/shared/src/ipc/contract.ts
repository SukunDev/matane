import { z } from 'zod';
import type { Filter, Page, Preference } from '@matane/extension-sdk';
import { extensionIdSchema } from '@matane/extension-sdk/manifest';
import {
  addRepoResultSchema,
  extensionLogEntrySchema,
  availableExtensionSchema,
  installPreviewSchema,
  repoInfoSchema,
  updateAllResultSchema,
  browseResultSchema,
  categorySchema,
  chapterViewSchema,
  downloadItemSchema,
  downloadMoveProgressSchema,
  downloadProgressSchema,
  downloadStatsSchema,
  chapterInfoSchema,
  cloudflareStatusSchema,
  continueTargetSchema,
  extensionEntrySchema,
  filterStateSchema,
  historyEntrySchema,
  updateEntrySchema,
  updateProgressSchema,
  updateScopeSchema,
  updateStatusSchema,
  updaterStatusSchema,
  libraryCountsSchema,
  libraryFiltersSchema,
  libraryItemSchema,
  libraryTabSchema,
  mangaInfoSchema,
  migrationProgressSchema,
  migrationResultSchema,
  migrationSearchSchema,
  scanlatorPrefsSchema,
  requestIdSchema,
  sourceCapabilitiesSchema,
  sourceEntrySchema,
  sourceIdSchema,
  statsOverviewSchema,
  STATS_RANGES,
  PACKAGE_KINDS,
  appLicenseSchema,
  TRACKER_SERVICES,
  trackEntrySchema,
  trackPatchSchema,
  trackSearchResultSchema,
  trackerInfoSchema,
} from '../models';
import type { DbChangeTag } from '../models';
import { appSettingsSchema, mangaReaderSettingsSchema, migrationOptionsSchema } from '../settings';
import { backupFileSchema, backupPreviewSchema, backupProgressSchema, restoreResultSchema } from '../backup';
import type { EventChannel, InvokeChannel } from './channels';

const invoke = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  /** Discord Rich Presence can be offered (a Discord application id is set). */
  discord: z.boolean(),
  packaging: z.enum(PACKAGE_KINDS),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

// Extension-defined shapes are only typed here; main builds them from validated extension output.
const filtersSchema = z.custom<Filter[]>();
const pagesSchema = z.custom<Page[]>();
const preferencesSchema = z.object({
  definitions: z.custom<Preference[]>(),
  values: z.record(z.string(), z.unknown()),
});
const idSchema = z.number().int().positive();
const pageSizeSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });

/** Renderer → main request/response channels. Inputs are validated in main. */
export const invokeContract = {
  'app.getInfo': invoke(z.void(), appInfoSchema),
  'app.getLocale': invoke(z.void(), z.string()),
  /** Whether the network is up (main watches it; changes arrive on `app.online`). */
  /** The running version and whether its release notes were seen (What's new, §6.6). */
  'app.whatsNew': invoke(z.void(), z.object({ version: z.string(), seen: z.boolean() })),
  'app.whatsNewSeen': invoke(z.void(), z.void()),
  'app.isOnline': invoke(z.void(), z.boolean()),
  /** Whether a system tray is there (some Linux desktops have none), and why not. */
  'app.tray': invoke(z.void(), z.object({ available: z.boolean(), reason: z.string().nullable() })),
  /** Opens the data folder or the log folder in the file manager. */
  'app.openPath': invoke(z.object({ which: z.enum(['data', 'logs', 'crashes']) }), z.void()),
  /**
   * "Copy debug info": versions, OS, how it was installed, extensions and the end of the log, with
   * the home folder and URL queries left out. Copied to the clipboard and returned.
   */
  'app.copyDebugInfo': invoke(z.void(), z.string()),
  /** Licenses of the open source software in the app (generated at build). */
  'app.licenses': invoke(z.void(), z.array(appLicenseSchema)),
  /** Disk use: page cache, browse covers, downloads; and where data and logs live. */
  'storage.info': invoke(
    z.void(),
    z.object({
      pageCacheBytes: z.number(),
      browseCoverBytes: z.number(),
      downloadBytes: z.number(),
      dataPath: z.string(),
      logPath: z.string(),
    }),
  ),
  'storage.clearCache': invoke(z.object({ kind: z.enum(['page', 'browse_cover']) }), z.void()),
  'updater.status': invoke(z.void(), updaterStatusSchema),
  /** Looks for a newer app version now (also when automatic checks are off). */
  'updater.check': invoke(z.void(), updaterStatusSchema),
  /** "Notify only" found one: download it now. */
  'updater.download': invoke(z.void(), z.void()),
  /** Quits, installs the downloaded update and starts again. */
  'updater.install': invoke(z.void(), z.void()),
  'updater.openRelease': invoke(z.void(), z.void()),
  'window.minimize': invoke(z.void(), z.void()),
  'window.toggleMaximize': invoke(z.void(), z.boolean()),
  'window.close': invoke(z.void(), z.void()),
  'window.isMaximized': invoke(z.void(), z.boolean()),
  /** Returns the new state. */
  'window.toggleFullScreen': invoke(z.object({ value: z.boolean().optional() }).optional(), z.boolean()),
  'settings.get': invoke(z.void(), appSettingsSchema),
  'settings.set': invoke(appSettingsSchema.partial(), appSettingsSchema),

  'extensions.list': invoke(z.void(), z.array(extensionEntrySchema)),
  /** Without a path, main asks with a folder picker. Returns null when cancelled. */
  'extensions.loadDevFolder': invoke(
    z.object({ path: z.string().optional() }).optional(),
    extensionEntrySchema.nullable(),
  ),
  'extensions.removeDevFolder': invoke(z.object({ path: z.string() }), z.void()),
  'extensions.reload': invoke(
    z.object({ extensionId: z.string().optional() }).optional(),
    z.array(extensionEntrySchema),
  ),
  'extensions.preferences': invoke(z.object({ extensionId: z.string() }), preferencesSchema),
  'extensions.setPreference': invoke(
    z.object({ extensionId: z.string(), key: z.string(), value: z.unknown() }),
    z.void(),
  ),

  /** Extension repositories (docs/BRAINSTORM.md §5.8). */
  'repos.list': invoke(z.void(), z.array(repoInfoSchema)),
  /** Unverified repositories are only added with `confirmUnverified`. */
  'repos.add': invoke(
    z.object({ url: z.string().min(1), confirmUnverified: z.boolean().optional() }),
    addRepoResultSchema,
  ),
  'repos.remove': invoke(z.object({ repoId: idSchema }), z.void()),
  /** Without an id, every repository. */
  'repos.sync': invoke(z.object({ repoId: idSchema.optional() }).optional(), z.array(repoInfoSchema)),
  /** Trusts the key that signed this repository's index. */
  'repos.trustKey': invoke(z.object({ repoId: idSchema }), repoInfoSchema),
  'extensions.available': invoke(z.void(), z.array(availableExtensionSchema)),
  /** Downloads and verifies the archive; nothing is installed until `extensions.install`. */
  'extensions.prepareInstall': invoke(z.object({ repoId: idSchema, extensionId: z.string() }), installPreviewSchema),
  'extensions.install': invoke(z.object({ token: z.string() }), extensionEntrySchema),
  'extensions.cancelInstall': invoke(z.object({ token: z.string() }), z.void()),
  /** Installs every available update. */
  'extensions.updateAll': invoke(z.void(), updateAllResultSchema),
  // The id names a folder under userData/extensions, so only a valid id (no `..`, no separators) gets through.
  'extensions.uninstall': invoke(z.object({ extensionId: extensionIdSchema }), z.void()),
  /** The last 500 log lines of an extension (developer panel). */
  'extensions.logs': invoke(z.object({ extensionId: z.string() }), z.array(extensionLogEntrySchema)),
  'extensions.clearLogs': invoke(z.object({ extensionId: z.string() }), z.void()),

  'sources.list': invoke(z.void(), z.array(sourceEntrySchema)),
  'sources.info': invoke(z.object({ sourceId: sourceIdSchema }), sourceCapabilitiesSchema),
  'sources.filters': invoke(z.object({ sourceId: sourceIdSchema }), filtersSchema),
  'sources.browse': invoke(
    z.object({
      sourceId: sourceIdSchema,
      kind: z.enum(['popular', 'latest', 'search']),
      page: z.number().int().positive(),
      query: z.string().max(500).optional(),
      filters: filterStateSchema.optional(),
      requestId: requestIdSchema,
    }),
    browseResultSchema,
  ),
  /** Tries every installed source that implements resolveUrl. */
  'sources.resolveUrl': invoke(
    z.object({ url: z.url() }),
    z.object({ sourceId: z.string(), mangaId: z.number() }).nullable(),
  ),
  /** Opens the Cloudflare challenge for a source in a visible window. */
  'sources.solveChallenge': invoke(z.object({ sourceId: sourceIdSchema }), z.boolean()),
  'sources.setPinned': invoke(z.object({ sourceId: sourceIdSchema, pinned: z.boolean() }), z.void()),

  'manga.get': invoke(z.object({ mangaId: idSchema }), mangaInfoSchema),
  /** Fetches details + chapters from the source and syncs them into the DB. */
  'manga.refresh': invoke(
    z.object({ mangaId: idSchema, requestId: requestIdSchema }),
    z.object({ manga: mangaInfoSchema, newChapterIds: z.array(z.number()) }),
  ),
  /** Opens the manga's page on the source website in the system browser. */
  'manga.openInBrowser': invoke(z.object({ mangaId: idSchema }), z.void()),
  'chapters.list': invoke(z.object({ mangaId: idSchema }), z.array(chapterInfoSchema)),
  'chapter.get': invoke(z.object({ chapterId: idSchema }), chapterInfoSchema),
  /** Page list (cached ~1 h; falls back to a stale copy when the source is unreachable). */
  'chapter.pages': invoke(
    z.object({ chapterId: idSchema, requestId: requestIdSchema }),
    z.object({ pages: pagesSchema, fromCache: z.boolean() }),
  ),
  /**
   * Readies a page for the reader: fetched (or read from the download), measured and, with `crop`,
   * cropped. Returns its size as shown, so the page is laid out before the image loads.
   */
  'reader.preparePage': invoke(
    z.object({ chapterId: idSchema, index: z.number().int().nonnegative(), crop: z.boolean() }),
    pageSizeSchema,
  ),
  /** Sizes already known for a chapter's pages (no network), shown size with or without crop. */
  'reader.pageSizes': invoke(
    z.object({ chapterId: idSchema, crop: z.boolean() }),
    z.array(pageSizeSchema.extend({ index: z.number().int().nonnegative() })),
  ),
  /** "Save image…": the page as the source sent it, to a file picked in a dialog (null = cancelled). */
  'reader.savePage': invoke(
    z.object({ chapterId: idSchema, index: z.number().int().nonnegative() }),
    z.string().nullable(),
  ),
  /** "Copy image": the page to the clipboard (as PNG). */
  'reader.copyPage': invoke(z.object({ chapterId: idSchema, index: z.number().int().nonnegative() }), z.void()),
  'requests.cancel': invoke(z.object({ requestId: z.string() }), z.void()),

  /**
   * Reader position. `page` is where to resume (first page of a spread), `pageEnd` the last page
   * seen (the chapter is read once it reaches the end), `offset` the scrolled fraction of `page`
   * in webtoon mode. Ignored while incognito.
   */
  'progress.save': invoke(
    z.object({
      chapterId: idSchema,
      page: z.number().int().nonnegative(),
      pageEnd: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      offset: z.number().min(0).max(1).nullable(),
    }),
    z.void(),
  ),
  'chapters.markRead': invoke(
    z.object({ chapterIds: z.array(idSchema).min(1).max(20_000), read: z.boolean() }),
    z.void(),
  ),
  /** Marks every chapter before this one (by number, else source order) as read. */
  'chapters.markPreviousRead': invoke(z.object({ chapterId: idSchema }), z.void()),
  'manga.continue': invoke(z.object({ mangaId: idSchema }), continueTargetSchema.nullable()),
  /** Reader activity for reading sessions (active time; idle after ~2 min). */
  'reading.heartbeat': invoke(z.object({ chapterId: idSchema }), z.void()),
  'reading.end': invoke(z.void(), z.void()),
  'history.list': invoke(
    z
      .object({ query: z.string().max(200).optional(), limit: z.number().int().positive().max(500).optional() })
      .optional(),
    z.array(historyEntrySchema),
  ),
  'history.remove': invoke(z.object({ mangaId: idSchema }), z.void()),
  'history.clear': invoke(z.void(), z.void()),
  /** "Back up now": a file picked in a save dialog (default: the backup folder). Null = cancelled. */
  'backup.create': invoke(z.void(), z.string().nullable()),
  /** Backups in the backup folder, newest first. */
  'backup.list': invoke(z.void(), z.array(backupFileSchema)),
  /** Picks a backup file to restore (open dialog). */
  'backup.pick': invoke(z.void(), z.string().nullable()),
  'backup.preview': invoke(z.object({ path: z.string().min(1) }), backupPreviewSchema),
  /**
   * Restores a backup. "merge" combines it with what is here; "replace" first backs up and then
   * removes the current library. `settings`: also take the backup's app settings. A Mihon backup
   * is always merged; `sourceMap` says which installed source each of its sources (by id) goes to.
   */
  'backup.restore': invoke(
    z.object({
      path: z.string().min(1),
      mode: z.enum(['merge', 'replace']),
      settings: z.boolean(),
      sourceMap: z.record(z.string(), z.string()).optional(),
    }),
    restoreResultSchema,
  ),
  /** Picks the folder automatic backups go to. Null = cancelled. */
  'backup.chooseFolder': invoke(z.void(), z.string().nullable()),
  'backup.openFolder': invoke(z.void(), z.void()),
  /** Settings → Browse: picks the local files folder and saves it; null when cancelled. */
  'local.chooseFolder': invoke(z.void(), z.string().nullable()),
  'local.openFolder': invoke(z.void(), z.void()),
  // Trackers (ADR 0035). Updates to a tracker are queued in main and sent when online.
  'trackers.list': invoke(z.void(), z.array(trackerInfoSchema)),
  /** Opens the tracker's login in the system browser and waits (up to 3 minutes) for the answer. */
  'trackers.connect': invoke(z.object({ service: z.enum(TRACKER_SERVICES) }), trackerInfoSchema),
  'trackers.cancelConnect': invoke(z.object({ service: z.enum(TRACKER_SERVICES) }), z.void()),
  /** Connects with an access token made elsewhere (when the browser login cannot be used). */
  'trackers.setToken': invoke(
    z.object({ service: z.enum(TRACKER_SERVICES), token: z.string().trim().min(10).max(4096) }),
    trackerInfoSchema,
  ),
  'trackers.disconnect': invoke(z.object({ service: z.enum(TRACKER_SERVICES) }), z.void()),
  'trackers.search': invoke(
    z.object({ service: z.enum(TRACKER_SERVICES), query: z.string().trim().min(1).max(200) }),
    z.array(trackSearchResultSchema),
  ),
  'trackers.tracks': invoke(z.object({ mangaId: idSchema }), z.array(trackEntrySchema)),
  'trackers.link': invoke(
    z.object({
      mangaId: idSchema,
      service: z.enum(TRACKER_SERVICES),
      remoteId: z.string().min(1).max(64),
      remoteUrl: z.string().max(2048).nullable().optional(),
      title: z.string().max(500).nullable().optional(),
    }),
    trackEntrySchema,
  ),
  'trackers.unlink': invoke(z.object({ mangaId: idSchema, service: z.enum(TRACKER_SERVICES) }), z.void()),
  'trackers.update': invoke(
    z.object({ mangaId: idSchema, service: z.enum(TRACKER_SERVICES), patch: trackPatchSchema }),
    trackEntrySchema,
  ),
  /** Sends the queued updates now. */
  'trackers.retry': invoke(z.void(), z.void()),
  'stats.overview': invoke(z.object({ range: z.enum(STATS_RANGES) }), statsOverviewSchema),
  /** Forgets every reading session (Settings → Data); progress and history stay. */
  'stats.clear': invoke(z.void(), z.void()),
  /** The browser User-Agent sources get by default, and whether a proxy password is stored. */
  'network.info': invoke(
    z.void(),
    z.object({ defaultUserAgent: z.string(), hasProxyPassword: z.boolean(), passwordEncrypted: z.boolean() }),
  ),
  /**
   * Stores the proxy password (null removes it), encrypted where the system has a keyring; it never
   * comes back to the renderer.
   */
  'network.setProxyPassword': invoke(z.object({ password: z.string().max(500).nullable() }), z.void()),
  /** Loads a known page through the app's network settings (DNS-over-HTTPS, proxy). */
  'network.test': invoke(
    z.void(),
    z.object({
      url: z.string(),
      ok: z.boolean(),
      status: z.number().nullable(),
      ms: z.number(),
      error: z.string().nullable(),
    }),
  ),

  'library.list': invoke(
    z.object({
      tab: libraryTabSchema,
      sort: z.enum(['title', 'lastRead', 'latestChapter', 'added', 'unread', 'total']),
      ascending: z.boolean(),
      filters: libraryFiltersSchema,
      /** Full-text search over title, author and genres (FTS5, prefix match). */
      query: z.string().max(200).optional(),
    }),
    z.array(libraryItemSchema),
  ),
  'library.counts': invoke(z.void(), libraryCountsSchema),
  /** Adds (or updates the categories of) a manga; fetches details first if never refreshed. */
  'library.add': invoke(z.object({ mangaId: idSchema, categoryIds: z.array(idSchema) }), z.void()),
  'library.remove': invoke(z.object({ mangaIds: z.array(idSchema).min(1) }), z.void()),
  'library.setCategories': invoke(
    z.object({ mangaIds: z.array(idSchema).min(1), categoryIds: z.array(idSchema) }),
    z.void(),
  ),
  /** Marks every chapter of these manga read or unread. */
  'library.markRead': invoke(z.object({ mangaIds: z.array(idSchema).min(1), read: z.boolean() }), z.void()),
  'categories.list': invoke(z.void(), z.array(categorySchema)),
  'categories.create': invoke(z.object({ name: z.string().trim().min(1).max(60) }), categorySchema),
  'categories.rename': invoke(z.object({ id: idSchema, name: z.string().trim().min(1).max(60) }), z.void()),
  'categories.delete': invoke(z.object({ id: idSchema }), z.void()),
  /** New order, first to last; every category id exactly once. */
  'categories.reorder': invoke(z.object({ ids: z.array(idSchema) }), z.void()),
  /** Cover from a file (picked in a dialog) or from a cached reader page. Returns false if cancelled. */
  'manga.setCustomCover': invoke(
    z.object({
      mangaId: idSchema,
      from: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('file') }),
        z.object({ kind: z.literal('page'), chapterId: idSchema, index: z.number().int().nonnegative() }),
      ]),
    }),
    z.boolean(),
  ),
  'manga.resetCover': invoke(z.object({ mangaId: idSchema }), z.void()),
  /** Library manga from other sources with the same (normalized) title. */
  'manga.findDuplicates': invoke(z.object({ mangaId: idSchema }), z.array(mangaInfoSchema)),
  /** Reader override for this manga (docs/BRAINSTORM.md §6.1); null resets it to the global settings. */
  'manga.setReaderSettings': invoke(
    z.object({ mangaId: idSchema, settings: mangaReaderSettingsSchema.nullable() }),
    z.void(),
  ),
  /** Hidden scanlators and their priority order (docs/BRAINSTORM.md §6.2). */
  'manga.setScanlatorPrefs': invoke(z.object({ mangaId: idSchema, prefs: scanlatorPrefsSchema }), z.void()),
  /**
   * Searches the target sources, in order, for a manga to migrate (docs/BRAINSTORM.md §6.2). Exact title
   * matches stop the search; otherwise every target is searched and the most similar result wins.
   */
  'migration.findCandidates': invoke(
    z.object({ mangaId: idSchema, targets: z.array(sourceIdSchema).min(1).max(20), requestId: requestIdSchema }),
    migrationSearchSchema,
  ),
  /** Migrates each pair in turn (progress on `migration.progress`); one failure doesn't stop the rest. */
  'migration.run': invoke(
    z.object({
      items: z
        .array(z.object({ fromMangaId: idSchema, toMangaId: idSchema }))
        .min(1)
        .max(500),
      options: migrationOptionsSchema,
    }),
    z.array(migrationResultSchema),
  ),
  /** Queues chapters for download (already queued or downloaded ones are left as they are). */
  'downloads.enqueue': invoke(z.object({ chapterIds: z.array(idSchema).min(1).max(5000) }), z.void()),
  /**
   * Downloads of one manga, or all of them; queue order, then newest finished first. `listed`
   * leaves out finished downloads cleared from the Downloads page (they stay on disk).
   */
  'downloads.list': invoke(
    z.object({ mangaId: idSchema.optional(), listed: z.boolean().optional() }).optional(),
    z.array(downloadItemSchema),
  ),
  'downloads.stats': invoke(z.void(), downloadStatsSchema),
  /** Without ids: the whole queue. */
  'downloads.pause': invoke(z.object({ ids: z.array(idSchema).optional() }).optional(), z.void()),
  'downloads.resume': invoke(z.object({ ids: z.array(idSchema).optional() }).optional(), z.void()),
  /** Removes queued/unfinished downloads (and their partial files). */
  'downloads.cancel': invoke(z.object({ ids: z.array(idSchema).min(1) }), z.void()),
  'downloads.retry': invoke(z.object({ ids: z.array(idSchema).min(1) }), z.void()),
  /** New queue order, first to last. */
  'downloads.reorder': invoke(z.object({ ids: z.array(idSchema).min(1) }), z.void()),
  /** Deletes finished downloads from disk (and cancels unfinished ones) of these chapters. */
  'downloads.delete': invoke(z.object({ chapterIds: z.array(idSchema).min(1) }), z.void()),
  /** Hides the finished downloads from the Downloads page (the files stay). */
  'downloads.clearCompleted': invoke(z.void(), z.void()),
  /** The download folder in effect (the setting, or the default `Documents/Matane`). */
  'downloads.folder': invoke(z.void(), z.string()),
  /** Asks for a folder; null when cancelled. */
  'downloads.pickFolder': invoke(z.void(), z.string().nullable()),
  /**
   * Makes `folder` the download folder. With `move`, finished and partial downloads move there
   * first (progress on `downloads.moveProgress`); the queue waits meanwhile.
   */
  'downloads.setFolder': invoke(z.object({ folder: z.string().min(1), move: z.boolean() }), z.void()),
  /** Opens the download folder, or the folder holding a chapter's download. */
  'downloads.openFolder': invoke(z.object({ chapterId: idSchema.optional() }).optional(), z.void()),
  /** Starts a check (progress on `updates.progress`); false when one is running or offline. */
  'updates.check': invoke(
    z.object({ scope: updateScopeSchema }),
    z.object({ started: z.boolean(), reason: z.enum(['running', 'offline', 'empty']).nullable() }),
  ),
  'updates.cancel': invoke(z.void(), z.void()),
  /** New chapters of library manga, newest first. */
  'updates.list': invoke(z.object({ categoryId: idSchema.optional() }).optional(), z.array(updateEntrySchema)),
  'updates.status': invoke(z.void(), updateStatusSchema),
  /** The Updates page was seen: the sidebar badge starts again from zero. */
  'updates.markSeen': invoke(z.void(), z.void()),
  'categories.setAutoDownload': invoke(
    z.object({ id: idSchema, value: z.enum(['include', 'exclude']).nullable() }),
    z.void(),
  ),
  /** The chapter list's filter and sort for this manga; null = default. */
  'manga.setChapterView': invoke(z.object({ mangaId: idSchema, view: chapterViewSchema.nullable() }), z.void()),
  'chapters.setBookmarked': invoke(
    z.object({ chapterIds: z.array(idSchema).min(1), bookmarked: z.boolean() }),
    z.void(),
  ),
} satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>;

/** Main → renderer push channels. */
export const eventContract = {
  'window.maximizeChanged': z.boolean(),
  'settings.changed': appSettingsSchema,
  'backup.progress': backupProgressSchema,
  'db.changed': z.object({ tags: z.array(z.custom<DbChangeTag>()) }),
  'cloudflare.status': cloudflareStatusSchema,
  'window.fullScreenChanged': z.boolean(),
  'migration.progress': migrationProgressSchema,
  'downloads.progress': downloadProgressSchema,
  'downloads.moveProgress': downloadMoveProgressSchema,
  'updates.progress': updateProgressSchema,
  /** Main asks the renderer to open a page (a notification was clicked). */
  'app.navigate': z.object({ to: z.string() }),
  'app.online': z.boolean(),
  'updater.changed': updaterStatusSchema,
  'extensions.log': z.object({ extensionId: z.string(), entry: extensionLogEntrySchema }),
} satisfies Record<EventChannel, z.ZodType>;

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>;
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>;

/** Shape exposed on `window.api` by the preload script. */
export interface IpcApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeInput<C> extends void | undefined
      ? []
      : undefined extends InvokeInput<C>
        ? [input?: InvokeInput<C>]
        : [input: InvokeInput<C>]
  ): Promise<InvokeOutput<C>>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
}
