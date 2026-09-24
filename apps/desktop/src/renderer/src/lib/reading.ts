import { queryOptions } from '@tanstack/react-query';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

// Main-owned like the library: cached until `db.changed` says "history" (ADR 0010).

export const historyQuery = (query: string) =>
  queryOptions({
    queryKey: ['history', query] as const,
    queryFn: () => ipc.invoke('history.list', query ? { query } : undefined),
    ...localQueryDefaults,
  });
