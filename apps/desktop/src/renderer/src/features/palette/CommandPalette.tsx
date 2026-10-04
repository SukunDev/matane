import type { LibraryFilters } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  EyeOff,
  HardDriveDownload,
  Pause,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { NAV_ITEMS, type NavLeaf } from '../../components/shell/nav';
import { downloadStatsQuery } from '../../lib/downloads';
import { useIncognito } from '../../lib/incognito';
import { ipc } from '../../lib/ipc';
import { libraryQuery } from '../../lib/library';
import { historyQuery } from '../../lib/reading';
import { cn } from '../../lib/utils';
import { usePalette } from '../../stores/palette';
import { SETTINGS_SECTIONS } from '../settings/sections';
import { matches } from './match';

const LIBRARY_LIMIT = 6;
const NO_FILTERS: LibraryFilters = {
  unread: false,
  reading: false,
  bookmarked: false,
  downloaded: false,
  status: [],
  sourceIds: [],
};
const CONTINUE_LIMIT = 5;

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
}

const NAV_LEAVES: NavLeaf[] = NAV_ITEMS.flatMap((item) => ('children' in item ? item.children : [item]));

/**
 * Command palette (docs/BRAINSTORM.md §6.6, mockup 12): library manga (full-text search in main),
 * continue reading, actions, every page and settings section, and "search sources" (Tab).
 */
export function CommandPalette() {
  const { open, setOpen } = usePalette();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ctp-crust/70 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-16 left-1/2 z-50 flex max-h-[min(36rem,calc(100vh-6rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        >
          {open && <Palette onClose={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim());
  const [incognito, setIncognito] = useIncognito();

  const library = useQuery({
    ...libraryQuery({
      tab: 'all',
      sort: 'lastRead',
      ascending: false,
      filters: NO_FILTERS,
      query: q,
    }),
    enabled: q.length > 0,
  });
  const history = useQuery({ ...historyQuery(''), enabled: q.length === 0 });
  const { data: stats } = useQuery(downloadStatsQuery);
  const downloading = (stats?.queued ?? 0) + (stats?.downloading ?? 0) > 0;
  const paused = (stats?.paused ?? 0) > 0;

  const run = (action: () => unknown) => () => {
    onClose();
    void action();
  };
  const go = (to: string) => run(() => navigate({ to }));
  const continueManga = (mangaId: number) =>
    run(async () => {
      const target = await ipc.invoke('manga.continue', { mangaId });
      if (target) await navigate({ to: '/reader/$chapterId', params: { chapterId: String(target.chapterId) } });
      else await navigate({ to: '/manga/$mangaId', params: { mangaId: String(mangaId) } });
    });
  const searchSources = run(() => navigate({ to: '/browse/global-search', search: { q } }));

  const actions: (PaletteAction | null)[] = [
    {
      id: 'updates',
      label: t('palette.actions.checkUpdates'),
      icon: RefreshCw,
      onSelect: run(() => ipc.invoke('updates.check', { scope: { kind: 'all' } })),
    },
    {
      id: 'incognito',
      label: incognito ? t('palette.actions.incognitoOff') : t('palette.actions.incognitoOn'),
      icon: EyeOff,
      onSelect: run(() => setIncognito(!incognito)),
    },
    downloading
      ? {
          id: 'pause',
          label: t('palette.actions.pauseDownloads'),
          hint: t('palette.queued', { count: (stats?.queued ?? 0) + (stats?.downloading ?? 0) }),
          icon: Pause,
          onSelect: run(() => ipc.invoke('downloads.pause')),
        }
      : paused
        ? {
            id: 'resume',
            label: t('palette.actions.resumeDownloads'),
            hint: t('palette.paused', { count: stats?.paused ?? 0 }),
            icon: Play,
            onSelect: run(() => ipc.invoke('downloads.resume')),
          }
        : null,
    {
      id: 'repos',
      label: t('palette.actions.syncRepos'),
      icon: RefreshCw,
      onSelect: run(() => ipc.invoke('repos.sync')),
    },
    {
      id: 'backup',
      label: t('palette.actions.backup'),
      icon: HardDriveDownload,
      onSelect: run(() => ipc.invoke('backup.create')),
    },
    {
      id: 'reader-settings',
      label: t('palette.actions.readerSettings'),
      icon: SlidersHorizontal,
      onSelect: go('/settings/reader'),
    },
  ];
  const shownActions = actions.filter((action): action is PaletteAction => action !== null && matches(action.label, q));

  const pages = NAV_LEAVES.map((leaf) => ({
    id: leaf.to,
    label: t(`nav.${leaf.labelKey}`),
    icon: leaf.icon,
    to: leaf.to,
  }));
  const sections = SETTINGS_SECTIONS.map((section) => ({
    id: `/settings/${section}`,
    label: `${t('nav.settings')} › ${t(`settings.sections.${section}`)}`,
    icon: Settings,
    to: `/settings/${section}`,
  }));
  const places = [...pages, ...sections].filter((place) => matches(place.label, q));
  const manga = (library.data ?? []).slice(0, LIBRARY_LIMIT);
  const recent = (history.data ?? []).slice(0, CONTINUE_LIMIT);

  // The highlighted item: the first one whenever the list changes under it (library results
  // arrive after typing, and Enter must pick the top one).
  const values = [
    ...manga.map((item) => `manga:${item.mangaId}`),
    ...recent.map((entry) => `history:${entry.mangaId}`),
    ...shownActions.map((action) => `action:${action.id}`),
    ...places.map((place) => `go:${place.id}`),
    ...(q ? ['search-sources'] : []),
  ];
  const [selected, setSelected] = useState('');
  const current = values.includes(selected) ? selected : (values[0] ?? '');

  return (
    <Command
      shouldFilter={false}
      loop
      value={current}
      onValueChange={setSelected}
      label={t('palette.label')}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center gap-3 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.placeholder')}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && q) {
              event.preventDefault();
              searchSources();
            }
          }}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <Kbd label="Esc" />
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          {library.isFetching ? t('palette.searching') : t('palette.empty')}
        </Command.Empty>

        {manga.length > 0 && (
          <Group heading={t('palette.groups.library')}>
            {manga.map((item) => {
              const reading = item.lastReadAt !== null && item.unreadCount > 0;
              return (
                <Item
                  key={item.mangaId}
                  value={`manga:${item.mangaId}`}
                  onSelect={reading ? continueManga(item.mangaId) : go(`/manga/${item.mangaId}`)}
                  icon={
                    <CoverImage
                      mangaId={item.mangaId}
                      coverKey={item.coverKey}
                      alt=""
                      className="aspect-[2/3] w-7 shrink-0 rounded"
                    />
                  }
                  label={item.title}
                  detail={[
                    item.sourceName,
                    item.lastReadChapter,
                    reading ? t('palette.reading') : t('palette.unread', { count: item.unreadCount }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  hint={
                    reading ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-primary">
                        {t('palette.continue')}
                        <ArrowRight className="size-3.5" />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('nav.library')}</span>
                    )
                  }
                />
              );
            })}
          </Group>
        )}

        {recent.length > 0 && (
          <Group heading={t('palette.groups.continue')}>
            {recent.map((entry) => (
              <Item
                key={entry.mangaId}
                value={`history:${entry.mangaId}`}
                onSelect={continueManga(entry.mangaId)}
                icon={<BookOpen className="size-4 text-muted-foreground" />}
                label={entry.title}
                detail={[entry.sourceName, entry.chapterName].filter(Boolean).join(' · ')}
                hint={<ArrowRight className="size-3.5 text-muted-foreground" />}
              />
            ))}
          </Group>
        )}

        {shownActions.length > 0 && (
          <Group heading={t('palette.groups.actions')}>
            {shownActions.map((action) => (
              <Item
                key={action.id}
                value={`action:${action.id}`}
                onSelect={action.onSelect}
                icon={<action.icon className="size-4 text-muted-foreground" />}
                label={action.label}
                hint={action.hint ? <span className="text-xs text-muted-foreground">{action.hint}</span> : undefined}
              />
            ))}
          </Group>
        )}

        {places.length > 0 && (
          <Group heading={t('palette.groups.goTo')}>
            {places.map((place) => (
              <Item
                key={place.id}
                value={`go:${place.id}`}
                onSelect={go(place.to)}
                icon={<place.icon className="size-4 text-muted-foreground" />}
                label={place.label}
                hint={<ArrowUpRight className="size-3.5 text-muted-foreground" />}
              />
            ))}
          </Group>
        )}

        {q && (
          <Command.Item
            value="search-sources"
            onSelect={searchSources}
            className="mt-2 flex h-11 cursor-default items-center gap-3 rounded-lg border px-3 text-sm data-[selected=true]:bg-accent"
          >
            <ScanSearch className="size-4 text-primary" />
            <span className="flex-1 truncate">{t('palette.searchSources', { query: q })}</span>
            <span className="text-xs text-muted-foreground">{t('nav.browse')}</span>
            <Kbd label="Tab" />
          </Command.Item>
        )}
      </Command.List>
      <footer className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd label="↑" />
          <Kbd label="↓" />
          {t('palette.footer.navigate')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd label="↵" />
          {t('palette.footer.open')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd label="Tab" />
          {t('palette.footer.searchSources')}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd label="Esc" />
          {t('palette.footer.close')}
        </span>
      </footer>
    </Command>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  value,
  onSelect,
  icon,
  label,
  detail,
  hint,
}: {
  value: string;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  detail?: string;
  hint?: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex min-h-10 cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {hint}
    </Command.Item>
  );
}

/** A key name (Esc, Tab, arrows): the same in every language. */
function Kbd({ label }: { label: string }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{label}</kbd>
  );
}
