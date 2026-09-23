import { z } from 'zod';
import type { Filter, Page, Preference } from '@manga-reader/extension-sdk';
import {
  browseResultSchema,
  chapterInfoSchema,
  cloudflareStatusSchema,
  extensionEntrySchema,
  filterStateSchema,
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
