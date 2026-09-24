import type { InvokeInput } from '@manga-reader/shared';
import { queryOptions } from '@tanstack/react-query';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

// Library data is main-owned: cached until `db.changed` says "library" / "categories" (ADR 0010).

export type LibraryListInput = InvokeInput<'library.list'>;

export const libraryQuery = (input: LibraryListInput) =>
  queryOptions({
    queryKey: ['library', 'list', input] as const,
    queryFn: () => ipc.invoke('library.list', input),
    ...localQueryDefaults,
  });

export const libraryCountsQuery = queryOptions({
  queryKey: ['library', 'counts'] as const,
  queryFn: () => ipc.invoke('library.counts'),
  ...localQueryDefaults,
});

export const categoriesQuery = queryOptions({
  queryKey: ['categories'] as const,
  queryFn: () => ipc.invoke('categories.list'),
  ...localQueryDefaults,
});

/** Ids of every library manga, for "In library" badges outside the library (browse results). */
export const libraryIdsQuery = queryOptions({
  queryKey: ['library', 'ids'] as const,
  queryFn: async () => {
    const items = await ipc.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, status: [], sourceIds: [] },
    });
    return new Set(items.map((item) => item.mangaId));
  },
  ...localQueryDefaults,
});
