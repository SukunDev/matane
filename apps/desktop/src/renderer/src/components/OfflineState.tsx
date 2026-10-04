import { WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../stores/ui';
import { EmptyState } from './EmptyState';

/**
 * Pages that need the network (Browse, Global search) show this while offline instead of an error
 * (docs/BRAINSTORM.md §6.5); what is on disk (library, history, downloads) keeps working.
 */
export function OnlineOnly({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const online = useUiStore((state) => state.online);
  if (online) return children;
  return <EmptyState icon={WifiOff} title={t('offline.title')} description={t('offline.description')} />;
}
