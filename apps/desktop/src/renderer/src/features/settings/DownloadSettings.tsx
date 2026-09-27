import type { DownloadMoveProgress, DownloadSettings as Settings } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FolderOpen, FolderPen } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { downloadFolderQuery, downloadStatsQuery } from '../../lib/downloads';
import { appError } from '../../lib/errors';
import { formatBytes } from '../../lib/format';
import { ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { cn } from '../../lib/utils';
import { Row, Segmented, Toggle } from './controls';

const PARALLEL = [1, 2, 3, 4] as const;
const AHEAD = [0, 1, 2, 3, 5, 10] as const;
const DELAYS = [0, 1, 2, 3] as const;
const LIMITS_GB = [5, 10, 20, 50, 100, 200, 500] as const;

/** Settings → Downloads (BRAINSTORM.md §6.4, §6.6). */
export function DownloadSettings() {
  const { t, i18n } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const ids = { resume: useId(), deleteAfter: useId(), keepBookmarked: useId(), limit: useId() };
  if (!settings) return null;
  const downloads = settings.downloads;
  const set = (patch: Partial<Settings>) => update.mutate({ downloads: { ...downloads, ...patch } });
  const rule = downloads.deleteAfterRead;
  const setRule = (patch: Partial<Settings['deleteAfterRead']>) => set({ deleteAfterRead: { ...rule, ...patch } });
  const limitOptions = [...new Set([...LIMITS_GB, ...(downloads.limitGb === null ? [] : [downloads.limitGb])])].sort(
    (a, b) => a - b,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.downloads.storage')}</h2>
        <div className="divide-y">
          <FolderRow folder={downloads.folder} />
          <Row label={t('settings.downloads.format')} description={t('settings.downloads.formatHint')}>
            <Segmented
              label={t('settings.downloads.format')}
              options={['cbz', 'folder'] as const}
              value={downloads.format}
              onChange={(format) => set({ format })}
              format={(value) => t(`settings.downloads.formats.${value}`)}
            />
          </Row>
          <Row
            htmlFor={ids.limit}
            label={t('settings.downloads.limit')}
            description={t('settings.downloads.limitHint')}
          >
            <select
              id={ids.limit}
              value={downloads.limitGb ?? ''}
              onChange={(event) => set({ limitGb: event.target.value ? Number(event.target.value) : null })}
              className="h-9 rounded-lg border border-input bg-background px-2.5"
            >
              <option value="">{t('settings.downloads.noLimit')}</option>
              {limitOptions.map((gb) => (
                <option key={gb} value={gb}>
                  {formatBytes(gb * 1024 ** 3, i18n.language)}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.downloads.queue')}</h2>
        <div className="divide-y">
          <Row label={t('settings.downloads.parallel')} description={t('settings.downloads.parallelHint')}>
            <Segmented
              label={t('settings.downloads.parallel')}
              options={PARALLEL}
              value={downloads.parallel}
              onChange={(parallel) => set({ parallel })}
              format={String}
            />
          </Row>
          <Row
            htmlFor={ids.resume}
            label={t('settings.downloads.resumeOnStart')}
            description={t('settings.downloads.resumeOnStartHint')}
          >
            <Toggle
              id={ids.resume}
              checked={downloads.resumeOnStart}
              onChange={(resumeOnStart) => set({ resumeOnStart })}
            />
          </Row>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.downloads.automatic')}</h2>
        <div className="divide-y">
          <Row label={t('settings.downloads.ahead')} description={t('settings.downloads.aheadHint')}>
            <Segmented
              label={t('settings.downloads.ahead')}
              options={AHEAD}
              value={downloads.ahead}
              onChange={(ahead) => set({ ahead })}
              format={(value) => (value === 0 ? t('common.off') : String(value))}
            />
          </Row>
          <Row
            htmlFor={ids.deleteAfter}
            label={t('settings.downloads.deleteAfterRead')}
            description={t('settings.downloads.deleteAfterReadHint')}
          >
            <Toggle id={ids.deleteAfter} checked={rule.enabled} onChange={(enabled) => setRule({ enabled })} />
          </Row>
          {rule.enabled && (
            <div className="flex flex-col py-4 pl-4">
              <Row stacked label={t('settings.downloads.delay')} description={t('settings.downloads.delayHint')}>
                <Segmented
                  label={t('settings.downloads.delay')}
                  options={DELAYS}
                  value={rule.delay}
                  onChange={(delay) => setRule({ delay })}
                  format={(value) =>
                    value === 0
                      ? t('settings.downloads.delayNone')
                      : t('settings.downloads.delayAfter', { count: value })
                  }
                />
              </Row>
              <Row htmlFor={ids.keepBookmarked} label={t('settings.downloads.keepBookmarked')}>
                <Toggle
                  id={ids.keepBookmarked}
                  checked={rule.keepBookmarked}
                  onChange={(keepBookmarked) => setRule({ keepBookmarked })}
                />
              </Row>
              <div>
                <p className="font-medium">{t('settings.downloads.excludeCategories')}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t('settings.downloads.excludeCategoriesHint')}</p>
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('library.categories.none')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {categories.map((category) => {
                      const excluded = rule.excludeCategoryIds.includes(category.id);
                      return (
                        <label
                          key={category.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
                            excluded && 'border-primary bg-primary/10 text-primary',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-(--primary)"
                            checked={excluded}
                            onChange={() =>
                              setRule({
                                excludeCategoryIds: excluded
                                  ? rule.excludeCategoryIds.filter((id) => id !== category.id)
                                  : [...rule.excludeCategoryIds, category.id],
                              })
                            }
                          />
                          {category.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type MoveState =
  | { step: 'ask'; folder: string }
  | { step: 'moving'; folder: string; progress: DownloadMoveProgress | null }
  | { step: 'failed'; folder: string; error: string };

/** The folder, "Change…" (offering to move what is there) and "Open". */
function FolderRow({ folder: setting }: { folder: string | null }) {
  const { t, i18n } = useTranslation();
  const { data: folder } = useQuery(downloadFolderQuery(setting));
  const { data: stats } = useQuery(downloadStatsQuery);
  const [move, setMove] = useState<MoveState | null>(null);
  const hasDownloads = (stats?.done ?? 0) + (stats?.paused ?? 0) + (stats?.queued ?? 0) + (stats?.error ?? 0) > 0;

  const open = useMutation({ mutationFn: () => ipc.invoke('downloads.openFolder') });
  const apply = useMutation({
    mutationFn: ({ target, moveFiles }: { target: string; moveFiles: boolean }) => {
      if (moveFiles) setMove({ step: 'moving', folder: target, progress: null });
      return ipc.invoke('downloads.setFolder', { folder: target, move: moveFiles });
    },
    onSuccess: () => setMove(null),
    onError: (error, { target }) => setMove({ step: 'failed', folder: target, error: appError(error).message }),
  });
  const pick = useMutation({
    mutationFn: () => ipc.invoke('downloads.pickFolder'),
    onSuccess: (target) => {
      if (!target || target === folder) return;
      if (hasDownloads) setMove({ step: 'ask', folder: target });
      else apply.mutate({ target, moveFiles: false });
    },
  });
  useIpcEvent(
    'downloads.moveProgress',
    useCallback(
      (progress: DownloadMoveProgress) =>
        setMove((current) => (current?.step === 'moving' ? { ...current, progress } : current)),
      [],
    ),
  );

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0">
      <div>
        <p className="font-medium">{t('settings.downloads.folder')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.downloads.folderHint')}</p>
      </div>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 text-xs"
          title={folder}
          data-testid="download-folder"
        >
          {folder}
        </code>
        <Button variant="secondary" onClick={() => pick.mutate()} disabled={pick.isPending || apply.isPending}>
          <FolderPen />
          {t('settings.downloads.change')}
        </Button>
        <Button variant="ghost" size="icon" title={t('downloads.page.openFolder')} onClick={() => open.mutate()}>
          <FolderOpen />
        </Button>
      </div>
      {stats && (
        <p className="text-xs text-muted-foreground">
          {t('settings.downloads.usage', {
            count: stats.done,
            size: formatBytes(stats.totalBytes, i18n.language),
          })}
        </p>
      )}

      <Dialog.Root open={move !== null} onOpenChange={(value) => !value && move?.step !== 'moving' && setMove(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
          <Dialog.Content
            onEscapeKeyDown={(event) => move?.step === 'moving' && event.preventDefault()}
            onInteractOutside={(event) => move?.step === 'moving' && event.preventDefault()}
            className="fixed top-1/2 left-1/2 z-50 flex w-[min(30rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border bg-popover p-5 shadow-2xl"
          >
            <Dialog.Title className="text-base font-semibold">
              {move?.step === 'failed' ? t('settings.downloads.moveFailed') : t('settings.downloads.moveTitle')}
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground">
              {move?.step === 'failed'
                ? move.error
                : t('settings.downloads.moveDescription', {
                    count: stats?.done ?? 0,
                    size: formatBytes(stats?.totalBytes ?? 0, i18n.language),
                  })}
            </Dialog.Description>
            {move && <code className="truncate rounded-lg border bg-background px-3 py-2 text-xs">{move.folder}</code>}
            {move?.step === 'moving' && (
              <div className="flex flex-col gap-1.5" role="status">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{
                      width: `${move.progress?.total ? Math.round((move.progress.done / move.progress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settings.downloads.moving', { done: move.progress?.done ?? 0, total: move.progress?.total ?? 0 })}
                </p>
              </div>
            )}
            {move && move.step !== 'moving' && (
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="ghost">{t('common.cancel')}</Button>
                </Dialog.Close>
                {move.step === 'ask' && (
                  <Button variant="secondary" onClick={() => apply.mutate({ target: move.folder, moveFiles: false })}>
                    {t('settings.downloads.dontMove')}
                  </Button>
                )}
                <Button onClick={() => apply.mutate({ target: move.folder, moveFiles: true })}>
                  {move.step === 'failed' ? t('common.retry') : t('settings.downloads.moveFiles')}
                </Button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
