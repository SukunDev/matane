import { queryOptions } from '@tanstack/react-query';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

// Accounts and links are main-owned: the "trackers" and "tracks:<mangaId>" db tags refresh them (ADR 0010).

export const trackersQuery = queryOptions({
  queryKey: ['trackers', 'list'] as const,
  queryFn: () => ipc.invoke('trackers.list'),
  ...localQueryDefaults,
});

export const tracksQuery = (mangaId: number) =>
  queryOptions({
    queryKey: ['tracks', mangaId] as const,
    queryFn: () => ipc.invoke('trackers.tracks', { mangaId }),
    ...localQueryDefaults,
  });

/** A date as `<input type="date">` writes it (UTC, as the trackers keep dates). */
export const toDateInput = (ms: number | null): string => (ms === null ? '' : new Date(ms).toISOString().slice(0, 10));
export const fromDateInput = (value: string): number | null => {
  const ms = value ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};
