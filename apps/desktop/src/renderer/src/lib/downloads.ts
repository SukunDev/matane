import type { DownloadProgress, DownloadStats } from '@manga-reader/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { create } from 'zustand';
import { ipc, settingsQuery, useIpcEvent } from './ipc';
import { localQueryDefaults } from './query';

// Rows are main-owned (refreshed by the "downloads" db tag, ADR 0010); live page progress arrives
// several times a second on `downloads.progress` and lives in a small store instead.

export const downloadsQuery = (mangaId?: number) =>
  queryOptions({
    queryKey: ['downloads', 'list', mangaId ?? 'all'] as const,
    queryFn: () => ipc.invoke('downloads.list', mangaId === undefined ? undefined : { mangaId }),
    ...localQueryDefaults,
  });

/** The Downloads page: every download except finished ones cleared from the page. */
export const listedDownloadsQuery = queryOptions({
  queryKey: ['downloads', 'list', 'listed'] as const,
  queryFn: () => ipc.invoke('downloads.list', { listed: true }),
  ...localQueryDefaults,
});

/** The folder in effect; keyed by the setting so it follows changes (null = the default folder). */
export const downloadFolderQuery = (setting: string | null) =>
  queryOptions({
    queryKey: ['downloads', 'folder', setting] as const,
    queryFn: () => ipc.invoke('downloads.folder'),
    ...localQueryDefaults,
  });

/** The size limit in bytes, or null. */
export const limitBytesOf = (limitGb: number | null) => (limitGb === null ? null : limitGb * 1024 ** 3);

export const isOverLimit = (stats: DownloadStats | undefined, limitGb: number | null | undefined) => {
  const limit = limitBytesOf(limitGb ?? null);
  return limit !== null && (stats?.totalBytes ?? 0) >= limit;
};

interface LimitConfirmState {
  /** Chapters waiting for "Download anyway" (the size limit is reached). */
  pending: { chapterIds: number[]; onQueued?: () => void } | null;
  ask: (pending: { chapterIds: number[]; onQueued?: () => void }) => void;
  close: () => void;
}

export const useLimitConfirm = create<LimitConfirmState>((set) => ({
  pending: null,
  ask: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}));

/**
 * Queues chapters the user asked for. Past the size limit, automatic downloads stop but manual
 * ones still go after a confirmation (docs/BRAINSTORM.md §6.4; the dialog is `DownloadLimitDialog`).
 */
export function useEnqueueDownloads(): (chapterIds: number[], onQueued?: () => void) => void {
  const queryClient = useQueryClient();
  const ask = useLimitConfirm((state) => state.ask);
  return useCallback(
    (chapterIds, onQueued) => {
      if (chapterIds.length === 0) return;
      void (async () => {
        const [settings, stats] = await Promise.all([
          queryClient.ensureQueryData(settingsQuery),
          queryClient.ensureQueryData(downloadStatsQuery),
        ]);
        if (isOverLimit(stats, settings.downloads.limitGb)) {
          ask({ chapterIds, onQueued });
          return;
        }
        await ipc.invoke('downloads.enqueue', { chapterIds });
        onQueued?.();
      })();
    },
    [queryClient, ask],
  );
}

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
