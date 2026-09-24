import { describe, expect, it } from 'vitest';
import { groupByDay } from './groups';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('groupByDay', () => {
  it('groups newest-first entries into today, yesterday, this week and older days', () => {
    const now = at(2026, 9, 24, 21);
    const entries = [
      at(2026, 9, 24, 20),
      at(2026, 9, 24, 0),
      at(2026, 9, 23, 23),
      at(2026, 9, 21),
      at(2026, 9, 18, 1),
      at(2026, 9, 17, 23),
      at(2026, 9, 12),
      at(2026, 9, 12, 8),
    ];
    const groups = groupByDay(entries, (x) => x, now);
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['today', 2],
      ['yesterday', 1],
      ['week', 2],
      ['date', 1],
      ['date', 2],
    ]);
    expect(groups[3]?.day).toBe(new Date(2026, 8, 17).getTime());
    expect(groups[4]?.day).toBe(new Date(2026, 8, 12).getTime());
  });

  it('returns nothing for no entries', () => {
    expect(groupByDay([], (x: number) => x)).toEqual([]);
  });
});
