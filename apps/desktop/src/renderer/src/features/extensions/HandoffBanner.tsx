import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CloudOff, Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { handoffQuery } from '../../lib/extensions';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';

/**
 * Extensions that used to come with the app and now come from the official repository: shown
 * while one waits for the network or failed to install, with a retry (Library and Sources).
 */
export function HandoffBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: items = [] } = useQuery(handoffQuery);
  const retry = useMutation({ mutationFn: () => ipc.invoke('extensions.retryHandoff') });
  if (items.length === 0) return null;
  const failed = items.filter((item) => item.state === 'failed');
  const names = items.map((item) => item.name).join(', ');

  return (
    <div
      role="status"
      data-testid="handoff-banner"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        failed.length > 0 ? 'border-ctp-peach/40 bg-ctp-peach/10' : 'border-ctp-blue/40 bg-ctp-blue/10',
        className,
      )}
    >
      {failed.length > 0 ? (
        <AlertTriangle className="size-4.5 shrink-0 text-ctp-peach" />
      ) : (
        <CloudOff className="size-4.5 shrink-0 text-ctp-blue" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {failed.length > 0
            ? t('extensions.handoff.failed', { names, count: items.length })
            : t('extensions.handoff.waiting', { names, count: items.length })}
        </p>
        <p className="text-xs text-muted-foreground select-text">
          {failed[0]?.error ?? t('extensions.handoff.waitingHint')}
        </p>
      </div>
      <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
        {retry.isPending ? <Loader2 className="animate-spin" /> : <Download />}
        {t('extensions.handoff.install')}
      </Button>
    </div>
  );
}
