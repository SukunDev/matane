import type { SourceEntry } from '@manga-reader/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  ScanSearch,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { librarySourceIdsQuery } from '../../lib/library';
import { useContentFilter } from '../../lib/content';
import { defaultSearchSources, sourceSearchQuery } from '../../lib/search';
import { sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { MangaCard, MangaCardSkeleton } from '../browse/MangaGrid';
import { SourceIcon } from '../browse/SourceIcon';
import { extensionIconUrl } from '../../lib/extensions';

/**
 * One query across the chosen sources (BRAINSTORM.md §6.2; mockup 06). Each source is its own query,
 * so results appear as they arrive and a slow or failing source never holds up the others.
 */
export function GlobalSearchPage({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { t } = useTranslation();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const { data: librarySources = new Set<string>() } = useQuery(librarySourceIdsQuery);
  const { data: settings } = useQuery(settingsQuery);
  const updateSettings = useUpdateSettings();
  const prefs = settings?.globalSearch ?? { sourceIds: null, onlyWithResults: false };
  const savePrefs = (patch: Partial<typeof prefs>) => updateSettings.mutate({ globalSearch: { ...prefs, ...patch } });

  const content = useContentFilter();
  // Adult sources and other languages are never searched while hidden (§6.6).
  const shown = sources.filter((s) => content.visible({ langs: [s.lang], nsfw: s.nsfw }));
  const installed = shown.filter((s) => s.installed);
  const defaults = defaultSearchSources(shown, librarySources);
  const selected = prefs.sourceIds === null ? defaults : installed.filter((s) => prefs.sourceIds!.includes(s.id));
  const results = useQueries({
    queries: selected.map((source) => sourceSearchQuery(source.id, query)),
  });

  const done = results.filter((r) => r.isSuccess).length;
  const failed = results.filter((r) => r.isError).length;
  const searching = selected.length - done - failed;
  const percent = selected.length > 0 ? Math.round(((done + failed) / selected.length) * 100) : 0;

  if (installed.length === 0) {
    return (
      <EmptyState
        icon={ScanSearch}
        title={t('empty.globalSearch.title')}
        description={t('empty.globalSearch.description')}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox key={query} initial={query} onSubmit={onQuery} />
          <SourcePicker
            sources={installed}
            selected={selected}
            isDefault={prefs.sourceIds === null}
            defaultCount={defaults.length}
            onChange={(sourceIds) => savePrefs({ sourceIds })}
          />
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px]">
            <input
              type="checkbox"
              checked={prefs.onlyWithResults}
              onChange={(event) => savePrefs({ onlyWithResults: event.target.checked })}
              className="size-4 accent-(--app-accent)"
            />
            {t('globalSearch.onlyWithResults')}
          </label>
        </div>
        {query && selected.length > 0 && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {t('globalSearch.status', { count: selected.length, done })}
              </span>
              {(searching > 0 || failed > 0) && <span>· {t('globalSearch.statusDetail', { searching, failed })}</span>}
              <span className="ml-auto">{t('globalSearch.complete', { percent })}</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('globalSearch.progress')}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!query ? (
          <EmptyState icon={Search} title={t('globalSearch.promptTitle')} description={t('globalSearch.prompt')} />
        ) : selected.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">{t('globalSearch.noSources')}</p>
        ) : (
          <div className="flex flex-col gap-7">
            {selected.map((source, index) => {
              const result = results[index]!;
              const items = result.data?.items ?? [];
              if (prefs.onlyWithResults && (result.isError || (result.isSuccess && items.length === 0))) return null;
              return (
                <SourceRow
                  key={source.id}
                  source={source}
                  query={query}
                  status={result.status}
                  count={items.length}
                  more={result.data?.hasNextPage ?? false}
                >
                  {result.isError ? (
                    <ErrorState
                      compact
                      error={result.error}
                      sourceId={source.id}
                      onRetry={() => void result.refetch()}
                      className="max-w-2xl items-start rounded-xl border text-left"
                    />
                  ) : result.isSuccess && items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('globalSearch.noResults')}</p>
                  ) : (
                    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                      {result.isSuccess
                        ? items.map((item) => (
                            <div key={item.mangaId} className="w-36 shrink-0">
                              <MangaCard item={item} />
                            </div>
                          ))
                        : Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className="w-36 shrink-0">
                              <MangaCardSkeleton />
                            </div>
                          ))}
                    </div>
                  )}
                </SourceRow>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchBox({ initial, onSubmit }: { initial: string; onSubmit: (query: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };
  return (
    <form onSubmit={submit} className="relative w-[min(28rem,100%)]" role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('globalSearch.placeholder')}
        aria-label={t('globalSearch.placeholder')}
        className="h-9 pr-9 pl-9"
      />
      {value && (
        <button
          type="button"
          title={t('globalSearch.clear')}
          onClick={() => {
            setValue('');
            onSubmit('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}

function SourceRow({
  source,
  query,
  status,
  count,
  more,
  children,
}: {
  source: SourceEntry;
  query: string;
  status: 'pending' | 'error' | 'success';
  count: number;
  more: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [extensionId, sourceKey] = source.id.split('/') as [string, string];
  return (
    <section aria-label={source.name} data-testid="search-source" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <SourceIcon
          id={source.id}
          name={source.name}
          src={source.installed && source.hasIcon ? extensionIconUrl(extensionId) : null}
          className="size-7 rounded-md text-[10px]"
        />
        <h2 className="font-semibold">
          {source.name} <span className="font-normal text-muted-foreground">({source.lang.toUpperCase()})</span>
        </h2>
        {status === 'pending' ? (
          <span className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t('globalSearch.searching')}
          </span>
        ) : status === 'error' ? (
          <span className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive">
            <CircleAlert className="size-3" />
            {t('globalSearch.failed')}
          </span>
        ) : (
          <span className="rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t('globalSearch.results', { count: more ? `${count}+` : count })}
          </span>
        )}
        {status === 'success' && count > 0 && (
          <Link
            to="/browse/sources/$extensionId/$sourceKey"
            params={{ extensionId, sourceKey }}
            search={{ tab: 'search', q: query }}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('globalSearch.seeAll')}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** "Sources: Default (5)" — the default set, or a custom list that is remembered. */
function SourcePicker({
  sources,
  selected,
  isDefault,
  defaultCount,
  onChange,
}: {
  sources: SourceEntry[];
  selected: SourceEntry[];
  isDefault: boolean;
  defaultCount: number;
  onChange: (sourceIds: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const ids = new Set(selected.map((s) => s.id));
  const toggle = (id: string) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(sources.filter((s) => next.has(s.id)).map((s) => s.id));
  };
  const itemClass =
    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" className="h-9">
          <SlidersHorizontal />
          {isDefault
            ? t('globalSearch.sourcesDefault', { count: defaultCount })
            : t('globalSearch.sourcesCustom', { count: selected.length })}
          <ChevronDown />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 flex max-h-96 w-72 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <button type="button" className={itemClass} onClick={() => onChange(null)}>
            <Check className={cn('size-4', !isDefault && 'invisible')} />
            {t('globalSearch.useDefault')}
          </button>
          <div className="my-1 h-px bg-border" />
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              role="checkbox"
              aria-checked={ids.has(source.id)}
              className={itemClass}
              onClick={() => toggle(source.id)}
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded border',
                  ids.has(source.id) && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {ids.has(source.id) && <Check className="size-3" />}
              </span>
              <span className="flex-1 truncate">{source.name}</span>
              <span className="text-xs text-muted-foreground">{source.lang.toUpperCase()}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
