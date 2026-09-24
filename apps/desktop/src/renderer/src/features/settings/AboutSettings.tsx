import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appInfoQuery } from '../../lib/ipc';

export function AboutSettings() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  if (!info) return null;
  return (
    <section className="flex items-center gap-4 rounded-xl border bg-card/40 p-5">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <BookOpen className="size-6" />
      </div>
      <div>
        <p className="font-semibold">
          {t('app.name')}{' '}
          <span lang="ja" className="font-normal text-muted-foreground">
            {t('app.nameNative')}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{t('settings.about.version', { version: info.version })}</p>
        <p className="text-xs text-muted-foreground">{t('settings.about.runtime', info)}</p>
      </div>
    </section>
  );
}
