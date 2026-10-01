import type { LibraryItem, LibrarySettings, LibraryTab } from '@manga-reader/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowRightLeft,
  BookmarkMinus,
  CheckCheck,
  Circle,
  CircleCheck,
  EyeOff,
  Folder,
  RefreshCw,
  Globe,
  LibraryBig,
  Puzzle,
  ListChecks,
  SearchX,
  X,
} from 'lucide-react';
import { type MouseEvent, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoverImage } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ipc } from '../../lib/ipc';
import { categoriesQuery, libraryCountsQuery, libraryQuery } from '../../lib/library';
import { sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { HandoffBanner } from '../extensions/HandoffBanner';
import { isTyping } from '../reader/keymap';
import { CategoryDialog } from './CategoryDialog';
import { LibraryToolbar } from './LibraryToolbar';
import { EMPTY_SELECTION, type Selection, select, visibleSelection } from './selection';
import { filterCount, filtersOf, useLibrarySettings } from './settings';

const PADDING = 24;
const LIST_ROW = 64;

/** The library (BRAINSTORM.md §6.2, docs/ui/screens/01-library.png). */
export function LibraryPage({ tab: requestedTab, onTab }: { tab: LibraryTab; onTab: (tab: LibraryTab) => void }) {
  const { t } = useTranslation();
  const [settings, update] = useLibrarySettings();
  const { data: counts } = useQuery(libraryCountsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  // A deleted category's tab falls back to "All".
  const tab =
    typeof requestedTab === 'number' && !categories.some((c) => c.id === requestedTab) && categories.length > 0
      ? 'all'
      : requestedTab;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const library = useQuery({
    ...libraryQuery({
      tab,
      sort: settings.sort,
      ascending: settings.ascending,
      filters: filtersOf(settings),
      query: debounced || undefined,
    }),
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => library.data ?? [], [library.data]);
  const order = useMemo(() => items.map((item) => item.mangaId), [items]);

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selected = visibleSelection(selection, order);
  const selecting = selected.length > 0;
  const clearSelection = () => setSelection(EMPTY_SELECTION);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      if (event.key === 'Escape') setSelection(EMPTY_SELECTION);
      if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelection({ ids: new Set(order), anchor: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order]);

  const onItemClick = (event: MouseEvent, id: number) => {
    const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey || selecting ? 'toggle' : null;
    if (!mode) return; // plain click opens the manga
    event.preventDefault();
    setSelection((current) => select(current, order, id, mode));
  };
  const onToggle = (id: number) => setSelection((current) => select(current, order, id, 'toggle'));

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const empty = counts?.all === 0;
  const { data: sources = [] } = useQuery(sourcesQuery);
  const hasSources = sources.some((source) => source.installed);
  const filtered = debounced !== '' || filterCount(settings) > 0;

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-5">
        <h1 className="flex items-center gap-3 text-xl font-semibold">
          {t('nav.library')}
          {counts && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t('library.titles', { count: counts.all })}
            </span>
          )}
        </h1>
        {!empty && (
          <div className="ml-auto">
            <LibraryToolbar settings={settings} onChange={update} query={query} onQuery={setQuery} />
          </div>
        )}
      </header>

      {!empty && (
        <nav
          role="tablist"
          aria-label={t('library.tabs')}
          className="flex gap-1 overflow-x-auto overflow-y-hidden border-b px-6 pt-3"
        >
          <TabButton active={tab === 'all'} count={counts?.all} onClick={() => onTab('all')}>
            {t('library.all')}
          </TabButton>
          {categories.map((category) => (
            <TabButton
              key={category.id}
              active={tab === category.id}
              count={counts?.byCategory[String(category.id)] ?? 0}
              onClick={() => onTab(category.id)}
            >
              {category.name}
            </TabButton>
          ))}
          <TabButton active={tab === 'default'} count={counts?.default} onClick={() => onTab('default')}>
            {t('library.default')}
          </TabButton>
        </nav>
      )}

      <HandoffBanner className="mx-6 mt-4" />
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto" data-testid="library-scroll">
        {empty ? (
          <EmptyState
            icon={LibraryBig}
            title={t('empty.library.title')}
            description={t('empty.library.description')}
            action={
              hasSources ? (
                <Button asChild className="mt-2">
                  <Link to="/browse/sources">
                    <Globe />
                    {t('library.browseSources')}
                  </Link>
                </Button>
              ) : (
                // Nothing to browse yet: extensions come first.
                <Button asChild className="mt-2">
                  <Link to="/browse/extensions" search={{ tab: 'available' }}>
                    <Puzzle />
                    {t('extensions.getExtensions')}
                  </Link>
                </Button>
              )
            }
          />
        ) : library.isError ? (
          <ErrorState error={library.error} onRetry={() => void library.refetch()} />
        ) : library.isPending ? (
          <GridSkeleton coverSize={settings.coverSize} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t('library.noMatches.title')}
            description={filtered ? t('library.noMatches.filtered') : t('library.noMatches.category')}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => {
                    setQuery('');
                    update({
                      unreadOnly: false,
                      readingOnly: false,
                      bookmarkedOnly: false,
                      downloadedOnly: false,
                      status: [],
                      sourceIds: [],
                    });
                  }}
                >
                  {t('library.filter.clear')}
                </Button>
              ) : undefined
            }
          />
        ) : settings.display === 'list' ? (
          <LibraryList
            items={items}
            scrollElement={scrollElement}
            selected={selection.ids}
            onItemClick={onItemClick}
            onToggle={onToggle}
          />
        ) : (
          <LibraryGrid
            items={items}
            settings={settings}
            scrollElement={scrollElement}
            selected={selection.ids}
            onItemClick={onItemClick}
            onToggle={onToggle}
          />
        )}
      </div>

      {selecting && (
        <SelectionBar
          ids={selected}
          items={items}
          onSelectAll={() => setSelection({ ids: new Set(order), anchor: null })}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 border-b-2 border-transparent px-2 text-muted-foreground transition-colors hover:text-foreground',
        active && 'border-primary font-semibold text-foreground',
      )}
    >
      <span className="max-w-48 truncate">{children}</span>
      {count !== undefined && (
        <span
          className={cn('rounded-md bg-muted px-1.5 text-[11px] font-medium', active && 'bg-primary/20 text-primary')}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Width of the scroll area's content box; follows window and sidebar resizes. */
function useContentWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(element.clientWidth - PADDING * 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

interface ViewProps {
  items: LibraryItem[];
  scrollElement: HTMLDivElement | null;
  selected: ReadonlySet<number>;
  onItemClick: (event: MouseEvent, id: number) => void;
  onToggle: (id: number) => void;
}

/** Virtualized by rows, so 1,000+ covers stay smooth. */
function LibraryGrid({ items, settings, scrollElement, ...rest }: ViewProps & { settings: LibrarySettings }) {
  const width = useContentWidth(scrollElement);
  const gap = settings.display === 'comfortable' ? 16 : 10;
  const columns = Math.max(1, Math.floor((width + gap) / (settings.coverSize + gap)));
  const cardWidth = width > 0 ? (width - gap * (columns - 1)) / columns : settings.coverSize;
  const textHeight = settings.display === 'comfortable' ? 46 : 0;
  const rowHeight = Math.round(cardWidth * 1.5) + textHeight + (settings.display === 'comfortable' ? 20 : gap);
  const rows = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: 20,
    paddingEnd: 96, // room for the selection bar
  });
  // Row heights change with the window width and cover size.
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          className="absolute inset-x-0 grid"
          style={{
            top: row.start,
            height: rowHeight,
            paddingInline: PADDING,
            columnGap: gap,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
            <LibraryCard key={item.mangaId} item={item} display={settings.display} {...rest} />
          ))}
        </div>
      ))}
    </div>
  );
}

function LibraryCard({
  item,
  display,
  selected,
  onItemClick,
  onToggle,
}: Omit<ViewProps, 'items' | 'scrollElement'> & { item: LibraryItem; display: LibrarySettings['display'] }) {
  const { t } = useTranslation();
  const isSelected = selected.has(item.mangaId);
  const progress = item.chapterCount > 0 && item.readCount > 0 ? item.readCount / item.chapterCount : 0;
  return (
    <div className="group relative min-w-0">
      <Link
        to="/manga/$mangaId"
        params={{ mangaId: String(item.mangaId) }}
        onClick={(event) => onItemClick(event, item.mangaId)}
        className="flex min-w-0 flex-col gap-2 rounded-lg outline-offset-4"
        title={item.title}
        aria-selected={isSelected}
        data-testid="library-item"
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-lg border transition-colors group-hover:border-primary',
            isSelected && 'border-primary ring-2 ring-primary',
          )}
        >
          <CoverImage mangaId={item.mangaId} coverKey={item.coverKey} alt={item.title} className="aspect-[2/3]" />
          {(item.unreadCount > 0 || item.downloadedCount > 0) && (
            <span className="absolute top-1.5 left-1.5 flex overflow-hidden rounded-full text-[11px] font-semibold">
              {item.unreadCount > 0 && (
                <span
                  className="flex h-5 min-w-5 items-center justify-center bg-primary px-1.5 text-primary-foreground"
                  title={t('library.unread', { count: item.unreadCount })}
                >
                  {item.unreadCount}
                </span>
              )}
              {item.downloadedCount > 0 && (
                <span
                  className="flex h-5 min-w-5 items-center justify-center bg-ctp-teal px-1.5 text-ctp-crust"
                  title={t('library.downloaded', { count: item.downloadedCount })}
                >
                  {item.downloadedCount}
                </span>
              )}
            </span>
          )}
          {display === 'compact' && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ctp-crust/95 via-ctp-crust/70 to-transparent px-2 pt-6 pb-2">
              <p className="line-clamp-2 text-xs leading-snug font-semibold text-ctp-text">{item.title}</p>
            </div>
          )}
          {progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-ctp-crust/60">
              <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
        {display === 'comfortable' && (
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-snug font-semibold group-hover:text-primary">{item.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              <ItemMeta item={item} />
            </p>
          </div>
        )}
      </Link>
      <SelectToggle selected={isSelected} onToggle={() => onToggle(item.mangaId)} />
    </div>
  );
}

function ItemMeta({ item }: { item: LibraryItem }) {
  const { t } = useTranslation();
  const detail = item.lastReadChapter ?? t('manga.chapterCount', { count: item.chapterCount });
  return <>{[item.sourceName, detail].filter(Boolean).join(' · ')}</>;
}

/** Top-right check on hover; the discoverable way into multi-select. */
function SelectToggle({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={selected ? t('library.selection.deselect') : t('library.selection.select')}
      onClick={onToggle}
      className={cn(
        'absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-ctp-crust/70 text-ctp-text opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        selected && 'bg-primary text-primary-foreground opacity-100',
      )}
    >
      {selected ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
    </button>
  );
}

function LibraryList({ items, scrollElement, selected, onItemClick, onToggle }: ViewProps) {
  const { t, i18n } = useTranslation();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => LIST_ROW,
    overscan: 10,
    paddingStart: 8,
    paddingEnd: 96,
  });
  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index]!;
        const isSelected = selected.has(item.mangaId);
        return (
          <div key={row.key} className="group absolute inset-x-0 px-6" style={{ top: row.start, height: LIST_ROW }}>
            <button
              type="button"
              aria-label={isSelected ? t('library.selection.deselect') : t('library.selection.select')}
              onClick={() => onToggle(item.mangaId)}
              className={cn(
                'absolute top-1/2 left-8 z-10 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                isSelected && 'text-primary opacity-100',
              )}
            >
              {isSelected ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
            </button>
            <Link
              to="/manga/$mangaId"
              params={{ mangaId: String(item.mangaId) }}
              onClick={(event) => onItemClick(event, item.mangaId)}
              aria-selected={isSelected}
              data-testid="library-item"
              className={cn(
                'flex h-full items-center gap-3 border-b px-2 transition-colors hover:bg-accent/60',
                isSelected && 'bg-primary/10 hover:bg-primary/15',
              )}
            >
              <span className="w-4 shrink-0" />
              <CoverImage
                mangaId={item.mangaId}
                coverKey={item.coverKey}
                alt={item.title}
                className="aspect-[2/3] h-12 shrink-0 rounded"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold group-hover:text-primary">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <ItemMeta item={item} />
                </p>
              </div>
              <span className="hidden w-32 shrink-0 text-xs text-muted-foreground md:block">
                {item.lastReadAt !== null &&
                  new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(item.lastReadAt)}
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                {t('library.readOf', { read: item.readCount, total: item.chapterCount })}
              </span>
              <span className="w-10 shrink-0 text-right">
                {item.unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    {item.unreadCount}
                  </span>
                )}
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function GridSkeleton({ coverSize }: { coverSize: number }) {
  return (
    <div
      className="grid gap-4 p-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))` }}
      aria-busy
    >
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
      ))}
    </div>
  );
}

/** Floating actions for the selected manga (mockup 01). Download arrives in Phase 3. */
function SelectionBar({
  ids,
  items,
  onSelectAll,
  onClear,
}: {
  ids: number[];
  items: LibraryItem[];
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const markRead = useMutation({
    mutationFn: (read: boolean) => ipc.invoke('library.markRead', { mangaIds: ids, read }),
  });
  // Per-manga update check (no skip rules); progress shows on the Updates page.
  const checkUpdates = useMutation({
    mutationFn: () => ipc.invoke('updates.check', { scope: { kind: 'manga', mangaIds: ids } }),
    onSuccess: ({ started }) => {
      if (started) void navigate({ to: '/updates' });
    },
  });
  const setCategories = useMutation({
    mutationFn: (categoryIds: number[]) => ipc.invoke('library.setCategories', { mangaIds: ids, categoryIds }),
    onSuccess: onClear,
  });
  const remove = useMutation({
    mutationFn: () => ipc.invoke('library.remove', { mangaIds: ids }),
    onSuccess: onClear,
  });
  // Pre-check the categories every selected manga already shares.
  const chosen = items.filter((item) => ids.includes(item.mangaId));
  const shared = chosen.reduce<number[]>(
    (common, item, index) => (index === 0 ? item.categoryIds : common.filter((id) => item.categoryIds.includes(id))),
    [],
  );

  return (
    <div
      role="toolbar"
      aria-label={t('library.selection.toolbar')}
      className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-popover/95 p-1.5 shadow-2xl backdrop-blur"
    >
      <span className="flex items-center gap-2 px-3 font-medium text-primary">
        <span className="size-2 rounded-full bg-primary" />
        {t('library.selection.count', { count: ids.length })}
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
      <Button variant="ghost" size="sm" onClick={() => checkUpdates.mutate()} disabled={checkUpdates.isPending}>
        <RefreshCw />
        {t('library.selection.checkUpdates')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setCategoriesOpen(true)}>
        <Folder />
        {t('library.selection.categories')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void navigate({ to: '/library/migrate', search: { ids } })}>
        <ArrowRightLeft />
        {t('library.selection.migrate')}
      </Button>
      {ids.length === 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: '/manga/$mangaId', params: { mangaId: String(ids[0]) } })}
        >
          {t('library.selection.open')}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>
        <BookmarkMinus />
        {t('library.selection.remove')}
      </Button>
      <span className="h-5 w-px bg-border" />
      <Button variant="ghost" size="icon-sm" title={t('library.selection.clear')} onClick={onClear}>
        <X />
      </Button>

      <CategoryDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        title={t('library.categories.setTitle', { count: ids.length })}
        initial={shared}
        confirmLabel={t('common.save')}
        onConfirm={(categoryIds) => setCategories.mutate(categoryIds)}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('library.remove.title', { count: ids.length })}
        description={t('library.remove.description')}
        confirmLabel={t('library.remove.confirm')}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
