import { type BrowseSettings as BrowseSettingsValue, REPO_SYNC_HOURS } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ContentLanguagePicker, NsfwToggle } from '../extensions/ContentControls';
import { AddRepoDialog, RepoCard } from '../extensions/RepositoriesPanel';
import { useContentFilter } from '../../lib/content';
import { reposQuery } from '../../lib/extensions';
import { useUpdateSettings } from '../../lib/ipc';
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

      <Repositories />
    </div>
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
