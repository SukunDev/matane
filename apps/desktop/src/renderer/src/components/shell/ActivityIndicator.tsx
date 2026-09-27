import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadStatsQuery } from '../../lib/downloads';
import { updateStatusQuery } from '../../lib/updates';

/**
 * Title bar: an update check or downloads running (BRAINSTORM.md §6.6); click opens the page. The
 * check wins when both run (it is shorter and says more).
 */
export function ActivityIndicator() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: status } = useQuery(updateStatusQuery);
  const { data: stats } = useQuery(downloadStatsQuery);
  const progress = status?.progress;
  const downloading = stats?.downloading ?? 0;
  if (!progress && downloading === 0) return null;
  const [Icon, label, to] = progress
    ? [RefreshCw, t('titlebar.checking', { done: progress.done, total: progress.total }), '/updates' as const]
    : [Download, t('titlebar.downloading', { count: downloading }), '/downloads' as const];
  return (
    <button
      type="button"
      data-testid="activity"
      onClick={() => void navigate({ to })}
      className="no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-primary hover:bg-accent"
    >
      <Icon className={progress ? 'size-3.5 animate-spin' : 'size-3.5 animate-pulse'} />
      {label}
    </button>
  );
}
