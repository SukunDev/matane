import { describe, expect, it } from 'vitest';
import { adjacentChapter, continueChapter, pickVersion } from './chapters';
import type { ChapterInfo } from './models';

let nextId = 1;
const ch = (number: number | null, extra: Partial<ChapterInfo> = {}): ChapterInfo => ({
  id: nextId++,
  mangaId: 1,
  url: `c${nextId}`,
  name: `Ch. ${number}`,
  number,
  scanlator: 'A',
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

describe('continueChapter', () => {
  it('starts at the first chapter when nothing was read', () => {
    const [c3, c2, c1] = [ch(3), ch(2), ch(1)];
    expect(continueChapter([c3!, c2!, c1!], null)).toEqual({ chapterId: c1!.id, kind: 'start' });
  });

  it('continues an unfinished chapter', () => {
    const [c3, c2, c1] = [ch(3), ch(2, { lastPage: 5 }), ch(1, { read: true })];
    expect(continueChapter([c3!, c2!, c1!], c2!.id)).toEqual({ chapterId: c2!.id, kind: 'continue' });
  });

  it('moves to the next unread chapter after a finished one, skipping read ones', () => {
    const [c4, c3, c2, c1] = [ch(4), ch(3, { read: true }), ch(2, { read: true }), ch(1, { read: true })];
    expect(continueChapter([c4!, c3!, c2!, c1!], c2!.id)).toEqual({ chapterId: c4!.id, kind: 'next' });
  });

  it('falls back to the oldest unread without history, and re-reads when all are read', () => {
    const [c3, c2, c1] = [ch(3), ch(2), ch(1, { read: true })];
    expect(continueChapter([c3!, c2!, c1!], null)).toEqual({ chapterId: c2!.id, kind: 'next' });
    const done = [ch(2, { read: true }), ch(1, { read: true })];
    expect(continueChapter(done, done[0]!.id)).toEqual({ chapterId: done[1]!.id, kind: 'reread' });
    expect(continueChapter([], null)).toBeNull();
  });

  it('ignores chapters the source dropped', () => {
    const [c2, gone] = [ch(2), ch(1, { sourceMissing: true })];
    expect(continueChapter([c2!, gone!], null)).toEqual({ chapterId: c2!.id, kind: 'start' });
  });
});

describe('scanlator versions (BRAINSTORM.md §6.2)', () => {
  // Source order, newest first: chapter 3 by A and B, chapter 2 by A, B and C, chapter 1 by A.
  const make = () => {
    const c3b = ch(3, { scanlator: 'B', uploadedAt: 31 });
    const c3a = ch(3, { scanlator: 'A', uploadedAt: 30 });
    const c2c = ch(2, { scanlator: 'C', uploadedAt: 22 });
    const c2b = ch(2, { scanlator: 'B', uploadedAt: 21 });
    const c2a = ch(2, { scanlator: 'A', uploadedAt: 20 });
    const c1a = ch(1, { scanlator: 'A', uploadedAt: 10 });
    return { c3b, c3a, c2c, c2b, c2a, c1a, all: [c3b, c3a, c2c, c2b, c2a, c1a] };
  };
  const prefs = (priority: string[] = [], hidden: string[] = []) => ({ priority, hidden });

  it('picks the priority scanlator, then the previous one, then the newest upload', () => {
    const { c2c, c2b, c2a } = make();
    const versions = [c2c, c2b, c2a];
    expect(pickVersion(versions, prefs(['B', 'A']), 'A')).toBe(c2b);
    expect(pickVersion(versions, prefs(['Z']), 'A')).toBe(c2a);
    expect(pickVersion(versions, prefs(), 'Q')).toBe(c2c);
    expect(pickVersion(versions, prefs())).toBe(c2c);
    const noGroup = ch(2, { scanlator: null, uploadedAt: 1 });
    expect(pickVersion([c2a, noGroup], prefs(['']), 'A')).toBe(noGroup);
  });

  it('moves between numbers following the prefs and skipping hidden groups', () => {
    const { c3b, c3a, c2c, c2b, c2a, c1a, all } = make();
    expect(adjacentChapter(all, c1a, 1)).toBe(c2a); // same scanlator
    expect(adjacentChapter(all, c1a, 1, prefs(['C']))).toBe(c2c); // priority wins
    expect(adjacentChapter(all, c2c, 1)).toBe(c3b); // C has no chapter 3: newest
    expect(adjacentChapter(all, c2a, 1, prefs([], ['A']))).toBe(c3b); // hidden A is skipped
    expect(adjacentChapter(all, c3a, -1, prefs([], ['A', 'B', 'C']))).toBeUndefined();
    expect(adjacentChapter(all, c2b, -1, prefs([], ['A']))).toBeUndefined(); // chapter 1 only by A
  });

  it('continues with the preferred version and ignores hidden groups', () => {
    const { c3b, c2c, c2b, c2a, c1a, all } = make();
    expect(continueChapter(all, null, prefs(['B']))).toEqual({ chapterId: c1a.id, kind: 'start' });
    // Chapter 1 hidden: start at chapter 2, priority B.
    expect(continueChapter(all, null, prefs(['B'], ['A']))).toEqual({ chapterId: c2b.id, kind: 'start' });
    expect(continueChapter(all, null, prefs([], ['A']))).toEqual({ chapterId: c2c.id, kind: 'start' });
    const read = all.map((c) => (c.number === 1 ? { ...c, read: true } : c));
    expect(continueChapter(read, c1a.id, prefs(['C']))).toEqual({ chapterId: c2c.id, kind: 'next' });
    expect(continueChapter(read, c1a.id)).toEqual({ chapterId: c2a.id, kind: 'next' });
    const allRead = all.map((c) => ({ ...c, read: true }));
    expect(continueChapter(allRead, c3b.id, prefs(['B'], ['A']))).toEqual({ chapterId: c2b.id, kind: 'reread' });
  });
});
