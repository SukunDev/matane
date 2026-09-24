import { describe, expect, it } from 'vitest';
import { continueChapter } from './chapters';
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
