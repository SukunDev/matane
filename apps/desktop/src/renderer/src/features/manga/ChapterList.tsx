import {
  CHAPTER_SORTS,
  type ChapterInfo,
  type ChapterView,
  DEFAULT_CHAPTER_VIEW,
  type DownloadItem,
  type MangaInfo,
} from '@manga-reader/shared';
import { isHiddenScanlator, scanlatorKey } from '@manga-reader/shared/chapters';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bookmark,
  BookmarkMinus,
  CalendarDays,
  CheckCheck,
  CircleArrowDown,
  Circle,
  CircleAlert,
  CircleCheck,
  EllipsisVertical,
  EyeOff,
  Hash,
  ListChecks,
  ListOrdered,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type FormEvent, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatRelative } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { downloadsQuery, useEnqueueDownloads } from '../../lib/downloads';
import { mangaQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { EMPTY_SELECTION, type Selection, select, visibleSelection } from '../library/selection';
import { isTyping } from '../reader/PagedView';
import { activeScanlator, viewChapters } from './chapterView';
import { DownloadButton } from './DownloadButton';
import { ScanlatorDialog } from './ScanlatorDialog';

const ROW_HEIGHT = 48;
const ALL = '__all__';

export function ChapterList({
  manga,
  chapters,
  newIds,
  scrollElement,
}: {
  manga: MangaInfo;
  chapters: ChapterInfo[];
  newIds: ReadonlySet<number>;
  /** The page's scroll container; null until it has mounted. */
  scrollElement: HTMLDivElement | null;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const prefs = manga.scanlatorPrefs;
  // Filter and sort are remembered per manga (`chapter_view_json`), optimistically.
  const view = manga.chapterView ?? DEFAULT_CHAPTER_VIEW;
  const saveView = useMutation({
    mutationFn: (next: ChapterView) => ipc.invoke('manga.setChapterView', { mangaId: manga.id, view: next }),
    onMutate: (next) =>
      queryClient.setQueryData(mangaQuery(manga.id).queryKey, (current: MangaInfo | undefined) =>
        current ? { ...current, chapterView: next } : current,
      ),
  });
  const setView = (patch: Partial<ChapterView>) => saveView.mutate({ ...view, ...patch });

  const { data: downloadList } = useQuery(downloadsQuery(manga.id));
  const downloads = useMemo(() => new Map((downloadList ?? []).map((d) => [d.chapterId, d])), [downloadList]);
  const downloaded = useMemo(
    () => new Set((downloadList ?? []).filter((d) => d.status === 'done').map((d) => d.chapterId)),
    [downloadList],
  );
  const visible = useMemo(() => viewChapters(chapters, view, prefs, downloaded), [chapters, view, prefs, downloaded]);
  const allScanlators = useMemo(
    () => [...new Set(chapters.map(scanlatorKey))].sort((a, b) => a.localeCompare(b)),
    [chapters],
  );
  const scanlators = allScanlators.filter((name) => !prefs.hidden.includes(name));
  const shown = chapters.filter((c) => !isHiddenScanlator(c, prefs));
  const unread = shown.filter((c) => !c.read && !c.sourceMissing).length;
  const [scanlatorDialog, setScanlatorDialog] = useState(false);

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

  const toggle = (key: 'unreadOnly' | 'bookmarkedOnly' | 'downloadedOnly') => setView({ [key]: !view[key] });

  // Multi-select like the library: Ctrl/Shift+click, or click once something is selected; Esc clears.
  const order = useMemo(() => visible.map((c) => c.id), [visible]);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selected = visibleSelection(selection, order);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTyping(event)) setSelection(EMPTY_SELECTION);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onRowClick = (event: MouseEvent, id: number) => {
    const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey || selected.length > 0 ? 'toggle' : null;
    if (!mode) return;
    event.preventDefault();
    setSelection((current) => select(current, order, id, mode));
  };

  return (
    <section>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-6 py-2.5 backdrop-blur">
        <h2 className="mr-3 flex items-center gap-2 font-semibold">
          {t('manga.chapters')}
          <span className="rounded-md bg-primary/15 px-1.5 text-xs text-primary">{chapters.length}</span>
        </h2>
        <Chip active={view.unreadOnly} onClick={() => toggle('unreadOnly')}>
          {t('manga.filters.unread')}
          <span className="text-muted-foreground">{unread}</span>
        </Chip>
        <Chip active={view.bookmarkedOnly} onClick={() => toggle('bookmarkedOnly')}>
          {t('manga.filters.bookmarked')}
        </Chip>
        <Chip active={view.downloadedOnly} onClick={() => toggle('downloadedOnly')}>
          {t('manga.filters.downloaded')}
          {downloaded.size > 0 && <span className="text-muted-foreground">{downloaded.size}</span>}
        </Chip>

        <div className="ml-auto flex items-center gap-2">
          {scanlators.length > 1 && (
            <select
              aria-label={t('manga.filters.scanlator')}
              value={activeScanlator(view, prefs) ?? ALL}
              onChange={(event) => setView({ scanlator: event.target.value === ALL ? null : event.target.value })}
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
          {(allScanlators.length > 1 || prefs.hidden.length > 0) && (
            <Button
              variant="secondary"
              size="sm"
              title={t('manga.scanlators.title')}
              onClick={() => setScanlatorDialog(true)}
            >
              <Users />
              {t('manga.scanlators.button')}
              {prefs.hidden.length > 0 && (
                <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">
                  {t('manga.scanlators.hiddenCount', { count: prefs.hidden.length })}
                </span>
              )}
            </Button>
          )}
          <SortMenu view={view} onChange={setView} />
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
                <ChapterRow
                  chapter={chapter}
                  isNew={newIds.has(chapter.id)}
                  language={i18n.language}
                  selected={selection.ids.has(chapter.id)}
                  download={downloads.get(chapter.id)}
                  onClick={(event) => onRowClick(event, chapter.id)}
                  onToggle={() => setSelection((current) => select(current, order, chapter.id, 'toggle'))}
                />
              </div>
            );
          })}
        </div>
      )}
      <p className="px-6 py-4 text-xs text-muted-foreground">
        {t('manga.showing', { shown: visible.length, total: chapters.length })}
        {shown.length < chapters.length &&
          ` · ${t('manga.scanlators.hiddenChapters', { count: chapters.length - shown.length })}`}
      </p>
      <ScanlatorDialog manga={manga} chapters={chapters} open={scanlatorDialog} onOpenChange={setScanlatorDialog} />
      {selected.length > 0 && (
        <ChapterSelectionBar
          chapters={visible.filter((c) => selection.ids.has(c.id))}
          downloaded={downloaded}
          onSelectAll={() => setSelection({ ids: new Set(order), anchor: null })}
          onClear={() => setSelection(EMPTY_SELECTION)}
        />
      )}
    </section>
  );
}

function ChapterRow({
  chapter,
  isNew,
  language,
  selected,
  download,
  onClick,
  onToggle,
}: {
  chapter: ChapterInfo;
  isNew: boolean;
  language: string;
  selected: boolean;
  download: DownloadItem | undefined;
  onClick: (event: MouseEvent) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'group flex h-full items-center border-b',
        chapter.read && 'text-muted-foreground',
        selected && 'bg-primary/10',
      )}
    >
      <button
        type="button"
        aria-label={selected ? t('library.selection.deselect') : t('library.selection.select')}
        aria-pressed={selected}
        onClick={onToggle}
        className={cn(
          'flex h-full w-7 shrink-0 items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          selected && 'text-primary opacity-100',
        )}
      >
        {selected ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
      </button>
      <Link
        to="/reader/$chapterId"
        params={{ chapterId: String(chapter.id) }}
        onClick={onClick}
        data-testid="chapter-row"
        className="flex h-full min-w-0 flex-1 items-center gap-3 pr-2 transition-colors hover:bg-accent/60"
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
            <span className="text-primary">
              {t('manga.pageProgress', { page: chapter.lastPage + 1, total: chapter.totalPages })}
            </span>
          )}
          {chapter.uploadedAt !== null && <span>{formatRelative(chapter.uploadedAt, language)}</span>}
        </span>
      </Link>
      <DownloadButton chapterId={chapter.id} download={download} />
      <BookmarkToggle chapter={chapter} />
      <ChapterMenu chapter={chapter} download={download} />
    </div>
  );
}

const SORT_ICONS = { source: ListOrdered, number: Hash, date: CalendarDays } as const;

/** Source order / chapter number / upload date, and the direction (BRAINSTORM.md §6.2). */
function SortMenu({ view, onChange }: { view: ChapterView; onChange: (patch: Partial<ChapterView>) => void }) {
  const { t } = useTranslation();
  const Icon = SORT_ICONS[view.sort];
  return (
    <div className="flex">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="secondary" size="sm" className="rounded-r-none" title={t('manga.sort.title')}>
            <Icon />
            {t(`manga.sort.${view.sort}`)}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            <DropdownMenu.RadioGroup
              value={view.sort}
              onValueChange={(value) => onChange({ sort: value as ChapterView['sort'] })}
            >
              {CHAPTER_SORTS.map((sort) => {
                const ItemIcon = SORT_ICONS[sort];
                return (
                  <DropdownMenu.RadioItem
                    key={sort}
                    value={sort}
                    className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent data-[state=checked]:text-primary"
                  >
                    <ItemIcon className="size-4" />
                    {t(`manga.sort.${sort}`)}
                  </DropdownMenu.RadioItem>
                );
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Button
        variant="secondary"
        size="sm"
        className="rounded-l-none border-l border-background px-2"
        title={view.descending ? t('manga.sort.descending') : t('manga.sort.ascending')}
        aria-label={view.descending ? t('manga.sort.descending') : t('manga.sort.ascending')}
        onClick={() => onChange({ descending: !view.descending })}
      >
        {view.descending ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
      </Button>
    </div>
  );
}

/** Filled when the chapter is bookmarked; otherwise shown on hover (mockup 02). */
function BookmarkToggle({ chapter }: { chapter: ChapterInfo }) {
  const { t } = useTranslation();
  const bookmark = useMutation({
    mutationFn: () =>
      ipc.invoke('chapters.setBookmarked', { chapterIds: [chapter.id], bookmarked: !chapter.bookmarked }),
  });
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={chapter.bookmarked}
      title={chapter.bookmarked ? t('manga.menu.unbookmark') : t('manga.menu.bookmark')}
      onClick={() => bookmark.mutate()}
      className={cn(
        'ml-1',
        chapter.bookmarked
          ? 'text-ctp-peach hover:text-ctp-peach'
          : 'opacity-0 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Bookmark className={cn(chapter.bookmarked && 'fill-current')} />
    </Button>
  );
}

/** Per-chapter actions (BRAINSTORM.md §6.3): mark read/unread, mark everything before as read. */
function ChapterMenu({ chapter, download }: { chapter: ChapterInfo; download: DownloadItem | undefined }) {
  const { t } = useTranslation();
  const markRead = useMutation({
    mutationFn: (read: boolean) => ipc.invoke('chapters.markRead', { chapterIds: [chapter.id], read }),
  });
  const markPrevious = useMutation({
    mutationFn: () => ipc.invoke('chapters.markPreviousRead', { chapterId: chapter.id }),
  });
  const bookmark = useMutation({
    mutationFn: (bookmarked: boolean) => ipc.invoke('chapters.setBookmarked', { chapterIds: [chapter.id], bookmarked }),
  });
  const enqueue = useEnqueueDownloads();
  const deleteDownload = useMutation({
    mutationFn: () => ipc.invoke('downloads.delete', { chapterIds: [chapter.id] }),
  });
  const item =
    'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('manga.menu.more')}
          className="mx-1 opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <DropdownMenu.Item className={item} onSelect={() => markRead.mutate(!chapter.read)}>
            <CheckCheck className="size-4" />
            {chapter.read ? t('manga.menu.markUnread') : t('manga.menu.markRead')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => markPrevious.mutate()}>
            <ListChecks className="size-4" />
            {t('manga.menu.markPrevious')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => bookmark.mutate(!chapter.bookmarked)}>
            {chapter.bookmarked ? <BookmarkMinus className="size-4" /> : <Bookmark className="size-4" />}
            {chapter.bookmarked ? t('manga.menu.unbookmark') : t('manga.menu.bookmark')}
          </DropdownMenu.Item>
          {download ? (
            <DropdownMenu.Item className={`${item} text-destructive`} onSelect={() => deleteDownload.mutate()}>
              <Trash2 className="size-4" />
              {download.status === 'done' ? t('downloads.delete') : t('downloads.cancel')}
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item className={item} onSelect={() => enqueue([chapter.id])}>
              <CircleArrowDown className="size-4" />
              {t('downloads.download')}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Actions for the selected chapters, floating at the bottom of the page. */
function ChapterSelectionBar({
  chapters,
  downloaded,
  onSelectAll,
  onClear,
}: {
  chapters: ChapterInfo[];
  downloaded: ReadonlySet<number>;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const chapterIds = chapters.map((c) => c.id);
  const markRead = useMutation({
    mutationFn: (read: boolean) => ipc.invoke('chapters.markRead', { chapterIds, read }),
    onSuccess: onClear,
  });
  const bookmark = useMutation({
    mutationFn: (bookmarked: boolean) => ipc.invoke('chapters.setBookmarked', { chapterIds, bookmarked }),
    onSuccess: onClear,
  });
  const markPrevious = useMutation({
    mutationFn: (chapterId: number) => ipc.invoke('chapters.markPreviousRead', { chapterId }),
    onSuccess: onClear,
  });
  const enqueue = useEnqueueDownloads();
  const deleteDownloads = useMutation({
    mutationFn: (ids: number[]) => ipc.invoke('downloads.delete', { chapterIds: ids }),
    onSuccess: onClear,
  });
  const downloadedIds = chapterIds.filter((id) => downloaded.has(id));
  const allBookmarked = chapters.every((c) => c.bookmarked);
  const single = chapters.length === 1 ? chapters[0] : undefined;

  return (
    <div className="pointer-events-none sticky bottom-5 z-20 flex justify-center">
      <div
        role="toolbar"
        aria-label={t('library.selection.toolbar')}
        className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1.5 shadow-2xl backdrop-blur"
      >
        <span className="flex items-center gap-2 px-3 font-medium text-primary">
          <span className="size-2 rounded-full bg-primary" />
          {t('library.selection.count', { count: chapters.length })}
        </span>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          <ListChecks />
          {t('library.selection.all')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(true)}>
          <CheckCheck />
          {t('library.selection.markRead')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(false)}>
          <EyeOff />
          {t('library.selection.markUnread')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => bookmark.mutate(!allBookmarked)}>
          {allBookmarked ? <BookmarkMinus /> : <Bookmark />}
          {allBookmarked ? t('manga.menu.unbookmark') : t('manga.menu.bookmark')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => enqueue(chapterIds, onClear)}>
          <CircleArrowDown />
          {t('downloads.download')}
        </Button>
        {downloadedIds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => deleteDownloads.mutate(downloadedIds)}
          >
            <Trash2 />
            {t('downloads.deleteCount', { count: downloadedIds.length })}
          </Button>
        )}
        {single && (
          <Button variant="ghost" size="sm" onClick={() => markPrevious.mutate(single.id)}>
            <ListChecks />
            {t('manga.menu.markPrevious')}
          </Button>
        )}
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" title={t('library.selection.clear')} onClick={onClear}>
          <X />
        </Button>
      </div>
    </div>
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
