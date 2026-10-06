import {
  type MangaInfo,
  TRACK_STATUSES,
  type TrackEntry,
  type TrackPatch,
  type TrackerInfo,
} from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useErrorText } from '../../lib/errors';
import { ipc } from '../../lib/ipc';
import { fromDateInput, toDateInput, trackersQuery, tracksQuery } from '../../lib/trackers';
import { Toggle } from '../settings/controls';

/**
 * Tracking of one manga (ADR 0035): link it to its entry on each connected tracker, then edit the
 * entry. Chapters read are sent by main on their own; edits here are saved at once and sent when
 * the tracker can be reached.
 */
export function TrackingDialog({
  manga,
  open,
  onOpenChange,
}: {
  manga: MangaInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(36rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t('tracking.title')}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted-foreground">{t('tracking.description')}</Dialog.Description>
          {/* Mounted only while open, so every opening starts fresh. */}
          <TrackingBody manga={manga} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TrackingBody({ manga }: { manga: MangaInfo }) {
  const { t } = useTranslation();
  const { data: trackers = [] } = useQuery(trackersQuery);
  const usable = trackers.filter((tracker) => tracker.connected && !tracker.expired);
  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="tracking-none">
        {t('tracking.none')}{' '}
        <Link to="/settings/$section" params={{ section: 'tracking' }} className="text-primary underline">
          {t('tracking.openSettings')}
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {usable.map((tracker) => (
        <ServiceSection key={tracker.service} manga={manga} tracker={tracker} />
      ))}
    </div>
  );
}

function ServiceSection({ manga, tracker }: { manga: MangaInfo; tracker: TrackerInfo }) {
  const { data: tracks = [] } = useQuery(tracksQuery(manga.id));
  const track = tracks.find((entry) => entry.service === tracker.service);
  return (
    <section aria-label={tracker.name} data-testid={`tracking-${tracker.service}`} className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold">{tracker.name}</h3>
      {track ? <LinkedEditor track={track} tracker={tracker} /> : <SearchAndLink manga={manga} tracker={tracker} />}
    </section>
  );
}

function SearchAndLink({ manga, tracker }: { manga: MangaInfo; tracker: TrackerInfo }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(manga.title);
  const [submitted, setSubmitted] = useState(manga.title);
  const results = useQuery({
    queryKey: ['tracker-search', tracker.service, submitted] as const,
    queryFn: () => ipc.invoke('trackers.search', { service: tracker.service, query: submitted }),
    enabled: submitted.trim() !== '',
    staleTime: 60_000,
    retry: false,
  });
  const link = useMutation({
    mutationFn: (result: { remoteId: string; url: string; title: string }) =>
      ipc.invoke('trackers.link', {
        mangaId: manga.id,
        service: tracker.service,
        remoteId: result.remoteId,
        remoteUrl: result.url,
        title: result.title,
      }),
  });
  const searchError = useErrorText(results.error);
  const linkError = useErrorText(link.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(query.trim());
  };
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} role="search" className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('tracking.search', { name: tracker.name })}
          aria-label={t('tracking.search', { name: tracker.name })}
          className="pl-9"
        />
      </form>
      {results.isFetching && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('tracking.searching')} />
      )}
      {results.isError && (
        <p role="alert" className="text-xs text-destructive">
          {searchError.title}: {searchError.detail}
        </p>
      )}
      {results.data?.length === 0 && <p className="text-xs text-muted-foreground">{t('tracking.noResults')}</p>}
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="tracking-results">
        {results.data?.map((result) => (
          <li key={result.remoteId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{result.title}</span>
              {result.detail && <span className="text-xs text-muted-foreground">{result.detail}</span>}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={link.isPending}
              onClick={() => link.mutate(result)}
              aria-label={t('tracking.linkTo', { title: result.title })}
            >
              {t('tracking.link')}
            </Button>
          </li>
        ))}
      </ul>
      {link.isError && (
        <p role="alert" className="text-xs text-destructive">
          {linkError.title}: {linkError.detail}
        </p>
      )}
    </div>
  );
}

const FIELD = 'flex flex-col gap-1 text-xs text-muted-foreground';

function LinkedEditor({ track, tracker }: { track: TrackEntry; tracker: TrackerInfo }) {
  const { t } = useTranslation();
  const update = useMutation({
    mutationFn: (patch: TrackPatch) =>
      ipc.invoke('trackers.update', { mangaId: track.mangaId, service: track.service, patch }),
  });
  const unlink = useMutation({
    mutationFn: () => ipc.invoke('trackers.unlink', { mangaId: track.mangaId, service: track.service }),
  });
  const sync = useMutation({
    mutationFn: () => ipc.invoke('trackers.sync', { service: track.service, mangaId: track.mangaId }),
  });
  const error = useErrorText(update.error ?? sync.error);
  const save = (patch: TrackPatch) => update.mutate(patch);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" data-testid="tracking-linked">
          {t('tracking.linkedTo', { title: track.remoteTitle ?? track.remoteId })}
        </span>
        {track.remoteUrl && (
          <a
            href={track.remoteUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t('tracking.openOn', { name: tracker.name })}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD}>
          {t('tracking.status')}
          <select
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
            value={track.status ?? ''}
            onChange={(event) => save({ status: (event.target.value || null) as TrackEntry['status'] })}
          >
            <option value="">—</option>
            {TRACK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`tracking.statuses.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label={t('tracking.progress')}
          key={`p${track.progress}`}
          value={track.progress}
          step={1}
          max={100000}
          onCommit={(value) => save({ progress: value === null ? null : Math.round(value) })}
        />
        <NumberField
          label={t('tracking.score')}
          key={`c${track.score}`}
          value={track.score}
          step={0.5}
          max={10}
          onCommit={(value) => save({ score: value })}
        />
        <span />
        <label className={FIELD}>
          {t('tracking.started')}
          <Input
            type="date"
            defaultValue={toDateInput(track.startedAt)}
            key={`s${track.startedAt}`}
            onBlur={(event) => {
              const next = fromDateInput(event.target.value);
              if (next !== track.startedAt) save({ startedAt: next });
            }}
          />
        </label>
        <label className={FIELD}>
          {t('tracking.finished')}
          <Input
            type="date"
            defaultValue={toDateInput(track.finishedAt)}
            key={`f${track.finishedAt}`}
            onBlur={(event) => {
              const next = fromDateInput(event.target.value);
              if (next !== track.finishedAt) save({ finishedAt: next });
            }}
          />
        </label>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Toggle
          checked={track.syncBack}
          label={t('tracking.syncBack', { name: tracker.name })}
          onChange={(value) => save({ syncBack: value })}
        />
        <span className="min-w-0 flex-1">{t('tracking.syncBack', { name: tracker.name })}</span>
        <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending && <Loader2 className="animate-spin" />}
          {t('tracking.syncNow')}
        </Button>
      </div>
      {sync.data && (
        <p className="text-xs text-muted-foreground" data-testid="tracking-synced">
          {t('tracking.synced', sync.data)}
        </p>
      )}

      <div className="flex items-center gap-3">
        {track.pending && (
          <span className="text-xs text-ctp-yellow" data-testid="tracking-pending">
            {t('tracking.pending')}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => unlink.mutate()}>
          {t('tracking.unlink')}
        </Button>
      </div>
      {(update.isError || sync.isError) && (
        <p role="alert" className="text-xs text-destructive">
          {error.title}: {error.detail}
        </p>
      )}
    </div>
  );
}

/** A number typed freely and saved when the field is left (empty clears it). */
function NumberField({
  label,
  value,
  step,
  max,
  onCommit,
}: {
  label: string;
  value: number | null;
  step: number;
  max: number;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const commit = () => {
    const trimmed = text.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > max)) {
      setText(value === null ? '' : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <label className={FIELD}>
      {label}
      <Input
        type="number"
        min={0}
        max={max}
        step={step}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
    </label>
  );
}
