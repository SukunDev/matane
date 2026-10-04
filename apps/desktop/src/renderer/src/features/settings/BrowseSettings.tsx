import { type BrowseSettings as BrowseSettingsValue, LOCAL_SOURCE_ID, REPO_SYNC_HOURS } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, FolderPen, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ContentLanguagePicker, NsfwToggle } from '../extensions/ContentControls';
import { AddRepoDialog, RepoCard } from '../extensions/RepositoriesPanel';
import { useContentFilter } from '../../lib/content';
import { reposQuery } from '../../lib/extensions';
import { ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { useNow } from '../../lib/now';
import { Row, Segmented, Toggle } from './controls';

/** Settings → Browse & extensions (docs/BRAINSTORM.md §6.6): content, repositories, extension updates. */
export function BrowseSettings() {
  const { t } = useTranslation();
  const { browse } = useContentFilter();
  const update = useUpdateSettings();
  const ids = { nsfw: useId(), auto: useId() };
  const set = (patch: Partial<BrowseSettingsValue>) => update.mutate({ browse: { ...browse, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.browse.contentTitle')}</h2>
        <div className="divide-y">
          <Row label={t('settings.browse.languages.label')} description={t('settings.browse.languages.hint')}>
            <ContentLanguagePicker />
          </Row>
          <Row htmlFor={ids.nsfw} label={t('settings.browse.nsfw.label')} description={t('settings.browse.nsfw.hint')}>
            <NsfwToggle id={ids.nsfw} />
          </Row>
        </div>
      </section>

      <section className="rounded-xl border bg-card/40 p-5">
        <h2 className="mb-4 text-sm font-semibold">{t('settings.browse.extensionsTitle')}</h2>
        <div className="divide-y">
          <Row
            htmlFor={ids.auto}
            label={t('settings.browse.autoUpdate.label')}
            description={t('settings.browse.autoUpdate.hint')}
          >
            <Toggle
              id={ids.auto}
              checked={browse.autoUpdateExtensions}
              onChange={(autoUpdateExtensions) => set({ autoUpdateExtensions })}
            />
          </Row>
          <Row label={t('settings.browse.syncEvery.label')} description={t('settings.browse.syncEvery.hint')} stacked>
            <Segmented
              label={t('settings.browse.syncEvery.label')}
              options={REPO_SYNC_HOURS}
              value={browse.repoSyncHours}
              onChange={(repoSyncHours) => set({ repoSyncHours })}
              format={(hours) =>
                hours === 168
                  ? t('settings.browse.syncEvery.week')
                  : t('settings.browse.syncEvery.hours', { count: hours })
              }
            />
          </Row>
        </div>
      </section>

      <LocalFolder />

      <Repositories />
    </div>
  );
}

/** The folder behind the "Local files" source (ADR 0033). */
function LocalFolder() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const queryClient = useQueryClient();
  // What was listed came from the old folder (`['browse', sourceId, …]`, lib/sources.ts).
  const forgetListing = () => queryClient.removeQueries({ queryKey: ['browse', LOCAL_SOURCE_ID] });
  const choose = useMutation({
    mutationFn: () => ipc.invoke('local.chooseFolder'),
    onSuccess: (picked) => picked && forgetListing(),
  });
  const open = useMutation({ mutationFn: () => ipc.invoke('local.openFolder') });
  const folder = settings?.local.folder ?? null;
  return (
    <section
      className="rounded-xl border bg-card/40 p-5"
      aria-label={t('settings.browse.local.title')}
      data-testid="local-settings"
    >
      <h2 className="mb-1 text-sm font-semibold">{t('settings.browse.local.title')}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('settings.browse.local.hint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('settings.browse.local.folder')}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" data-testid="local-folder">
            {folder ?? t('settings.browse.local.none')}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={() => choose.mutate()}>
            <FolderPen />
            {t('settings.browse.local.choose')}
          </Button>
          {folder && (
            <>
              <Button variant="ghost" size="sm" onClick={() => open.mutate()}>
                <FolderOpen />
                {t('settings.browse.local.open')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update.mutate({ local: { folder: null } }, { onSuccess: forgetListing })}
              >
                {t('settings.browse.local.forget')}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Repositories() {
  const { t } = useTranslation();
  const now = useNow();
  const { data: repos = [] } = useQuery(reposQuery);
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-xl border bg-card/40 p-5" aria-label={t('extensions.repos.title')}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t('extensions.repos.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('settings.browse.reposHint')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          {t('extensions.repos.add')}
        </Button>
      </div>
      {repos.length === 0 ? (
        <p className="text-muted-foreground">{t('extensions.repos.none')}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} now={now} />
          ))}
        </div>
      )}
      <AddRepoDialog open={adding} onOpenChange={setAdding} />
    </section>
  );
}
