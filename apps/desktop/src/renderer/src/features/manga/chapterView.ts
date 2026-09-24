import type { ChapterInfo, ChapterView, ScanlatorPrefs } from '@manga-reader/shared';
import { isHiddenScanlator, scanlatorKey } from '@manga-reader/shared/chapters';

/** The scanlator filter, unless that group has been hidden since (then: all). */
export const activeScanlator = (view: ChapterView, prefs: ScanlatorPrefs) =>
  view.scanlator !== null && !prefs.hidden.includes(view.scanlator) ? view.scanlator : null;

/**
 * The chapter list as shown (BRAINSTORM.md §6.2): hidden scanlators left out, filters applied, then
 * sorted by source order, number or upload date. Chapters without a number or date go last either
 * way; ties keep the source's order (newest first).
 */
export function viewChapters(
  chapters: readonly ChapterInfo[],
  view: ChapterView,
  prefs: ScanlatorPrefs,
): ChapterInfo[] {
  const scanlator = activeScanlator(view, prefs);
  const visible = chapters.filter(
    (c) =>
      !isHiddenScanlator(c, prefs) &&
      (!view.unreadOnly || !c.read) &&
      (!view.bookmarkedOnly || c.bookmarked) &&
      (scanlator === null || scanlatorKey(c) === scanlator),
  );
  if (view.sort === 'source') return view.descending ? visible : visible.reverse();
  const key = (c: ChapterInfo) => (view.sort === 'number' ? c.number : c.uploadedAt);
  const position = new Map(visible.map((c, index) => [c.id, index]));
  const sign = view.descending ? -1 : 1;
  return [...visible].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) {
      if (ka !== kb) return ka === null ? 1 : -1;
    } else if (ka !== kb) {
      return (ka - kb) * sign;
    }
    return (position.get(a.id)! - position.get(b.id)!) * (view.descending ? 1 : -1);
  });
}
