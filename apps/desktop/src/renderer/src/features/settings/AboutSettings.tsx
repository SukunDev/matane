import type { UpdaterSettings, UpdaterStatus } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Download, ExternalLink, RefreshCw, RotateCw, Sparkles, Wand2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import logoMark from '../../assets/logo-mark.png';
import { Button } from '../../components/ui/button';
import { formatRelative } from '../../lib/format';
import { appInfoQuery, ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { useWhatsNew } from '../whats-new/WhatsNewDialog';
import { Row, Segmented } from './controls';

const updaterQuery = { queryKey: ['updater', 'status'] as const, queryFn: () => ipc.invoke('updater.status') };

export function AboutSettings() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  const navigate = useNavigate();
  const setWhatsNew = useWhatsNew((state) => state.setOpen);
  if (!info) return null;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-4 rounded-xl border bg-card/40 p-5">
        <img src={logoMark} alt="" className="size-12" />
        <div>
          <p className="font-semibold">
            {t('app.name')}{' '}
            <span lang="ja" className="font-normal text-muted-foreground">
              {t('app.nameNative')}
            </span>
          </p>
          <p className="text-xs text-muted-foreground" data-testid="app-version">
            {t('settings.about.version', { version: info.version })}
          </p>
          <p className="text-xs text-muted-foreground">{t('settings.about.runtime', info)}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWhatsNew(true)}>
            <Sparkles />
            {t('settings.about.whatsNew')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void navigate({ to: '/onboarding' })}>
            <Wand2 />
            {t('settings.about.runSetup')}
          </Button>
        </div>
      </section>
      <UpdaterCard />
    </div>
  );
}

/** App updates (BRAINSTORM.md §10): status, check now, restart to update, and the settings. */
function UpdaterCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status } = useQuery(updaterQuery);
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  useIpcEvent(
    'updater.changed',
    useCallback((next: UpdaterStatus) => queryClient.setQueryData(updaterQuery.queryKey, next), [queryClient]),
  );
  const check = useMutation({ mutationFn: () => ipc.invoke('updater.check') });
  const download = useMutation({ mutationFn: () => ipc.invoke('updater.download') });
  const install = useMutation({ mutationFn: () => ipc.invoke('updater.install') });
  const openRelease = useMutation({ mutationFn: () => ipc.invoke('updater.openRelease') });
  if (!status || !settings) return null;
  const set = (patch: Partial<UpdaterSettings>) => update.mutate({ updater: { ...settings.updater, ...patch } });
  const busy = status.state === 'checking' || status.state === 'downloading';

  const line =
    status.kind === 'none'
      ? t('settings.updater.dev')
      : status.state === 'checking'
        ? t('settings.updater.checking')
        : status.state === 'latest'
          ? t('settings.updater.latest')
          : status.state === 'available'
            ? t('settings.updater.available', { version: status.version })
            : status.state === 'downloading'
              ? t('settings.updater.downloading', { version: status.version, percent: status.progress ?? 0 })
              : status.state === 'downloaded'
                ? t('settings.updater.downloaded', { version: status.version })
                : status.state === 'error'
                  ? t('settings.updater.error', { error: status.error })
                  : t('settings.updater.idle');

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="mb-4 text-sm font-semibold">{t('settings.updater.title')}</h2>
      <div className="divide-y">
        <div className="flex flex-col gap-3 pb-4">
          <div className="min-w-0">
            <p className="font-medium" role="status" data-testid="updater-status">
              {line}
            </p>
            <p className="text-xs text-muted-foreground">
              {status.kind === 'notify' ? t('settings.updater.notifyOnly') : t('settings.updater.autoHint')}
              {status.checkedAt &&
                ` · ${t('settings.updater.checkedAt', { when: formatRelative(status.checkedAt, i18n.language) })}`}
            </p>
            {status.state === 'downloading' && (
              <div className="mt-2 h-1.5 w-64 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${status.progress ?? 0}%` }} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {status.state === 'downloaded' ? (
              <Button onClick={() => install.mutate()}>
                <RotateCw />
                {t('settings.updater.restart')}
              </Button>
            ) : status.state === 'available' && status.kind === 'auto' ? (
              <Button onClick={() => download.mutate()}>
                <Download />
                {t('settings.updater.download')}
              </Button>
            ) : status.state === 'available' ? (
              <Button onClick={() => openRelease.mutate()}>
                <ExternalLink />
                {t('settings.updater.openRelease')}
              </Button>
            ) : null}
            <Button variant="secondary" disabled={busy || status.kind === 'none'} onClick={() => check.mutate()}>
              <RefreshCw className={busy ? 'animate-spin' : undefined} />
              {t('settings.updater.checkNow')}
            </Button>
          </div>
        </div>
        <Row stacked label={t('settings.updater.mode')} description={t('settings.updater.modeHint')}>
          <Segmented
            label={t('settings.updater.mode')}
            options={['auto', 'notify', 'off'] as const}
            value={settings.updater.mode}
            onChange={(mode) => set({ mode })}
            format={(mode) => t(`settings.updater.modes.${mode}`)}
          />
        </Row>
        <Row label={t('settings.updater.channel')} description={t('settings.updater.channelHint')}>
          <Segmented
            label={t('settings.updater.channel')}
            options={['stable', 'beta'] as const}
            value={settings.updater.channel}
            onChange={(channel) => set({ channel })}
            format={(channel) => t(`settings.updater.channels.${channel}`)}
          />
        </Row>
      </div>
    </section>
  );
}
