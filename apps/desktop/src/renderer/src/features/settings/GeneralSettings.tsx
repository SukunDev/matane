import type { AppSettings } from '@manga-reader/shared';
import { ACCENTS, LANGUAGES, THEME_MODES } from '@manga-reader/shared/theme';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { cn } from '../../lib/utils';

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

/** Renders a mini preview in the given flavor by scoping Catppuccin variables with its class. */
function ThemePreview({ mode }: { mode: AppSettings['theme'] }) {
  const swatch = (flavor: string) => (
    <span className={cn(flavor, 'flex flex-1 items-end gap-1 bg-ctp-base p-1.5')}>
      <span className="h-5 w-3 rounded-sm bg-ctp-mantle" />
      <span className="h-2 flex-1 rounded-sm bg-ctp-surface0" />
      <span className="size-2 rounded-full bg-ctp-mauve" />
    </span>
  );
  return (
    <span className="flex h-12 overflow-hidden rounded-md border">
      {mode === 'system' ? (
        <>
          {swatch('latte')}
          {swatch('mocha')}
        </>
      ) : (
        swatch(mode === 'amoled' ? 'mocha amoled' : mode)
      )}
    </span>
  );
}

export function GeneralSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.appearance')}</h2>
        <div className="divide-y">
          <SettingRow label={t('settings.theme.label')} description={t('settings.theme.description')}>
            <div
              role="radiogroup"
              aria-label={t('settings.theme.label')}
              className="grid grid-cols-3 gap-3 lg:grid-cols-6"
            >
              {THEME_MODES.map((mode) => {
                const selected = settings.theme === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => update.mutate({ theme: mode })}
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:border-input',
                      selected && 'border-primary ring-1 ring-primary',
                    )}
                  >
                    <ThemePreview mode={mode} />
                    <span className={cn(selected && 'font-semibold text-primary')}>{t(`settings.theme.${mode}`)}</span>
                  </button>
                );
              })}
            </div>
          </SettingRow>

          <SettingRow label={t('settings.accent.label')} description={t('settings.accent.description')}>
            <div role="radiogroup" aria-label={t('settings.accent.label')} className="flex flex-wrap gap-2.5">
              {ACCENTS.map((accent) => {
                const selected = settings.accent === accent;
                return (
                  <button
                    key={accent}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(`settings.accent.${accent}`)}
                    title={t(`settings.accent.${accent}`)}
                    onClick={() => update.mutate({ accent })}
                    style={{ backgroundColor: `var(--catppuccin-color-${accent})` }}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full text-ctp-crust transition-transform hover:scale-110',
                      selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                    )}
                  >
                    {selected && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <SettingRow label={t('settings.language.label')} description={t('settings.language.description')}>
          <div
            role="radiogroup"
            aria-label={t('settings.language.label')}
            className="inline-flex w-fit rounded-lg border p-1"
          >
            {[null, ...LANGUAGES].map((language) => {
              const selected = settings.language === language;
              return (
                <button
                  key={language ?? 'system'}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update.mutate({ language })}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs transition-colors',
                    selected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`settings.language.${language ?? 'system'}`)}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </section>
    </div>
  );
}
