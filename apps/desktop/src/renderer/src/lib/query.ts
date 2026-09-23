import { QueryClient } from '@tanstack/react-query';

/**
 * Data owned by the main process (SQLite, app info, window state). It never goes stale on its own:
 * main pushes changes over IPC events and the renderer updates or invalidates the cache (ADR 0010).
 */
export const localQueryDefaults = { staleTime: Infinity, retry: false } as const;

/**
 * Global defaults target remote data from extensions (slow, rate-limited, may fail), which is what
 * TanStack Query is for. Local queries opt out via `localQueryDefaults`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        // Window focus changes constantly on desktop and would re-hit rate-limited sources.
        refetchOnWindowFocus: false,
      },
    },
  });
}
