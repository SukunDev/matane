import { useQuery } from '@tanstack/react-query';
import { settingsQuery, useUpdateSettings } from './ipc';

/** Incognito (BRAINSTORM.md §6.3): main skips progress, history and sessions while it is on. */
export function useIncognito(): [on: boolean, set: (on: boolean) => void] {
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  return [settings?.incognito ?? false, (incognito) => update.mutate({ incognito })];
}
