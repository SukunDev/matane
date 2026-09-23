import type { AppSettings, EventPayload } from '@manga-reader/shared';
import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { useCallback } from 'react';
import { settingsQuery, useIpcEvent } from '../lib/ipc';
import { invalidateTags } from '../lib/sources';
import { LanguageSync } from '../i18n/LanguageSync';
import { ThemeSync } from '../theme/ThemeSync';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Settings can change from main (or another window); keep the cache authoritative.
  useIpcEvent(
    'settings.changed',
    useCallback((settings: AppSettings) => queryClient.setQueryData(settingsQuery.queryKey, settings), [queryClient]),
  );
  // Main owns the database and says which entities changed (ADR 0010).
  useIpcEvent(
    'db.changed',
    useCallback((payload: EventPayload<'db.changed'>) => invalidateTags(queryClient, payload.tags), [queryClient]),
  );
  return (
    <>
      <ThemeSync />
      <LanguageSync />
      <Outlet />
    </>
  );
}
