import type { FilterState } from '@manga-reader/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw, Search, SearchX, SlidersHorizontal } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverViewControls } from '../../components/CoverViewControls';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  type BrowseKind,
  browseQuery,
  queryKeys,
  sourceFiltersQuery,
  sourceInfoQuery,
  sourcesQuery,
} from '../../lib/sources';
import { useScrollRestoration } from '../../lib/scroll';
import { cn } from '../../lib/utils';
import { usePageCrumbs } from '../../stores/crumbs';
import { FilterPanel, countActiveFilters } from './FilterPanel';
import { MangaCardSkeleton, MangaGrid, gridStyle } from './MangaGrid';
import { useBrowseView } from './settings';
import { SourceIcon } from './SourceIcon';
import { extensionIconUrl } from '../../lib/extensions';

export interface BrowseSearch {
  tab: BrowseKind;
  q?: string;
  filters?: FilterState;
}

const EMPTY_FILTERS: FilterState = {};

export function SourceBrowsePage({
  extensionId,
  sourceKey,
  search,
  onSearchChange,
}: {
  extensionId: string;
  sourceKey: string;
  search: BrowseSearch;
  onSearchChange: (next: BrowseSearch) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sourceId = `${extensionId}/${sourceKey}`;
  const { tab, q = '', filters = EMPTY_FILTERS } = search;

  const { data: sources } = useQuery(sourcesQuery);
  const source = sources?.find((s) => s.id === sourceId);
  const info = useQuery(sourceInfoQuery(sourceId));
  const capabilities = info.data?.capabilities ?? [];
  const hasFilters = capabilities.includes('getFilters');
  const filterDefs = useQuery({ ...sourceFiltersQuery(sourceId), enabled: hasFilters });
  const [panelOpen, setPanelOpen] = useState(false);
  const [{ display, coverSize }, updateView] = useBrowseView();
  usePageCrumbs(source ? `${source.name} (${source.lang.toUpperCase()})` : undefined);

  const listing = useInfiniteQuery({
    ...browseQuery(sourceId, tab, q, filters),
    enabled: tab !== 'latest' || info.isSuccess,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollElement(node);
  }, []);
  useScrollRestoration(scrollElement, listing.data !== undefined);
  const items = listing.data?.pages.flatMap((page) => page.items) ?? [];
  // Pages can repeat titles when the source list shifts between requests; show each once.
  const unique = items.filter((item, index) => items.findIndex((other) => other.mangaId === item.mangaId) === index);

  // A different tab, query or filter starts at the top; opening the page (or Back to it) keeps the position.
  const listingKey = JSON.stringify([tab, q, filters]);
  const shownListing = useRef(listingKey);
  useEffect(() => {
    if (shownListing.current === listingKey) return;
    shownListing.current = listingKey;
    // Block body: Chromium's scrollTo() returns a promise, which React would treat as a cleanup.
    scrollRef.current?.scrollTo({ top: 0 });
  }, [listingKey]);

  const tabs: { kind: BrowseKind; label: string }[] = [
    { kind: 'popular', label: t('browse.tabs.popular') },
    ...(capabilities.includes('getLatest') ? [{ kind: 'latest' as const, label: t('browse.tabs.latest') }] : []),
    { kind: 'search', label: t('browse.tabs.search') },
  ];
  const activeFilters = countActiveFilters(filters);
  const reload = () => void queryClient.resetQueries({ queryKey: queryKeys.browse(sourceId, tab, q, filters) });

  return (
    <div className="flex h-full">
      <div ref={attachScroll} className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-6 pt-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <SourceIcon
              id={extensionId}
              name={source?.name ?? extensionId}
              src={source?.installed && source.hasIcon ? extensionIconUrl(extensionId) : null}
            />
            <h1 className="min-w-0 truncate text-2xl font-semibold">{source?.name ?? sourceId}</h1>
            {source && <Badge>{source.lang.toUpperCase()}</Badge>}
            {source && !source.installed && <Badge variant="danger">{t('browse.notInstalled')}</Badge>}
            <div className="ml-auto flex items-center gap-2">
              <CoverViewControls display={display} coverSize={coverSize} onChange={updateView} />
              <Button variant="secondary" onClick={reload} disabled={listing.isFetching && !listing.isFetchingNextPage}>
                <RefreshCw className={cn(listing.isFetching && !listing.isFetchingNextPage && 'animate-spin')} />
                {t('browse.refresh')}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap-reverse items-end gap-x-4">
            <nav role="tablist" className="flex gap-6">
              {tabs.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={tab === kind}
                  onClick={() => onSearchChange({ ...search, tab: kind })}
                  className={cn(
                    '-mb-px border-b-2 border-transparent pb-3 text-muted-foreground transition-colors hover:text-foreground',
                    tab === kind && 'border-primary font-semibold text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="mb-2 ml-auto flex min-w-0 items-center gap-2">
              <SearchBox
                key={q}
                initial={q}
                placeholder={t('browse.searchPlaceholder', { source: source?.name ?? '' })}
                onSubmit={(value) => onSearchChange({ tab: 'search', q: value || undefined, filters: search.filters })}
              />
              {hasFilters && (
                <Button
                  variant={panelOpen || activeFilters > 0 ? 'default' : 'secondary'}
                  className={cn(!panelOpen && activeFilters > 0 && 'bg-primary/15 text-primary hover:bg-primary/25')}
                  onClick={() => setPanelOpen((open) => !open)}
                  aria-expanded={panelOpen}
                >
                  <SlidersHorizontal />
                  {t('browse.filters.button')}
                  {activeFilters > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                      {activeFilters}
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="p-6">
          {listing.isPending ? (
            <div className="grid" style={gridStyle(display, coverSize)}>
              {Array.from({ length: 18 }, (_, i) => (
                <MangaCardSkeleton key={i} display={display} />
              ))}
            </div>
          ) : listing.isError && unique.length === 0 ? (
            <ErrorState error={listing.error} onRetry={reload} sourceId={sourceId} />
          ) : unique.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('browse.noResults.title')}
              description={t('browse.noResults.description')}
              action={
                <Button asChild variant="secondary">
                  <Link to="/browse/sources">{t('nav.sources')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <MangaGrid
                items={unique}
                hasNextPage={listing.hasNextPage}
                isFetchingNextPage={listing.isFetchingNextPage}
                fetchNextPage={() => void listing.fetchNextPage()}
                scrollRoot={scrollRef}
                loadingLabel={t('browse.loadingMore', { source: source?.name ?? '' })}
                display={display}
                coverSize={coverSize}
              />
              {listing.isFetchNextPageError && (
                <ErrorState
                  compact
                  error={listing.error}
                  onRetry={() => void listing.fetchNextPage()}
                  sourceId={sourceId}
                />
              )}
            </>
          )}
        </div>
      </div>

      {panelOpen && hasFilters && (
        <FilterPanel
          key={JSON.stringify(filters)}
          filters={filterDefs.data ?? []}
          value={filters}
          onClose={() => setPanelOpen(false)}
          onApply={(next) => onSearchChange({ tab: 'search', q: search.q, filters: next })}
        />
      )}
    </div>
  );
}

function SearchBox({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-64 min-w-40 shrink">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </form>
  );
}
