import { CACHE_SIZES_MB } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, FileText, FolderOpen, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { formatBytes } from '../../lib/format';
import { ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { Row } from './controls';

const storageQueryKey = ['storage', 'info'] as const;

/** Settings → Data & storage (BRAINSTORM.md §6.5, §6.6; ADR 0014): cache size and usage, folders. */
export function DataSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  // Usage changes all the time while reading; read it fresh whenever the page is shown.
  const { data: info } = useQuery({ queryKey: storageQueryKey, queryFn: () => ipc.invoke('storage.info') });
  const [confirm, setConfirm] = useState<'page' | 'browse_cover' | null>(null);
  const clear = useMutation({
    mutationFn: (kind: 'page' | 'browse_cover') => ipc.invoke('storage.clearCache', { kind }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageQueryKey }),
  });
  const [confirmStats, setConfirmStats] = useState(false);
  const clearStats = useMutation({
    mutationFn: () => ipc.invoke('stats.clear'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stats'] }),
  });
  const openPath = useMutation({ mutationFn: (which: 'data' | 'logs') => ipc.invoke('app.openPath', { which }) });
  const sizeId = useId();
  if (!settings) return null;
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  const limit = settings.cacheSizeMb * 1024 * 1024;
  const used = info?.pageCacheBytes ?? 0;
  const setCacheSize = (cacheSizeMb: number) =>
    update.mutate(
      { cacheSizeMb },
      // Main trims the cache to the new limit; show the result.
      { onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: storageQueryKey }), 500) },
    );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.data.cache')}</h2>
        <div className="divide-y">
          <Row htmlFor={sizeId} label={t('settings.data.cacheSize')} description={t('settings.data.cacheSizeHint')}>
            <select
              id={sizeId}
              value={settings.cacheSizeMb}
              onChange={(event) => setCacheSize(Number(event.target.value))}
              className="h-9 rounded-lg border border-input bg-background px-2.5"
            >
              {[...new Set([...CACHE_SIZES_MB, settings.cacheSizeMb])]
                .sort((a, b) => a - b)
                .map((mb) => (
                  <option key={mb} value={mb}>
                    {size(mb * 1024 * 1024)}
                  </option>
                ))}
            </select>
          </Row>
          <div className="flex flex-col gap-2 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('settings.data.pageCache')}</p>
                <p className="text-xs text-muted-foreground" data-testid="page-cache-usage">
                  {t('settings.data.usedOf', { used: size(used), limit: size(limit) })}
                </p>
              </div>
              <Button variant="destructive" size="sm" disabled={used === 0} onClick={() => setConfirm('page')}>
                <Trash2 />
                {t('settings.data.clearPages')}
              </Button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 py-4 last:pb-0">
            <div>
              <p className="font-medium">{t('settings.data.browseCovers')}</p>
              <p className="text-xs text-muted-foreground" data-testid="cover-cache-usage">
                {t('settings.data.browseCoversHint', { used: size(info?.browseCoverBytes ?? 0) })}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={(info?.browseCoverBytes ?? 0) === 0}
              onClick={() => setConfirm('browse_cover')}
            >
              <Trash2 />
              {t('settings.data.clearCovers')}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.data.storage')}</h2>
        <div className="divide-y">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div>
              <p className="font-medium">{t('settings.data.downloads')}</p>
              <p className="text-xs text-muted-foreground">{size(info?.downloadBytes ?? 0)}</p>
            </div>
            <Link
              to="/settings/$section"
              params={{ section: 'downloads' }}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('downloads.page.settings')}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="font-medium">{t('settings.data.dataFolder')}</p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={info?.dataPath}>
                {info?.dataPath}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openPath.mutate('data')}>
              <FolderOpen />
              {t('settings.data.open')}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 pt-4">
            <div className="min-w-0">
              <p className="font-medium">{t('settings.data.logs')}</p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={info?.logPath}>
                {info?.logPath}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openPath.mutate('logs')}>
              <FileText />
              {t('settings.data.open')}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.data.statistics')}</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{t('settings.data.clearStats')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.data.clearStatsHint')}</p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setConfirmStats(true)}>
            <Trash2 />
            {t('settings.data.clearStats')}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmStats}
        onOpenChange={setConfirmStats}
        title={t('settings.data.clearStatsTitle')}
        description={t('settings.data.clearStatsDescription')}
        confirmLabel={t('settings.data.clearStats')}
        onConfirm={() => clearStats.mutate()}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'page' ? t('settings.data.clearPagesTitle') : t('settings.data.clearCoversTitle')}
        description={
          confirm === 'page' ? t('settings.data.clearPagesDescription') : t('settings.data.clearCoversDescription')
        }
        confirmLabel={confirm === 'page' ? t('settings.data.clearPages') : t('settings.data.clearCovers')}
        onConfirm={() => confirm && clear.mutate(confirm)}
      />
    </div>
  );
}
