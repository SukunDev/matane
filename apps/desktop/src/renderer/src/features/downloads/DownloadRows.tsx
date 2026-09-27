import type { DownloadItem } from '@manga-reader/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  GripVertical,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { DragEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { Button } from '../../components/ui/button';
import { useDownloadProgress } from '../../lib/downloads';
import { formatBytes, formatDuration, formatRelative } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { type QueueGroup, etaSeconds } from './queue';

interface DragProps {
  draggable: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
}

/** Alt+↑/↓ moves the focused row (the keyboard way to reorder). */
const moveKeys = (onMove: (dir: -1 | 1) => void) => (event: KeyboardEvent) => {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  onMove(event.key === 'ArrowUp' ? -1 : 1);
};

function Handle() {
  return <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />;
}

function FormatChip({ item }: { item: DownloadItem }) {
  return (
    <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
      {item.format}
    </span>
  );
}

/** A manga's card header: cover, title, source, "3 chapters in queue", collapse. */
export function QueueGroupHeader({
  group,
  collapsed,
  onToggle,
  onMove,
  dragging,
  dropTarget,
  dragProps,
}: {
  group: QueueGroup;
  collapsed: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  dragging: boolean;
  dropTarget: boolean;
  dragProps: DragProps;
}) {
  const { t } = useTranslation();
  const first = group.items[0]!;
  return (
    <div className="pt-4">
      <div
        {...dragProps}
        tabIndex={0}
        onKeyDown={moveKeys(onMove)}
        aria-label={first.mangaTitle}
        data-testid="download-group"
        className={cn(
          'flex items-center gap-3 rounded-t-xl border bg-card/60 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed && 'rounded-b-xl',
          dragging && 'opacity-50',
          dropTarget && 'border-primary',
        )}
      >
        <Handle />
        <CoverImage mangaId={first.mangaId} coverKey={first.coverKey} alt="" className="h-11 w-8 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/manga/$mangaId"
              params={{ mangaId: String(first.mangaId) }}
              className="truncate font-semibold hover:underline"
              draggable={false}
            >
              {first.mangaTitle}
            </Link>
            {first.sourceName && (
              <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {first.sourceName}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('downloads.page.groupCount', { count: group.items.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          title={collapsed ? t('downloads.page.expand') : t('downloads.page.collapse')}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <ChevronDown className={cn('transition-transform', !collapsed && 'rotate-180')} />
        </Button>
      </div>
    </div>
  );
}

/** A chapter in the queue: status, pages, speed, ETA, format, size, pause/resume and cancel. */
export function QueueRow({
  item,
  last,
  onDetails,
  onMove,
  dragging,
  dropTarget,
  dragProps,
}: {
  item: DownloadItem;
  last: boolean;
  onDetails: () => void;
  onMove: (dir: -1 | 1) => void;
  dragging: boolean;
  dropTarget: boolean;
  dragProps: DragProps;
}) {
  const { t, i18n } = useTranslation();
  const live = useDownloadProgress((state) => state.byChapter.get(item.chapterId));
  const pause = useMutation({ mutationFn: () => ipc.invoke('downloads.pause', { ids: [item.id] }) });
  const resume = useMutation({ mutationFn: () => ipc.invoke('downloads.resume', { ids: [item.id] }) });
  const cancel = useMutation({ mutationFn: () => ipc.invoke('downloads.cancel', { ids: [item.id] }) });
  const retry = useMutation({ mutationFn: () => ipc.invoke('downloads.retry', { ids: [item.id] }) });
  const done = live?.pagesDone ?? item.pagesDone;
  const total = live?.pagesTotal ?? item.pagesTotal;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const running = item.status === 'downloading';
  const eta = running ? etaSeconds(live) : null;
  const size = live ? live.bytes : item.sizeBytes;
  const error = item.status === 'error';

  const status = running ? (
    <span className="font-medium text-primary">{t('downloads.page.status.downloading', { percent })}</span>
  ) : item.status === 'paused' ? (
    <span>{t('downloads.page.status.paused')}</span>
  ) : error ? (
    <span
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive"
      title={item.error ?? undefined}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="truncate">{t('downloads.page.status.error', { error: item.error ?? '' })}</span>
    </span>
  ) : (
    <span className="flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-muted-foreground" />
      {t('downloads.page.status.queued')}
    </span>
  );

  return (
    <div
      {...dragProps}
      tabIndex={0}
      onKeyDown={moveKeys(onMove)}
      data-testid="download-item"
      aria-label={`${item.mangaTitle} · ${item.chapterName}`}
      className={cn(
        'flex items-center gap-3 border-x border-t px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        last && 'rounded-b-xl border-b',
        error ? 'bg-destructive/5' : 'bg-background',
        dragging && 'opacity-50',
        dropTarget && 'border-t-2 border-t-primary',
      )}
    >
      <Handle />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate font-medium">{item.chapterName}</p>
          <div className="flex min-w-0 shrink text-xs text-muted-foreground">{status}</div>
        </div>
        {error ? (
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="flex items-center gap-1 font-medium text-foreground hover:underline"
              onClick={() => retry.mutate()}
            >
              <RotateCcw className="size-3.5" />
              {t('downloads.page.retry')}
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="text-muted-foreground hover:underline" onClick={onDetails}>
              {t('downloads.page.details')}
            </button>
          </div>
        ) : (
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {item.scanlator && <span>{item.scanlator}</span>}
            {total !== null && (running || done > 0) && (
              <>
                {item.scanlator && <span aria-hidden>·</span>}
                <span className="font-medium text-foreground">{t('downloads.page.pages', { done, total })}</span>
              </>
            )}
            {running && live && live.bytesPerSecond > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{t('downloads.page.speed', { speed: formatBytes(live.bytesPerSecond, i18n.language) })}</span>
              </>
            )}
            {eta !== null && (
              <>
                <span aria-hidden>·</span>
                <span>{t('downloads.page.eta', { eta: formatDuration(eta) })}</span>
              </>
            )}
          </p>
        )}
        {(running || (item.status === 'paused' && done > 0)) && total !== null && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-[width]', running ? 'bg-primary' : 'bg-muted-foreground')}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <FormatChip item={item} />
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {size ? formatBytes(size, i18n.language) : ''}
      </span>
      {item.status === 'paused' ? (
        <Button variant="ghost" size="icon-sm" title={t('downloads.page.resume')} onClick={() => resume.mutate()}>
          <Play />
        </Button>
      ) : error ? (
        <span className="size-7" />
      ) : (
        <Button variant="ghost" size="icon-sm" title={t('downloads.page.pause')} onClick={() => pause.mutate()}>
          <Pause />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('downloads.cancel')}
        className="hover:text-destructive"
        onClick={() => cancel.mutate()}
      >
        <X />
      </Button>
    </div>
  );
}

/** A finished download: read it, show it in its folder, or delete it. */
export function CompletedRow({ item }: { item: DownloadItem }) {
  const { t, i18n } = useTranslation();
  const remove = useMutation({ mutationFn: () => ipc.invoke('downloads.delete', { chapterIds: [item.chapterId] }) });
  const reveal = useMutation({ mutationFn: () => ipc.invoke('downloads.openFolder', { chapterId: item.chapterId }) });
  return (
    <div data-testid="download-done" className="flex items-center gap-3 border-b bg-background px-4 py-2.5">
      <CoverImage mangaId={item.mangaId} coverKey={item.coverKey} alt="" className="h-11 w-8 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <Link to="/manga/$mangaId" params={{ mangaId: String(item.mangaId) }} className="font-medium hover:underline">
            {item.mangaTitle}
          </Link>
          <span className="text-muted-foreground"> · {item.chapterName}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.scanlator, item.sourceName, item.completedAt ? formatRelative(item.completedAt, i18n.language) : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <FormatChip item={item} />
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {item.sizeBytes ? formatBytes(item.sizeBytes, i18n.language) : ''}
      </span>
      <Button asChild variant="ghost" size="icon-sm" title={t('downloads.page.read')}>
        <Link to="/reader/$chapterId" params={{ chapterId: String(item.chapterId) }}>
          <BookOpen />
        </Link>
      </Button>
      <Button variant="ghost" size="icon-sm" title={t('downloads.page.showInFolder')} onClick={() => reveal.mutate()}>
        <FolderOpen />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('downloads.delete')}
        className="hover:text-destructive"
        onClick={() => remove.mutate()}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** "Details" of a failed download: which chapter, and the full error. */
export function ErrorDetailsDialog({ item, onClose }: { item: DownloadItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const retry = useMutation({
    mutationFn: (id: number) => ipc.invoke('downloads.retry', { ids: [id] }),
    onSuccess: onClose,
  });
  return (
    <Dialog.Root open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t('downloads.page.detailsTitle')}</Dialog.Title>
          <Dialog.Description className="text-muted-foreground">
            {item && `${item.mangaTitle} · ${item.chapterName}${item.sourceName ? ` · ${item.sourceName}` : ''}`}
          </Dialog.Description>
          <pre className="max-h-60 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-destructive">
            {item?.error}
          </pre>
          {item && item.pagesTotal !== null && (
            <p className="text-xs text-muted-foreground">
              {t('downloads.page.detailsPages', { done: item.pagesDone, total: item.pagesTotal })}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">{t('common.close')}</Button>
            </Dialog.Close>
            <Button onClick={() => item && retry.mutate(item.id)}>
              <RotateCcw />
              {t('downloads.page.retry')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
