import { UPDATE_INTERVALS, type UpdateSettings as Settings } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { cn } from '../../lib/utils';
import { Row, Segmented, Toggle } from './controls';

const UNREAD_LIMITS = [10, 25, 50, 100] as const;
const AUTO_DOWNLOAD = [null, 'include', 'exclude'] as const;

/** Settings → Library: the update checker and auto-download of new chapters (BRAINSTORM.md §6.4). */
export function UpdateSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const setCategory = useMutation({
    mutationFn: ({ id, value }: { id: number; value: (typeof AUTO_DOWNLOAD)[number] }) =>
      ipc.invoke('categories.setAutoDownload', { id, value }),
  });
  const ids = {
    completed: useId(),
    notStarted: useId(),
    unread: useId(),
    metadata: useId(),
    notify: useId(),
    auto: useId(),
    reading: useId(),
  };
  if (!settings) return null;
  const updates = settings.updates;
  const set = (patch: Partial<Settings>) => update.mutate({ updates: { ...updates, ...patch } });

  return (
    <>
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.updates.title')}</h2>
        <div className="divide-y">
          <Row stacked label={t('settings.updates.interval')} description={t('settings.updates.intervalHint')}>
            <Segmented
              label={t('settings.updates.interval')}
              options={UPDATE_INTERVALS}
              value={updates.intervalHours}
              onChange={(intervalHours) => set({ intervalHours })}
              format={(hours) => t(`settings.updates.intervals.${hours}`)}
            />
          </Row>
          <Row
            htmlFor={ids.completed}
            label={t('settings.updates.skipCompleted')}
            description={t('settings.updates.skipHint')}
          >
            <Toggle
              id={ids.completed}
              checked={updates.skipCompleted}
              onChange={(skipCompleted) => set({ skipCompleted })}
            />
          </Row>
          <Row htmlFor={ids.notStarted} label={t('settings.updates.skipNotStarted')}>
            <Toggle
              id={ids.notStarted}
              checked={updates.skipNotStarted}
              onChange={(skipNotStarted) => set({ skipNotStarted })}
            />
          </Row>
          <Row htmlFor={ids.unread} label={t('settings.updates.skipUnread')}>
            <select
              id={ids.unread}
              value={updates.skipUnreadOver ?? ''}
              onChange={(event) => set({ skipUnreadOver: event.target.value ? Number(event.target.value) : null })}
              className="h-9 rounded-lg border border-input bg-background px-2.5"
            >
              <option value="">{t('common.off')}</option>
              {[...new Set([...UNREAD_LIMITS, ...(updates.skipUnreadOver ? [updates.skipUnreadOver] : [])])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {t('settings.updates.moreThan', { count: n })}
                  </option>
                ))}
            </select>
          </Row>
          <Row
            htmlFor={ids.metadata}
            label={t('settings.updates.metadata')}
            description={t('settings.updates.metadataHint')}
          >
            <Toggle
              id={ids.metadata}
              checked={updates.refreshMetadata}
              onChange={(refreshMetadata) => set({ refreshMetadata })}
            />
          </Row>
          <Row htmlFor={ids.notify} label={t('settings.updates.notify')} description={t('settings.updates.notifyHint')}>
            <Toggle id={ids.notify} checked={updates.notify} onChange={(notify) => set({ notify })} />
          </Row>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.updates.autoDownloadTitle')}</h2>
        <div className="divide-y">
          <Row
            htmlFor={ids.auto}
            label={t('settings.updates.autoDownload')}
            description={t('settings.updates.autoDownloadHint')}
          >
            <Toggle id={ids.auto} checked={updates.autoDownload} onChange={(autoDownload) => set({ autoDownload })} />
          </Row>
          {updates.autoDownload && (
            <>
              <Row htmlFor={ids.reading} label={t('settings.updates.onlyReading')}>
                <Toggle
                  id={ids.reading}
                  checked={updates.autoDownloadOnlyReading}
                  onChange={(autoDownloadOnlyReading) => set({ autoDownloadOnlyReading })}
                />
              </Row>
              <div className="py-4 last:pb-0">
                <p className="font-medium">{t('settings.updates.categories')}</p>
                <p className="mb-3 text-xs text-muted-foreground">{t('settings.updates.categoriesHint')}</p>
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('library.categories.none')}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {categories.map((category) => (
                      <li key={category.id} className="flex items-center justify-between gap-4">
                        <span className="truncate">{category.name}</span>
                        <div
                          role="radiogroup"
                          aria-label={t('settings.updates.categoryRule', { name: category.name })}
                          className="inline-flex rounded-lg border p-1"
                        >
                          {AUTO_DOWNLOAD.map((value) => (
                            <button
                              key={value ?? 'default'}
                              type="button"
                              role="radio"
                              aria-checked={category.autoDownload === value}
                              onClick={() => setCategory.mutate({ id: category.id, value })}
                              className={cn(
                                'rounded-md px-3 py-1 text-xs transition-colors',
                                category.autoDownload === value
                                  ? 'bg-primary font-semibold text-primary-foreground'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {t(`settings.updates.rule.${value ?? 'default'}`)}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
