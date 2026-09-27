import type { DownloadItem } from '@manga-reader/shared';
import { describe, expect, it } from 'vitest';
import { applyOrder, etaSeconds, flatOrder, groupQueue, moveGroup, moveItem } from './queue';

const item = (id: number, mangaId: number, queueOrder: number): DownloadItem => ({
  id,
  chapterId: id * 10,
  mangaId,
  mangaTitle: `Manga ${mangaId}`,
  coverKey: null,
  sourceId: 's',
  sourceName: 'S',
  chapterName: `Ch. ${id}`,
  chapterNumber: id,
  scanlator: null,
  status: 'queued',
  queueOrder,
  pagesDone: 0,
  pagesTotal: null,
  error: null,
  format: 'cbz',
  path: null,
  sizeBytes: null,
  createdAt: 0,
  completedAt: null,
});

// Manga 1: items 1, 2, 4 · manga 2: item 3 (queued between them).
const items = [item(4, 1, 4), item(3, 2, 3), item(2, 1, 2), item(1, 1, 1)];

describe('download queue', () => {
  it('groups per manga in the order of their first chapter', () => {
    const groups = groupQueue(items);
    expect(groups.map((g) => [g.mangaId, g.items.map((i) => i.id)])).toEqual([
      [1, [1, 2, 4]],
      [2, [3]],
    ]);
    expect(flatOrder(groups)).toEqual([1, 2, 4, 3]);
  });

  it('moves a chapter within its manga, and a manga as a whole', () => {
    const groups = groupQueue(items);
    expect(moveItem(groups, 4, 1)).toEqual([4, 1, 2, 3]);
    expect(moveItem(groups, 1, 2)).toEqual([2, 1, 4, 3]);
    expect(moveItem(groups, 1, 3)).toBeNull(); // another manga
    expect(moveItem(groups, 1, 1)).toBeNull();
    expect(moveGroup(groups, 2, 1)).toEqual([3, 1, 2, 4]);
    expect(moveGroup(groups, 1, 1)).toBeNull();
  });

  it('applies a new order to the items', () => {
    const next = applyOrder(items, [3, 1, 2, 4]);
    expect(groupQueue(next).map((g) => g.mangaId)).toEqual([2, 1]);
  });

  it('estimates the time left from the average page size and the speed', () => {
    const live = { id: 1, chapterId: 10, pagesDone: 2, pagesTotal: 10, bytes: 2000, bytesPerSecond: 1000 };
    expect(etaSeconds(live)).toBe(8);
    expect(etaSeconds({ ...live, pagesDone: 0 })).toBeNull();
    expect(etaSeconds({ ...live, bytesPerSecond: 0 })).toBeNull();
    expect(etaSeconds(undefined)).toBeNull();
  });
});
