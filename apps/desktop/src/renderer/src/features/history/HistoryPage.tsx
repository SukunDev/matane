import type { HistoryEntry } from '@manga-reader/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { EyeOff, History, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoverImage } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { SearchField } from '../../components/SearchField';
import { useIncognito } from '../../lib/incognito';
import { ipc } from '../../lib/ipc';
import { historyQuery } from '../../lib/reading';
import { cn } from '../../lib/utils';
import { type HistoryGroup, groupByDay } from './groups';

/** One entry per manga, last read first, grouped by day (docs/BRAINSTORM.md §6.3; mockup 10). */
export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const history = useQuery({ ...historyQuery(debounced), placeholderData: keepPreviousData });
  const groups = useMemo(() => groupByDay(history.data ?? [], (entry) => entry.readAt), [history.data]);
  const [confirmClear, setConfirmClear] = useState(false);
  const clear = useMutation({ mutationFn: () => ipc.invoke('history.clear') });
  const empty = history.isSuccess && history.data.length === 0 && debounced === '';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-5">
          <div>
            <h1 className="text-xl font-semibold">{t('nav.history')}</h1>
            <p className="text-xs text-muted-foreground">{t('history.subtitle')}</p>
          </div>
          {!empty && (
            <div className="ml-auto flex items-center gap-2">
              <SearchField value={query} onChange={setQuery} placeholder={t('history.search')} className="w-64" />
              <Button
                variant="ghost"
                className="h-8 border border-destructive/50 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 />
                {t('history.clearAll')}
              </Button>
            </div>
          )}
        </header>

        <IncognitoBanner />

        {history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : empty ? (
          <EmptyState icon={History} title={t('empty.history.title')} description={t('empty.history.description')} />
        ) : history.data?.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">{t('history.noResults', { query: debounced })}</p>
        ) : (
          groups.map((group) => (
            <section key={`${group.kind}-${group.day}`} className="flex flex-col gap-2.5">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {group.kind === 'date' ? formatDay(group.day, i18n.language) : t(`history.groups.${group.kind}`)}
              </h2>
              {group.items.map((entry) => (
                <HistoryRow key={entry.mangaId} entry={entry} group={group.kind} />
              ))}
            </section>
          ))
        )}
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('history.clearTitle')}
        description={t('history.clearDescription')}
        confirmLabel={t('history.clearConfirm')}
        onConfirm={() => clear.mutate()}
      />
    </div>
  );
}

/** "12 Sep" (with the year when it isn't this one). */
function formatDay(day: number, language: string): string {
  const sameYear = new Date(day).getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(day);
}

/** "Incognito mode is off — reading is being recorded · Turn on" (mockup 10). */
function IncognitoBanner() {
  const { t } = useTranslation();
  const [on, setOn] = useIncognito();
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm',
        on ? 'border-ctp-peach/40 bg-ctp-peach/10 text-ctp-peach' : 'bg-card/40 text-muted-foreground',
      )}
    >
      <EyeOff className="size-4.5 shrink-0" />
      <span className="flex-1">{on ? t('incognito.bannerOn') : t('incognito.bannerOff')}</span>
      <Button variant="ghost" size="sm" className="text-primary" onClick={() => setOn(!on)}>
        {on ? t('incognito.turnOff') : t('incognito.turnOn')}
      </Button>
    </div>
  );
}

function HistoryRow({ entry, group }: { entry: HistoryEntry; group: HistoryGroup<unknown>['kind'] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const remove = useMutation({ mutationFn: () => ipc.invoke('history.remove', { mangaId: entry.mangaId }) });
  const open = (chapterId: number) =>
    void navigate({ to: '/reader/$chapterId', params: { chapterId: String(chapterId) } });
  // A finished chapter continues with the next unread one (main picks it, like the detail page).
  const resume = useMutation({
    mutationFn: async () =>
      entry.read
        ? ((await ipc.invoke('manga.continue', { mangaId: entry.mangaId }))?.chapterId ?? entry.chapterId)
        : entry.chapterId,
    onSuccess: open,
  });
  const readAgain = entry.read && !entry.hasUnread;
  const percent = entry.read ? 100 : entry.totalPages ? Math.round(((entry.lastPage + 1) / entry.totalPages) * 100) : 0;
  const when = new Intl.DateTimeFormat(
    i18n.language,
    group === 'today' || group === 'yesterday'
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: 'numeric', month: 'short' },
  ).format(entry.readAt);
  const page = entry.read
    ? t('history.finished')
    : entry.totalPages
      ? t('history.page', { page: entry.lastPage + 1, total: entry.totalPages })
      : t('history.pageNoTotal', { page: entry.lastPage + 1 });

  return (
    <article
      data-testid="history-entry"
      className="flex items-center gap-4 rounded-xl border bg-card/40 p-2.5 pr-4 transition-colors hover:border-input"
    >
      <Link to="/manga/$mangaId" params={{ mangaId: String(entry.mangaId) }} className="shrink-0">
        <CoverImage
          mangaId={entry.mangaId}
          coverKey={entry.coverKey}
          alt=""
          className="aspect-[2/3] w-12 rounded-md border"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/manga/$mangaId"
            params={{ mangaId: String(entry.mangaId) }}
            className="truncate text-[15px] font-medium hover:underline"
          >
            {entry.title}
          </Link>
          {entry.sourceName && (
            <span className="shrink-0 rounded border bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              {entry.sourceName}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          <span className="text-foreground/85">{entry.chapterName}</span> · {page}
          <span className="px-2">·</span>
          {when}
        </p>
        <div className="flex items-center gap-2">
          <div className="h-1 w-56 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', readAgain ? 'bg-ctp-green' : 'bg-primary')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className={cn('text-[11px] text-muted-foreground', readAgain && 'text-ctp-green')}>{percent}%</span>
        </div>
      </div>
      {readAgain ? (
        <Button variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
          <RotateCcw />
          {t('history.readAgain')}
        </Button>
      ) : (
        <Button onClick={() => resume.mutate()} disabled={resume.isPending}>
          <Play className="fill-current" />
          {t('history.resume')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        title={t('history.remove')}
        className="hover:text-destructive"
        onClick={() => remove.mutate()}
      >
        <Trash2 />
      </Button>
    </article>
  );
}
