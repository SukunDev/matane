import { useMutation, useQuery } from '@tanstack/react-query';
import { FolderOpen, FolderX, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ipc } from '../../lib/ipc';
import { extensionsQuery } from '../../lib/sources';
import { useLoadDevFolder } from '../extensions/ExtensionsPage';

/** Developer tools: extensions loaded from folders (hot-reloaded when `mr-ext build` rewrites them). */
export function AdvancedSettings() {
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
