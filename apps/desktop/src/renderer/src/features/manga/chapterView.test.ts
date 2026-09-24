import { type ChapterInfo, DEFAULT_CHAPTER_VIEW } from '@manga-reader/shared';
import { describe, expect, it } from 'vitest';
import { viewChapters } from './chapterView';

let nextId = 1;
const ch = (name: string, number: number | null, uploadedAt: number | null, extra: Partial<ChapterInfo> = {}) =>
  ({
    id: nextId++,
    mangaId: 1,
    url: name,
    name,
    number,
    scanlator: 'A',
    uploadedAt,
    sourceOrder: 0,
    read: false,
    readAt: null,
    bookmarked: false,
    lastPage: 0,
    totalPages: null,
    pageOffset: null,
    sourceMissing: false,
    ...extra,
  }) satisfies ChapterInfo;

// Source order (newest first); the extra has no number and the source lists it oddly.
const list = [
  ch('c3', 3, 30),
  ch('extra', null, 35),
  ch('c2b', 2, 21, { scanlator: 'B', read: true }),
  ch('c2a', 2, 20, { bookmarked: true }),
  ch('c1', 1, null, { scanlator: null }),
];
const names = (chapters: ChapterInfo[]) => chapters.map((c) => c.name);
const none = { hidden: [], priority: [] };

describe('viewChapters', () => {
  it('keeps the source order, or reverses it', () => {
    expect(names(viewChapters(list, DEFAULT_CHAPTER_VIEW, none))).toEqual(['c3', 'extra', 'c2b', 'c2a', 'c1']);
    expect(names(viewChapters(list, { ...DEFAULT_CHAPTER_VIEW, descending: false }, none))).toEqual([
      'c1',
      'c2a',
      'c2b',
      'extra',
      'c3',
    ]);
  });

  it('sorts by number or date with missing values last and ties in source order', () => {
    const byNumber = { ...DEFAULT_CHAPTER_VIEW, sort: 'number' as const };
    expect(names(viewChapters(list, byNumber, none))).toEqual(['c3', 'c2b', 'c2a', 'c1', 'extra']);
    expect(names(viewChapters(list, { ...byNumber, descending: false }, none))).toEqual([
      'c1',
      'c2a',
      'c2b',
      'c3',
      'extra',
    ]);
    const byDate = { ...DEFAULT_CHAPTER_VIEW, sort: 'date' as const };
    expect(names(viewChapters(list, byDate, none))).toEqual(['extra', 'c3', 'c2b', 'c2a', 'c1']);
  });

  it('filters and leaves hidden scanlators out, ignoring a filter on a hidden group', () => {
    expect(names(viewChapters(list, { ...DEFAULT_CHAPTER_VIEW, unreadOnly: true }, none))).not.toContain('c2b');
    expect(names(viewChapters(list, { ...DEFAULT_CHAPTER_VIEW, bookmarkedOnly: true }, none))).toEqual(['c2a']);
    expect(names(viewChapters(list, { ...DEFAULT_CHAPTER_VIEW, scanlator: '' }, none))).toEqual(['c1']);
    const hideA = { hidden: ['A'], priority: [] };
    expect(names(viewChapters(list, DEFAULT_CHAPTER_VIEW, hideA))).toEqual(['c2b', 'c1']);
    expect(names(viewChapters(list, { ...DEFAULT_CHAPTER_VIEW, scanlator: 'A' }, hideA))).toEqual(['c2b', 'c1']);
  });
});
