// Chapter navigation shared by main (continue reading) and the reader. Zod-free, types only.
import type { ChapterInfo, MangaInfo, ScanlatorPrefs } from './models';
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

export const NO_SCANLATOR_PREFS: ScanlatorPrefs = { hidden: [], priority: [] };

/** Scanlator name as stored in the prefs ("" for chapters without a group). */
export const scanlatorKey = (chapter: Pick<ChapterInfo, 'scanlator'>) => chapter.scanlator ?? '';

/** Chapters of a hidden scanlator are left out of the list, unread counts and navigation. */
export const isHiddenScanlator = (chapter: ChapterInfo, prefs: ScanlatorPrefs) =>
  prefs.hidden.includes(scanlatorKey(chapter));

/**
 * One version among several releases of the same chapter number (BRAINSTORM.md §6.2): the highest
 * priority scanlator, else the same scanlator as the chapter read before, else the newest upload
 * (the source's order breaks ties; it lists newest first).
 */
export function pickVersion(
  versions: readonly ChapterInfo[],
  prefs: ScanlatorPrefs,
  previousScanlator?: string | null,
): ChapterInfo | undefined {
  let best: ChapterInfo | undefined;
  let bestRank = Infinity;
  for (const version of versions) {
    const rank = prefs.priority.indexOf(scanlatorKey(version));
    if (rank >= 0 && rank < bestRank) {
      best = version;
      bestRank = rank;
    }
  }
  if (best) return best;
  if (previousScanlator !== undefined) {
    const same = versions.find((v) => v.scanlator === previousScanlator);
    if (same) return same;
  }
  return versions.reduce<ChapterInfo | undefined>(
    (newest, v) => (!newest || (v.uploadedAt ?? -Infinity) > (newest.uploadedAt ?? -Infinity) ? v : newest),
    undefined,
  );
}

/**
 * The next (dir 1) or previous (dir -1) chapter to read. With chapter numbers, it is the nearest
 * number in that direction, one version picked by `pickVersion`; otherwise the neighbour in source
 * order (which lists newest first). Hidden scanlators are skipped.
 */
export function adjacentChapter(
  chapters: readonly ChapterInfo[],
  current: ChapterInfo,
  dir: 1 | -1,
  prefs: ScanlatorPrefs = NO_SCANLATOR_PREFS,
): ChapterInfo | undefined {
  const present = chapters.filter((c) => c.id === current.id || (!c.sourceMissing && !isHiddenScanlator(c, prefs)));
  if (current.number !== null) {
    const candidates = present.filter((c) => c.number !== null && (c.number - current.number!) * dir > 0);
    if (candidates.length > 0) {
      const nearest = candidates.reduce(
        (best, c) => (Math.abs(c.number! - current.number!) < Math.abs(best - current.number!) ? c.number! : best),
        candidates[0]!.number!,
      );
      return pickVersion(
        candidates.filter((c) => c.number === nearest),
        prefs,
        current.scanlator,
      );
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

/** Oldest first, without chapters the source dropped or of hidden scanlators. */
function readingOrder(chapters: readonly ChapterInfo[], prefs: ScanlatorPrefs): ChapterInfo[] {
  return chapters.filter((c) => !c.sourceMissing && !isHiddenScanlator(c, prefs)).reverse();
}

/** The preferred version of `chapter`'s number (itself when unnumbered). */
function preferredVersion(order: readonly ChapterInfo[], chapter: ChapterInfo, prefs: ScanlatorPrefs): ChapterInfo {
  if (chapter.number === null) return chapter;
  return pickVersion(
    order.filter((c) => c.number === chapter.number),
    prefs,
  )!;
}

/**
 * Where "Continue reading" goes (BRAINSTORM.md §6.3):
 * 1. the chapter read last is unfinished → continue it;
 * 2. it is finished → the next unread chapter after it (by number);
 * 3. nothing read yet → the oldest unread chapter (the first one when none was marked read).
 * When everything is read, "read again" from the first chapter. Versions follow the scanlator prefs.
 */
export function continueChapter(
  chapters: readonly ChapterInfo[],
  lastReadChapterId: number | null,
  prefs: ScanlatorPrefs = NO_SCANLATOR_PREFS,
): ContinueTarget | null {
  const order = readingOrder(chapters, prefs);
  if (order.length === 0) return null;
  const last = lastReadChapterId === null ? undefined : chapters.find((c) => c.id === lastReadChapterId);
  if (last) {
    if (!last.read) return { chapterId: last.id, kind: 'continue' };
    let next = adjacentChapter(chapters, last, 1, prefs);
    const seen = new Set<number>();
    while (next && next.read && !seen.has(next.id)) {
      seen.add(next.id);
      next = adjacentChapter(chapters, next, 1, prefs);
    }
    if (next && !next.read) return { chapterId: next.id, kind: 'next' };
  }
  const unread = order.find((c) => !c.read);
  if (unread) {
    const kind = last || order.some((c) => c.read) ? 'next' : 'start';
    return { chapterId: preferredVersion(order, unread, prefs).id, kind };
  }
  return { chapterId: preferredVersion(order, order[0]!, prefs).id, kind: 'reread' };
}
