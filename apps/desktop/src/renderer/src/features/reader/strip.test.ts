import { describe, expect, it } from 'vitest';
import { pruneSegments } from './strip';

const segments = (...ids: number[]) => ids.map((id) => ({ chapter: { id } }));
const ids = (list: { chapter: { id: number } }[]) => list.map((s) => s.chapter.id);

describe('pruneSegments', () => {
  it('keeps everything inside the window', () => {
    const list = segments(1, 2, 3);
    expect(pruneSegments(list, 2, 2)).toBe(list);
  });

  it('drops chapters far above the current one', () => {
    expect(ids(pruneSegments(segments(1, 2, 3, 4, 5, 6), 5, 2))).toEqual([3, 4, 5, 6]);
  });

  it('drops chapters far below the current one', () => {
    expect(ids(pruneSegments(segments(1, 2, 3, 4, 5, 6), 1, 2))).toEqual([1, 2, 3]);
  });

  it('drops on both sides', () => {
    expect(ids(pruneSegments(segments(1, 2, 3, 4, 5, 6, 7), 4, 1))).toEqual([3, 4, 5]);
  });

  it('leaves the list alone when the current chapter is not loaded', () => {
    const list = segments(1, 2);
    expect(pruneSegments(list, 9, 1)).toBe(list);
  });
});
