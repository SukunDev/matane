import '@fontsource-variable/inter';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import log from 'electron-log/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n, resolveLanguage } from './i18n';
import { ipc, osLocaleQuery, settingsQuery } from './lib/ipc';
import { queryClient, router } from './router';
import { applyTheme } from './theme/apply-theme';

window.addEventListener('error', (event) => log.error('Renderer error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => log.error('Unhandled rejection', event.reason));

async function start(): Promise<void> {
  const [settings, osLocale] = await Promise.all([ipc.invoke('settings.get'), ipc.invoke('app.getLocale')]);
  // Apply theme and language before the first paint to avoid a flash of the wrong theme.
  applyTheme(settings, document.documentElement, window.matchMedia('(prefers-color-scheme: dark)').matches);
  await initI18n(resolveLanguage(settings.language, osLocale));
  queryClient.setQueryData(settingsQuery.queryKey, settings);
  queryClient.setQueryData(osLocaleQuery.queryKey, osLocale);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
