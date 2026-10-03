import { createHashHistory, createRouter } from '@tanstack/react-router';
import type en from './i18n/locales/en.json';
import { createQueryClient } from './lib/query';
import { trackReaderOrigin } from './lib/reader-origin';
import { routeTree } from './routeTree.gen';

export const queryClient = createQueryClient();

// Hash history: the packaged app is loaded from file://, where path-based URLs don't resolve.
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { queryClient },
  defaultPreload: 'intent',
});

trackReaderOrigin(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** `nav.*` translation keys shown as breadcrumbs in the title bar. */
    crumbs?: (keyof (typeof en)['nav'])[];
  }
}
