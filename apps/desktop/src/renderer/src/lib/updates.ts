import type { UpdateProgress } from '@manga-reader/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ipc, useIpcEvent } from './ipc';
import { localQueryDefaults } from './query';

// New chapters and the checker's status are main-owned (refreshed by the "updates" db tag and by
// chapter changes, ADR 0010); the running check's progress arrives on `updates.progress`.

export const updatesQuery = (categoryId?: number) =>
  queryOptions({
    queryKey: ['updates', 'list', categoryId ?? 'all'] as const,
    queryFn: () => ipc.invoke('updates.list', categoryId === undefined ? undefined : { categoryId }),
    ...localQueryDefaults,
  });

export const updateStatusQuery = queryOptions({
  queryKey: ['updates', 'status'] as const,
  queryFn: () => ipc.invoke('updates.status'),
  ...localQueryDefaults,
});

/** Mounted once at the root: live progress goes into the status query; a finished check refetches it. */
export function useUpdateProgressSync(): void {
  const queryClient = useQueryClient();
  useIpcEvent(
    'updates.progress',
    useCallback(
      (progress: UpdateProgress) => {
        queryClient.setQueryData(updateStatusQuery.queryKey, (old) =>
          old ? { ...old, progress: progress.running ? progress : null } : old,
        );
        if (!progress.running) void queryClient.invalidateQueries({ queryKey: ['updates'] });
      },
      [queryClient],
    ),
  );
}
