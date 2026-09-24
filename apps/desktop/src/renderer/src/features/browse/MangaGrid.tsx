import type { BrowseItem } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bookmark, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { Skeleton } from '../../components/ui/skeleton';
import { libraryIdsQuery } from '../../lib/library';

export const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6';

export function MangaCard({ item }: { item: BrowseItem }) {
  const { t } = useTranslation();
  // Browse results are cached remote data; library membership comes from the local query (ADR 0010).
  const { data: libraryIds } = useQuery(libraryIdsQuery);
  const inLibrary = libraryIds ? libraryIds.has(item.mangaId) : item.inLibrary;
  return (
    <Link
      to="/manga/$mangaId"
      params={{ mangaId: String(item.mangaId) }}
      className="group flex min-w-0 flex-col gap-2 rounded-lg outline-offset-4"
      title={item.title}
    >
      <div className="relative">
        <CoverImage
          mangaId={item.mangaId}
          coverKey={item.coverKey}
          alt={item.title}
          className="aspect-[2/3] rounded-lg border transition-colors group-hover:border-primary"
        />
        {inLibrary && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-ctp-crust/85 px-1.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
            <Bookmark className="size-3 fill-current text-primary" />
            {t('browse.inLibrary')}
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-[13px] leading-snug font-medium group-hover:text-primary">{item.title}</span>
    </Link>
  );
}

export function MangaCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] rounded-lg" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/**
 * Covers of one source listing, with infinite scroll: a sentinel below the grid asks for the next
 * page when it comes within ~2 screens of the viewport.
 */
export function MangaGrid({
  items,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  scrollRoot,
  loadingLabel,
}: {
  items: BrowseItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  scrollRoot: React.RefObject<HTMLElement | null>;
  loadingLabel: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { root: scrollRoot.current, rootMargin: '0px 0px 200% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrollRoot]);

  return (
    <>
      <div className={GRID_CLASS}>
        {items.map((item) => (
          <MangaCard key={item.mangaId} item={item} />
        ))}
        {isFetchingNextPage && Array.from({ length: 6 }, (_, i) => <MangaCardSkeleton key={`s${i}`} />)}
      </div>
      <div ref={sentinel} className="h-px" />
      {isFetchingNextPage && (
        <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          {loadingLabel}
        </p>
      )}
    </>
  );
}
