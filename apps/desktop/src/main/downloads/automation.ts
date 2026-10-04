import type { ChapterInfo, DeleteAfterRead, DownloadSettings, ScanlatorPrefs } from '@manga-reader/shared';
import { NO_SCANLATOR_PREFS, adjacentChapter, isHiddenScanlator } from '@manga-reader/shared/chapters';
import { type ChaptersRepository, toChapterInfo } from '../db/repositories/chapters';
import type { DownloadsRepository } from '../db/repositories/downloads';
import type { MangaRepository } from '../db/repositories/manga';
import type { DownloadManager } from './manager';

/**
 * Download ahead (docs/BRAINSTORM.md §6.4): the next `count` unread chapters after `current`, in
 * reading order, one version per number (`adjacentChapter` picks it with the scanlator prefs).
 */
export function chaptersAhead(
  chapters: readonly ChapterInfo[],
  current: ChapterInfo,
  count: number,
  prefs: ScanlatorPrefs = NO_SCANLATOR_PREFS,
): ChapterInfo[] {
  const result: ChapterInfo[] = [];
  const seen = new Set([current.id]);
  let at = current;
  while (result.length < count) {
    const next = adjacentChapter(chapters, at, 1, prefs);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    if (!next.read) result.push(next);
    at = next;
  }
  return result;
}

/**
 * Reading positions, oldest first: one per chapter number (holding every version of it), one per
 * unnumbered chapter. Chapters the source dropped or of hidden scanlators take no position.
 */
function positions(chapters: readonly ChapterInfo[], prefs: ScanlatorPrefs): ChapterInfo[][] {
  const byKey = new Map<string, ChapterInfo[]>();
  // Source order lists newest first.
  for (const chapter of [...chapters].reverse()) {
    if (chapter.sourceMissing || isHiddenScanlator(chapter, prefs)) continue;
    const key = chapter.number !== null ? `n${chapter.number}` : `c${chapter.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), chapter]);
  }
  return [...byKey.values()];
}

/**
 * Delete after reading (docs/BRAINSTORM.md §6.4): once `finished` is read, the chapters to delete are
 * those `delay` positions before it, provided every position from there up to `finished` is read
 * ("wait until N later chapters are read"). All read versions of that number go, except bookmarked
 * ones when `keepBookmarked`. Only chapters with a download matter; the caller filters those.
 */
export function chaptersToDelete(
  chapters: readonly ChapterInfo[],
  finished: ChapterInfo,
  rule: Pick<DeleteAfterRead, 'delay' | 'keepBookmarked'>,
  prefs: ScanlatorPrefs = NO_SCANLATOR_PREFS,
): ChapterInfo[] {
  const order = positions(chapters, prefs);
  const at = order.findIndex((versions) => versions.some((c) => c.id === finished.id));
  const target = at - rule.delay;
  if (at < 0 || target < 0) return [];
  const window = order.slice(target, at + 1);
  if (!window.every((versions) => versions.some((c) => c.read) || versions.some((c) => c.id === finished.id))) {
    return [];
  }
  return order[target]!.filter((c) => (c.read || c.id === finished.id) && !(rule.keepBookmarked && c.bookmarked));
}

export interface DownloadAutomationDeps {
  settings: () => DownloadSettings;
  manga: Pick<MangaRepository, 'info'>;
  chapters: Pick<ChaptersRepository, 'get' | 'list'>;
  downloads: Pick<DownloadsRepository, 'rowsForChapters'>;
  manager: Pick<DownloadManager, 'enqueueAuto' | 'delete'>;
  scanlatorPrefs: (mangaId: number) => ScanlatorPrefs;
  log?: (message: string) => void;
}

/**
 * Downloads that follow reading (docs/BRAINSTORM.md §6.4), driven by the reader's saved progress (so
 * nothing happens in incognito, where progress is not saved): download ahead for library manga,
 * and delete after reading.
 */
export class DownloadAutomation {
  /** Download ahead runs once per chapter opened, not on every page. */
  private lastAhead: number | null = null;

  constructor(private readonly deps: DownloadAutomationDeps) {}

  onProgress(event: { mangaId: number; chapterId: number; finished: boolean }): void {
    try {
      if (event.chapterId !== this.lastAhead) {
        this.lastAhead = event.chapterId;
        this.downloadAhead(event.mangaId, event.chapterId);
      }
      if (event.finished) {
        void this.deleteAfterRead(event.mangaId, event.chapterId).catch((error: unknown) =>
          this.deps.log?.(`delete after reading failed: ${String(error)}`),
        );
      }
    } catch (error) {
      this.deps.log?.(`download automation failed: ${String(error)}`);
    }
  }

  private list(mangaId: number): ChapterInfo[] {
    return this.deps.chapters.list(mangaId).map(toChapterInfo);
  }

  private downloadAhead(mangaId: number, chapterId: number): void {
    const count = this.deps.settings().ahead;
    if (count <= 0 || !this.deps.manga.info(mangaId)?.inLibrary) return;
    const list = this.list(mangaId);
    const current = list.find((c) => c.id === chapterId);
    if (!current) return;
    const ids = chaptersAhead(list, current, count, this.deps.scanlatorPrefs(mangaId)).map((c) => c.id);
    // Chapters already queued or downloaded keep their row (enqueue is idempotent).
    this.deps.manager.enqueueAuto(ids);
  }

  private async deleteAfterRead(mangaId: number, chapterId: number): Promise<void> {
    const rule = this.deps.settings().deleteAfterRead;
    if (!rule.enabled) return;
    const info = this.deps.manga.info(mangaId);
    if (!info || info.categoryIds.some((id) => rule.excludeCategoryIds.includes(id))) return;
    const list = this.list(mangaId);
    const finished = list.find((c) => c.id === chapterId);
    if (!finished) return;
    const candidates = chaptersToDelete(list, finished, rule, this.deps.scanlatorPrefs(mangaId)).map((c) => c.id);
    const done = this.deps.downloads
      .rowsForChapters(candidates)
      .filter((row) => row.status === 'done')
      .map((row) => row.chapterId);
    if (done.length > 0) await this.deps.manager.delete(done);
  }
}
