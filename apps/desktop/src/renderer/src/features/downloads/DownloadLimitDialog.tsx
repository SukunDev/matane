import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { downloadStatsQuery, useLimitConfirm } from '../../lib/downloads';
import { formatBytes } from '../../lib/format';
import { ipc, settingsQuery } from '../../lib/ipc';

/** "The download size limit is reached — download anyway?" (asked by `useEnqueueDownloads`). */
export function DownloadLimitDialog() {
  const { t, i18n } = useTranslation();
  const pending = useLimitConfirm((state) => state.pending);
  const close = useLimitConfirm((state) => state.close);
  const { data: settings } = useQuery(settingsQuery);
  const { data: stats } = useQuery(downloadStatsQuery);
  const limitGb = settings?.downloads.limitGb ?? 0;

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && close()}
      title={t('downloads.limit.confirmTitle')}
      description={t('downloads.limit.confirmDescription', {
        used: formatBytes(stats?.totalBytes ?? 0, i18n.language),
        limit: formatBytes(limitGb * 1024 ** 3, i18n.language),
        count: pending?.chapterIds.length ?? 0,
      })}
      confirmLabel={t('downloads.limit.confirm')}
      destructive={false}
      onConfirm={() => {
        if (!pending) return;
        void ipc.invoke('downloads.enqueue', { chapterIds: pending.chapterIds }).then(() => pending.onQueued?.());
        close();
      }}
    />
  );
}
