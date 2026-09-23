import type { ChapterInfo } from '@manga-reader/shared';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, CheckCheck, CircleAlert, Search } from 'lucide-react';
import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatRelative } from '../../lib/format';
import { cn } from '../../lib/utils';

const ROW_HEIGHT = 48;
const ALL = '__all__';

export interface ChapterFilters {
  unreadOnly: boolean;
  bookmarkedOnly: boolean;
  scanlator: string;
  /** Source order is newest first; `oldestFirst` flips it. */
  oldestFirst: boolean;
}

export function filterChapters(chapters: ChapterInfo[], filters: ChapterFilters): ChapterInfo[] {
  const visible = chapters.filter(
    (c) =>
      (!filters.unreadOnly || !c.read) &&
      (!filters.bookmarkedOnly || c.bookmarked) &&
      (filters.scanlator === ALL || (c.scanlator ?? '') === filters.scanlator),
  );
  return filters.oldestFirst ? visible.reverse() : visible;
}

export function ChapterList({
  chapters,
  newIds,
  scrollElement,
}: {
  chapters: ChapterInfo[];
  newIds: ReadonlySet<number>;
  /** The page's scroll container; null until it has mounted. */
  scrollElement: HTMLDivElement | null;
}) {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<ChapterFilters>({
    unreadOnly: false,
    bookmarkedOnly: false,
    scanlator: ALL,
    oldestFirst: false,
  });
  const visible = useMemo(() => filterChapters(chapters, filters), [chapters, filters]);
  const scanlators = useMemo(
    () => [...new Set(chapters.map((c) => c.scanlator ?? ''))].sort((a, b) => a.localeCompare(b)),
    [chapters],
  );
  const unread = chapters.filter((c) => !c.read && !c.sourceMissing).length;

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Rows are positioned relative to the list; the header above it can grow ("show more").
  useLayoutEffect(() => {
    const container = scrollElement;
    if (!container) return;
    const measure = () => setScrollMargin(listRef.current?.offsetTop ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    for (const child of container.children) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollElement, chapters.length]);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  });

  const jump = (number: number) => {
    const index = visible.findIndex((c) => c.number !== null && Math.floor(c.number) === Math.floor(number));
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' });
  };

  const toggle = (key: 'unreadOnly' | 'bookmarkedOnly') => setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <section>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-6 py-2.5 backdrop-blur">
        <h2 className="mr-3 flex items-center gap-2 font-semibold">
          {t('manga.chapters')}
          <span className="rounded-md bg-primary/15 px-1.5 text-xs text-primary">{chapters.length}</span>
        </h2>
        <Chip active={filters.unreadOnly} onClick={() => toggle('unreadOnly')}>
          {t('manga.filters.unread')}
          <span className="text-muted-foreground">{unread}</span>
        </Chip>
        <Chip active={filters.bookmarkedOnly} onClick={() => toggle('bookmarkedOnly')}>
          {t('manga.filters.bookmarked')}
        </Chip>

        <div className="ml-auto flex items-center gap-2">
          {scanlators.length > 1 && (
            <select
              aria-label={t('manga.filters.scanlator')}
              value={filters.scanlator}
              onChange={(event) => setFilters((f) => ({ ...f, scanlator: event.target.value }))}
              className="h-8 max-w-52 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value={ALL}>{t('manga.filters.allScanlators')}</option>
              {scanlators.map((name) => (
                <option key={name} value={name}>
                  {name || t('manga.filters.noScanlator')}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFilters((f) => ({ ...f, oldestFirst: !f.oldestFirst }))}
          >
            {filters.oldestFirst ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            {filters.oldestFirst ? t('manga.sort.oldest') : t('manga.sort.newest')}
          </Button>
          <JumpBox onJump={jump} />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-10 text-center text-muted-foreground">
          {chapters.length === 0 ? t('manga.noChapters') : t('manga.noMatchingChapters')}
        </p>
      ) : (
        <div ref={listRef} className="relative px-6" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const chapter = visible[row.index]!;
            return (
              <div
                key={chapter.id}
                className="absolute inset-x-6"
                style={{ top: row.start - scrollMargin, height: row.size }}
              >
                <ChapterRow chapter={chapter} isNew={newIds.has(chapter.id)} language={i18n.language} />
              </div>
            );
          })}
        </div>
      )}
      <p className="px-6 py-4 text-xs text-muted-foreground">
        {t('manga.showing', { shown: visible.length, total: chapters.length })}
      </p>
    </section>
  );
}

function ChapterRow({ chapter, isNew, language }: { chapter: ChapterInfo; isNew: boolean; language: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/reader/$chapterId"
      params={{ chapterId: String(chapter.id) }}
      className={cn(
        'flex h-full items-center gap-3 border-b px-2 transition-colors hover:bg-accent/60',
        chapter.read && 'text-muted-foreground',
      )}
    >
      {chapter.read ? (
        <CheckCheck className="size-4 shrink-0" aria-label={t('manga.read')} />
      ) : (
        <span className="mx-1 size-2 shrink-0 rounded-full bg-primary" aria-label={t('manga.unread')} />
      )}
      <span className={cn('truncate', !chapter.read && 'font-medium')}>{chapter.name}</span>
      {isNew && <Badge variant="primary">{t('manga.new')}</Badge>}
      {chapter.sourceMissing && (
        <Badge variant="warning" title={t('manga.sourceMissingHint')}>
          <CircleAlert />
          {t('manga.sourceMissing')}
        </Badge>
      )}
      {chapter.scanlator && <span className="truncate text-xs text-muted-foreground">· {chapter.scanlator}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {chapter.lastPage > 0 && !chapter.read && chapter.totalPages !== null && (
          <span>{t('manga.pageProgress', { page: chapter.lastPage + 1, total: chapter.totalPages })}</span>
        )}
        {chapter.uploadedAt !== null && <span>{formatRelative(chapter.uploadedAt, language)}</span>}
        {chapter.bookmarked && <Bookmark className="size-3.5 fill-current text-ctp-peach" />}
      </span>
    </Link>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-3 text-xs transition-colors hover:border-foreground/40',
        active && 'border-primary bg-primary/15 text-primary',
      )}
    >
      {children}
    </button>
  );
}

function JumpBox({ onJump }: { onJump: (number: number) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const number = Number.parseFloat(value);
    if (Number.isFinite(number)) onJump(number);
  };
  return (
    <form onSubmit={submit} className="relative w-36">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('manga.jump')}
        aria-label={t('manga.jump')}
        className="h-8 pl-8 text-xs"
      />
    </form>
  );
}
