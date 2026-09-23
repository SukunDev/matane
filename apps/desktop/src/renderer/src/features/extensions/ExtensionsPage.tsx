import type { ExtensionEntry } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, FolderOpen, FolderX, Puzzle, RotateCw, Settings2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useErrorText } from '../../lib/errors';
import { ipc } from '../../lib/ipc';
import { extensionsQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { SourceIcon } from '../browse/SourceIcon';
import { PreferencesDialog } from './PreferencesDialog';

export function useLoadDevFolder() {
  return useMutation({ mutationFn: () => ipc.invoke('extensions.loadDevFolder') });
}

export function ExtensionsPage() {
  const { t } = useTranslation();
  const { data: extensions = [], isPending } = useQuery(extensionsQuery);
  const reloadAll = useMutation({ mutationFn: () => ipc.invoke('extensions.reload') });
  const loadFolder = useLoadDevFolder();

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{t('nav.extensions')}</h1>
          <p className="text-xs text-muted-foreground">{t('extensions.subtitle', { count: extensions.length })}</p>
        </div>
        <Button variant="secondary" onClick={() => loadFolder.mutate()} disabled={loadFolder.isPending}>
          <FolderOpen />
          {t('extensions.loadFolder')}
        </Button>
        <Button variant="secondary" onClick={() => reloadAll.mutate()} disabled={reloadAll.isPending}>
          <RotateCw className={cn(reloadAll.isPending && 'animate-spin')} />
          {t('extensions.reloadAll')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadFolder.isError && <InlineError error={loadFolder.error} />}
        {!isPending && extensions.length === 0 ? (
          <EmptyState
            icon={Puzzle}
            title={t('empty.extensions.title')}
            description={t('empty.extensions.description')}
          />
        ) : (
          <ul className="mx-auto flex max-w-5xl flex-col gap-2 p-6">
            {extensions.map((extension) => (
              <ExtensionRow key={`${extension.origin}:${extension.path}`} extension={extension} />
            ))}
            <li className="pt-4 text-center text-xs text-muted-foreground">{t('extensions.reposSoon')}</li>
          </ul>
        )}
      </div>
    </div>
  );
}

function ExtensionRow({ extension }: { extension: ExtensionEntry }) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const reload = useMutation({
    mutationFn: () => ipc.invoke('extensions.reload', { extensionId: extension.id }),
  });
  const remove = useMutation({
    mutationFn: () => ipc.invoke('extensions.removeDevFolder', { path: extension.path }),
  });
  const langs = [...new Set(extension.sourceIds.map((id) => id.split('/')[1]!.toUpperCase()))];
  const broken = extension.error !== null;

  return (
    <li className={cn('rounded-xl border bg-card/40 p-4', broken && 'border-ctp-red/40')}>
      <div className="flex items-center gap-4">
        <SourceIcon id={extension.id} name={extension.name} className="size-11" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{extension.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {t('extensions.version', { version: extension.version })}
            </span>
            {langs.map((lang) => (
              <Badge key={lang}>{lang}</Badge>
            ))}
            {extension.nsfw && <Badge variant="danger">18+</Badge>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            {extension.origin === 'builtin' ? (
              <span className="flex items-center gap-1 text-ctp-green">
                <ShieldCheck className="size-3.5" />
                {t('extensions.builtin')}
              </span>
            ) : (
              <>
                <Badge variant="info">
                  <FolderOpen />
                  {t('extensions.devLoaded')}
                </Badge>
                <span className="truncate font-mono text-muted-foreground" title={extension.path}>
                  {extension.path}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {extension.origin === 'dev' && (
            <Button variant="secondary" size="sm" onClick={() => reload.mutate()} disabled={reload.isPending}>
              <RotateCw className={cn(reload.isPending && 'animate-spin')} />
              {t('extensions.reload')}
            </Button>
          )}
          {!broken && (
            <Button
              variant="ghost"
              size="icon"
              title={t('extensions.preferences.open')}
              onClick={() => setPrefsOpen(true)}
            >
              <Settings2 />
            </Button>
          )}
          {extension.origin === 'dev' && (
            <Button
              variant="ghost"
              size="icon"
              title={t('extensions.removeFolder')}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <FolderX />
            </Button>
          )}
        </div>
      </div>
      {broken && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs text-ctp-red select-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {extension.error}
        </p>
      )}
      {!broken && (
        <PreferencesDialog
          extensionId={extension.id}
          name={extension.name}
          open={prefsOpen}
          onOpenChange={setPrefsOpen}
        />
      )}
    </li>
  );
}

function InlineError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <p className="mx-6 mt-4 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs text-ctp-red">
      {title}: {detail}
    </p>
  );
}
