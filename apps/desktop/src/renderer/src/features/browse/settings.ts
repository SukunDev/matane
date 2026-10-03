import type { BrowseSettings } from '@manga-reader/shared';
import { DEFAULT_SETTINGS } from '@manga-reader/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';

/** How a source's manga list is shown (display mode, cover size), saved in the browse settings. */
export function useBrowseView(): [BrowseSettings, (patch: Partial<BrowseSettings>) => void] {
  const queryClient = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const browse = data?.browse ?? DEFAULT_SETTINGS.browse;
  return [
    browse,
    (patch) => {
      // From the cache, not this render: quick successive patches must build on each other.
      const current = queryClient.getQueryData(settingsQuery.queryKey)?.browse ?? browse;
      update.mutate({ browse: { ...current, ...patch } });
    },
  ];
}
