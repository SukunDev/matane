import type { BackupPreview, BackupProgress, RestoreResult } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  FolderOpen,
  FolderPen,
  HardDriveDownload,
  Loader2,
  Puzzle,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { appError } from '../../lib/errors';
import { availableExtensionsQuery } from '../../lib/extensions';
import { formatBytes, formatRelative } from '../../lib/format';
import { ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { InstallDialog, type InstallRequest } from '../extensions/InstallDialog';
import { Row, Segmented } from './controls';

export const backupListQuery = { queryKey: ['backup', 'list'] as const, queryFn: () => ipc.invoke('backup.list') };

/** Settings → Data → Backup (BRAINSTORM.md §6.7): back up now, restore, automatic backups. */
export function BackupSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const { data: files = [] } = useQuery(backupListQuery);
  const [restoring, setRestoring] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => ipc.invoke('backup.create'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupListQuery.queryKey }),
  });
  const pick = useMutation({
    mutationFn: () => ipc.invoke('backup.pick'),
    onSuccess: (path) => path && setRestoring(path),
  });
  const chooseFolder = useMutation({
    mutationFn: () => ipc.invoke('backup.chooseFolder'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupListQuery.queryKey }),
  });
  const openFolder = useMutation({ mutationFn: () => ipc.invoke('backup.openFolder') });
  if (!settings) return null;
  const backup = settings.backup;

  return (
    <section className="rounded-xl border bg-card/40 p-5" data-testid="backup-settings">
      <h2 className="mb-1 text-sm font-semibold">{t('backup.title')}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('backup.description')}</p>
      <div className="divide-y">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <HardDriveDownload />}
            {t('backup.now')}
          </Button>
          <Button variant="secondary" onClick={() => pick.mutate()}>
            <ArchiveRestore />
            {t('backup.restore')}
          </Button>
          {create.data && (
            <p role="status" className="flex items-center gap-1.5 text-xs text-ctp-green">
              <Check className="size-3.5" />
              {t('backup.saved', { path: create.data })}
            </p>
          )}
          {create.isError && <p className="text-xs text-ctp-red">{appError(create.error).message}</p>}
        </div>
        <Row label={t('backup.auto.label')} description={t('backup.auto.hint')}>
          <Segmented
            label={t('backup.auto.label')}
            options={['off', 'daily', 'weekly'] as const}
            value={backup.auto}
            onChange={(auto) => update.mutate({ backup: { ...backup, auto } })}
            format={(value) => t(`backup.auto.${value}`)}
          />
        </Row>
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="font-medium">{t('backup.folder')}</p>
            <p className="truncate font-mono text-xs text-muted-foreground" data-testid="backup-folder">
              {backup.folder ?? t('backup.defaultFolder')}
            </p>
            <p className="text-xs text-muted-foreground">{t('backup.syncTip')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => chooseFolder.mutate()}>
              <FolderPen />
              {t('backup.changeFolder')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => openFolder.mutate()}>
              <FolderOpen />
              {t('settings.data.open')}
            </Button>
          </div>
        </div>
        {files.length > 0 && (
          <div className="pt-4">
            <p className="mb-2 font-medium">{t('backup.recent')}</p>
            <ul className="flex flex-col divide-y rounded-lg border" data-testid="backup-files">
              {files.slice(0, 10).map((file) => (
                <li key={file.path} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(file.modifiedAt, i18n.language)} · {formatBytes(file.sizeBytes, i18n.language)}
                      {!file.auto && ` · ${t('backup.safety')}`}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setRestoring(file.path)}>
                    {t('backup.restoreThis')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {restoring && <RestoreDialog path={restoring} onClose={() => setRestoring(null)} />}
    </section>
  );
}

/** Preview → options (merge or replace, settings) → progress → what happened. */
function RestoreDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['backup', 'preview', path],
    queryFn: () => ipc.invoke('backup.preview', { path }),
    retry: false,
  });
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [withSettings, setWithSettings] = useState(false);
  const [sure, setSure] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [request, setRequest] = useState<InstallRequest | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  useIpcEvent(
    'backup.progress',
    useCallback((next: BackupProgress) => setProgress(next), []),
  );
  // Installing an extension for a source of a Mihon backup: the preview matches again.
  const { data: allSources = [] } = useQuery(sourcesQuery);
  const installedSources = allSources.filter((source) => source.installed).length;
  const seenInstalled = useRef(installedSources);
  const { refetch: refetchPreview } = preview;
  useEffect(() => {
    if (installedSources === seenInstalled.current) return;
    seenInstalled.current = installedSources;
    void refetchPreview();
  }, [installedSources, refetchPreview]);
  const mihon = preview.data?.mihon ?? null;
  // Where each Mihon source goes: what the user picked, else what matched by itself, else nowhere.
  const sourceMap = Object.fromEntries(
    (mihon?.sources ?? []).map((s) => [s.id, chosen[s.id] ?? s.matchedSourceId ?? '']),
  );
  const restore = useMutation({
    mutationFn: () =>
      ipc.invoke('backup.restore', {
        path,
        mode: mihon ? 'merge' : mode,
        settings: mihon ? false : withSettings,
        ...(mihon && { sourceMap }),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
  const done = restore.data;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !restore.isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ctp-crust/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl"
        >
          <header className="flex items-start gap-3 border-b p-5">
            <ArchiveRestore className="mt-0.5 size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">{t('backup.dialog.title')}</Dialog.Title>
              <p className="truncate font-mono text-xs text-muted-foreground">{path}</p>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" title={t('common.close')} disabled={restore.isPending}>
                <X />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm">
            {preview.isPending ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('backup.dialog.reading')}
              </p>
            ) : preview.isError ? (
              <p role="alert" className="flex items-start gap-2 text-ctp-red">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {appError(preview.error).message}
              </p>
            ) : done ? (
              <RestoreSummary result={done} />
            ) : (
              <div className="flex flex-col gap-4">
                <dl className="grid grid-cols-2 gap-3" data-testid="backup-preview">
                  <Fact label={t('backup.dialog.made')} value={formatRelative(preview.data.createdAt, i18n.language)} />
                  <Fact
                    label={mihon ? t('backup.dialog.madeBy') : t('backup.dialog.version')}
                    value={mihon ? t('backup.dialog.mihonApp') : preview.data.appVersion}
                  />
                  <Fact
                    label={t('backup.dialog.library')}
                    value={t('backup.dialog.manga', { count: preview.data.inLibrary })}
                  />
                  <Fact label={t('backup.dialog.categories')} value={String(preview.data.categories)} />
                  <Fact label={t('backup.dialog.chaptersRead')} value={String(preview.data.chaptersRead)} />
                </dl>
                {preview.data.missingExtensions.length > 0 && (
                  <p className="rounded-lg bg-ctp-yellow/10 px-3 py-2 text-xs">
                    {t('backup.dialog.missing', {
                      names: preview.data.missingExtensions.map((e) => e.name).join(', '),
                    })}
                  </p>
                )}
                {mihon && (
                  <MihonSources
                    sources={mihon.sources}
                    sourceMap={sourceMap}
                    onChange={setChosen}
                    onInstall={(offer) =>
                      setRequest({
                        kind: 'prepare',
                        repoId: offer.repoId,
                        extensionId: offer.extensionId,
                        name: offer.name,
                      })
                    }
                  />
                )}
                {!mihon && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 font-medium">{t('backup.dialog.how')}</legend>
                    {(['merge', 'replace'] as const).map((value) => (
                      <label
                        key={value}
                        className={cn(
                          'flex cursor-pointer gap-3 rounded-lg border p-3',
                          mode === value && 'border-primary bg-primary/5',
                        )}
                      >
                        <input
                          type="radio"
                          name="restore-mode"
                          checked={mode === value}
                          onChange={() => setMode(value)}
                          className="mt-0.5 accent-(--app-accent)"
                        />
                        <span>
                          <span className="block font-medium">{t(`backup.dialog.${value}`)}</span>
                          <span className="text-xs text-muted-foreground">{t(`backup.dialog.${value}Hint`)}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {!mihon && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={withSettings}
                      onChange={(event) => setWithSettings(event.target.checked)}
                      className="accent-(--app-accent)"
                    />
                    {t('backup.dialog.settings')}
                  </label>
                )}
                {!mihon && mode === 'replace' && (
                  <label className="flex items-start gap-2 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs text-ctp-red">
                    <input
                      type="checkbox"
                      checked={sure}
                      onChange={(event) => setSure(event.target.checked)}
                      className="mt-0.5 accent-(--app-accent)"
                    />
                    {t('backup.dialog.replaceSure')}
                  </label>
                )}
                {restore.isPending && (
                  <div className="flex flex-col gap-1.5" role="status">
                    <p className="text-xs text-muted-foreground">
                      {progress?.phase === 'writing' ? t('backup.dialog.safety') : t('backup.dialog.restoring')}
                      {progress && progress.total > 0 && ` ${progress.done} / ${progress.total}`}
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{
                          width: `${progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 5}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {restore.isError && <p className="text-xs text-ctp-red">{appError(restore.error).message}</p>}
              </div>
            )}
          </div>

          <InstallDialog request={request} onClose={() => setRequest(null)} />
          <footer className="flex justify-end gap-2 border-t p-4">
            {done ? (
              <Button onClick={onClose}>{t('common.close')}</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose} disabled={restore.isPending}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant={!mihon && mode === 'replace' ? 'destructive' : 'default'}
                  disabled={
                    !preview.isSuccess ||
                    restore.isPending ||
                    (!mihon && mode === 'replace' && !sure) ||
                    (mihon !== null && !Object.values(sourceMap).some(Boolean))
                  }
                  onClick={() => restore.mutate()}
                >
                  {restore.isPending && <Loader2 className="animate-spin" />}
                  {mihon
                    ? t('backup.dialog.importAction')
                    : mode === 'replace'
                      ? t('backup.dialog.replaceAction')
                      : t('backup.dialog.mergeAction')}
                </Button>
              </>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A Mihon backup's sources: where each one goes (matched by itself, or picked here). */
function MihonSources({
  sources,
  sourceMap,
  onChange,
  onInstall,
}: {
  sources: NonNullable<BackupPreview['mihon']>['sources'];
  sourceMap: Record<string, string>;
  onChange: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  onInstall: (offer: NonNullable<NonNullable<BackupPreview['mihon']>['sources'][number]['offer']>) => void;
}) {
  const { t } = useTranslation();
  const { data: all = [] } = useQuery(sourcesQuery);
  const installed = all.filter((source) => source.installed).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <fieldset className="flex flex-col gap-2" data-testid="mihon-sources">
      <legend className="mb-1 font-medium">{t('backup.dialog.mihonSources')}</legend>
      <p className="text-xs text-muted-foreground">{t('backup.dialog.mihonHint')}</p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {sources.map((source) => {
          const label = source.name ?? t('backup.dialog.unknownSource');
          return (
            <li key={source.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {t('backup.dialog.manga', { count: source.manga })}
                </span>
              </span>
              {!sourceMap[source.id] && (
                <span className="flex shrink-0 items-center">
                  {source.offer ? (
                    <Button size="sm" variant="secondary" onClick={() => onInstall(source.offer!)}>
                      <Puzzle />
                      {t('backup.dialog.installOffer', { name: source.offer.name })}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('backup.summary.notOffered')}</span>
                  )}
                </span>
              )}
              <select
                aria-label={label}
                value={sourceMap[source.id] ?? ''}
                onChange={(event) => onChange((previous) => ({ ...previous, [source.id]: event.target.value }))}
                className="h-8 w-48 shrink-0 rounded-md border bg-background px-2 text-xs"
              >
                <option value="">{t('backup.dialog.skip')}</option>
                {installed.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.lang})
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function RestoreSummary({ result }: { result: RestoreResult }) {
  const { t } = useTranslation();
  const { data: available = [] } = useQuery(availableExtensionsQuery);
  const [request, setRequest] = useState<InstallRequest | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="restore-summary">
      <p className="flex items-center gap-2 font-medium text-ctp-green">
        <Check className="size-4" />
        {t('backup.summary.done')}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        <li>{t('backup.summary.manga', { added: result.manga.added, updated: result.manga.updated })}</li>
        <li>{t('backup.summary.chapters', { added: result.chapters.added, updated: result.chapters.updated })}</li>
        {result.categories > 0 && <li>{t('backup.summary.categories', { count: result.categories })}</li>}
        {result.downloads > 0 && <li>{t('backup.summary.downloads', { count: result.downloads })}</li>}
        {result.covers > 0 && <li>{t('backup.summary.covers', { count: result.covers })}</li>}
        {result.repos > 0 && <li>{t('backup.summary.repos', { count: result.repos })}</li>}
        {result.settings && <li>{t('backup.summary.settings')}</li>}
      </ul>
      {result.safetyBackup && (
        <p className="text-xs text-muted-foreground">{t('backup.summary.safety', { path: result.safetyBackup })}</p>
      )}
      {result.failed.length > 0 && (
        <div className="rounded-lg bg-ctp-red/10 px-3 py-2 text-xs">
          <p className="mb-1 font-medium text-ctp-red">{t('backup.summary.failed', { count: result.failed.length })}</p>
          <ul>
            {result.failed.map((failure) => (
              <li key={failure.title}>
                {failure.title}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.unmatched.length > 0 && (
        <div className="rounded-lg bg-ctp-yellow/10 px-3 py-2 text-xs" data-testid="restore-unmatched">
          <p className="mb-1 font-medium">
            {t('backup.summary.unmatched', { count: result.unmatched.reduce((sum, u) => sum + u.manga, 0) })}
          </p>
          <ul>
            {result.unmatched.map((source, index) => (
              <li key={source.name ?? index}>
                {source.name ?? t('backup.dialog.unknownSource')}: {t('backup.dialog.manga', { count: source.manga })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.missingExtensions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t('backup.summary.missingTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('backup.summary.missingHint')}</p>
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="restore-missing">
            {result.missingExtensions.map((missing) => {
              const offer = available.find((a) => a.id === missing.id);
              return (
                <li key={missing.id} className="flex items-center gap-3 px-3 py-2">
                  <Puzzle className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{missing.name}</span>
                  {offer?.installedVersion ? (
                    <span className="flex items-center gap-1 text-xs text-ctp-green">
                      <Check className="size-3.5" />
                      {t('onboarding.sources.installed')}
                    </span>
                  ) : offer ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        setRequest({ kind: 'prepare', repoId: offer.repoId, extensionId: offer.id, name: offer.name })
                      }
                    >
                      {t('onboarding.sources.install')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('backup.summary.notOffered')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <InstallDialog request={request} onClose={() => setRequest(null)} />
    </div>
  );
}
