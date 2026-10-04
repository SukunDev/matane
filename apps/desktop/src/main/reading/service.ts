import type { ScanlatorPrefs } from '@manga-reader/shared';
import { type ContinueTarget, NO_SCANLATOR_PREFS, continueChapter } from '@manga-reader/shared/chapters';
import { type ChaptersRepository, toChapterInfo } from '../db/repositories/chapters';
import type { HistoryRepository } from '../db/repositories/history';
import type { ProgressRepository, SavedProgress } from '../db/repositories/progress';
import type { SessionRecorder } from './sessions';

export interface ReadingServiceDeps {
  progress: ProgressRepository;
  history: HistoryRepository;
  sessions: SessionRecorder;
  chapters: ChaptersRepository;
  /** A manga's hidden/preferred scanlators (none when omitted). */
  scanlatorPrefs?: (mangaId: number) => ScanlatorPrefs;
  /** Current incognito setting. */
  incognito: () => boolean;
  /** After progress was saved (download ahead, delete after reading). */
  onProgress?: (event: { mangaId: number; chapterId: number; finished: boolean }) => void;
  now?: () => number;
}

/**
 * Everything the reader records. Incognito is enforced here, once: while it is on, progress,
 * history and sessions are not written (docs/BRAINSTORM.md §6.3). Explicit actions such as "mark as
 * read" still apply; they are the user's edits, not reading activity.
 */
export class ReadingService {
  constructor(private readonly deps: ReadingServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  saveProgress(progress: SavedProgress): void {
    if (this.deps.incognito()) return;
    const saved = this.deps.progress.save(progress, this.now());
    if (!saved) return;
    this.deps.history.touch(saved.mangaId, progress.chapterId, this.now());
    this.deps.onProgress?.({ mangaId: saved.mangaId, chapterId: progress.chapterId, finished: saved.finished });
  }

  heartbeat(chapterId: number): void {
    if (this.deps.incognito()) {
      this.deps.sessions.end();
      return;
    }
    const chapter = this.deps.chapters.get(chapterId);
    if (chapter) this.deps.sessions.heartbeat(chapter.mangaId, chapterId);
  }

  endSession(): void {
    this.deps.sessions.end(this.now());
  }

  markRead(chapterIds: readonly number[], read: boolean): void {
    this.deps.progress.markRead(chapterIds, read, this.now());
  }

  markPreviousRead(chapterId: number): void {
    this.deps.progress.markPreviousRead(chapterId, this.now());
  }

  continueTarget(mangaId: number): ContinueTarget | null {
    const list = this.deps.chapters.list(mangaId).map(toChapterInfo);
    const prefs = this.deps.scanlatorPrefs?.(mangaId) ?? NO_SCANLATOR_PREFS;
    return continueChapter(list, this.deps.history.lastChapterId(mangaId), prefs);
  }
}
