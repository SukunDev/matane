import type { LibraryFilters, LibrarySettings } from '@manga-reader/shared';
import { DEFAULT_LIBRARY_SETTINGS } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';

/** The library view settings (display, sort, filters), saved in app settings. */
export function useLibrarySettings(): [LibrarySettings, (patch: Partial<LibrarySettings>) => void] {
  const { data } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const library = data?.library ?? DEFAULT_LIBRARY_SETTINGS;
  return [library, (patch) => update.mutate({ library: { ...library, ...patch } })];
}

export const filtersOf = (settings: LibrarySettings): LibraryFilters => ({
  unread: settings.unreadOnly,
  reading: settings.readingOnly,
  bookmarked: settings.bookmarkedOnly,
  downloaded: settings.downloadedOnly,
  status: settings.status,
  sourceIds: settings.sourceIds,
});

export const filterCount = (settings: LibrarySettings) =>
  Number(settings.unreadOnly) +
  Number(settings.readingOnly) +
  Number(settings.bookmarkedOnly) +
  Number(settings.downloadedOnly) +
  settings.status.length +
  settings.sourceIds.length;
