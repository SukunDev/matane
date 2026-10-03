import type {
  BrowseItem,
  MangaInfo,
  MigrationOptions,
  MigrationProgress,
  MigrationResult,
  MigrationSearch,
  SourceEntry,
} from '@manga-reader/shared';
import { DEFAULT_MIGRATION_OPTIONS } from '@manga-reader/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  ArrowRightLeft,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ImageOff,
  ListOrdered,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/ui/button';
import { useContentFilter } from '../../lib/content';
import { useErrorText } from '../../lib/errors';
import { ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { sourceSearchLimit } from '../../lib/search';
import { chaptersQuery, invokeCancellable, mangaQuery, sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { ManualSearchDialog } from './ManualSearchDialog';

/** The manga picked for one row: a found candidate, one chosen by hand, or nothing yet. */
export interface Choice {
  sourceId: string;
  item: BrowseItem;
  /** null when picked by hand. */
  score: number | null;
  match: 'exact' | 'similar' | 'manual';
}

/**
 * Source migration (BRAINSTORM.md §6.2; mockup 15): choose target sources and what to carry over,
 * check the match found for each manga, then migrate and read the summary.
 */
export function MigrationPage({ ids }: { ids: number[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const updateSettings = useUpdateSettings();
  const migration = settings?.migration ?? { targets: [], options: DEFAULT_MIGRATION_OPTIONS };
  const content = useContentFilter();
  // Hidden sources (other languages, adult while off) are not offered as targets (§6.6).
  const installed = sources.filter((s) => s.installed && content.visible({ langs: [s.lang], nsfw: s.nsfw }));
  const saved = migration.targets.flatMap((id) => installed.find((s) => s.id === id) ?? []);
  const pinned = installed.filter((s) => s.pinned);
  // Saved order, else pinned sources, else every installed source.
  const targets = saved.length > 0 ? saved : pinned.length > 0 ? pinned : installed;
  const targetIds = targets.map((s) => s.id);

  const manga = useQueries({ queries: ids.map((id) => mangaQuery(id)) });
  const chapters = useQueries({ queries: ids.map((id) => chaptersQuery(id)) });
  const searches = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['migration', 'candidates', id, targetIds] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sourceSearchLimit(
          () => invokeCancellable('migration.findCandidates', { mangaId: id, targets: targetIds }, signal),
          signal,
        ),
      enabled: targetIds.length > 0,
      staleTime: Infinity,
      retry: false,
    })),
  });

  const [choices, setChoices] = useState<ReadonlyMap<number, Choice | 'skip'>>(new Map());
  const choose = (id: number, choice: Choice | 'skip' | undefined) =>
    setChoices((current) => {
      const next = new Map(current);
      if (choice === undefined) next.delete(id);
      else next.set(id, choice);
      return next;
    });
  const choiceOf = (index: number): Choice | 'skip' | undefined => {
    const own = choices.get(ids[index]!);
    if (own) return own;
    const best = searches[index]?.data?.best;
    return best ? { ...best, match: best.match } : undefined;
  };
  const ready = ids.flatMap((id, index) => {
    const choice = choiceOf(index);
    return choice && choice !== 'skip' ? [{ fromMangaId: id, toMangaId: choice.item.mangaId }] : [];
  });
  const needsChoice = ids.filter((_, index) => !choiceOf(index) && searches[index]?.isFetched).length;
  const skipped = ids.filter((_, index) => choiceOf(index) === 'skip').length;

  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  useIpcEvent(
    'migration.progress',
    useCallback((next: MigrationProgress) => setProgress(next), []),
  );
  const run = useMutation({
    mutationFn: () => ipc.invoke('migration.run', { items: ready, options: migration.options }),
  });

  const setOptions = (patch: Partial<MigrationOptions>) =>
    updateSettings.mutate({ migration: { ...migration, options: { ...migration.options, ...patch } } });
  const setTargets = (next: string[]) => updateSettings.mutate({ migration: { ...migration, targets: next } });

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={ArrowRightLeft}
        title={t('migration.emptyTitle')}
        description={t('migration.emptyDescription')}
        action={
          <Button asChild>
            <Link to="/library">{t('migration.backToLibrary')}</Link>
          </Button>
        }
      />
    );
  }

  if (run.data) {
    return (
      <MigrationSummary results={run.data} skipped={skipped + needsChoice} manga={manga.map((m) => m.data)} ids={ids} />
    );
  }

  const fromSources = [...new Set(manga.flatMap((m) => (m.data ? [m.data.sourceId] : [])))]
    .map((id) => sources.find((s) => s.id === id)?.name ?? id)
    .join(', ');

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5">
          <header className="flex flex-wrap items-start gap-4 border-b pb-5">
            <div>
              <h1 className="text-xl font-semibold">{t('migration.title', { count: ids.length })}</h1>
              <p className="text-xs text-muted-foreground">{t('migration.from', { sources: fromSources })}</p>
            </div>
            <TargetOrder sources={installed} targets={targets} onChange={setTargets} />
          </header>

          <OptionsCard options={migration.options} onChange={setOptions} />

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{t('migration.queue', { count: ids.length })}</h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              disabled={run.isPending}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['migration', 'candidates'] })}
            >
              <RefreshCw />
              {t('migration.rescan')}
            </Button>
          </div>

          {targets.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              {t('migration.noTargets')}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {ids.map((id, index) => (
                <MigrationRow
                  key={id}
                  manga={manga[index]!.data}
                  chapters={chapters[index]!.data}
                  search={searches[index]!}
                  choice={choiceOf(index)}
                  targets={targets}
                  sources={sources}
                  disabled={run.isPending}
                  onChoose={(choice) => choose(id, choice)}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t bg-sidebar px-6 py-3 text-xs">
        {run.isPending && progress ? (
          <div className="flex flex-1 items-center gap-3" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span>{t('migration.running', { done: progress.done, total: progress.total })}</span>
            <div className="h-1 max-w-72 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-ctp-green" />
              {t('migration.ready', { count: ready.length, total: ids.length })}
            </span>
            {needsChoice > 0 && (
              <span className="flex items-center gap-1.5 text-ctp-red">
                <span className="size-2 rounded-full bg-ctp-red" />
                {t('migration.needsChoice', { count: needsChoice })}
              </span>
            )}
            {run.error && <RunError error={run.error} />}
          </div>
        )}
        <Button variant="ghost" onClick={() => void navigate({ to: '/library' })} disabled={run.isPending}>
          {t('common.cancel')}
        </Button>
        <Button disabled={ready.length === 0 || run.isPending} onClick={() => run.mutate()}>
          <ArrowRightLeft />
          {t('migration.migrate', { count: ready.length })}
        </Button>
      </footer>
    </div>
  );
}

function RunError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <span role="alert" className="text-destructive" title={detail}>
      {title}: {detail}
    </span>
  );
}

/** "Target order: 1. Example Source (EN) · 2. …" with an editor (checkbox + up/down per source). */
function TargetOrder({
  sources,
  targets,
  onChange,
}: {
  sources: SourceEntry[];
  targets: SourceEntry[];
  onChange: (targets: string[]) => void;
}) {
  const { t } = useTranslation();
  const ids = targets.map((s) => s.id);
  const move = (id: string, by: -1 | 1) => {
    const index = ids.indexOf(id);
    const next = [...ids];
    next.splice(index, 1);
    next.splice(index + by, 0, id);
    onChange(next);
  };
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const others = sources.filter((s) => !ids.includes(s.id));
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{t('migration.targetOrder')}</span>
      {targets.map((source, index) => (
        <span key={source.id} className="rounded-md border bg-card/40 px-2 py-1">
          {index + 1}. {source.name} ({source.lang.toUpperCase()})
        </span>
      ))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button variant="secondary" size="sm">
            <ListOrdered />
            {t('migration.editOrder')}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="z-50 flex max-h-96 w-80 flex-col gap-1 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <p className="px-1 pb-1 text-[11px] text-muted-foreground">{t('migration.orderHint')}</p>
            {[...targets, ...others].map((source) => {
              const index = ids.indexOf(source.id);
              const on = index >= 0;
              return (
                <div key={source.id} className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-accent/50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(source.id)}
                    aria-label={source.name}
                    className="size-4 accent-(--app-accent)"
                  />
                  <span className="w-4 text-center font-mono text-xs text-muted-foreground">{on ? index + 1 : ''}</span>
                  <span className="flex-1 truncate text-sm">
                    {source.name} <span className="text-xs text-muted-foreground">{source.lang.toUpperCase()}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('manga.scanlators.moveUp')}
                    disabled={!on || index === 0}
                    onClick={() => move(source.id, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('manga.scanlators.moveDown')}
                    disabled={!on || index === ids.length - 1}
                    onClick={() => move(source.id, 1)}
                  >
                    <ChevronDown />
                  </Button>
                </div>
              );
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const OPTION_KEYS = ['readStatus', 'categories', 'readerSettings', 'customCover', 'bookmarks'] as const;

function OptionsCard({
  options,
  onChange,
}: {
  options: MigrationOptions;
  onChange: (patch: Partial<MigrationOptions>) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card/40 p-5" aria-label={t('migration.options')}>
      <h2 className="flex items-center gap-2 font-semibold">
        <SlidersHorizontal className="size-4 text-primary" />
        {t('migration.options')}
      </h2>
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {t('migration.dataToTransfer')}
          </legend>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-3">
            {OPTION_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => onChange({ [key]: event.target.checked })}
                  className="size-4 accent-(--app-accent)"
                />
                {t(`migration.option.${key}`)}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-muted-foreground" title={t('migration.soon')}>
              <input type="checkbox" disabled className="size-4" />
              {t('migration.option.downloads')}
            </label>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {t('migration.afterwards')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="afterwards"
              checked={options.removeOld}
              onChange={() => onChange({ removeOld: true })}
              className="size-4 accent-(--app-accent)"
            />
            {t('migration.removeOld')}
            <span className="text-muted-foreground">{t('migration.recommended')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="afterwards"
              checked={!options.removeOld}
              onChange={() => onChange({ removeOld: false })}
              className="size-4 accent-(--app-accent)"
            />
            {t('migration.keepBoth')}
          </label>
        </fieldset>
      </div>
    </section>
  );
}

function MigrationRow({
  manga,
  chapters,
  search,
  choice,
  targets,
  sources,
  disabled,
  onChoose,
}: {
  manga: MangaInfo | undefined;
  chapters: { read: boolean; number: number | null }[] | undefined;
  search: { data?: MigrationSearch; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  choice: Choice | 'skip' | undefined;
  targets: SourceEntry[];
  sources: SourceEntry[];
  disabled: boolean;
  onChoose: (choice: Choice | 'skip' | undefined) => void;
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState(false);
  if (!manga) return <li className="h-28 animate-pulse rounded-xl border bg-card/40" />;
  const sourceName = (id: string) => {
    const source = sources.find((s) => s.id === id);
    return source ? `${source.name} (${source.lang.toUpperCase()})` : id;
  };
  const lastRead = (chapters ?? []).reduce<number | null>(
    (max, c) => (c.read && c.number !== null && (max === null || c.number > max) ? c.number : max),
    null,
  );
  const picked = choice && choice !== 'skip' ? choice : null;
  const candidates = search.data?.candidates ?? [];

  return (
    <li
      data-testid="migration-row"
      className="grid items-center gap-4 rounded-xl border bg-card/40 p-3 md:grid-cols-[1fr_auto_1fr]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CoverImage
          mangaId={manga.id}
          coverKey={manga.coverKey}
          alt=""
          className="aspect-[2/3] w-14 shrink-0 rounded-md border"
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{manga.title}</p>
          <p className="truncate text-xs text-muted-foreground">{sourceName(manga.sourceId)}</p>
          <p className="mt-1 flex gap-2 text-xs">
            <span className="rounded border px-1.5">{t('manga.chapterCount', { count: chapters?.length ?? 0 })}</span>
            {lastRead !== null && (
              <span className="flex items-center gap-1 text-ctp-green">
                <CheckCheck className="size-3.5" />
                {t('migration.readUpTo', { number: lastRead })}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
        {search.isPending ? (
          <Loader2 className="size-5 animate-spin text-primary" />
        ) : choice === 'skip' ? (
          <span>{t('migration.skipped')}</span>
        ) : picked?.match === 'exact' ? (
          <>
            <ArrowRight className="size-5 text-ctp-green" />
            {t('migration.exactShort')}
          </>
        ) : picked ? (
          <>
            <ArrowRightLeft className="size-5 text-ctp-yellow" />
            {t('migration.verify')}
          </>
        ) : (
          <>
            <TriangleAlert className="size-5 text-ctp-red" />
            {t('migration.noMatchShort')}
          </>
        )}
      </div>

      <div
        className={cn(
          'flex min-h-20 items-center gap-3 rounded-lg border p-2.5',
          !picked && 'border-dashed',
          picked?.match === 'similar' && 'border-ctp-yellow/50',
        )}
      >
        {picked ? (
          <CoverImage
            mangaId={picked.item.mangaId}
            coverKey={picked.item.coverKey}
            alt=""
            className="aspect-[2/3] w-12 shrink-0 rounded border"
          />
        ) : (
          <div className="flex aspect-[2/3] w-12 shrink-0 items-center justify-center rounded border border-dashed text-muted-foreground">
            <ImageOff className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {search.isPending ? (
            <p className="text-sm text-muted-foreground">{t('migration.searching')}</p>
          ) : picked ? (
            <>
              <p className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{picked.item.title}</span>
                <MatchBadge choice={picked} />
              </p>
              <p className="truncate text-xs text-muted-foreground">{sourceName(picked.sourceId)}</p>
            </>
          ) : (
            <>
              <span className="rounded bg-ctp-red/15 px-1.5 py-0.5 text-[11px] font-medium text-ctp-red">
                {t('migration.noMatch')}
              </span>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {t('migration.searched', { sources: targets.map((s) => s.name).join(', ') })}
              </p>
            </>
          )}
          {search.data && search.data.errors.length > 0 && (
            <p
              className="mt-1 flex items-center gap-1 text-[11px] text-ctp-peach"
              title={search.data.errors.map((e) => `${sourceName(e.sourceId)}: ${e.message}`).join('\n')}
            >
              <CircleAlert className="size-3" />
              {t('migration.searchFailed', {
                sources: search.data.errors.map((e) => sourceName(e.sourceId)).join(', '),
              })}
            </p>
          )}
          {search.isError && <SearchError error={search.error} />}
          {!search.isPending && (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={choice === 'skip'}
                disabled={disabled}
                onChange={(event) => onChoose(event.target.checked ? 'skip' : undefined)}
                className="size-3.5 accent-(--app-accent)"
              />
              {t('migration.skip')}
            </label>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {candidates.length > 1 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="ghost" size="sm" disabled={disabled}>
                  {t('migration.change')}
                  <ChevronDown />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 max-h-80 w-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
                >
                  {candidates.map((candidate) => (
                    <DropdownMenu.Item
                      key={`${candidate.sourceId}:${candidate.item.mangaId}`}
                      onSelect={() => onChoose(candidate)}
                      className="flex cursor-default items-center gap-2 rounded-md p-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                    >
                      <CoverImage
                        mangaId={candidate.item.mangaId}
                        coverKey={candidate.item.coverKey}
                        alt=""
                        className="aspect-[2/3] w-8 shrink-0 rounded"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{candidate.item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {sourceName(candidate.sourceId)}
                        </span>
                      </span>
                      <MatchBadge choice={candidate} />
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <Button variant="secondary" size="sm" disabled={disabled || search.isPending} onClick={() => setManual(true)}>
            <Search />
            {t('migration.searchManually')}
          </Button>
        </div>
      </div>
      <ManualSearchDialog
        open={manual}
        onOpenChange={setManual}
        initialQuery={manga.title}
        // Its own source can't be a target, and neither can the manga itself.
        targets={targets.filter((s) => s.id !== manga.sourceId)}
        excludeMangaId={manga.id}
        // Start where the current candidate came from (else the first target).
        defaultSourceId={picked?.sourceId}
        onPick={(sourceId, item) => {
          onChoose({ sourceId, item, score: null, match: 'manual' });
          setManual(false);
        }}
      />
    </li>
  );
}

function SearchError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <p className="mt-1 text-[11px] text-destructive" title={detail}>
      {title}
    </p>
  );
}

function MatchBadge({ choice }: { choice: Pick<Choice, 'match' | 'score'> }) {
  const { t } = useTranslation();
  const styles = {
    exact: 'bg-ctp-green/15 text-ctp-green',
    similar: 'bg-ctp-yellow/15 text-ctp-yellow',
    manual: 'bg-primary/15 text-primary',
  } as const;
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', styles[choice.match])}>
      {choice.match === 'similar'
        ? t('migration.similar', { percent: Math.round((choice.score ?? 0) * 100) })
        : t(`migration.${choice.match}`)}
    </span>
  );
}

function MigrationSummary({
  results,
  skipped,
  manga,
  ids,
}: {
  results: MigrationResult[];
  skipped: number;
  manga: (MangaInfo | undefined)[];
  ids: number[];
}) {
  const { t } = useTranslation();
  const titleOf = (id: number) => manga[ids.indexOf(id)]?.title ?? `#${id}`;
  const migrated = results.filter((r) => r.status === 'migrated');
  const failed = results.filter((r) => r.status === 'failed');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-8">
        <h1 className="text-xl font-semibold">{t('migration.summaryTitle')}</h1>
        <div className="grid grid-cols-3 gap-3" data-testid="migration-summary">
          <Stat label={t('migration.stat.migrated')} value={migrated.length} tone="text-ctp-green" />
          <Stat label={t('migration.stat.skipped')} value={skipped} tone="text-muted-foreground" />
          <Stat label={t('migration.stat.failed')} value={failed.length} tone="text-ctp-red" />
        </div>
        <ul className="flex flex-col gap-2">
          {results.map((result) => (
            <li key={result.fromMangaId} className="flex flex-col gap-1 rounded-xl border bg-card/40 p-3 text-sm">
              <p className="flex items-center gap-2">
                {result.status === 'migrated' ? (
                  <CheckCheck className="size-4 text-ctp-green" />
                ) : (
                  <CircleAlert className="size-4 text-ctp-red" />
                )}
                <span className="font-medium">{titleOf(result.fromMangaId)}</span>
                {result.status === 'migrated' && (
                  <Link
                    to="/manga/$mangaId"
                    params={{ mangaId: String(result.toMangaId) }}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    {t('migration.openNew')}
                  </Link>
                )}
              </p>
              {result.status === 'migrated' ? (
                <p className="text-xs text-muted-foreground">
                  {t('migration.readMatched', { count: result.readMatched })}
                  {result.unmatched.length > 0 &&
                    ` · ${t('migration.unmatched', { count: result.unmatched.length, chapters: result.unmatched.join(', ') })}`}
                </p>
              ) : (
                <p className="text-xs text-destructive">{result.error}</p>
              )}
            </li>
          ))}
        </ul>
        <Button asChild className="self-start">
          <Link to="/library">{t('migration.backToLibrary')}</Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border bg-card/40 p-4">
      <p className={cn('text-2xl font-semibold', tone)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
