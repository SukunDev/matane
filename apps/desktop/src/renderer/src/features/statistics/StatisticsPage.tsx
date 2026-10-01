import { STATS_RANGES, type StatsOverview, type StatsRange } from '@manga-reader/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, ChartColumn, Clock, EyeOff, Flame, LibraryBig, Table2, Trophy } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { useColorScheme } from '../../theme/useColorScheme';
import { Segmented } from '../settings/controls';

const HOUR_MS = 60 * 60 * 1000;

// Reading sessions send no change events: read again whenever the page opens.
const statsQuery = (range: StatsRange) => ({
  queryKey: ['stats', range] as const,
  queryFn: () => ipc.invoke('stats.overview', { range }),
  staleTime: 0,
  retry: false,
});

/**
 * Categorical colours for the sources breakdown: the first four slots of the validated reference
 * palette (adjacent CVD ΔE ≥ 8, light and dark steps); the rest folds into a grey "Other".
 */
const SOURCE_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500'],
} as const;
const MAX_SOURCES = 4;

/** Statistics (BRAINSTORM.md §6.3, mockup 14). */
export function StatisticsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<StatsRange>('month');
  // The previous period stays on screen while the next one loads (no flash, view state kept).
  const { data, error, refetch, isPending } = useQuery({ ...statsQuery(range), placeholderData: keepPreviousData });
  const all = useQuery(statsQuery('all'));
  const nothing = all.data && all.data.readingMs === 0 && all.data.chaptersRead === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.statistics')}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <EyeOff className="size-3.5" />
            {t('stats.incognitoNote')}
          </p>
        </div>
        <Segmented
          label={t('stats.range.label')}
          options={STATS_RANGES}
          value={range}
          onChange={setRange}
          format={(value) => t(`stats.range.${value}`)}
        />
      </header>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : nothing ? (
        <div className="rounded-xl border">
          <EmptyState icon={ChartColumn} title={t('stats.empty.title')} description={t('stats.empty.description')} />
        </div>
      ) : isPending || !data ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
          <Skeleton className="col-span-4 h-72" />
        </div>
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}

function Overview({ data }: { data: StatsOverview }) {
  const { t, i18n } = useTranslation();
  const number = (value: number, digits = 0) => value.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const formatDuration = (ms: number) => {
    const { value, unit } = duration(ms);
    return `${number(value, unit === 'h' ? 1 : 0)} ${t(unit === 'h' ? 'stats.hoursShort' : 'stats.minutesShort')}`;
  };
  const time = duration(data.readingMs);
  const perDay = Math.round(data.readingMs / 60_000 / data.days);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="stats-tiles">
        <Tile icon={BookOpen} label={t('stats.tiles.chapters')} value={number(data.chaptersRead)}>
          {t(`stats.tiles.in.${data.range}`)}
        </Tile>
        <Tile
          icon={Clock}
          label={t('stats.tiles.time')}
          value={number(time.value, time.unit === 'h' && time.value < 10 ? 1 : 0)}
          unit={t(time.unit === 'h' ? 'stats.hoursShort' : 'stats.minutesShort')}
        >
          {t('stats.tiles.perDay', { minutes: perDay })}
        </Tile>
        <Tile icon={LibraryBig} label={t('stats.tiles.library')} value={number(data.library.total)}>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ctp-green" />
            {t('stats.tiles.reading', { count: data.library.reading })}
          </span>
        </Tile>
        <Tile
          icon={Flame}
          label={t('stats.tiles.streak')}
          value={number(data.streak.current)}
          unit={t('stats.days', { count: data.streak.current })}
        >
          <span className="flex items-center gap-1.5">
            <Trophy className="size-3.5" />
            {t('stats.tiles.best', { count: data.streak.best })}
          </span>
        </Tile>
      </div>

      <ActivityCard data={data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('stats.genres.title')} description={t('stats.genres.description')}>
          {data.genres.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noneInRange')}</p>
          ) : (
            <GenreBars data={data} />
          )}
        </Card>
        <Card title={t('stats.top.title')} description={t('stats.top.description')}>
          {data.topManga.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noneInRange')}</p>
          ) : (
            <ol className="flex flex-col divide-y" data-testid="stats-top">
              {data.topManga.map((manga, i) => (
                <li key={manga.mangaId}>
                  <Link
                    to="/manga/$mangaId"
                    params={{ mangaId: String(manga.mangaId) }}
                    className="flex items-center gap-3 rounded-md py-2.5 hover:bg-accent/40"
                  >
                    <span className="w-6 text-right font-mono text-sm text-muted-foreground">#{i + 1}</span>
                    <CoverImage
                      mangaId={manga.mangaId}
                      coverKey={manga.coverKey}
                      alt=""
                      className="aspect-[2/3] w-9 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{manga.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[manga.author, manga.genres.join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold">
                        {t('stats.chaptersShort', { count: manga.chapters })}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">{formatDuration(manga.ms)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {data.sources.length > 0 && <SourcesCard data={data} />}
    </>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  children,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card/40 p-4">
      <p className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        <Icon className="size-4 text-primary" />
      </p>
      <p className="text-3xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
      <p className="text-xs text-muted-foreground">{children}</p>
    </section>
  );
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card/40 p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Reading time in hours, or in minutes under an hour (so a short session never reads "0 h"). */
function duration(ms: number): { value: number; unit: 'h' | 'min' } {
  return ms >= HOUR_MS ? { value: ms / HOUR_MS, unit: 'h' } : { value: Math.round(ms / 60_000), unit: 'min' };
}

/** Nice round axis steps (1, 2, 5 × 10ⁿ) for a maximum. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks.at(-1)! < max) ticks.push(Number((ticks.at(-1)! + step).toFixed(6)));
  return ticks;
}

/**
 * Chapters read or reading time over the period: one measure at a time on one axis (never two
 * scales on one chart), with a tooltip per column and a table view.
 */
function ActivityCard({ data }: { data: StatsOverview }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<'chapters' | 'time'>('chapters');
  const [table, setTable] = useState(false);
  const label = (start: number, long = false) =>
    new Date(start).toLocaleDateString(
      i18n.language,
      data.unit === 'day'
        ? { day: 'numeric', month: 'short' }
        : { month: long ? 'long' : 'short', ...(long || data.series.length > 12 ? { year: 'numeric' } : {}) },
    );
  const valueOf = (bucket: StatsOverview['series'][number]) =>
    metric === 'chapters' ? bucket.chapters : bucket.ms / HOUR_MS;
  const format = (value: number) =>
    metric === 'chapters'
      ? t('stats.chaptersShort', { count: value })
      : `${value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} ${t('stats.hoursShort')}`;

  return (
    <Card
      title={t(`stats.activity.${metric}.${data.unit}`)}
      description={t(`stats.tiles.in.${data.range}`)}
      action={
        <div className="flex items-center gap-2">
          <Segmented
            label={t('stats.activity.metric')}
            options={['chapters', 'time'] as const}
            value={metric}
            onChange={setMetric}
            format={(value) => t(`stats.activity.metrics.${value}`)}
          />
          <Button
            variant={table ? 'secondary' : 'ghost'}
            size="icon"
            aria-pressed={table}
            title={t('stats.activity.table')}
            onClick={() => setTable(!table)}
          >
            <Table2 />
          </Button>
        </div>
      }
    >
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm" data-testid="stats-table">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">{t(`stats.activity.period.${data.unit}`)}</th>
                <th className="py-1.5 text-right font-medium">{t('stats.activity.metrics.chapters')}</th>
                <th className="py-1.5 text-right font-medium">{t('stats.activity.metrics.time')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.series.map((bucket) => (
                <tr key={bucket.start}>
                  <td className="py-1.5">{label(bucket.start, true)}</td>
                  <td className="py-1.5 text-right font-mono">{bucket.chapters}</td>
                  <td className="py-1.5 text-right font-mono">
                    {(bucket.ms / HOUR_MS).toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ColumnChart
          values={data.series.map(valueOf)}
          labels={data.series.map((bucket) => label(bucket.start))}
          tooltips={data.series.map((bucket) => `${label(bucket.start, true)} · ${format(valueOf(bucket))}`)}
          format={(value) => value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
        />
      )}
    </Card>
  );
}

const CHART_HEIGHT = 240;
const AXIS_WIDTH = 40;
const LABEL_HEIGHT = 24;
/** Room above the plot for the top tick label. */
const TOP_PAD = 8;

function ColumnChart({
  values,
  labels,
  tooltips,
  format,
}: {
  values: number[];
  labels: string[];
  tooltips: string[];
  format: (value: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks.at(-1) || 1;
  const plot = Math.max(width - AXIS_WIDTH, 0);
  const band = values.length > 0 ? plot / values.length : 0;
  const barWidth = Math.max(Math.min(24, band - 2), 2);
  const y = (value: number) => CHART_HEIGHT - (value / top) * CHART_HEIGHT;
  // Label every column when they fit, else every few (always the last one).
  const every = Math.max(1, Math.ceil(48 / Math.max(band, 1)));

  return (
    // min-w-0 + overflow-hidden: the box follows the card when the window narrows (the drawn SVG
    // must not hold it at its old width).
    <div ref={box} className="relative w-full min-w-0 overflow-hidden" data-testid="stats-chart">
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT + LABEL_HEIGHT + TOP_PAD}
          viewBox={`0 ${-TOP_PAD} ${width} ${CHART_HEIGHT + LABEL_HEIGHT + TOP_PAD}`}
          role="img"
          aria-label={tooltips.join(', ')}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS_WIDTH} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
              <text
                x={AXIS_WIDTH - 8}
                y={y(tick)}
                dominantBaseline="middle"
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {format(tick)}
              </text>
            </g>
          ))}
          {values.map((value, i) => {
            const x = AXIS_WIDTH + i * band + (band - barWidth) / 2;
            const height = Math.max(CHART_HEIGHT - y(value), value > 0 ? 2 : 0);
            const r = Math.min(4, barWidth / 2, height);
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                data-testid="stats-column"
              >
                {/* Hit area: the whole band, taller than the column. */}
                <rect x={AXIS_WIDTH + i * band} y={0} width={band} height={CHART_HEIGHT} fill="transparent" />
                {height > 0 && (
                  <path
                    d={`M${x},${CHART_HEIGHT} V${CHART_HEIGHT - height + r} Q${x},${CHART_HEIGHT - height} ${x + r},${CHART_HEIGHT - height} H${x + barWidth - r} Q${x + barWidth},${CHART_HEIGHT - height} ${x + barWidth},${CHART_HEIGHT - height + r} V${CHART_HEIGHT} Z`}
                    className={cn('fill-primary transition-opacity', hover !== null && hover !== i && 'opacity-50')}
                  />
                )}
                {(i % every === 0 || i === values.length - 1) && (
                  <text
                    x={AXIS_WIDTH + i * band + band / 2}
                    y={CHART_HEIGHT + 16}
                    textAnchor="middle"
                    className={cn('fill-muted-foreground text-[10px]', hover === i && 'fill-foreground')}
                  >
                    {labels[i]}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={AXIS_WIDTH} x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} className="stroke-ctp-surface2" />
        </svg>
      )}
      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: AXIS_WIDTH + hover * band + band / 2,
            top: Math.max(y(values[hover] ?? 0) + TOP_PAD - 8, 16),
          }}
        >
          {tooltips[hover]}
        </div>
      )}
    </div>
  );
}

function GenreBars({ data }: { data: StatsOverview }) {
  const { t } = useTranslation();
  // Share of the chapters read (a chapter with three genres counts for each of them).
  const total = Math.max(data.chaptersRead, 1);
  const max = data.genres[0]?.chapters ?? 1;
  return (
    <div className="flex flex-col gap-3" data-testid="stats-genres">
      {data.genres.map((genre) => (
        <div key={genre.name}>
          <p className="mb-1 flex items-baseline justify-between text-sm">
            <span>{genre.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {`${Math.round((genre.chapters / total) * 100)}% · ${t('stats.chaptersShort', { count: genre.chapters })}`}
            </span>
          </p>
          <div className="h-1.5 rounded-full bg-ctp-surface0">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(genre.chapters / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {data.otherGenreChapters > 0 && (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {t('stats.genres.other', { count: data.otherGenreChapters })}
        </p>
      )}
    </div>
  );
}

function SourcesCard({ data }: { data: StatsOverview }) {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const total = data.sources.reduce((sum, s) => sum + s.chapters, 0);
  const shown = data.sources.slice(0, MAX_SOURCES);
  const rest = data.sources.slice(MAX_SOURCES).reduce((sum, s) => sum + s.chapters, 0);
  const parts = [
    ...shown.map((source, i) => ({
      key: source.sourceId,
      name: source.name,
      chapters: source.chapters,
      color: SOURCE_COLORS[scheme][i]!,
    })),
    ...(rest > 0
      ? [{ key: 'other', name: t('stats.sources.other'), chapters: rest, color: 'var(--catppuccin-color-overlay0)' }]
      : []),
  ];
  return (
    <Card
      title={t('stats.sources.title')}
      description={t('stats.sources.description')}
      action={
        <span className="font-mono text-sm text-muted-foreground">{t('stats.chaptersShort', { count: total })}</span>
      }
    >
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" data-testid="stats-sources">
        {parts.map((part) => (
          <div
            key={part.key}
            title={`${part.name} · ${t('stats.chaptersShort', { count: part.chapters })}`}
            style={{ width: `${(part.chapters / total) * 100}%`, backgroundColor: part.color }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {parts.map((part) => (
          <li key={part.key} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: part.color }} />
            <span>
              <span className="font-medium">{part.name}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">{`${Math.round((part.chapters / total) * 100)}%`}</span>
              <span className="block text-xs text-muted-foreground">
                {t('stats.sources.read', { count: part.chapters })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
