import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccentPicker, LanguagePicker, ThemePicker } from './appearance';
import { DiscordSettings } from './DiscordSettings';
import { SystemSettings } from './SystemSettings';

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function GeneralSettings() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.appearance')}</h2>
        <div className="divide-y">
          <SettingRow label={t('settings.theme.label')} description={t('settings.theme.description')}>
            <ThemePicker />
          </SettingRow>
          <SettingRow label={t('settings.accent.label')} description={t('settings.accent.description')}>
            <AccentPicker />
          </SettingRow>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <SettingRow label={t('settings.language.label')} description={t('settings.language.description')}>
          <LanguagePicker />
        </SettingRow>
      </section>

      <SystemSettings />
      <DiscordSettings />
    </div>
  );
}
