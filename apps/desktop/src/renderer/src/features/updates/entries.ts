import type { UpdateEntry } from '@manga-reader/shared';
import type { HistoryGroup } from '../history/groups';

export type UpdateRowEntry =
  | { kind: 'group'; group: HistoryGroup<UpdateEntry> }
  | { kind: 'chapter'; entry: UpdateEntry; first: boolean; last: boolean };

/** Day groups as one list of rows (a header, then its chapters), for the virtualized list. */
export function flattenGroups(groups: readonly HistoryGroup<UpdateEntry>[]): UpdateRowEntry[] {
  return groups.flatMap<UpdateRowEntry>((group) => [
    { kind: 'group', group },
    ...group.items.map((entry, index) => ({
      kind: 'chapter' as const,
      entry,
      first: index === 0,
      last: index === group.items.length - 1,
    })),
  ]);
}
