// Chapter navigation shared by main (continue reading) and the reader. Zod-free, types only.
import type { ChapterInfo, MangaInfo } from './models';
import type { ReaderSettings } from './settings';

export type ResolvedMode = Exclude<ReaderSettings['mode'], 'auto'>;
export type ResolvedDirection = Exclude<ReaderSettings['direction'], 'auto'>;

/** "auto": long-strip formats (manhwa/manhua) read as webtoon, everything else page by page. */
export function resolveMode(mode: ReaderSettings['mode'], type: MangaInfo['type']): ResolvedMode {
  if (mode !== 'auto') return mode;
  return type === 'manhwa' || type === 'manhua' ? 'webtoon' : 'single';
}

/** "auto": Japanese manga right-to-left, everything else left-to-right. */
export function resolveDirection(direction: ReaderSettings['direction'], type: MangaInfo['type']): ResolvedDirection {
  if (direction !== 'auto') return direction;
  return type === 'manga' ? 'rtl' : 'ltr';
}

/**
 * The next (dir 1) or previous (dir -1) chapter to read. With chapter numbers, it is the nearest
 * number in that direction, preferring the same scanlator when several groups released it;
 * otherwise the neighbour in source order (which lists newest first).
 */
export function adjacentChapter(
  chapters: readonly ChapterInfo[],
  current: ChapterInfo,
  dir: 1 | -1,
): ChapterInfo | undefined {
  const present = chapters.filter((c) => !c.sourceMissing || c.id === current.id);
  if (current.number !== null) {
    const candidates = present.filter((c) => c.number !== null && (c.number - current.number!) * dir > 0);
    if (candidates.length > 0) {
      const nearest = candidates.reduce(
        (best, c) => (Math.abs(c.number! - current.number!) < Math.abs(best - current.number!) ? c.number! : best),
        candidates[0]!.number!,
      );
      const same = candidates.filter((c) => c.number === nearest);
      return same.find((c) => c.scanlator === current.scanlator) ?? same[0];
    }
    // Numbered chapters exhausted: fall through to source order (e.g. an unnumbered extra).
  }
  const index = present.findIndex((c) => c.id === current.id);
  if (index < 0) return undefined;
  // Source order is newest first, so "next" is one step towards the start of the list.
  const neighbour = present[index - dir];
  if (
    neighbour &&
    current.number !== null &&
    neighbour.number !== null &&
    (neighbour.number - current.number) * dir <= 0
  ) {
    return undefined;
  }
  return neighbour;
}

/** Whole chapters skipped between two chapters, e.g. 5 → 8 skips 2 (6 and 7). */
export function missingBetween(from: ChapterInfo, to: ChapterInfo): number {
  if (from.number === null || to.number === null) return 0;
  const gap = Math.abs(Math.floor(to.number) - Math.floor(from.number)) - 1;
  return Math.max(0, gap);
}

export type ContinueKind = 'start' | 'continue' | 'next' | 'reread';

export interface ContinueTarget {
  chapterId: number;
  kind: ContinueKind;
}

/** Oldest first, without chapters the source dropped. */
function readingOrder(chapters: readonly ChapterInfo[]): ChapterInfo[] {
  return chapters.filter((c) => !c.sourceMissing).reverse();
}

/**
 * Where "Continue reading" goes (BRAINSTORM.md §6.3):
 * 1. the chapter read last is unfinished → continue it;
 * 2. it is finished → the next unread chapter after it (by number);
 * 3. nothing read yet → the oldest unread chapter (the first one when none was marked read).
 * When everything is read, "read again" from the first chapter.
 */
export function continueChapter(
  chapters: readonly ChapterInfo[],
  lastReadChapterId: number | null,
): ContinueTarget | null {
  const order = readingOrder(chapters);
  if (order.length === 0) return null;
  const last = lastReadChapterId === null ? undefined : chapters.find((c) => c.id === lastReadChapterId);
  if (last) {
    if (!last.read) return { chapterId: last.id, kind: 'continue' };
    let next = adjacentChapter(chapters, last, 1);
    const seen = new Set<number>();
    while (next && next.read && !seen.has(next.id)) {
      seen.add(next.id);
      next = adjacentChapter(chapters, next, 1);
    }
    if (next && !next.read) return { chapterId: next.id, kind: 'next' };
  }
  const unread = order.find((c) => !c.read);
  if (unread) return { chapterId: unread.id, kind: last || order.some((c) => c.read) ? 'next' : 'start' };
  return { chapterId: order[0]!.id, kind: 'reread' };
}
