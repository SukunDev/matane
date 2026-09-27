import type { DownloadItem, UpdateEntry } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleArrowDown,
  EllipsisVertical,
  EyeOff,
  Play,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { type MouseEvent, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { downloadsQuery, useEnqueueDownloads } from '../../lib/downloads';
import { formatRelative } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { updateStatusQuery, updatesQuery } from '../../lib/updates';
import { cn } from '../../lib/utils';
import { groupByDay } from '../history/groups';
import { EMPTY_SELECTION, type Selection, select, visibleSelection } from '../library/selection';
import { DownloadButton } from '../manga/DownloadButton';
import { type UpdateRowEntry, flattenGroups } from './entries';

/** New chapters of library manga, grouped by day (BRAINSTORM.md §6.4; mockup 07). */
export function UpdatesPage() {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const list = useQuery(updatesQuery(categoryId));
  const { data: downloadList } = useQuery(downloadsQuery());
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const markSeen = useMutation({ mutationFn: () => ipc.invoke('updates.markSeen') });
  const entries = useMemo(() => list.data ?? [], [list.data]);
  const groups = useMemo(() => groupByDay(entries, (e) => e.fetchedAt), [entries]);
  const order = useMemo(() => entries.map((e) => e.chapterId), [entries]);
  const downloads = useMemo(() => new Map((downloadList ?? []).map((d) => [d.chapterId, d] as const)), [downloadList]);
  const selected = visibleSelection(selection, order);
  const now = useNow();

  // Opening the page (and new chapters arriving while it is open) clears the sidebar badge.
  const { mutate: seen } = markSeen;
  useEffect(() => {
    if (list.isSuccess) seen();
  }, [list.isSuccess, list.data, seen]);

  const toggle = (chapterId: number, event: MouseEvent) =>
    setSelection((current) => select(current, order, chapterId, event.shiftKey ? 'range' : 'toggle'));

  return (
    <div ref={setScrollElement} className="relative h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5">
        <UpdatesHeader categoryId={categoryId} onCategory={setCategoryId} />
        <CheckBanner />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.isSuccess ? null : entries.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={RefreshCw}
              title={t('empty.updates.title')}
              description={t('empty.updates.description')}
            />
          </div>
        ) : (
          <UpdateList
            rows={flattenGroups(groups)}
            scrollElement={scrollElement}
            downloads={downloads}
            now={now}
            selected={selection.ids}
            onToggle={toggle}
          />
        )}
      </div>
      {selected.length > 0 && (
        <SelectionBar
          chapterIds={selected}
          onSelectAll={() => setSelection({ ids: new Set(order), anchor: null })}
          onClear={() => setSelection(EMPTY_SELECTION)}
        />
      )}
    </div>
  );
}

/** Re-renders every half minute, for "12 minutes ago" / "in 11 hours". */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function UpdatesHeader({
  categoryId,
  onCategory,
}: {
  categoryId: number | undefined;
  onCategory: (id: number | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const { data: status } = useQuery(updateStatusQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [notice, setNotice] = useState<'offline' | 'empty' | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const check = useMutation({
    mutationFn: () =>
      ipc.invoke('updates.check', {
        scope: categoryId === undefined ? { kind: 'all' } : { kind: 'category', categoryId },
      }),
    onSuccess: ({ reason }) => setNotice(reason === 'offline' || reason === 'empty' ? reason : null),
  });
  const category = categories.find((c) => c.id === categoryId);
  const running = status?.progress != null;
  const errors = status?.lastResult?.errors ?? [];
  const item =
    'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent';

  const last = status?.lastCheckAt
    ? t('updates.lastChecked', { when: formatRelative(status.lastCheckAt, i18n.language, now) })
    : t('updates.neverChecked');
  const next =
    status?.nextCheckAt == null
      ? t('updates.autoOff')
      : status.nextCheckAt <= now
        ? t('updates.nextSoon')
        : t('updates.nextCheck', { when: formatRelative(status.nextCheckAt, i18n.language, now) });

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <h1 className="text-xl font-semibold">{t('nav.updates')}</h1>
          <p className="text-xs text-muted-foreground" data-testid="updates-schedule">
            {last} · {next}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            className="border-primary/50 text-primary"
            disabled={running || check.isPending}
            onClick={() => check.mutate()}
          >
            <RefreshCw className={cn(running && 'animate-spin')} />
            {category ? t('updates.checkCategory', { name: category.name }) : t('updates.checkLibrary')}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="secondary" aria-label={t('updates.category')}>
                {category?.name ?? t('updates.allCategories')}
                <ChevronDown />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
              >
                <DropdownMenu.RadioGroup
                  value={String(categoryId ?? 'all')}
                  onValueChange={(value) => onCategory(value === 'all' ? undefined : Number(value))}
                >
                  {[{ id: 'all', name: t('updates.allCategories') }, ...categories].map((c) => (
                    <DropdownMenu.RadioItem key={c.id} value={String(c.id)} className={item}>
                      <span className="flex size-4 items-center justify-center">
                        <DropdownMenu.ItemIndicator>
                          <Check className="size-4" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      {c.name}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="secondary" size="icon" title={t('updates.more')}>
                <EllipsisVertical />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
              >
                <DropdownMenu.Item className={item} disabled={errors.length === 0} onSelect={() => setErrorsOpen(true)}>
                  <CircleAlert className="size-4" />
                  {t('updates.errors', { count: errors.length })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={item}
                  onSelect={() => void navigate({ to: '/settings/$section', params: { section: 'library' } })}
                >
                  <Settings className="size-4" />
                  {t('updates.settings')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      {notice && !running && (
        <p role="status" className="rounded-lg border bg-card/40 px-4 py-2.5 text-sm text-muted-foreground">
          {t(`updates.notice.${notice}`)}
        </p>
      )}
      {!running && errors.length > 0 && (
        <button
          type="button"
          onClick={() => setErrorsOpen(true)}
          className="flex items-center gap-2 self-start text-xs text-destructive hover:underline"
        >
          <CircleAlert className="size-3.5" />
          {t('updates.lastErrors', { count: errors.length })}
        </button>
      )}
      <Dialog.Root open={errorsOpen} onOpenChange={setErrorsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(34rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border bg-popover p-5 shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{t('updates.errorsTitle')}</Dialog.Title>
            <Dialog.Description className="text-muted-foreground">{t('updates.errorsDescription')}</Dialog.Description>
            <ul className="flex flex-col gap-2 overflow-auto">
              {errors.map((error) => (
                <li key={error.mangaId} className="rounded-lg border px-3 py-2">
                  <Link
                    to="/manga/$mangaId"
                    params={{ mangaId: String(error.mangaId) }}
                    className="font-medium hover:underline"
                    onClick={() => setErrorsOpen(false)}
                  >
                    {error.title}
                  </Link>
                  <p className="text-xs text-destructive">{error.message}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <Button variant="ghost">{t('common.close')}</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}

/** "Checking for updates 37 / 148 titles", the bar, what is being checked, and Cancel. */
function CheckBanner() {
  const { t } = useTranslation();
  const { data: status } = useQuery(updateStatusQuery);
  const cancel = useMutation({ mutationFn: () => ipc.invoke('updates.cancel') });
  const progress = status?.progress;
  if (!progress) return null;
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section
      role="status"
      aria-label={t('updates.checking')}
      className="flex items-center gap-4 rounded-xl border bg-card/40 px-4 py-3.5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-primary">
        <RefreshCw className="size-4 animate-spin" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex items-baseline gap-2.5">
          <span className="font-semibold">{t('updates.checking')}</span>
          <span className="font-mono text-xs text-muted-foreground" data-testid="updates-progress">
            {t('updates.progress', { done: progress.done, total: progress.total })}
          </span>
        </p>
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-1.5 w-56 shrink-0 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          {progress.current.length > 0 && (
            <span className="truncate text-xs text-muted-foreground">
              {t('updates.current')} <span className="text-foreground">{progress.current.join(', ')}</span>
            </span>
          )}
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => cancel.mutate()}>
        {t('common.cancel')}
      </Button>
    </section>
  );
}

function UpdateList({
  rows,
  scrollElement,
  downloads,
  now,
  selected,
  onToggle,
}: {
  rows: UpdateRowEntry[];
  scrollElement: HTMLElement | null;
  downloads: ReadonlyMap<number, DownloadItem>;
  now: number;
  selected: ReadonlySet<number>;
  onToggle: (chapterId: number, event: MouseEvent) => void;
}) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => (rows[index]!.kind === 'group' ? 56 : 58),
    overscan: 8,
    scrollMargin: listElement?.offsetTop ?? 0,
    paddingEnd: 96, // room for the selection bar
    getItemKey: (index) => {
      const row = rows[index]!;
      return row.kind === 'group' ? `g${row.group.kind}${row.group.day}` : `c${row.entry.chapterId}`;
    },
  });
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, listElement]);

  return (
    <div ref={setListElement} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            {row.kind === 'group' ? (
              <GroupHeader row={row} downloads={downloads} />
            ) : (
              <UpdateRow
                entry={row.entry}
                first={row.first}
                last={row.last}
                download={downloads.get(row.entry.chapterId)}
                now={now}
                selected={selected.has(row.entry.chapterId)}
                onToggle={onToggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupHeader({
  row,
  downloads,
}: {
  row: Extract<UpdateRowEntry, { kind: 'group' }>;
  downloads: ReadonlyMap<number, DownloadItem>;
}) {
  const { t, i18n } = useTranslation();
  const enqueue = useEnqueueDownloads();
  const { group } = row;
  const toDownload = group.items.filter((e) => !e.read && !downloads.has(e.chapterId)).map((e) => e.chapterId);
  const label =
    group.kind === 'date'
      ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(group.day)
      : t(`history.groups.${group.kind}`);
  return (
    <div className="flex items-center gap-3 px-2 pt-5 pb-2.5" data-testid="updates-group">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</h2>
      <span className="rounded border bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
        {t('updates.chapters', { count: group.items.length })}
      </span>
      {toDownload.length > 0 && (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => enqueue(toDownload)}>
          <CircleArrowDown />
          {t('updates.downloadAll', { count: toDownload.length })}
        </Button>
      )}
    </div>
  );
}

function UpdateRow({
  entry,
  first,
  last,
  download,
  now,
  selected,
  onToggle,
}: {
  entry: UpdateEntry;
  now: number;
  first: boolean;
  last: boolean;
  download: DownloadItem | undefined;
  selected: boolean;
  onToggle: (chapterId: number, event: MouseEvent) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const markRead = useMutation({
    mutationFn: (read: boolean) => ipc.invoke('chapters.markRead', { chapterIds: [entry.chapterId], read }),
  });
  const read = () => void navigate({ to: '/reader/$chapterId', params: { chapterId: String(entry.chapterId) } });
  const when =
    now - entry.fetchedAt < 86_400_000
      ? formatRelative(entry.fetchedAt, i18n.language, now)
      : new Intl.DateTimeFormat(i18n.language, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(entry.fetchedAt);

  return (
    <article
      data-testid="update-row"
      className={cn(
        'group flex items-center gap-3 border-x border-t bg-card/40 px-3 py-2 transition-colors hover:bg-accent/40',
        first && 'rounded-t-xl',
        last && 'rounded-b-xl border-b',
        selected && 'bg-primary/10',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => undefined}
        onClick={(event) => onToggle(entry.chapterId, event)}
        aria-label={t('updates.select', { chapter: entry.chapterName, title: entry.mangaTitle })}
        className="size-4 shrink-0 accent-(--primary)"
      />
      <span
        className={cn('size-1.5 shrink-0 rounded-full', entry.read ? 'bg-transparent' : 'bg-primary')}
        aria-label={entry.read ? undefined : t('updates.unread')}
      />
      <div className={cn('flex min-w-0 flex-1 items-center gap-3', entry.read && 'opacity-50')}>
        <Link to="/manga/$mangaId" params={{ mangaId: String(entry.mangaId) }} className="shrink-0">
          <CoverImage mangaId={entry.mangaId} coverKey={entry.coverKey} alt="" className="h-10 w-7 rounded-sm" />
        </Link>
        <div className="min-w-0">
          <p className="truncate">
            <Link
              to="/manga/$mangaId"
              params={{ mangaId: String(entry.mangaId) }}
              className="font-semibold hover:underline"
            >
              {entry.mangaTitle}
            </Link>
            <span className="px-1.5 text-muted-foreground">·</span>
            <span className="text-primary">{entry.chapterName}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[entry.scanlator ?? entry.sourceName, when].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <DownloadButton chapterId={entry.chapterId} download={download} />
      {entry.read ? (
        <Button variant="ghost" size="sm" title={t('updates.markUnread')} onClick={() => markRead.mutate(false)}>
          <Check />
          {t('updates.read')}
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="icon-sm" title={t('updates.markRead')} onClick={() => markRead.mutate(true)}>
            <Check />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('updates.readNow')} onClick={read}>
            <Play />
          </Button>
        </>
      )}
    </article>
  );
}

function SelectionBar({
  chapterIds,
  onSelectAll,
  onClear,
}: {
  chapterIds: number[];
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const enqueue = useEnqueueDownloads();
  const markRead = useMutation({
    mutationFn: (read: boolean) => ipc.invoke('chapters.markRead', { chapterIds, read }),
    onSuccess: onClear,
  });
  return (
    <div className="pointer-events-none sticky bottom-5 z-20 flex justify-center">
      <div
        role="toolbar"
        aria-label={t('library.selection.toolbar')}
        className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1.5 shadow-2xl backdrop-blur"
      >
        <span className="flex items-center gap-2 px-3 font-medium text-primary">
          <span className="size-2 rounded-full bg-primary" />
          {t('library.selection.count', { count: chapterIds.length })}
        </span>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          {t('library.selection.all')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => enqueue(chapterIds, onClear)}>
          <CircleArrowDown />
          {t('downloads.download')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(true)}>
          <CheckCheck />
          {t('library.selection.markRead')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(false)}>
          <EyeOff />
          {t('library.selection.markUnread')}
        </Button>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" title={t('library.selection.clear')} onClick={onClear}>
          <X />
        </Button>
      </div>
    </div>
  );
}
