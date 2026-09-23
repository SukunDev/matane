import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { settingsQuery } from '../lib/ipc';
import { applyTheme } from './apply-theme';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Keeps <html> classes in sync with the stored theme and, for "system", the OS preference. */
export function ThemeSync(): null {
  const { data: settings } = useQuery(settingsQuery);

  useEffect(() => {
    if (!settings) return;
    const apply = (): void => applyTheme(settings, document.documentElement, darkQuery.matches);
    apply();
    darkQuery.addEventListener('change', apply);
    return () => darkQuery.removeEventListener('change', apply);
  }, [settings]);

  return null;
}
