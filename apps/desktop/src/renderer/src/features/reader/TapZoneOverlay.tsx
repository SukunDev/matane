import type { ReaderSettings } from '@manga-reader/shared';
import { ChevronsDown, ChevronsUp, Menu, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { type TapAction, ZONE_COLUMNS, ZONE_ROWS, zoneGrid } from './navigation';

const VISIBLE_MS = 2500;
const FADE_MS = 500;

const FILL: Record<TapAction, string> = {
  prev: 'bg-ctp-blue/30',
  next: 'bg-ctp-green/30',
  menu: 'bg-primary/25',
};
const LABEL: Record<TapAction, string> = {
  prev: 'bg-ctp-blue text-ctp-crust',
  next: 'bg-ctp-green text-ctp-crust',
  menu: 'bg-primary text-primary-foreground',
};

export interface ZoneLabel {
  action: TapAction;
  /** Label position in % of the reader (centre of its region, or of its closest cell). */
  left: number;
  top: number;
}

/**
 * One label per connected region (4-neighbourhood): e.g. both edges of the "edges" preset get one.
 * Placed at the region's centre, or at its closest own cell when the centre falls outside it (L).
 */
export function zoneLabels(cells: TapAction[]): ZoneLabel[] {
  const seen = new Set<number>();
  const labels: ZoneLabel[] = [];
  const col = (i: number) => i % ZONE_COLUMNS;
  const row = (i: number) => Math.floor(i / ZONE_COLUMNS);
  for (let startCell = 0; startCell < cells.length; startCell++) {
    if (seen.has(startCell)) continue;
    const action = cells[startCell]!;
    const region: number[] = [];
    const stack = [startCell];
    seen.add(startCell);
    while (stack.length > 0) {
      const i = stack.pop()!;
      region.push(i);
      const neighbours = [
        col(i) > 0 ? i - 1 : -1,
        col(i) < ZONE_COLUMNS - 1 ? i + 1 : -1,
        i - ZONE_COLUMNS,
        i + ZONE_COLUMNS,
      ];
      for (const n of neighbours) {
        if (n >= 0 && n < cells.length && !seen.has(n) && cells[n] === action) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const cx = region.reduce((sum, i) => sum + col(i) + 0.5, 0) / region.length;
    const cy = region.reduce((sum, i) => sum + row(i) + 0.5, 0) / region.length;
    const inside = region.includes(Math.floor(cy) * ZONE_COLUMNS + Math.floor(cx));
    const [x, y] = inside
      ? [cx, cy]
      : (() => {
          const nearest = region.reduce((a, b) => {
            const d = (i: number) => (col(i) + 0.5 - cx) ** 2 + (row(i) + 0.5 - cy) ** 2;
            return d(b) < d(a) ? b : a;
          });
          return [col(nearest) + 0.5, row(nearest) + 0.5];
        })();
    labels.push({ action, left: (x / ZONE_COLUMNS) * 100, top: (y / ZONE_ROWS) * 100 });
  }
  return labels;
}

/**
 * Shows where the tap zones are for ~3 s, then fades out (mounted afresh each time the preset
 * changes). Purely visual: clicks go through to the reader underneath.
 */
export function TapZoneOverlay({
  zones,
  rtl,
  continuous,
}: {
  zones: ReaderSettings['tapZones'];
  /** Paged right-to-left mirrors prev/next. */
  rtl: boolean;
  /** Webtoon/vertical: prev/next scroll instead of turning pages. */
  continuous: boolean;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'shown' | 'fading' | 'gone'>('shown');
  useEffect(() => {
    const fade = setTimeout(() => setPhase('fading'), VISIBLE_MS);
    const gone = setTimeout(() => setPhase('gone'), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, []);
  if (phase === 'gone') return null;

  const cells = zoneGrid(zones, rtl);
  const labels = zoneLabels(cells);
  const at = (col: number, row: number) =>
    col < ZONE_COLUMNS && row < ZONE_ROWS ? cells[row * ZONE_COLUMNS + col] : undefined;
  const text: Record<TapAction, string> = {
    prev: continuous ? t('reader.tapZones.scrollUp') : t('reader.tapZones.prev'),
    next: continuous ? t('reader.tapZones.scrollDown') : t('reader.tapZones.next'),
    menu: t('reader.tapZones.menu'),
  };
  const Icon = {
    prev: continuous ? ChevronsUp : SkipBack,
    next: continuous ? ChevronsDown : SkipForward,
    menu: Menu,
  };

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-10 grid transition-opacity duration-500',
        phase === 'fading' ? 'opacity-0' : 'opacity-100',
      )}
      style={{
        gridTemplateColumns: `repeat(${ZONE_COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${ZONE_ROWS}, 1fr)`,
      }}
    >
      {cells.map((action, i) => {
        const col = i % ZONE_COLUMNS;
        const row = Math.floor(i / ZONE_COLUMNS);
        return (
          <div
            key={i}
            className={cn(
              'border-dashed border-ctp-text/60',
              FILL[action],
              // Only draw a line where the action changes, so each zone reads as one shape.
              at(col + 1, row) !== undefined && at(col + 1, row) !== action && 'border-r-2',
              at(col, row + 1) !== undefined && at(col, row + 1) !== action && 'border-b-2',
            )}
          />
        );
      })}
      {labels.map(({ action, left, top }) => {
        const LabelIcon = Icon[action];
        return (
          <span
            key={`${action}-${left}-${top}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            className={cn(
              'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap shadow-lg',
              LABEL[action],
            )}
          >
            <LabelIcon className="size-4" />
            {text[action]}
          </span>
        );
      })}
      <p className="absolute top-16 left-1/2 -translate-x-1/2 rounded-full bg-ctp-crust/85 px-4 py-1.5 text-sm text-ctp-text shadow-lg">
        {t('reader.tapZones.title', { preset: t(`reader.settings.zones.${zones}`) })}
      </p>
    </div>
  );
}
