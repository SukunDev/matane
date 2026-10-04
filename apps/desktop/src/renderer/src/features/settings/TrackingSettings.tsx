import type { TrackerInfo } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useErrorText } from '../../lib/errors';
import { ipc } from '../../lib/ipc';
import { trackersQuery } from '../../lib/trackers';

/** Settings → Tracking (ADR 0035): connect the services whose lists Matane keeps up to date. */
export function TrackingSettings() {
  const { t } = useTranslation();
  const { data: trackers = [] } = useQuery(trackersQuery);
  return (
    <div className="flex flex-col gap-6" data-testid="tracking-settings">
      <p className="text-muted-foreground">{t('settings.tracking.intro')}</p>
      {trackers.map((tracker) => (
        <TrackerCard key={tracker.service} tracker={tracker} />
      ))}
    </div>
  );
}

function TrackerCard({ tracker }: { tracker: TrackerInfo }) {
  const { t } = useTranslation();
  const connect = useMutation({ mutationFn: () => ipc.invoke('trackers.connect', { service: tracker.service }) });
  const cancel = useMutation({ mutationFn: () => ipc.invoke('trackers.cancelConnect', { service: tracker.service }) });
  const disconnect = useMutation({ mutationFn: () => ipc.invoke('trackers.disconnect', { service: tracker.service }) });
  const retry = useMutation({ mutationFn: () => ipc.invoke('trackers.retry') });
  const connecting = connect.isPending;
  const error = useErrorText(connect.error);

  return (
    <section
      className="rounded-xl border bg-card/40 p-5"
      aria-label={tracker.name}
      data-testid={`tracker-${tracker.service}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{tracker.name}</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="tracker-state">
            {!tracker.configured ? (
              t('settings.tracking.notConfigured', { name: tracker.name })
            ) : tracker.connected && !tracker.expired ? (
              <>
                <CircleCheck className="size-3.5 text-ctp-green" />
                {t('settings.tracking.connectedAs', { name: tracker.username })}
              </>
            ) : tracker.expired ? (
              <>
                <CircleAlert className="size-3.5 text-ctp-yellow" />
                {t('settings.tracking.expired')}
              </>
            ) : (
              t('settings.tracking.notConnected')
            )}
          </p>
        </div>
        {tracker.connected && !tracker.expired ? (
          <Button variant="secondary" size="sm" onClick={() => disconnect.mutate()}>
            {t('settings.tracking.disconnect')}
          </Button>
        ) : connecting ? (
          <Button variant="secondary" size="sm" onClick={() => cancel.mutate()}>
            <Loader2 className="animate-spin" />
            {t('settings.tracking.waiting')}
          </Button>
        ) : (
          <Button size="sm" disabled={!tracker.configured} onClick={() => connect.mutate()}>
            {t('settings.tracking.connect')}
          </Button>
        )}
      </div>

      {connect.isError && !connecting && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error.title}: {error.detail}
        </p>
      )}
      {tracker.connected && tracker.encrypted === false && (
        <p className="mt-3 text-xs text-ctp-yellow">{t('settings.tracking.plain')}</p>
      )}
      {(tracker.queued > 0 || tracker.lastError) && (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
          data-testid="tracker-queue"
        >
          {tracker.queued > 0 && <span>{t('settings.tracking.queued', { count: tracker.queued })}</span>}
          {tracker.lastError && (
            <span className="text-ctp-yellow">{t('settings.tracking.lastError', { message: tracker.lastError })}</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => retry.mutate()}>
            <RefreshCw />
            {t('settings.tracking.retry')}
          </Button>
        </div>
      )}

      <TokenLogin tracker={tracker} />
      <p className="mt-4 text-[11px] text-muted-foreground">
        {t('settings.tracking.redirectHint', { url: tracker.redirectUrl })}
      </p>
    </section>
  );
}

/** For when the browser login cannot come back: an access token made elsewhere. */
function TokenLogin({ tracker }: { tracker: TrackerInfo }) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const save = useMutation({
    mutationFn: () => ipc.invoke('trackers.setToken', { service: tracker.service, token }),
    onSuccess: () => setToken(''),
  });
  const error = useErrorText(save.error);
  return (
    <details className="mt-4 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {t('settings.tracking.tokenTitle')}
      </summary>
      <p className="my-2 text-muted-foreground">{t('settings.tracking.tokenHint')}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim().length >= 10) save.mutate();
        }}
      >
        <Input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t('settings.tracking.tokenPlaceholder')}
          aria-label={t('settings.tracking.tokenTitle')}
          autoComplete="off"
          spellCheck={false}
          type="password"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={token.trim().length < 10 || save.isPending}>
          {t('settings.tracking.tokenSave')}
        </Button>
      </form>
      {save.isError && (
        <p role="alert" className="mt-2 text-destructive">
          {error.title}: {error.detail}
        </p>
      )}
    </details>
  );
}
