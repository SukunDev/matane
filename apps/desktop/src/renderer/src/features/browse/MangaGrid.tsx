import type { BrowseItem, BrowseSettings } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bookmark, Loader2 } from 'lucide-react';
import { type CSSProperties, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { Skeleton } from '../../components/ui/skeleton';
import { libraryIdsQuery } from '../../lib/library';

type Display = BrowseSettings['display'];

/** Columns of `coverSize` px, like the library grid; the list is one row per manga. */
export function gridStyle(display: Display, coverSize: number): CSSProperties {
  return {
    gridTemplateColumns: display === 'list' ? 'minmax(0, 1fr)' : `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
    columnGap: display === 'comfortable' ? 16 : display === 'list' ? 0 : 10,
    rowGap: display === 'comfortable' ? 24 : display === 'list' ? 0 : 10,
  };
}

export function MangaCard({ item, display = 'comfortable' }: { item: BrowseItem; display?: Display }) {
  const { t } = useTranslation();
  // Browse results are cached remote data; library membership comes from the local query (ADR 0010).
  const { data: libraryIds } = useQuery(libraryIdsQuery);
  const inLibrary = libraryIds ? libraryIds.has(item.mangaId) : item.inLibrary;
  const params = { mangaId: String(item.mangaId) };

  if (display === 'list') {
    return (
      <Link
        to="/manga/$mangaId"
        params={params}
        title={item.title}
        className="group flex h-16 min-w-0 items-center gap-3 border-b px-2 transition-colors hover:bg-accent/60"
      >
        <CoverImage
          mangaId={item.mangaId}
          coverKey={item.coverKey}
          alt={item.title}
          className="aspect-[2/3] h-12 shrink-0 rounded"
        />
        <span className="min-w-0 flex-1 truncate font-semibold group-hover:text-primary">{item.title}</span>
        {inLibrary && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Bookmark className="size-3.5 fill-current text-primary" />
            {t('browse.inLibrary')}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      to="/manga/$mangaId"
      params={params}
      className="group flex min-w-0 flex-col gap-2 rounded-lg outline-offset-4"
      title={item.title}
    >
      <div className="relative overflow-hidden rounded-lg">
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
        {display === 'compact' && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ctp-crust/95 via-ctp-crust/70 to-transparent px-2 pt-6 pb-2">
            <p className="line-clamp-2 text-xs leading-snug font-semibold text-ctp-text">{item.title}</p>
          </div>
        )}
      </div>
      {display === 'comfortable' && (
        <span className="line-clamp-2 text-[13px] leading-snug font-medium group-hover:text-primary">{item.title}</span>
      )}
    </Link>
  );
}

export function MangaCardSkeleton({ display = 'comfortable' }: { display?: Display }) {
  if (display === 'list') {
    return (
      <div className="flex h-16 items-center gap-3 border-b px-2">
        <Skeleton className="aspect-[2/3] h-12 rounded" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] rounded-lg" />
      {display === 'comfortable' && (
        <>
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </>
      )}
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
  display,
  coverSize,
}: {
  items: BrowseItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  scrollRoot: React.RefObject<HTMLElement | null>;
  loadingLabel: string;
  display: Display;
  coverSize: number;
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
      <div className="grid" style={gridStyle(display, coverSize)}>
        {items.map((item) => (
          <MangaCard key={item.mangaId} item={item} display={display} />
        ))}
        {isFetchingNextPage &&
          Array.from({ length: 6 }, (_, i) => <MangaCardSkeleton key={`s${i}`} display={display} />)}
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
