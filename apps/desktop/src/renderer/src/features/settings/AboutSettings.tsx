import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import logoMark from '../../assets/logo-mark.png';
import { appInfoQuery } from '../../lib/ipc';

export function AboutSettings() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  if (!info) return null;
  return (
    <section className="flex items-center gap-4 rounded-xl border bg-card/40 p-5">
      <img src={logoMark} alt="" className="size-12" />
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
