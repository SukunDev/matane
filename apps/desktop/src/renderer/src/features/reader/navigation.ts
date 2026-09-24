import type { ReaderSettings } from '@manga-reader/shared';

// Chapter navigation lives in @manga-reader/shared so main (continue reading) uses the same rules.
export {
  adjacentChapter,
  missingBetween,
  resolveDirection,
  resolveMode,
  type ResolvedDirection,
  type ResolvedMode,
} from '@manga-reader/shared/chapters';

export type TapAction = 'prev' | 'next' | 'menu';

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Pairs pages into two-page spreads. Wide pages (already a spread) stand alone; `shift` shows the
 * first page alone so covers and printed spreads line up. Unknown sizes count as portrait.
 */
export function buildSpreads(
  count: number,
  sizeOf: (index: number) => PageSize | undefined,
  shift: boolean,
): number[][] {
  const wide = (index: number) => {
    const size = sizeOf(index);
    return size !== undefined && size.width > size.height;
  };
  const spreads: number[][] = [];
  let index = 0;
  if (shift && count > 0) spreads.push([index++]);
  while (index < count) {
    if (wide(index) || index + 1 >= count || wide(index + 1)) {
      spreads.push([index++]);
    } else {
      spreads.push([index, index + 1]);
      index += 2;
    }
  }
  return spreads;
}

/**
 * Maps a click (x, y in 0…1 of the reader) to an action for a tap-zone preset. Zones are drawn for
 * left-to-right reading; right-to-left mirrors prev/next horizontally.
 */
export function tapAction(zones: ReaderSettings['tapZones'], x: number, y: number, rtl: boolean): TapAction {
  const third = (v: number) => (v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2);
  const col = third(x);
  const row = third(y);
  const flip = (action: TapAction): TapAction =>
    rtl && action !== 'menu' ? (action === 'prev' ? 'next' : 'prev') : action;
  switch (zones) {
    case 'off':
      return 'menu';
    case 'l':
      // Mihon's "L": left column + top middle go back, right column + bottom middle go forward.
      if (col === 0) return flip('prev');
      if (col === 2) return flip('next');
      return row === 0 ? flip('prev') : row === 2 ? flip('next') : 'menu';
    case 'kindle':
      if (col === 1 && row === 0) return 'menu';
      return col === 0 ? flip('prev') : flip('next');
    case 'edges':
      // Both edges go forward (one-handed reading); the bottom middle goes back.
      if (col !== 1) return 'next';
      return row === 2 ? 'prev' : 'menu';
    case 'lr':
      if (col === 1 && row === 1) return 'menu';
      return x < 0.5 ? flip('prev') : flip('next');
  }
}

export const ZONE_COLUMNS = 6;
export const ZONE_ROWS = 3;

/**
 * The tap-zone preset sampled on a 6×3 grid (row-major), for drawing it. Six columns line up with
 * both the thirds (L, Kindle, edges) and the halves (left/right) the presets use.
 */
export function zoneGrid(zones: ReaderSettings['tapZones'], rtl: boolean): TapAction[] {
  const cells: TapAction[] = [];
  for (let row = 0; row < ZONE_ROWS; row++) {
    for (let col = 0; col < ZONE_COLUMNS; col++) {
      cells.push(tapAction(zones, (col + 0.5) / ZONE_COLUMNS, (row + 0.5) / ZONE_ROWS, rtl));
    }
  }
  return cells;
}
