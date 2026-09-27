import { useEffect } from 'react';
import { useUiStore } from '../stores/ui';
import { ipc, useIpcEvent } from './ipc';

/** Mounted once at the root: main says whether the app is online (BRAINSTORM.md §6.5). */
export function useOnlineSync(): void {
  const setOnline = useUiStore((state) => state.setOnline);
  useEffect(() => {
    void ipc.invoke('app.isOnline').then(setOnline);
  }, [setOnline]);
  useIpcEvent('app.online', setOnline);
}
