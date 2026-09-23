import type { ChapterInfo, MangaInfo } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, Globe, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage, coverSrc } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { appError } from '../../lib/errors';
import { formatRelative } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { chaptersQuery, mangaQuery, sourcesQuery, useRefreshManga } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { usePageCrumbs } from '../../stores/crumbs';
import { ChapterList } from './ChapterList';

const STATUS_VARIANT = {
  ongoing: 'success',
  completed: 'info',
  hiatus: 'warning',
  cancelled: 'danger',
  unknown: 'outline',
} as const;

/** Where "Start/Continue reading" goes: the oldest unread chapter, else the first one. */
export function nextChapter(chapters: ChapterInfo[]): ChapterInfo | undefined {
  const present = chapters.filter((c) => !c.sourceMissing);
  // Source order is newest first, so walk it backwards.
  const oldestFirst = [...present].reverse();
  return oldestFirst.find((c) => !c.read) ?? oldestFirst[0];
}

export function MangaDetailPage({ mangaId }: { mangaId: number }) {
  const { t } = useTranslation();
  const manga = useQuery(mangaQuery(mangaId));
  const chapters = useQuery(chaptersQuery(mangaId));
  const refresh = useRefreshManga(mangaId);
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set());
  // State, not a ref: the chapter list must re-render once the element exists. With cached data
  // both mount in one commit, and a child's layout effects run before the parent's ref is attached.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const { data: sources } = useQuery(sourcesQuery);
  const source = sources?.find((s) => s.id === manga.data?.sourceId);
  usePageCrumbs(source?.name, manga.data?.title || undefined);

  // First visit (only seen in a listing so far): fetch details and chapters once.
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (!manga.data || manga.data.lastFetchedAt !== null || autoRefreshed.current) return;
    autoRefreshed.current = true;
    refresh.mutate();
  }, [manga.data, refresh]);

  const runRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) => setNewIds(new Set(result.newChapterIds)),
    });

  if (manga.isError) {
    const notFound = appError(manga.error).code === 'not_found';
    return notFound ? (
      <EmptyState icon={BookOpen} title={t('empty.manga.title')} description={t('empty.manga.description')} />
    ) : (
      <ErrorState error={manga.error} onRetry={() => void manga.refetch()} />
    );
  }
  if (!manga.data) return <HeaderSkeleton />;

  const list = chapters.data ?? [];
  const firstLoad = manga.data.lastFetchedAt === null;

  return (
    <div ref={setScrollElement} className="relative h-full overflow-y-auto">
      <MangaHeader
        manga={manga.data}
        sourceName={source?.name}
        sourceLang={source?.lang}
        chapters={list}
        refreshing={refresh.isPending}
        onRefresh={runRefresh}
      />
      {refresh.isError && !firstLoad && (
        <div className="border-b bg-ctp-red/5 px-6">
          <ErrorState compact error={refresh.error} onRetry={runRefresh} sourceId={manga.data.sourceId} />
        </div>
      )}
      {firstLoad && refresh.isError ? (
        <ErrorState error={refresh.error} onRetry={runRefresh} sourceId={manga.data.sourceId} />
      ) : firstLoad || chapters.isPending ? (
        <div className="flex flex-col gap-2 p-6">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <ChapterList chapters={list} newIds={newIds} scrollElement={scrollElement} />
      )}
    </div>
  );
}

function MangaHeader({
  manga,
  sourceName,
  sourceLang,
  chapters,
  refreshing,
  onRefresh,
}: {
  manga: MangaInfo;
  sourceName?: string;
  sourceLang?: string;
  chapters: ChapterInfo[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const openInBrowser = useMutation({ mutationFn: () => ipc.invoke('manga.openInBrowser', { mangaId: manga.id }) });
  const target = nextChapter(chapters);
  const started = chapters.some((c) => c.read || c.lastPage > 0);
  const lastUpload = chapters.reduce<number | null>(
    (max, c) => (c.uploadedAt !== null && (max === null || c.uploadedAt > max) ? c.uploadedAt : max),
    null,
  );
  const people = [
    manga.author && t('manga.author', { name: manga.author }),
    manga.artist && manga.artist !== manga.author && t('manga.artist', { name: manga.artist }),
  ].filter(Boolean);

  return (
    <section className="relative shrink-0 overflow-hidden border-b">
      {/* Blurred cover as a tinted backdrop (docs/ui/screens/02-detail.png). */}
      {manga.thumbnailUrl && (
        <img
          aria-hidden
          src={coverSrc(manga.id, manga.thumbnailUrl)}
          alt=""
          className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-20 blur-2xl"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background" />

      <div className="relative flex gap-8 px-6 py-6">
        <CoverImage
          mangaId={manga.id}
          thumbnailUrl={manga.thumbnailUrl}
          alt={manga.title}
          className="aspect-[2/3] w-52 shrink-0 rounded-xl border shadow-2xl shadow-black/40"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={STATUS_VARIANT[manga.status]}>{t(`manga.status.${manga.status}`)}</Badge>
            {manga.type && <Badge>{t(`manga.type.${manga.type}`)}</Badge>}
            {sourceName && (
              <Badge variant="outline">
                <Globe />
                {sourceName}
                {sourceLang && ` · ${sourceLang.toUpperCase()}`}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl leading-tight font-bold tracking-tight select-text">
            {manga.title || t('manga.untitled')}
          </h1>
          {people.length > 0 && <p className="text-muted-foreground">{people.join(' · ')}</p>}
          {manga.genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {manga.genres.map((genre) => (
                <li key={genre} className="rounded-md border border-input px-2 py-0.5 text-xs">
                  {genre}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{t('manga.chapterCount', { count: chapters.length })}</span>
            {lastUpload !== null && ` · ${t('manga.lastUpdate', { when: formatRelative(lastUpload, i18n.language) })}`}
          </p>
          {manga.description && (
            <div className="max-w-4xl">
              <p
                className={cn(
                  'leading-relaxed whitespace-pre-line text-foreground/85 select-text',
                  !expanded && 'line-clamp-3',
                )}
              >
                {manga.description}
              </p>
              {manga.description.length > 240 && (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {expanded ? t('manga.showLess') : t('manga.showMore')}
                  {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
              )}
            </div>
          )}

          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            {target ? (
              <Button asChild className="h-10 px-5 text-sm">
                <Link to="/reader/$chapterId" params={{ chapterId: String(target.id) }}>
                  <Play className="fill-current" />
                  {started ? t('manga.continue', { chapter: target.name }) : t('manga.start')}
                </Link>
              </Button>
            ) : (
              <Button className="h-10 px-5 text-sm" disabled>
                <Play />
                {t('manga.start')}
              </Button>
            )}
            <Button variant="secondary" className="h-10" onClick={() => openInBrowser.mutate()}>
              <ExternalLink />
              {t('manga.openInBrowser')}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-10"
              title={t('manga.refresh')}
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex gap-8 p-6">
      <Skeleton className="aspect-[2/3] w-52 rounded-xl" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full max-w-3xl" />
      </div>
    </div>
  );
}
