import type { FilterState } from '@manga-reader/shared';
import { createFileRoute } from '@tanstack/react-router';
import { OnlineOnly } from '../../../components/OfflineState';
import { type BrowseSearch, SourceBrowsePage } from '../../../features/browse/SourceBrowsePage';

const TABS = ['popular', 'latest', 'search'] as const;

export const Route = createFileRoute('/_app/browse/sources/$extensionId/$sourceKey')({
  staticData: { crumbs: ['browse'] },
  // Tab, query and filters live in the URL so Back from a manga restores the same listing.
  validateSearch: (search: Record<string, unknown>): BrowseSearch => ({
    tab: TABS.find((tab) => tab === search['tab']) ?? 'popular',
    q: typeof search['q'] === 'string' && search['q'] ? search['q'] : undefined,
    filters:
      search['filters'] && typeof search['filters'] === 'object' && !Array.isArray(search['filters'])
        ? (search['filters'] as FilterState)
        : undefined,
  }),
  component: BrowseRoute,
});

function BrowseRoute() {
  const { extensionId, sourceKey } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OnlineOnly>
      <SourceBrowsePage
        key={`${extensionId}/${sourceKey}`}
        extensionId={extensionId}
        sourceKey={sourceKey}
        search={search}
        onSearchChange={(next) => void navigate({ search: next, replace: true })}
      />
    </OnlineOnly>
  );
}
