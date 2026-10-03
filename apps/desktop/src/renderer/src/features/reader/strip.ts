/** How many chapters the strip keeps loaded on each side of the one on screen. */
export const STRIP_WINDOW = 2;

/**
 * The loaded chapters of the strip that are still worth keeping: the one on screen and up to `keep`
 * on each side. The rest are dropped so a long read does not pile up memory.
 */
export function pruneSegments<T extends { chapter: { id: number } }>(
  segments: T[],
  currentChapterId: number,
  keep: number = STRIP_WINDOW,
): T[] {
  const at = segments.findIndex((segment) => segment.chapter.id === currentChapterId);
  if (at < 0) return segments;
  const kept = segments.slice(Math.max(at - keep, 0), at + keep + 1);
  return kept.length === segments.length ? segments : kept;
}
