import type { ChapterInfo } from '@manga-reader/shared';
import { describe, expect, it } from 'vitest';
import {
  adjacentChapter,
  buildSpreads,
  missingBetween,
  resolveDirection,
  resolveMode,
  tapAction,
  zoneGrid,
} from './navigation';

let nextId = 1;
const ch = (number: number | null, scanlator: string | null = 'A', extra: Partial<ChapterInfo> = {}): ChapterInfo => ({
  id: nextId++,
  mangaId: 1,
  url: `c${nextId}`,
  name: `Ch. ${number}`,
  number,
  scanlator,
  uploadedAt: null,
  sourceOrder: 0,
  read: false,
  readAt: null,
  bookmarked: false,
  lastPage: 0,
  totalPages: null,
  pageOffset: null,
  sourceMissing: false,
  ...extra,
});

describe('reader modes', () => {
  it('resolves auto from the manga type', () => {
    expect(resolveMode('auto', 'manhwa')).toBe('webtoon');
    expect(resolveMode('auto', 'manga')).toBe('single');
    expect(resolveMode('double', 'manhwa')).toBe('double');
    expect(resolveDirection('auto', 'manga')).toBe('rtl');
    expect(resolveDirection('auto', null)).toBe('ltr');
  });
});

describe('adjacentChapter', () => {
  // Source order: newest first.
  const c5b = ch(5, 'B');
  const c5a = ch(5, 'A');
  const c4 = ch(4, 'A');
  const c2 = ch(2, 'A');
  const list = [c5b, c5a, c4, c2];

  it('goes to the nearest number, preferring the same scanlator', () => {
    expect(adjacentChapter(list, c4, 1)).toBe(c5a);
    expect(adjacentChapter(list, c4, -1)).toBe(c2);
    expect(adjacentChapter(list, c2, -1)).toBeUndefined();
    expect(adjacentChapter(list, c5b, 1)).toBeUndefined();
    expect(adjacentChapter(list, c5b, -1)).toBe(c4);
  });

  it('skips chapters the source removed and falls back to source order without numbers', () => {
    const gone = ch(3, 'A', { sourceMissing: true });
    expect(adjacentChapter([c4, gone, c2], c2, 1)).toBe(c4);
    const a = ch(null);
    const b = ch(null);
    expect(adjacentChapter([b, a], a, 1)).toBe(b);
    expect(adjacentChapter([b, a], b, -1)).toBe(a);
  });

  it('counts missing chapters', () => {
    expect(missingBetween(c2, c4)).toBe(1);
    expect(missingBetween(c4, c5a)).toBe(0);
    expect(missingBetween(ch(10.5), ch(11))).toBe(0);
  });
});

describe('buildSpreads', () => {
  const tall = { width: 700, height: 1000 };
  const wide = { width: 1400, height: 1000 };

  it('pairs portrait pages and keeps wide pages alone', () => {
    const sizes = [tall, tall, wide, tall, tall, tall];
    expect(buildSpreads(6, (i) => sizes[i], false)).toEqual([[0, 1], [2], [3, 4], [5]]);
  });

  it('shows the first page alone when shifted', () => {
    expect(buildSpreads(5, () => tall, true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(buildSpreads(0, () => tall, true)).toEqual([]);
  });
});

describe('tapAction', () => {
  it('maps the L preset and mirrors it for right-to-left', () => {
    expect(tapAction('l', 0.1, 0.5, false)).toBe('prev');
    expect(tapAction('l', 0.9, 0.5, false)).toBe('next');
    expect(tapAction('l', 0.5, 0.5, false)).toBe('menu');
    expect(tapAction('l', 0.5, 0.9, false)).toBe('next');
    expect(tapAction('l', 0.1, 0.5, true)).toBe('next');
  });

  it('supports the other presets', () => {
    expect(tapAction('kindle', 0.5, 0.1, false)).toBe('menu');
    expect(tapAction('kindle', 0.5, 0.5, false)).toBe('next');
    expect(tapAction('edges', 0.05, 0.5, true)).toBe('next');
    expect(tapAction('lr', 0.3, 0.1, true)).toBe('next');
    expect(tapAction('off', 0.1, 0.1, false)).toBe('menu');
  });
});

describe('zoneGrid', () => {
  const rows = (cells: string[]) => [cells.slice(0, 6), cells.slice(6, 12), cells.slice(12)].map((r) => r.join(' '));

  it('draws the L preset and mirrors it for right-to-left', () => {
    expect(rows(zoneGrid('l', false))).toEqual([
      'prev prev prev prev next next',
      'prev prev menu menu next next',
      'prev prev next next next next',
    ]);
    expect(rows(zoneGrid('l', true))[0]).toBe('next next next next prev prev');
  });

  it('splits halves for left/right and covers everything when off', () => {
    expect(rows(zoneGrid('lr', false))[1]).toBe('prev prev menu menu next next');
    expect(rows(zoneGrid('lr', false))[0]).toBe('prev prev prev next next next');
    expect(new Set(zoneGrid('off', false))).toEqual(new Set(['menu']));
  });
});

describe('zoneLabels', () => {
  it('labels every connected region once, inside its own cells', async () => {
    const { zoneLabels } = await import('./TapZoneOverlay');
    const edges = zoneLabels(zoneGrid('edges', false));
    expect(edges.filter((l) => l.action === 'next')).toHaveLength(2); // left and right edge
    const menu = edges.filter((l) => l.action === 'menu');
    expect(menu).toHaveLength(1);
    expect(menu[0]!.left).toBeCloseTo(50);
    expect(menu[0]!.top).toBeCloseTo(100 / 3);
    // The L-shaped "prev" region's centre lies outside it; its label moves into its own cells.
    const l = zoneLabels(zoneGrid('l', false));
    const prev = l.find((x) => x.action === 'prev')!;
    const cell = Math.floor((prev.top / 100) * 3) * 6 + Math.floor((prev.left / 100) * 6);
    expect(zoneGrid('l', false)[cell]).toBe('prev');
  });
});
