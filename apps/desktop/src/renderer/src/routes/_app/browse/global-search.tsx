import { createFileRoute } from '@tanstack/react-router';
import { GlobalSearchPage } from '../../../features/search/GlobalSearchPage';

export interface GlobalSearchSearch {
  q?: string;
}

export const Route = createFileRoute('/_app/browse/global-search')({
  staticData: { crumbs: ['browse', 'globalSearch'] },
  // The query lives in the URL so Back from a manga shows the same (cached) results.
  validateSearch: (search: Record<string, unknown>): GlobalSearchSearch =>
    typeof search['q'] === 'string' && search['q'].trim() ? { q: search['q'].trim() } : {},
  component: GlobalSearchRoute,
});

function GlobalSearchRoute() {
  const { q = '' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <GlobalSearchPage query={q} onQuery={(next) => void navigate({ search: next ? { q: next } : {} })} />;
}
