import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { resources } from '../i18n';
import { EmptyState } from './EmptyState';

type EmptyKey = keyof (typeof resources)['en']['translation']['empty'];

/** Phase 0 pages: shell + empty state until the real feature lands. */
export function PlaceholderPage({
  titleKey,
  emptyKey,
  icon,
}: {
  titleKey: EmptyKey;
  emptyKey: EmptyKey;
  icon: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-6">
        <h1 className="text-xl font-semibold">{t(`nav.${titleKey}`)}</h1>
      </header>
      <EmptyState icon={icon} title={t(`empty.${emptyKey}.title`)} description={t(`empty.${emptyKey}.description`)} />
    </div>
  );
}
