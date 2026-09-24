import type { DbChangeTag, FilterState, InvokeInput, InvokeOutput } from '@manga-reader/shared';
import {
  type QueryClient,
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

// Queries for extensions, sources, manga and chapters (ADR 0010):
// - main-owned rows use `localQueryDefaults` and are refreshed by `db.changed` tags;
// - calls that reach an extension keep the remote defaults (retry, no focus refetch).

type CancellableChannel = 'sources.browse' | 'manga.refresh' | 'chapter.pages' | 'migration.findCandidates';

/**
 * Invokes a slow source call that TanStack Query may abort (unmount, new filters, …). The abort is
 * forwarded to main as `requests.cancel` so it stops waiting on the extension.
 */
export function invokeCancellable<C extends CancellableChannel>(
  channel: C,
  input: Omit<InvokeInput<C>, 'requestId'>,
  signal?: AbortSignal,
): Promise<InvokeOutput<C>> {
  const requestId = crypto.randomUUID();
  const onAbort = () => void ipc.invoke('requests.cancel', { requestId }).catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  const call = ipc.invoke as (channel: C, input: InvokeInput<C>) => Promise<InvokeOutput<C>>;
  return call(channel, { ...input, requestId } as InvokeInput<C>).finally(() =>
    signal?.removeEventListener('abort', onAbort),
  );
}

export type BrowseKind = InvokeInput<'sources.browse'>['kind'];

export const queryKeys = {
  extensions: ['extensions'] as const,
  sources: ['sources', 'list'] as const,
  sourceInfo: (sourceId: string) => ['sourceInfo', sourceId] as const,
  sourceFilters: (sourceId: string) => ['sourceFilters', sourceId] as const,
  preferences: (extensionId: string) => ['preferences', extensionId] as const,
  browse: (sourceId: string, kind: BrowseKind, query: string, filters: FilterState) =>
    ['browse', sourceId, kind, query, filters] as const,
  manga: (mangaId: number) => ['manga', mangaId] as const,
  chapters: (mangaId: number) => ['chapters', mangaId] as const,
  chapter: (chapterId: number) => ['chapter', chapterId] as const,
  pages: (chapterId: number) => ['pages', chapterId] as const,
  continue: (mangaId: number) => ['continue', mangaId] as const,
  history: (query: string) => ['history', query] as const,
};

export const extensionsQuery = queryOptions({
  queryKey: queryKeys.extensions,
  queryFn: () => ipc.invoke('extensions.list'),
  ...localQueryDefaults,
});

export const sourcesQuery = queryOptions({
  queryKey: queryKeys.sources,
  queryFn: () => ipc.invoke('sources.list'),
  ...localQueryDefaults,
});

/** Capabilities barely change; an extension reload invalidates them. */
export const sourceInfoQuery = (sourceId: string) =>
  queryOptions({
    queryKey: queryKeys.sourceInfo(sourceId),
    queryFn: () => ipc.invoke('sources.info', { sourceId }),
    staleTime: Infinity,
  });

export const sourceFiltersQuery = (sourceId: string) =>
  queryOptions({
    queryKey: queryKeys.sourceFilters(sourceId),
    queryFn: () => ipc.invoke('sources.filters', { sourceId }),
    staleTime: 60 * 60_000,
  });

export const preferencesQuery = (extensionId: string) =>
  queryOptions({
    queryKey: queryKeys.preferences(extensionId),
    queryFn: () => ipc.invoke('extensions.preferences', { extensionId }),
    ...localQueryDefaults,
  });

export const browseQuery = (sourceId: string, kind: BrowseKind, query: string, filters: FilterState) =>
  infiniteQueryOptions({
    queryKey: queryKeys.browse(sourceId, kind, query, filters),
    queryFn: ({ pageParam, signal }) =>
      invokeCancellable(
        'sources.browse',
        { sourceId, kind, page: pageParam, ...(kind === 'search' && { query, filters }) },
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasNextPage ? pages.length + 1 : undefined),
    // Browsing back and forth should not re-hit the source every time.
    staleTime: 5 * 60_000,
  });

export const mangaQuery = (mangaId: number) =>
  queryOptions({
    queryKey: queryKeys.manga(mangaId),
    queryFn: () => ipc.invoke('manga.get', { mangaId }),
    ...localQueryDefaults,
  });

export const chaptersQuery = (mangaId: number) =>
  queryOptions({
    queryKey: queryKeys.chapters(mangaId),
    queryFn: () => ipc.invoke('chapters.list', { mangaId }),
    ...localQueryDefaults,
  });

export const chapterQuery = (chapterId: number) =>
  queryOptions({
    queryKey: queryKeys.chapter(chapterId),
    queryFn: () => ipc.invoke('chapter.get', { chapterId }),
    ...localQueryDefaults,
  });

/** Which chapter "Continue reading" opens (main applies BRAINSTORM.md §6.3). */
export const continueQuery = (mangaId: number) =>
  queryOptions({
    queryKey: queryKeys.continue(mangaId),
    queryFn: () => ipc.invoke('manga.continue', { mangaId }),
    ...localQueryDefaults,
  });

/** Page list of a chapter; main caches it (~1 h) and falls back to a stale copy offline. */
export const pagesQuery = (chapterId: number) =>
  queryOptions({
    queryKey: queryKeys.pages(chapterId),
    queryFn: ({ signal }) => invokeCancellable('chapter.pages', { chapterId }, signal),
    staleTime: 30 * 60_000,
  });

/** Fetches details + chapters from the source; `db.changed` then refreshes the local queries. */
export function useRefreshManga(mangaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['refreshManga', mangaId],
    mutationFn: () => invokeCancellable('manga.refresh', { mangaId }),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.manga(mangaId), result.manga),
  });
}

/** Query keys that go stale when main reports a changed entity (ADR 0010). */
export function keysForTag(tag: DbChangeTag): readonly (readonly unknown[])[] {
  if (tag === 'extensions') {
    return [queryKeys.extensions, queryKeys.sources, ['sourceInfo'], ['sourceFilters'], ['preferences']];
  }
  if (tag === 'sources') return [queryKeys.sources];
  // Library rows show unread counts (chapters) and "last read" (history).
  if (tag === 'history') return [['history'], ['continue'], ['library']];
  if (tag === 'library') return [['library']];
  if (tag === 'categories') return [['categories'], ['library']];
  const [kind, id] = tag.split(':');
  // History rows show the manga's title and cover, and chapter names and read state.
  if (kind === 'manga') return [queryKeys.manga(Number(id)), ['history']];
  if (kind === 'chapters') {
    return [
      queryKeys.chapters(Number(id)),
      ['chapter'],
      queryKeys.continue(Number(id)),
      ['library', 'list'],
      ['history'],
    ];
  }
  return [];
}

export function invalidateTags(queryClient: QueryClient, tags: readonly DbChangeTag[]): void {
  for (const tag of tags) {
    for (const queryKey of keysForTag(tag)) void queryClient.invalidateQueries({ queryKey });
  }
}
