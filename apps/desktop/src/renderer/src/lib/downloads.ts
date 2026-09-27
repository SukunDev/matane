import type { DownloadProgress } from '@manga-reader/shared';
import { queryOptions } from '@tanstack/react-query';
import { useCallback } from 'react';
import { create } from 'zustand';
import { ipc, useIpcEvent } from './ipc';
import { localQueryDefaults } from './query';

// Rows are main-owned (refreshed by the "downloads" db tag, ADR 0010); live page progress arrives
// several times a second on `downloads.progress` and lives in a small store instead.

export const downloadsQuery = (mangaId?: number) =>
  queryOptions({
    queryKey: ['downloads', 'list', mangaId ?? 'all'] as const,
    queryFn: () => ipc.invoke('downloads.list', mangaId === undefined ? undefined : { mangaId }),
    ...localQueryDefaults,
  });

export const downloadStatsQuery = queryOptions({
  queryKey: ['downloads', 'stats'] as const,
  queryFn: () => ipc.invoke('downloads.stats'),
  ...localQueryDefaults,
});

type LiveItem = DownloadProgress['items'][number];

interface ProgressState {
  /** By chapter id, only chapters downloading right now. */
  byChapter: ReadonlyMap<number, LiveItem>;
  set: (progress: DownloadProgress) => void;
}

export const useDownloadProgress = create<ProgressState>((set) => ({
  byChapter: new Map(),
  set: (progress) => set({ byChapter: new Map(progress.items.map((item) => [item.chapterId, item])) }),
}));

/** Mounted once at the root: feeds `useDownloadProgress` from main. */
export function useDownloadProgressSync(): void {
  const update = useDownloadProgress((state) => state.set);
  useIpcEvent(
    'downloads.progress',
    useCallback((progress: DownloadProgress) => update(progress), [update]),
  );
}
