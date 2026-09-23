import type { AppSettings, EventChannel, EventPayload } from '@manga-reader/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { localQueryDefaults } from './query';

export const ipc = window.api;

export const appInfoQuery = queryOptions({
  queryKey: ['app', 'info'],
  queryFn: () => ipc.invoke('app.getInfo'),
  ...localQueryDefaults,
});

export const osLocaleQuery = queryOptions({
  queryKey: ['app', 'locale'],
  queryFn: () => ipc.invoke('app.getLocale'),
  ...localQueryDefaults,
});

/** Kept current by the `settings.changed` event (see routes/__root.tsx). */
export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: () => ipc.invoke('settings.get'),
  ...localQueryDefaults,
});

/** Kept current by the `window.maximizeChanged` event (see WindowControls). */
export const windowMaximizedQuery = queryOptions({
  queryKey: ['window', 'maximized'],
  queryFn: () => ipc.invoke('window.isMaximized'),
  ...localQueryDefaults,
});

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => ipc.invoke('settings.set', patch),
    onMutate: (patch) => {
      // Optimistic so theme/language switches feel instant.
      const previous = queryClient.getQueryData(settingsQuery.queryKey);
      if (previous) queryClient.setQueryData(settingsQuery.queryKey, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(settingsQuery.queryKey, context.previous);
    },
    onSuccess: (next) => queryClient.setQueryData(settingsQuery.queryKey, next),
  });
}

export function useIpcEvent<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): void {
  useEffect(() => ipc.on(channel, listener), [channel, listener]);
}
