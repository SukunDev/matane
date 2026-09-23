import type { ChapterInfo, MangaInfo, ReaderSettings } from '@manga-reader/shared';

export type ResolvedMode = Exclude<ReaderSettings['mode'], 'auto'>;
export type ResolvedDirection = Exclude<ReaderSettings['direction'], 'auto'>;
export type TapAction = 'prev' | 'next' | 'menu';

/** "auto": long-strip formats (manhwa/manhua) read as webtoon, everything else page by page. */
export function resolveMode(mode: ReaderSettings['mode'], type: MangaInfo['type']): ResolvedMode {
  if (mode !== 'auto') return mode;
  return type === 'manhwa' || type === 'manhua' ? 'webtoon' : 'single';
}

/** "auto": Japanese manga right-to-left, everything else left-to-right. */
export function resolveDirection(direction: ReaderSettings['direction'], type: MangaInfo['type']): ResolvedDirection {
  if (direction !== 'auto') return direction;
  return type === 'manga' ? 'rtl' : 'ltr';
}

/**
 * The next (dir 1) or previous (dir -1) chapter to read. With chapter numbers, it is the nearest
 * number in that direction, preferring the same scanlator when several groups released it;
 * otherwise the neighbour in source order (which lists newest first).
 */
export function adjacentChapter(
  chapters: readonly ChapterInfo[],
  current: ChapterInfo,
  dir: 1 | -1,
): ChapterInfo | undefined {
  const present = chapters.filter((c) => !c.sourceMissing || c.id === current.id);
  if (current.number !== null) {
    const candidates = present.filter((c) => c.number !== null && (c.number - current.number!) * dir > 0);
    if (candidates.length > 0) {
      const nearest = candidates.reduce(
        (best, c) => (Math.abs(c.number! - current.number!) < Math.abs(best - current.number!) ? c.number! : best),
        candidates[0]!.number!,
      );
      const same = candidates.filter((c) => c.number === nearest);
      return same.find((c) => c.scanlator === current.scanlator) ?? same[0];
    }
    // Numbered chapters exhausted: fall through to source order (e.g. an unnumbered extra).
  }
  const index = present.findIndex((c) => c.id === current.id);
  if (index < 0) return undefined;
  // Source order is newest first, so "next" is one step towards the start of the list.
  const neighbour = present[index - dir];
  if (
    neighbour &&
    current.number !== null &&
    neighbour.number !== null &&
    (neighbour.number - current.number) * dir <= 0
  ) {
    return undefined;
  }
  return neighbour;
}

/** Whole chapters skipped between two chapters, e.g. 5 → 8 skips 2 (6 and 7). */
export function missingBetween(from: ChapterInfo, to: ChapterInfo): number {
  if (from.number === null || to.number === null) return 0;
  const gap = Math.abs(Math.floor(to.number) - Math.floor(from.number)) - 1;
  return Math.max(0, gap);
}

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
