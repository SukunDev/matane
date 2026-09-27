import type { GeneralSettings } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { appInfoQuery, ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { Row, Toggle } from './controls';

/** Settings → General: tray and start at login (BRAINSTORM.md §6.4). */
export function SystemSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: info } = useQuery(appInfoQuery);
  const { data: tray } = useQuery({ queryKey: ['app', 'tray'], queryFn: () => ipc.invoke('app.tray') });
  const update = useUpdateSettings();
  const ids = { tray: useId(), login: useId(), hidden: useId() };
  if (!settings) return null;
  const general = settings.general;
  const set = (patch: Partial<GeneralSettings>) => update.mutate({ general: { ...general, ...patch } });
  const trayAvailable = tray?.available ?? true;
  // macOS always opens the window at login.
  const canStartHidden = trayAvailable && general.closeToTray && general.openAtLogin && info?.platform !== 'darwin';

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="mb-4 text-sm font-semibold">{t('settings.system.title')}</h2>
      <div className="divide-y">
        <Row
          htmlFor={ids.tray}
          label={t('settings.system.closeToTray')}
          description={trayAvailable ? t('settings.system.closeToTrayHint') : t('settings.system.noTray')}
        >
          <Toggle
            id={ids.tray}
            checked={general.closeToTray && trayAvailable}
            disabled={!trayAvailable}
            onChange={(closeToTray) => set({ closeToTray })}
          />
        </Row>
        <Row
          htmlFor={ids.login}
          label={t('settings.system.openAtLogin')}
          description={t('settings.system.openAtLoginHint')}
        >
          <Toggle id={ids.login} checked={general.openAtLogin} onChange={(openAtLogin) => set({ openAtLogin })} />
        </Row>
        <Row
          htmlFor={ids.hidden}
          label={t('settings.system.startHidden')}
          description={t('settings.system.startHiddenHint')}
        >
          <Toggle
            id={ids.hidden}
            checked={general.startHidden && canStartHidden}
            disabled={!canStartHidden}
            onChange={(startHidden) => set({ startHidden })}
          />
        </Row>
      </div>
    </section>
  );
}
