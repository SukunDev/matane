import { type AppErrorData, decodeIpcError } from '@manga-reader/shared/errors';
import { useTranslation } from 'react-i18next';

export type { AppErrorData };

/** Typed error from a rejected IPC call (codes survive the hop, see shared/errors). */
export function appError(error: unknown): AppErrorData {
  return decodeIpcError(error);
}

/** Short, translated headline for an error plus the raw detail for the curious. */
export function useErrorText(error: unknown): { code: AppErrorData['code']; title: string; detail: string } {
  const { t } = useTranslation();
  const data = appError(error);
  const title =
    data.code === 'http' && data.status !== undefined
      ? t('errors.httpStatus', { status: data.status })
      : t(`errors.${data.code}`);
  return { code: data.code, title, detail: data.message };
}
