import type { AvailableExtension, ExtensionEntry, InstallPreview, RepoInfo } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  ChevronDown,
  Download,
  EllipsisVertical,
  FolderOpen,
  FolderX,
  Languages,
  Puzzle,
  RotateCw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SearchField } from '../../components/SearchField';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useErrorText } from '../../lib/errors';
import { availableExtensionsQuery, extensionIconUrl, repoIconUrl, reposQuery } from '../../lib/extensions';
import { languageName } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { extensionsQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { InstallDialog, type InstallRequest } from './InstallDialog';
import { ExtensionIcon, LangBadges, TrustLine } from './parts';
import { PreferencesDialog } from './PreferencesDialog';
import { RepositoriesPanel } from './RepositoriesPanel';

type Tab = 'installed' | 'available' | 'updates';
const TABS: Tab[] = ['installed', 'available', 'updates'];

const menuItem =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4';

export function useLoadDevFolder() {
  return useMutation({ mutationFn: () => ipc.invoke('extensions.loadDevFolder') });
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Extensions (mockup 09): installed ones, what the repositories offer, updates, and the
 * Repositories panel. Installs and updates go through the install dialog (mockup 09b).
 */
export function ExtensionsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const { data: extensions = [], isPending } = useQuery(extensionsQuery);
  const { data: available = [] } = useQuery(availableExtensionsQuery);
  const { data: repos = [] } = useQuery(reposQuery);
  const loadFolder = useLoadDevFolder();
  const reloadAll = useMutation({ mutationFn: () => ipc.invoke('extensions.reload') });
  const [tab, setTab] = useState<Tab>('installed');
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [install, setInstall] = useState<InstallRequest | null>(null);
  const [confirmQueue, setConfirmQueue] = useState<InstallPreview[]>([]);
  const updateAll = useMutation({
    mutationFn: () => ipc.invoke('extensions.updateAll'),
    // Updates that reach new domains are confirmed one by one.
    onSuccess: (result) => setConfirmQueue(result.needsConfirmation),
  });

  const updates = available.filter((a) => a.update);
  const offered = available.filter((a) => !a.installedHere);
  const repoById = useMemo(() => new Map(repos.map((r) => [r.id, r])), [repos]);
  const allLangs = useMemo(
    () => [...new Set([...extensions.flatMap((e) => e.langs), ...available.flatMap((a) => a.langs)])].sort(),
    [extensions, available],
  );
  const matches = (item: { id: string; name: string; langs: string[] }) =>
    (!query || `${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase())) &&
    (langs.length === 0 || item.langs.some((l) => langs.includes(l)));
  const counts: Record<Tab, number> = {
    installed: extensions.length,
    available: offered.length,
    updates: updates.length,
  };

  const current = confirmQueue[0];
  const dialogRequest: InstallRequest | null = install ?? (current ? { kind: 'preview', preview: current } : null);
  const closeDialog = useCallback(() => {
    if (install) setInstall(null);
    else setConfirmQueue((queue) => queue.slice(1));
  }, [install]);

  const startInstall = (item: AvailableExtension) =>
    setInstall({ kind: 'prepare', repoId: item.repoId, extensionId: item.id, name: item.name, update: item.update });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-8 pt-6 pb-4">
          <h1 className="text-2xl font-semibold">{t('nav.extensions')}</h1>
          {updates.length > 0 && (
            <Badge variant="primary" className="rounded-full px-2.5 py-1">
              {t('extensions.updatesAvailable', { count: updates.length })}
            </Badge>
          )}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => loadFolder.mutate()} disabled={loadFolder.isPending}>
            <FolderOpen />
            {t('extensions.loadFolder')}
          </Button>
          <Button variant="secondary" onClick={() => setPanelOpen((open) => !open)} aria-pressed={panelOpen}>
            <Server />
            {t('extensions.repos.title')}
          </Button>
          {updates.length > 0 && (
            <Button onClick={() => updateAll.mutate()} disabled={updateAll.isPending}>
              <ArrowUpCircle className={cn(updateAll.isPending && 'animate-pulse')} />
              {t('extensions.updateAll')}
            </Button>
          )}
        </header>

        <div className="mx-8 flex items-end gap-6 border-b" role="tablist" aria-label={t('nav.extensions')}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                tab === key && 'border-primary font-semibold text-foreground',
              )}
            >
              {t(`extensions.tabs.${key}`)}
              <span
                className={cn(
                  'rounded-md bg-muted px-1.5 text-[11px] font-semibold',
                  key === 'updates' && counts.updates > 0 && 'bg-primary/20 text-primary',
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card/40 p-3">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={t('extensions.search')}
              className="min-w-48 flex-1"
            />
            <LanguageFilter all={allLangs} selected={langs} onChange={setLangs} />
            {tab === 'installed' && (
              <Button variant="ghost" size="sm" onClick={() => reloadAll.mutate()} disabled={reloadAll.isPending}>
                <RotateCw className={cn(reloadAll.isPending && 'animate-spin')} />
                {t('extensions.reloadAll')}
              </Button>
            )}
          </div>
          {loadFolder.isError && <InlineError error={loadFolder.error} />}
          {updateAll.data && updateAll.data.failed.length > 0 && (
            <InlineError error={new Error(updateAll.data.failed.map((f) => `${f.id}: ${f.message}`).join('\n'))} />
          )}

          {tab === 'installed' &&
            (!isPending && extensions.length === 0 ? (
              <EmptyState
                icon={Puzzle}
                title={t('empty.extensions.title')}
                description={t('empty.extensions.description')}
                action={
                  <Button variant="secondary" onClick={() => setTab('available')}>
                    {t('extensions.browseAvailable')}
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {extensions.filter(matches).map((extension) => (
                  <InstalledRow
                    key={`${extension.origin}:${extension.path}`}
                    extension={extension}
                    repo={extension.repoId === null ? undefined : repoById.get(extension.repoId)}
                    update={available.find((a) => a.id === extension.id && a.update)}
                    onUpdate={startInstall}
                  />
                ))}
              </ul>
            ))}

          {tab === 'available' &&
            (repos.length === 0 ? (
              <EmptyState
                icon={Server}
                title={t('extensions.noRepos.title')}
                description={t('extensions.noRepos.description')}
                action={<Button onClick={() => setPanelOpen(true)}>{t('extensions.repos.add')}</Button>}
              />
            ) : offered.length === 0 ? (
              <EmptyState
                icon={Check}
                title={t('extensions.allInstalled.title')}
                description={t('extensions.allInstalled.description')}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {offered.filter(matches).map((item) => (
                  <AvailableRow
                    key={`${item.repoId}:${item.id}`}
                    item={item}
                    installed={extensions.find((e) => e.id === item.id)}
                    onInstall={startInstall}
                  />
                ))}
              </ul>
            ))}

          {tab === 'updates' &&
            (updates.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title={t('extensions.noUpdates.title')}
                description={t('extensions.noUpdates.description')}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {updates.filter(matches).map((item) => (
                  <AvailableRow key={`${item.repoId}:${item.id}`} item={item} onInstall={startInstall} />
                ))}
              </ul>
            ))}
        </div>
      </div>
      {panelOpen && <RepositoriesPanel onClose={() => setPanelOpen(false)} now={now} />}
      <InstallDialog request={dialogRequest} onClose={closeDialog} />
    </div>
  );
}

function LanguageFilter({
  all,
  selected,
  onChange,
}: {
  all: string[];
  selected: string[];
  onChange: (langs: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const label = selected.length === 0 ? t('extensions.languages.all') : selected.map((l) => l.toUpperCase()).join(', ');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm" disabled={all.length === 0}>
          <Languages />
          {t('extensions.languages.label', { langs: label })}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {all.map((lang) => (
            <DropdownMenu.CheckboxItem
              key={lang}
              className={cn(menuItem, 'pl-8 relative')}
              checked={selected.includes(lang)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onChange(checked ? [...selected, lang] : selected.filter((l) => l !== lang))
              }
            >
              <DropdownMenu.ItemIndicator className="absolute left-2">
                <Check />
              </DropdownMenu.ItemIndicator>
              {languageName(lang, i18n.language)}
              <span className="ml-auto text-xs text-muted-foreground">{lang.toUpperCase()}</span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function OriginLine({ extension, repo }: { extension: ExtensionEntry; repo: RepoInfo | undefined }) {
  const { t } = useTranslation();
  if (extension.origin === 'dev') {
    return (
      <>
        <Badge variant="info">
          <FolderOpen />
          {t('extensions.devLoaded')}
        </Badge>
        <span className="truncate font-mono text-muted-foreground" title={extension.path}>
          {extension.path}
        </span>
      </>
    );
  }
  if (extension.origin === 'builtin') {
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-ctp-green">
        <ShieldCheck className="size-3.5" />
        {t('extensions.builtin')}
      </span>
    );
  }
  if (!repo) return <span className="text-muted-foreground">{t('extensions.repoRemoved')}</span>;
  return <TrustLine trust={repo.trust} repoName={repo.name} />;
}

function InstalledRow({
  extension,
  repo,
  update,
  onUpdate,
}: {
  extension: ExtensionEntry;
  repo: RepoInfo | undefined;
  update: AvailableExtension | undefined;
  onUpdate: (item: AvailableExtension) => void;
}) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const reload = useMutation({ mutationFn: () => ipc.invoke('extensions.reload', { extensionId: extension.id }) });
  const removeFolder = useMutation({
    mutationFn: () => ipc.invoke('extensions.removeDevFolder', { path: extension.path }),
  });
  const uninstall = useMutation({
    mutationFn: () => ipc.invoke('extensions.uninstall', { extensionId: extension.id }),
  });
  const broken = extension.error !== null;
  const actionError = uninstall.error ?? removeFolder.error;

  return (
    <li
      className={cn('rounded-xl border bg-card/40 px-4 py-3.5', broken && 'border-ctp-red/40')}
      aria-label={extension.name}
      data-testid="extension-row"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExtensionIcon
          id={extension.id}
          name={extension.name}
          src={extension.hasIcon ? extensionIconUrl(extension.id) : null}
          className="size-11"
        />
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{extension.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {t('extensions.version', { version: extension.version })}
            </span>
            <LangBadges langs={extension.langs} />
            {extension.nsfw && <Badge variant="danger">18+</Badge>}
            {extension.origin === 'repo' && !update && !broken && (
              <Badge variant="success">{t('extensions.upToDate')}</Badge>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            <OriginLine extension={extension} repo={repo} />
            {extension.description && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{extension.description}</span>
              </>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {update && (
            <Button size="sm" onClick={() => onUpdate(update)}>
              <ArrowUpCircle />
              {t('extensions.updateTo', { version: update.version })}
            </Button>
          )}
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
          {extension.origin !== 'builtin' && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="ghost" size="icon" title={t('extensions.more')}>
                  <EllipsisVertical />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
                >
                  {extension.origin === 'repo' ? (
                    <DropdownMenu.Item
                      className={cn(menuItem, 'text-destructive')}
                      onSelect={() => setConfirmUninstall(true)}
                    >
                      <Trash2 />
                      {t('extensions.uninstall')}
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item className={menuItem} onSelect={() => removeFolder.mutate()}>
                      <FolderX />
                      {t('extensions.removeFolder')}
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
      {broken && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs text-ctp-red select-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {extension.error}
        </p>
      )}
      {actionError && <InlineError error={actionError} />}
      {!broken && (
        <PreferencesDialog
          extensionId={extension.id}
          name={extension.name}
          open={prefsOpen}
          onOpenChange={setPrefsOpen}
        />
      )}
      <ConfirmDialog
        open={confirmUninstall}
        onOpenChange={setConfirmUninstall}
        title={t('extensions.uninstallTitle', { name: extension.name })}
        description={t('extensions.uninstallDescription')}
        confirmLabel={t('extensions.uninstall')}
        onConfirm={() => uninstall.mutate()}
      />
    </li>
  );
}

function AvailableRow({
  item,
  installed,
  onInstall,
}: {
  item: AvailableExtension;
  installed?: ExtensionEntry;
  onInstall: (item: AvailableExtension) => void;
}) {
  const { t } = useTranslation();
  // Installed from another repository: updates only come from there (§5.8).
  const elsewhere = installed?.origin === 'repo' && !item.installedHere;
  return (
    <li className="rounded-xl border bg-card/40 px-4 py-3.5" aria-label={item.name} data-testid="available-row">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExtensionIcon
          id={item.id}
          name={item.name}
          src={item.hasIcon ? repoIconUrl(item.repoId, item.id) : null}
          className="size-11"
        />
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {item.update
                ? t('extensions.versionUpdate', { from: item.installedVersion, to: item.version })
                : t('extensions.version', { version: item.version })}
            </span>
            <LangBadges langs={item.langs} />
            {item.nsfw && <Badge variant="danger">18+</Badge>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            <TrustLine trust={item.trust} repoName={item.repoName} />
            {item.description && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{item.description}</span>
              </>
            )}
          </div>
        </div>
        {elsewhere ? (
          <span className="ml-auto text-xs text-muted-foreground">{t('extensions.installedElsewhere')}</span>
        ) : (
          <Button
            size="sm"
            className="ml-auto"
            variant={item.update ? 'default' : 'secondary'}
            onClick={() => onInstall(item)}
          >
            {item.update ? <ArrowUpCircle /> : <Download />}
            {item.update ? t('extensions.updateTo', { version: item.version }) : t('extensions.install.install')}
          </Button>
        )}
      </div>
    </li>
  );
}

function InlineError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <p className="mt-3 mb-1 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs whitespace-pre-line text-ctp-red select-text">
      {title}: {detail}
    </p>
  );
}
