import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../../components/EmptyState';
import { AboutSettings } from '../../../features/settings/AboutSettings';
import { AdvancedSettings } from '../../../features/settings/AdvancedSettings';
import { BrowseSettings } from '../../../features/settings/BrowseSettings';
import { DataSettings } from '../../../features/settings/DataSettings';
import { DownloadSettings } from '../../../features/settings/DownloadSettings';
import { GeneralSettings } from '../../../features/settings/GeneralSettings';
import { LibrarySettings } from '../../../features/settings/LibrarySettings';
import { NetworkSettings } from '../../../features/settings/NetworkSettings';
import { ReaderSettings } from '../../../features/settings/ReaderSettings';
import { TrackingSettings } from '../../../features/settings/TrackingSettings';
import { UpdateSettings } from '../../../features/settings/UpdateSettings';
import { READY_SECTIONS, SETTINGS_SECTIONS, isSettingsSection } from '../../../features/settings/sections';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/_app/settings/$section')({
  staticData: { crumbs: ['settings'] },
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section))
      throw redirect({ to: '/settings/$section', params: { section: 'general' } });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { section } = Route.useParams();
  const current = isSettingsSection(section) ? section : 'general';

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r p-3">
        {SETTINGS_SECTIONS.map((item) => (
          <Link
            key={item}
            to="/settings/$section"
            params={{ section: item }}
            className="flex h-8 items-center justify-between rounded-lg px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{
              className: 'bg-primary/15 font-semibold text-primary hover:bg-primary/15 hover:text-primary',
            }}
          >
            <span className="truncate">{t(`settings.sections.${item}`)}</span>
            {!READY_SECTIONS.includes(item) && (
              <span className="ml-2 shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                {t('settings.soon')}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-8">
          <h1 className="mb-6 text-xl font-semibold">{t(`settings.sections.${current}`)}</h1>
          {current === 'general' && <GeneralSettings />}
          {current === 'library' && (
            <div className="flex flex-col gap-6">
              <LibrarySettings />
              <UpdateSettings />
            </div>
          )}
          {current === 'reader' && <ReaderSettings />}
          {current === 'downloads' && <DownloadSettings />}
          {current === 'browse' && <BrowseSettings />}
          {current === 'tracking' && <TrackingSettings />}
          {current === 'network' && <NetworkSettings />}
          {current === 'data' && <DataSettings />}
          {current === 'advanced' && <AdvancedSettings />}
          {current === 'about' && <AboutSettings />}
          {!READY_SECTIONS.includes(current) && (
            <div className={cn('rounded-xl border')}>
              <EmptyState
                icon={Settings}
                title={t(`settings.sections.${current}`)}
                description={t('settings.comingSoon')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
