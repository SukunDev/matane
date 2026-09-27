import type { DownloadItem } from '@manga-reader/shared';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, CircleArrowDown, CircleCheck, Clock, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { useDownloadProgress, useEnqueueDownloads } from '../../lib/downloads';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';

/**
 * A chapter's download state on its row (mockup 02): download on hover; queued / paused /
 * progress ring while downloading (click cancels); a check once downloaded; an alert on error
 * (click retries). Deleting a download is in the row menu.
 */
export function DownloadButton({ chapterId, download }: { chapterId: number; download: DownloadItem | undefined }) {
  const { t } = useTranslation();
  const live = useDownloadProgress((state) => state.byChapter.get(chapterId));
  const enqueue = useEnqueueDownloads();
  const cancel = useMutation({ mutationFn: (id: number) => ipc.invoke('downloads.cancel', { ids: [id] }) });
  const retry = useMutation({ mutationFn: (id: number) => ipc.invoke('downloads.retry', { ids: [id] }) });
  const base = 'ml-1';

  if (!download) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('downloads.download')}
        onClick={() => enqueue([chapterId])}
        className={cn(base, 'opacity-0 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100')}
      >
        <CircleArrowDown />
      </Button>
    );
  }
  if (download.status === 'done') {
    return (
      <span
        className={cn(base, 'flex size-7 items-center justify-center text-primary')}
        title={t('downloads.downloaded')}
      >
        <CircleCheck className="size-4" aria-label={t('downloads.downloaded')} />
      </span>
    );
  }
  if (download.status === 'error') {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('downloads.failedRetry', { error: download.error ?? '' })}
        onClick={() => retry.mutate(download.id)}
        className={cn(base, 'text-destructive hover:text-destructive')}
      >
        <CircleAlert />
      </Button>
    );
  }
  const done = live?.pagesDone ?? download.pagesDone;
  const total = live?.pagesTotal ?? download.pagesTotal;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const label =
    download.status === 'downloading'
      ? t('downloads.progress', { percent })
      : download.status === 'paused'
        ? t('downloads.paused')
        : t('downloads.queued');
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={`${label} · ${t('downloads.clickToCancel')}`}
      aria-label={label}
      onClick={() => cancel.mutate(download.id)}
      className={cn(base, 'text-primary hover:text-destructive')}
    >
      {download.status === 'downloading' ? (
        <ProgressRing percent={percent} />
      ) : download.status === 'paused' ? (
        <Pause />
      ) : (
        <Clock />
      )}
    </Button>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-4.5 -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-muted" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - percent / 100)}
        className="stroke-current transition-[stroke-dashoffset]"
      />
    </svg>
  );
}
