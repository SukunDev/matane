import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { appInfoQuery, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { Row, Toggle } from './controls';

/** Discord Rich Presence (BRAINSTORM.md §6.6); hidden until the app has a Discord application id. */
export function DiscordSettings() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const ids = { enabled: useId(), hide: useId() };
  if (!info?.discord || !settings) return null;
  const general = settings.general;
  const discord = general.discord;
  const set = (patch: Partial<typeof discord>) =>
    update.mutate({ general: { ...general, discord: { ...discord, ...patch } } });

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="mb-4 text-sm font-semibold">{t('settings.discord.title')}</h2>
      <div className="divide-y">
        <Row
          htmlFor={ids.enabled}
          label={t('settings.discord.enabled')}
          description={t('settings.discord.enabledHint')}
        >
          <Toggle id={ids.enabled} checked={discord.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row
          htmlFor={ids.hide}
          label={t('settings.discord.hideTitle')}
          description={t('settings.discord.hideTitleHint')}
        >
          <Toggle
            id={ids.hide}
            checked={discord.hideTitle}
            disabled={!discord.enabled}
            onChange={(hideTitle) => set({ hideTitle })}
          />
        </Row>
      </div>
    </section>
  );
}
