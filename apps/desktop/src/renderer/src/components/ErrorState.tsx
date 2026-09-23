import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, RotateCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../lib/errors';
import { ipc } from '../lib/ipc';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

/**
 * Failure of a source call, with "Try again" and — for Cloudflare — "Verify", which opens the
 * challenge in a window and retries once it is cleared.
 */
export function ErrorState({
  error,
  onRetry,
  sourceId,
  compact,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  sourceId?: string;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { code, title, detail } = useErrorText(error);
  const verify = useMutation({
    mutationFn: (id: string) => ipc.invoke('sources.solveChallenge', { sourceId: id }),
    onSuccess: () => onRetry?.(),
  });

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'p-4' : 'h-full p-8',
        className,
      )}
    >
      {!compact && (
        <div className="flex size-14 items-center justify-center rounded-2xl bg-ctp-red/10 text-ctp-red">
          <AlertTriangle className="size-7" />
        </div>
      )}
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 max-w-md text-xs break-words text-muted-foreground select-text">{detail}</p>
      </div>
      <div className="flex gap-2">
        {code === 'cloudflare' && sourceId && (
          <Button onClick={() => verify.mutate(sourceId)} disabled={verify.isPending}>
            <ShieldCheck />
            {verify.isPending ? t('errors.verifying') : t('errors.verify')}
          </Button>
        )}
        {onRetry && code !== 'not_implemented' && (
          <Button variant="secondary" onClick={onRetry}>
            <RotateCw />
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
