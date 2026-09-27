import type { DownloadItem, DownloadProgress } from '@manga-reader/shared';

export type LiveProgress = DownloadProgress['items'][number];

export interface QueueGroup {
  mangaId: number;
  items: DownloadItem[];
}

/** Rows still in the queue (or failed there), in queue order. */
export const inQueue = (item: DownloadItem) => item.status !== 'done';

/** Queue items grouped per manga (mockup 08); groups in the order their first chapter is queued. */
export function groupQueue(items: readonly DownloadItem[]): QueueGroup[] {
  const groups = new Map<number, QueueGroup>();
  for (const item of [...items].sort((a, b) => a.queueOrder - b.queueOrder || a.id - b.id)) {
    const group = groups.get(item.mangaId) ?? { mangaId: item.mangaId, items: [] };
    group.items.push(item);
    groups.set(item.mangaId, group);
  }
  return [...groups.values()];
}

/** The queue order the groups show, first to last (what `downloads.reorder` takes). */
export const flatOrder = (groups: readonly QueueGroup[]) => groups.flatMap((g) => g.items.map((i) => i.id));

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Moves a chapter onto another chapter's place in the same manga (drag and drop, Alt+↑/↓).
 * Returns the new order, or null when nothing changes (another manga, same place).
 */
export function moveItem(groups: readonly QueueGroup[], id: number, targetId: number): number[] | null {
  const group = groups.find((g) => g.items.some((i) => i.id === id));
  if (!group || id === targetId) return null;
  const from = group.items.findIndex((i) => i.id === id);
  const to = group.items.findIndex((i) => i.id === targetId);
  if (to < 0) return null;
  return flatOrder(groups.map((g) => (g === group ? { ...g, items: move(g.items, from, to) } : g)));
}

/** Moves a whole manga onto another manga's place. */
export function moveGroup(groups: readonly QueueGroup[], mangaId: number, targetMangaId: number): number[] | null {
  const from = groups.findIndex((g) => g.mangaId === mangaId);
  const to = groups.findIndex((g) => g.mangaId === targetMangaId);
  if (from < 0 || to < 0 || from === to) return null;
  return flatOrder(move(groups, from, to));
}

/** Items in the new order with their `queueOrder` updated (optimistic update). */
export function applyOrder(items: readonly DownloadItem[], ids: readonly number[]): DownloadItem[] {
  const rank = new Map(ids.map((id, index) => [id, index + 1]));
  return items.map((item) => (rank.has(item.id) ? { ...item, queueOrder: rank.get(item.id)! } : item));
}

/** Seconds left for a running chapter, from its average page size and the current speed. */
export function etaSeconds(live: LiveProgress | undefined): number | null {
  if (!live?.pagesTotal || live.pagesDone === 0 || live.bytesPerSecond <= 0) return null;
  const left = ((live.pagesTotal - live.pagesDone) * live.bytes) / live.pagesDone;
  return left / live.bytesPerSecond;
}
