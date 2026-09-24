export type HistoryGroupKind = 'today' | 'yesterday' | 'week' | 'date';

export interface HistoryGroup<T> {
  kind: HistoryGroupKind;
  /** Local midnight of the group's day (for "date" groups; the start of the range otherwise). */
  day: number;
  items: T[];
}

/** Local midnight `daysAgo` days before `now` (calendar days, so DST shifts don't matter). */
const midnight = (now: number, daysAgo = 0) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo).getTime();
};

/**
 * Today / Yesterday / This week (the 5 days before) / one group per older day (mockup 10).
 * `items` must already be newest first; the order is kept.
 */
export function groupByDay<T>(items: readonly T[], readAt: (item: T) => number, now = Date.now()): HistoryGroup<T>[] {
  const today = midnight(now);
  const yesterday = midnight(now, 1);
  const week = midnight(now, 6);
  const groups: HistoryGroup<T>[] = [];
  for (const item of items) {
    const at = readAt(item);
    const [kind, day]: [HistoryGroupKind, number] =
      at >= today
        ? ['today', today]
        : at >= yesterday
          ? ['yesterday', yesterday]
          : at >= week
            ? ['week', week]
            : ['date', midnight(at)];
    const last = groups.at(-1);
    if (last?.kind === kind && last.day === day) last.items.push(item);
    else groups.push({ kind, day, items: [item] });
  }
  return groups;
}
