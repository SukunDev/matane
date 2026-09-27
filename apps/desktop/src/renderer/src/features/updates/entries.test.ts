import type { UpdateEntry } from '@manga-reader/shared';
import { describe, expect, it } from 'vitest';
import { groupByDay } from '../history/groups';
import { flattenGroups } from './entries';

const entry = (chapterId: number, fetchedAt: number) => ({ chapterId, fetchedAt }) as UpdateEntry;

describe('flattenGroups', () => {
  it('puts each day header before its chapters and marks the first and last of a group', () => {
    const now = new Date(2026, 8, 27, 12).getTime();
    const day = 86_400_000;
    const groups = groupByDay(
      [entry(1, now - 1000), entry(2, now - 2000), entry(3, now - day)],
      (e) => e.fetchedAt,
      now,
    );
    const rows = flattenGroups(groups).map((row) =>
      row.kind === 'group'
        ? `group:${row.group.kind}`
        : `${row.entry.chapterId}${row.first ? ' first' : ''}${row.last ? ' last' : ''}`,
    );
    expect(rows).toEqual(['group:today', '1 first', '2 last', 'group:yesterday', '3 first last']);
  });
});
