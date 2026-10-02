import type { AppSettings } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bug, Check, ClipboardCopy, FileText, FolderOpen, FolderX, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { extensionsQuery } from '../../lib/sources';
import { useLoadDevFolder } from '../extensions/ExtensionsPage';
import { Row, Segmented } from './controls';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const satisfies readonly AppSettings['advanced']['logLevel'][];

export function AdvancedSettings() {
  return (
    <div className="flex flex-col gap-6">
      <DiagnosticsCard />
      <DevExtensionsCard />
    </div>
  );
}

/** Logs, crash dumps and the debug info for a bug report (BRAINSTORM.md §10). */
function DiagnosticsCard() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const openPath = useMutation({ mutationFn: (which: 'logs' | 'crashes') => ipc.invoke('app.openPath', { which }) });
  const copy = useMutation({ mutationFn: () => ipc.invoke('app.copyDebugInfo') });
  if (!settings) return null;

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="mb-4 text-sm font-semibold">{t('settings.advanced.diagnostics')}</h2>
      <div className="divide-y">
        <Row label={t('settings.advanced.logLevel')} description={t('settings.advanced.logLevelHint')}>
          <Segmented
            label={t('settings.advanced.logLevel')}
            options={LOG_LEVELS}
            value={settings.advanced.logLevel}
            onChange={(logLevel) => update.mutate({ advanced: { ...settings.advanced, logLevel } })}
            format={(level) => t(`settings.advanced.logLevels.${level}`)}
          />
        </Row>
        <Row label={t('settings.advanced.files')} description={t('settings.advanced.filesHint')}>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => openPath.mutate('logs')}>
              <FileText />
              {t('settings.advanced.openLogs')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openPath.mutate('crashes')}>
              <Bug />
              {t('settings.advanced.openCrashes')}
            </Button>
          </div>
        </Row>
        <Row label={t('settings.advanced.debugInfo')} description={t('settings.advanced.debugInfoHint')}>
          <Button variant="secondary" size="sm" onClick={() => copy.mutate()} disabled={copy.isPending}>
            {copy.isSuccess ? <Check /> : <ClipboardCopy />}
            {copy.isSuccess ? t('settings.advanced.copied') : t('settings.advanced.copy')}
          </Button>
        </Row>
      </div>
    </section>
  );
}

/** Developer tools: extensions loaded from folders (hot-reloaded when `mr-ext build` rewrites them). */
function DevExtensionsCard() {
  const { t } = useTranslation();
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const devExtensions = extensions.filter((e) => e.origin === 'dev');
  const loadFolder = useLoadDevFolder();
  const reloadAll = useMutation({ mutationFn: () => ipc.invoke('extensions.reload') });
  const remove = useMutation({ mutationFn: (path: string) => ipc.invoke('extensions.removeDevFolder', { path }) });

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="text-sm font-semibold">{t('settings.advanced.devTitle')}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('settings.advanced.devDescription')}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {devExtensions.length === 0 && <li className="text-muted-foreground">{t('settings.advanced.noFolders')}</li>}
        {devExtensions.map((extension) => (
          <li key={extension.path} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {extension.name}{' '}
                <span className="font-mono text-xs text-muted-foreground">
                  {t('extensions.version', { version: extension.version })}
                </span>
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={extension.path}>
                {extension.path}
              </p>
              {extension.error && <p className="text-xs text-ctp-red">{extension.error}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              title={t('extensions.removeFolder')}
              onClick={() => remove.mutate(extension.path)}
            >
              <FolderX />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => loadFolder.mutate()} disabled={loadFolder.isPending}>
          <FolderOpen />
          {t('extensions.loadFolder')}
        </Button>
        <Button variant="secondary" onClick={() => reloadAll.mutate()} disabled={reloadAll.isPending}>
          <RotateCw />
          {t('extensions.reloadAll')}
        </Button>
      </div>
    </section>
  );
}
