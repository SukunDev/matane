import { createFileRoute } from '@tanstack/react-router';
import { ExtensionsPage, type ExtensionsTab } from '../../../features/extensions/ExtensionsPage';

const TABS: ExtensionsTab[] = ['installed', 'available', 'updates'];

export const Route = createFileRoute('/_app/browse/extensions')({
  staticData: { crumbs: ['browse', 'extensions'] },
  validateSearch: (search: Record<string, unknown>): { tab?: ExtensionsTab } =>
    TABS.includes(search['tab'] as ExtensionsTab) ? { tab: search['tab'] as ExtensionsTab } : {},
  component: ExtensionsRoute,
});

function ExtensionsRoute() {
  const { tab } = Route.useSearch();
  // A link to another tab (e.g. from an empty Library) opens the page on it.
  return <ExtensionsPage key={tab ?? 'installed'} initialTab={tab} />;
}
