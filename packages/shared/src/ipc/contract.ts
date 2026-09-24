import { z } from 'zod';
import type { Filter, Page, Preference } from '@manga-reader/extension-sdk';
import {
  browseResultSchema,
  categorySchema,
  chapterInfoSchema,
  cloudflareStatusSchema,
  continueTargetSchema,
  extensionEntrySchema,
  filterStateSchema,
  historyEntrySchema,
  libraryCountsSchema,
  libraryFiltersSchema,
  libraryItemSchema,
  libraryTabSchema,
  mangaInfoSchema,
  requestIdSchema,
  sourceCapabilitiesSchema,
  sourceEntrySchema,
  sourceIdSchema,
} from '../models';
import type { DbChangeTag } from '../models';
import { appSettingsSchema } from '../settings';
import type { EventChannel, InvokeChannel } from './channels';

const invoke = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
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

/** Renderer → main request/response channels. Inputs are validated in main. */
export const invokeContract = {
  'app.getInfo': invoke(z.void(), appInfoSchema),
  'app.getLocale': invoke(z.void(), z.string()),
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
  'chapters.setBookmarked': invoke(
    z.object({ chapterIds: z.array(idSchema).min(1), bookmarked: z.boolean() }),
    z.void(),
  ),
} satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>;

/** Main → renderer push channels. */
export const eventContract = {
  'window.maximizeChanged': z.boolean(),
  'settings.changed': appSettingsSchema,
  'db.changed': z.object({ tags: z.array(z.custom<DbChangeTag>()) }),
  'cloudflare.status': cloudflareStatusSchema,
  'window.fullScreenChanged': z.boolean(),
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
