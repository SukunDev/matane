import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc, useIpcEvent, windowMaximizedQuery } from '../../lib/ipc';
import { cn } from '../../lib/utils';

const controlClass = 'no-drag flex h-full w-11 items-center justify-center text-muted-foreground transition-colors';

/** Minimize / maximize / close for the frameless window on Windows and Linux. */
export function WindowControls() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: maximized = false } = useQuery(windowMaximizedQuery);
  useIpcEvent(
    'window.maximizeChanged',
    useCallback((value: boolean) => queryClient.setQueryData(windowMaximizedQuery.queryKey, value), [queryClient]),
  );

  return (
    <div className="flex h-full">
      <button
        type="button"
        className={cn(controlClass, 'hover:bg-accent')}
        title={t('titlebar.minimize')}
        onClick={() => void ipc.invoke('window.minimize')}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        className={cn(controlClass, 'hover:bg-accent')}
        title={t(maximized ? 'titlebar.restore' : 'titlebar.maximize')}
        onClick={() => void ipc.invoke('window.toggleMaximize')}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        type="button"
        className={cn(controlClass, 'hover:bg-ctp-red hover:text-ctp-crust')}
        title={t('titlebar.close')}
        onClick={() => void ipc.invoke('window.close')}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
