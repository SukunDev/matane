import type { DownloadItem } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowRight,
  ArrowUpDown,
  CircleAlert,
  CircleCheck,
  Download,
  EllipsisVertical,
  FolderOpen,
  ListX,
  Pause,
  Play,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { downloadStatsQuery, isOverLimit, limitBytesOf, listedDownloadsQuery } from '../../lib/downloads';
import { formatBytes } from '../../lib/format';
import { ipc, settingsQuery } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { CompletedRow, ErrorDetailsDialog, QueueGroupHeader, QueueRow } from './DownloadRows';
import { type QueueGroup, applyOrder, groupQueue, inQueue, moveGroup, moveItem } from './queue';

type Tab = 'queue' | 'completed' | 'errors';
const TABS: Tab[] = ['queue', 'completed', 'errors'];

/** The download queue and finished downloads (BRAINSTORM.md §6.4; mockup 08). */
export function DownloadsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('queue');
  const list = useQuery(listedDownloadsQuery);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [details, setDetails] = useState<DownloadItem | null>(null);
  const items = useMemo(() => list.data ?? [], [list.data]);
  const byTab: Record<Tab, DownloadItem[]> = useMemo(
    () => ({
      queue: items.filter(inQueue),
      completed: items.filter((i) => i.status === 'done'),
      errors: items.filter((i) => i.status === 'error'),
    }),
    [items],
  );

  return (
    <div className="flex h-full flex-col">
      <div ref={setScrollElement} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5">
          <DownloadsHeader queue={byTab.queue} completed={byTab.completed.length} />
          <LimitBanner />
          <div className="flex items-end gap-6 border-b" role="tablist" aria-label={t('nav.downloads')}>
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                  tab === key && 'border-primary font-semibold text-foreground',
                )}
              >
                {t(`downloads.page.tabs.${key}`)}
                <span
                  className={cn(
                    'rounded-md bg-muted px-1.5 text-[11px] font-semibold',
                    key === 'errors' && byTab.errors.length > 0 && 'bg-destructive/20 text-destructive',
                    tab === key && key !== 'errors' && 'bg-primary/20 text-primary',
                  )}
                >
                  {byTab[key].length}
                </span>
              </button>
            ))}
            {tab === 'queue' && byTab.queue.length > 1 && (
              <span className="mb-2.5 ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowUpDown className="size-3.5" />
                {t('downloads.page.dragHint')}
              </span>
            )}
            {tab === 'errors' && byTab.errors.length > 0 && (
              <RetryAll ids={byTab.errors.map((i) => i.id)} className="mb-1.5 ml-auto" />
            )}
          </div>

          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.isSuccess ? null : byTab[tab].length === 0 ? (
            <EmptyTab tab={tab} />
          ) : tab === 'completed' ? (
            <CompletedList items={byTab.completed} scrollElement={scrollElement} />
          ) : (
            <QueueList items={byTab[tab]} scrollElement={scrollElement} onDetails={setDetails} />
          )}
        </div>
      </div>
      <DownloadsFooter />
      <ErrorDetailsDialog item={details} onClose={() => setDetails(null)} />
    </div>
  );
}

function EmptyTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const icon = tab === 'queue' ? Download : tab === 'completed' ? CircleCheck : CircleAlert;
  return (
    <div className="rounded-xl border">
      <EmptyState
        icon={icon}
        title={t(`downloads.page.empty.${tab}.title`)}
        description={t(`downloads.page.empty.${tab}.description`)}
      />
    </div>
  );
}

/** "6 in queue · 2 active · 18.4 GB used of 20 GB limit", the usage bar and the queue actions. */
function DownloadsHeader({ queue, completed }: { queue: DownloadItem[]; completed: number }) {
  const { t, i18n } = useTranslation();
  const { data: stats } = useQuery(downloadStatsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const limit = limitBytesOf(settings?.downloads.limitGb ?? null);
  const used = stats?.totalBytes ?? 0;
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const runnable = (stats?.queued ?? 0) + (stats?.downloading ?? 0);
  const pause = useMutation({ mutationFn: () => ipc.invoke('downloads.pause') });
  const resume = useMutation({ mutationFn: () => ipc.invoke('downloads.resume') });
  const clear = useMutation({ mutationFn: () => ipc.invoke('downloads.clearCompleted') });
  const cancelAll = useMutation({
    mutationFn: () => ipc.invoke('downloads.cancel', { ids: queue.map((i) => i.id) }),
  });
  const openFolder = useMutation({ mutationFn: () => ipc.invoke('downloads.openFolder') });
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  const menuItem =
    'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent';

  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold">{t('nav.downloads')}</h1>
          <span className="text-xs text-muted-foreground">{t('downloads.page.subtitle')}</span>
        </div>
        <p className="text-muted-foreground" data-testid="downloads-summary">
          {t('downloads.page.summary', { queue: queue.length, active: stats?.downloading ?? 0 })}
          {' · '}
          {limit
            ? t('downloads.page.usedOfLimit', { used: size(used), limit: size(limit) })
            : t('downloads.page.used', { used: size(used) })}
        </p>
        {limit !== null && (
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-52 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', percent >= 100 ? 'bg-destructive' : 'bg-ctp-peach')}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className={cn('text-xs', percent >= 100 ? 'text-destructive' : 'text-ctp-peach')}>
              {t('downloads.page.percent', { percent, used: size(used), limit: size(limit) })}
            </span>
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {runnable > 0 || (stats?.paused ?? 0) === 0 ? (
          <Button variant="secondary" size="sm" disabled={runnable === 0} onClick={() => pause.mutate()}>
            <Pause />
            {t('downloads.page.pauseAll')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => resume.mutate()}>
            <Play />
            {t('downloads.page.resumeAll')}
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={completed === 0} onClick={() => clear.mutate()}>
          <ListX />
          {t('downloads.page.clearCompleted')}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="secondary" size="icon" title={t('downloads.page.more')}>
              <EllipsisVertical />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              <DropdownMenu.Item className={menuItem} onSelect={() => openFolder.mutate()}>
                <FolderOpen className="size-4" />
                {t('downloads.page.openFolder')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(menuItem, 'text-destructive')}
                disabled={queue.length === 0}
                onSelect={() => setConfirmCancel(true)}
              >
                <X className="size-4" />
                {t('downloads.page.cancelAll')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('downloads.page.cancelAllTitle', { count: queue.length })}
        description={t('downloads.page.cancelAllDescription')}
        confirmLabel={t('downloads.page.cancelAll')}
        onConfirm={() => cancelAll.mutate()}
      />
    </header>
  );
}

function RetryAll({ ids, className }: { ids: number[]; className?: string }) {
  const { t } = useTranslation();
  const retry = useMutation({ mutationFn: () => ipc.invoke('downloads.retry', { ids }) });
  return (
    <Button variant="ghost" size="sm" className={className} onClick={() => retry.mutate()}>
      <RotateCcw />
      {t('downloads.page.retryAll')}
    </Button>
  );
}

/** Past the size limit, automatic downloads stop (BRAINSTORM.md §6.4). */
function LimitBanner() {
  const { t, i18n } = useTranslation();
  const { data: stats } = useQuery(downloadStatsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const limitGb = settings?.downloads.limitGb ?? null;
  if (!isOverLimit(stats, limitGb)) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-ctp-peach/40 bg-ctp-peach/10 px-4 py-3 text-sm text-ctp-peach"
    >
      <TriangleAlert className="size-4.5 shrink-0" />
      <span className="flex-1">
        {t('downloads.page.limitReached', {
          used: formatBytes(stats?.totalBytes ?? 0, i18n.language),
          limit: formatBytes(limitBytesOf(limitGb) ?? 0, i18n.language),
        })}
      </span>
      <Button asChild variant="ghost" size="sm" className="text-ctp-peach">
        <Link to="/settings/$section" params={{ section: 'downloads' }}>
          {t('downloads.page.settings')}
        </Link>
      </Button>
    </div>
  );
}

type QueueEntry = { kind: 'group'; group: QueueGroup } | { kind: 'item'; item: DownloadItem; last: boolean };
type Dragging = { kind: 'group'; mangaId: number } | { kind: 'item'; id: number; mangaId: number };

/**
 * Queue (or errors), one card per manga; drag a chapter within its manga, or a manga header onto
 * another one, to change the order (Alt+↑/↓ does the same from the keyboard). Virtualized.
 */
function QueueList({
  items,
  scrollElement,
  onDetails,
}: {
  items: DownloadItem[];
  scrollElement: HTMLElement | null;
  onDetails: (item: DownloadItem) => void;
}) {
  const queryClient = useQueryClient();
  const groups = useMemo(() => groupQueue(items), [items]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const entries = useMemo(
    () =>
      groups.flatMap<QueueEntry>((group) => [
        { kind: 'group', group },
        ...(collapsed.has(group.mangaId)
          ? []
          : group.items.map((item, index) => ({
              kind: 'item' as const,
              item,
              last: index === group.items.length - 1,
            }))),
      ]),
    [groups, collapsed],
  );
  const reorder = useMutation({ mutationFn: (ids: number[]) => ipc.invoke('downloads.reorder', { ids }) });
  /** Moving a row re-inserts its DOM node, which drops focus; put it back for the next Alt+↑/↓. */
  const refocus = (key: string) =>
    requestAnimationFrame(() => listElement?.querySelector<HTMLElement>(`[data-key="${key}"] [tabindex]`)?.focus());
  // Keyboard moves start from the latest order, which is ahead of the rendered one when Alt+↑ is
  // pressed again before React re-rendered.
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);
  const apply = (ids: number[] | null, focusKey?: string) => {
    if (!ids) return;
    if (focusKey) refocus(focusKey);
    latest.current = applyOrder(latest.current, ids);
    queryClient.setQueryData(listedDownloadsQuery.queryKey, (old) => old && applyOrder(old, ids));
    reorder.mutate(ids);
  };
  const moveGroupBy = (mangaId: number, dir: number, key: string) => {
    const current = groupQueue(latest.current);
    const other = current[current.findIndex((g) => g.mangaId === mangaId) + dir];
    if (other) apply(moveGroup(current, mangaId, other.mangaId), key);
  };
  const moveItemBy = (item: DownloadItem, dir: number, key: string) => {
    const current = groupQueue(latest.current);
    const siblings = current.find((g) => g.mangaId === item.mangaId)?.items ?? [];
    const other = siblings[siblings.findIndex((i) => i.id === item.id) + dir];
    if (other) apply(moveItem(current, item.id, other.id), key);
  };

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => (entries[index]!.kind === 'group' ? 68 : 76),
    overscan: 6,
    scrollMargin: listElement?.offsetTop ?? 0,
    getItemKey: (index) => {
      const entry = entries[index]!;
      return entry.kind === 'group' ? `g${entry.group.mangaId}` : `i${entry.item.id}`;
    },
  });
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, listElement]);

  const dragProps = (key: string, start: Dragging, onDrop: () => void) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      setDragging(start);
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((current) => (current === key ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      onDrop();
      setOver(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });

  return (
    <div ref={setListElement} className="relative pb-6" style={{ height: virtualizer.getTotalSize() + 24 }}>
      {virtualizer.getVirtualItems().map((row) => {
        const entry = entries[row.index]!;
        let content: ReactNode;
        if (entry.kind === 'group') {
          const { group } = entry;
          const key = `g${group.mangaId}`;
          content = (
            <QueueGroupHeader
              group={group}
              collapsed={collapsed.has(group.mangaId)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (!next.delete(group.mangaId)) next.add(group.mangaId);
                  return next;
                })
              }
              onMove={(dir) => moveGroupBy(group.mangaId, dir, key)}
              dragging={dragging?.kind === 'group' && dragging.mangaId === group.mangaId}
              dropTarget={over === key && dragging?.kind === 'group' && dragging.mangaId !== group.mangaId}
              dragProps={dragProps(key, { kind: 'group', mangaId: group.mangaId }, () => {
                if (dragging?.kind === 'group') apply(moveGroup(groups, dragging.mangaId, group.mangaId));
              })}
            />
          );
        } else {
          const { item } = entry;
          const key = `i${item.id}`;
          content = (
            <QueueRow
              item={item}
              last={entry.last}
              onDetails={() => onDetails(item)}
              onMove={(dir) => moveItemBy(item, dir, key)}
              dragging={dragging?.kind === 'item' && dragging.id === item.id}
              dropTarget={
                over === key &&
                dragging?.kind === 'item' &&
                dragging.id !== item.id &&
                dragging.mangaId === item.mangaId
              }
              dragProps={dragProps(key, { kind: 'item', id: item.id, mangaId: item.mangaId }, () => {
                if (dragging?.kind === 'item') apply(moveItem(groups, dragging.id, item.id));
              })}
            />
          );
        }
        return (
          <div
            key={row.key}
            data-index={row.index}
            data-key={row.key}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0"
            style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** Finished downloads still listed (not cleared), newest first. Virtualized. */
function CompletedList({ items, scrollElement }: { items: DownloadItem[]; scrollElement: HTMLElement | null }) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 64,
    overscan: 8,
    scrollMargin: listElement?.offsetTop ?? 0,
    getItemKey: (index) => items[index]!.id,
  });
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, listElement]);
  return (
    <div
      ref={setListElement}
      className="relative overflow-hidden rounded-xl border"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0"
          style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
        >
          <CompletedRow item={items[row.index]!} />
        </div>
      ))}
    </div>
  );
}

/** "● Download ahead: 2 chapters · Delete after reading: on" and a link to the settings. */
function DownloadsFooter() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  if (!settings) return null;
  const { ahead, deleteAfterRead } = settings.downloads;
  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t bg-sidebar px-6 text-xs text-muted-foreground">
      <span className={cn('size-2 rounded-full', ahead > 0 ? 'bg-ctp-green' : 'bg-muted-foreground/50')} />
      <span>
        {t('downloads.page.ahead')}{' '}
        <strong className="text-foreground">
          {ahead > 0 ? t('downloads.page.aheadCount', { count: ahead }) : t('common.off')}
        </strong>
      </span>
      <span aria-hidden>·</span>
      <span>
        {t('downloads.page.deleteAfterRead')}{' '}
        <strong className="text-foreground">{deleteAfterRead.enabled ? t('common.on') : t('common.off')}</strong>
      </span>
      <Link
        to="/settings/$section"
        params={{ section: 'downloads' }}
        className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {t('downloads.page.settings')}
        <ArrowRight className="size-3.5" />
      </Link>
    </footer>
  );
}
