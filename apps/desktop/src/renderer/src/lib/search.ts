import type { SourceEntry } from '@manga-reader/shared';
import { queryOptions } from '@tanstack/react-query';
import { createLimiter } from '@manga-reader/shared/limit';
import { invokeCancellable } from './sources';

// Global search and migration share one queue: at most 5 sources are searched at once (§6.2);
// each extension's own rate limit still applies in main.
export const sourceSearchLimit = createLimiter(5);

/** First page of one source's search results, for global search and manual migration search. */
export const sourceSearchQuery = (sourceId: string, query: string) =>
  queryOptions({
    queryKey: ['globalSearch', sourceId, query] as const,
    queryFn: ({ signal }) =>
      sourceSearchLimit(
        () => invokeCancellable('sources.browse', { sourceId, kind: 'search', page: 1, query }, signal),
        signal,
      ),
    enabled: query.trim() !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * The default set of sources to search: pinned ones and those with manga in the library; every
 * installed source when that set is empty.
 */
export function defaultSearchSources(sources: readonly SourceEntry[], librarySourceIds: ReadonlySet<string>) {
  const installed = sources.filter((s) => s.installed);
  const picked = installed.filter((s) => s.pinned || librarySourceIds.has(s.id));
  return picked.length > 0 ? picked : installed;
}
