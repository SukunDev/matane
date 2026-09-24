import type { LibraryTab } from '@manga-reader/shared';
import { createFileRoute } from '@tanstack/react-router';
import { LibraryPage } from '../../features/library/LibraryPage';

export interface LibrarySearch {
  /** "default" or a category id; absent = "All". */
  tab?: 'default' | number;
}

export const Route = createFileRoute('/_app/library')({
  staticData: { crumbs: ['library'] },
  validateSearch: (search: Record<string, unknown>): LibrarySearch => {
    const tab = search['tab'];
    if (tab === 'default') return { tab };
    return typeof tab === 'number' && Number.isInteger(tab) && tab > 0 ? { tab } : {};
  },
  component: LibraryRoute,
});

function LibraryRoute() {
  const { tab = 'all' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onTab = (next: LibraryTab) => void navigate({ search: next === 'all' ? {} : { tab: next }, replace: true });
  return <LibraryPage tab={tab} onTab={onTab} />;
}
