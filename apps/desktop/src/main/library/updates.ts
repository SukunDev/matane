import type {
  CategorySettings,
  UpdateProgress,
  UpdateResult,
  UpdateScope,
  UpdateSettings,
  UpdateEntry,
  UpdateStatus,
} from '@manga-reader/shared';
import { toAppErrorData } from '@manga-reader/shared/errors';
import { createLimiter } from '@manga-reader/shared/limit';
import type { ChapterRow } from '../db/repositories/chapters';
import type { UpdateTarget, UpdatesRepository } from '../db/repositories/updates';

/** Manga checked at once (docs/BRAINSTORM.md §6.4); each source's rate limit still applies. */
export const MAX_PARALLEL = 3;
const HOUR = 3_600_000;
/** How often the scheduler looks whether a check is due. */
const TICK_MS = 60_000;
/** Wait after start before the first look, so the app opens first. */
const START_DELAY_MS = 5_000;

/** When the next automatic check is due; null when automatic checks are off. */
export function nextCheckAt(lastCheckAt: number | null, intervalHours: number, now: number): number | null {
  if (intervalHours <= 0) return null;
  return lastCheckAt === null ? now : lastCheckAt + intervalHours * HOUR;
}

/** The skip rules (docs/BRAINSTORM.md §6.4): completed, never started, too many unread. */
export function skipReason(
  target: Pick<UpdateTarget, 'status' | 'started' | 'unread'>,
  settings: Pick<UpdateSettings, 'skipCompleted' | 'skipNotStarted' | 'skipUnreadOver'>,
): 'completed' | 'notStarted' | 'unread' | null {
  if (settings.skipCompleted && target.status === 'completed') return 'completed';
  if (settings.skipNotStarted && !target.started) return 'notStarted';
  if (settings.skipUnreadOver !== null && target.unread > settings.skipUnreadOver) return 'unread';
  return null;
}

/**
 * Whether new chapters of a manga in these categories are downloaded: never when one of them
 * excludes itself; when some category includes itself, only manga in such a category; otherwise all.
 */
export function autoDownloads(
  categoryIds: readonly number[],
  categories: ReadonlyMap<number, CategorySettings>,
): boolean {
  if (categoryIds.some((id) => categories.get(id)?.autoDownload === 'exclude')) return false;
  const included = [...categories.values()].some((c) => c.autoDownload === 'include');
  return !included || categoryIds.some((id) => categories.get(id)?.autoDownload === 'include');
}

/** "5 new chapters from 3 manga" and the first titles, in the app language (English or Indonesian). */
export function notificationText(
  language: string,
  newChapters: number,
  titles: readonly string[],
): { title: string; body: string } {
  const id = language.startsWith('id');
  const title = id
    ? `${newChapters} chapter baru dari ${titles.length} manga`
    : `${newChapters} new chapter${newChapters === 1 ? '' : 's'} from ${titles.length} manga`;
  const shown = titles.slice(0, 3).join(', ');
  const more = titles.length - 3;
  const body = more > 0 ? `${shown} ${id ? `dan ${more} lainnya` : `and ${more} more`}` : shown;
  return { title, body };
}

export interface UpdateServiceDeps {
  repo: Pick<UpdatesRepository, 'targets' | 'unseen' | 'list'>;
  settings: () => UpdateSettings;
  /** Small persistent values: last check, when the Updates page was seen, the last result. */
  store: {
    get: <T>(key: string, fallback: T) => T;
    set: (key: string, value: unknown) => void;
  };
  refresh: (mangaId: number, signal: AbortSignal, metadata: boolean) => Promise<{ newChapterIds: number[] }>;
  /** Chapters of a manga (auto-download picks the new unread ones not of hidden scanlators). */
  chapters: (mangaId: number) => ChapterRow[];
  hiddenScanlators: (mangaId: number) => readonly string[];
  categories: () => ReadonlyMap<number, CategorySettings>;
  /** Queues automatic downloads (refused past the size limit). */
  enqueueAuto: (chapterIds: number[]) => boolean;
  notify: (text: { title: string; body: string }) => void;
  language: () => string;
  isOnline: () => boolean;
  /** Whether the app window has focus (manual checks notify only when it has not). */
  focused: () => boolean;
  onProgress: (progress: UpdateProgress) => void;
  /** The Updates page and its badge changed. */
  changed: () => void;
  /** A check of the library (or a category) ran to its end, not cancelled: trackers are compared next. */
  finished?: () => void;
  log?: (message: string) => void;
  now?: () => number;
}

const LAST_CHECK_KEY = 'updates.lastCheckAt';
const SEEN_KEY = 'updates.seenAt';
const RESULT_KEY = 'updates.lastResult';

/**
 * The library update checker (docs/BRAINSTORM.md §6.4), in main: on a schedule (and at start when the
 * interval passed), or on demand for the library, a category or some manga. Three manga at a time;
 * cancellable; skip rules apply to library and category checks. Afterwards new chapters may be
 * downloaded, and a grouped desktop notification says what arrived.
 */
export class UpdateService {
  private progress: UpdateProgress | null = null;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly deps: UpdateServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Starts the scheduler: a first look shortly after start, then every minute. */
  start(): void {
    const first = setTimeout(() => this.tick(), START_DELAY_MS);
    const every = setInterval(() => this.tick(), TICK_MS);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.cancel();
  }

  /** Runs the automatic check when it is due. Offline, it waits for a later tick. */
  tick(): void {
    if (this.running) return;
    const due = nextCheckAt(this.lastCheckAt(), this.deps.settings().intervalHours, this.now());
    if (due === null || due > this.now() || !this.deps.isOnline()) return;
    this.check({ kind: 'all' }, 'auto');
  }

  check(
    scope: UpdateScope,
    trigger: 'auto' | 'manual' = 'manual',
  ): { started: boolean; reason: 'running' | 'offline' | 'empty' | null } {
    if (this.running) return { started: false, reason: 'running' };
    if (!this.deps.isOnline()) return { started: false, reason: 'offline' };
    const settings = this.deps.settings();
    let targets = this.deps.repo.targets(scope);
    if (scope.kind !== 'manga') targets = targets.filter((t) => skipReason(t, settings) === null);
    // Whole-library checks set the schedule, even if cancelled (else it would start right again).
    if (scope.kind === 'all') this.deps.store.set(LAST_CHECK_KEY, this.now());
    if (targets.length === 0) {
      this.deps.changed();
      return { started: false, reason: 'empty' };
    }
    this.controller = new AbortController();
    this.running = this.run(targets, settings, trigger, this.controller.signal, scope.kind !== 'manga').finally(() => {
      this.running = null;
      this.controller = null;
    });
    return { started: true, reason: null };
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Resolves once the running check (if any) finished (tests). */
  async idle(): Promise<void> {
    await this.running;
  }

  lastCheckAt(): number | null {
    return this.deps.store.get<number | null>(LAST_CHECK_KEY, null);
  }

  list(categoryId?: number): UpdateEntry[] {
    return this.deps.repo.list({ categoryId });
  }

  markSeen(): void {
    this.deps.store.set(SEEN_KEY, this.now());
    this.deps.changed();
  }

  status(): UpdateStatus {
    const lastCheckAt = this.lastCheckAt();
    return {
      progress: this.progress,
      lastCheckAt,
      nextCheckAt: nextCheckAt(lastCheckAt, this.deps.settings().intervalHours, this.now()),
      unseen: this.deps.repo.unseen(this.deps.store.get<number>(SEEN_KEY, 0)),
      lastResult: this.deps.store.get<UpdateResult | null>(RESULT_KEY, null),
    };
  }

  private emit(progress: UpdateProgress): void {
    this.progress = progress.running ? progress : null;
    this.deps.onProgress(progress);
  }

  private async run(
    targets: UpdateTarget[],
    settings: UpdateSettings,
    trigger: 'auto' | 'manual',
    signal: AbortSignal,
    wide: boolean,
  ): Promise<void> {
    const current: string[] = [];
    const found = new Map<number, number[]>();
    const errors: UpdateResult['errors'] = [];
    let done = 0;
    let newChapters = 0;
    const emit = (running = true) =>
      this.emit({ running, done, total: targets.length, current: [...current], newChapters, errors: errors.length });
    emit();

    const limit = createLimiter(MAX_PARALLEL);
    await Promise.allSettled(
      targets.map((target) =>
        limit(async () => {
          if (signal.aborted) return;
          current.push(target.title);
          emit();
          try {
            const { newChapterIds } = await this.deps.refresh(target.mangaId, signal, settings.refreshMetadata);
            if (newChapterIds.length > 0) {
              found.set(target.mangaId, newChapterIds);
              newChapters += newChapterIds.length;
            }
          } catch (error) {
            if (!signal.aborted) {
              const { message } = toAppErrorData(error);
              errors.push({ mangaId: target.mangaId, title: target.title, message });
              this.deps.log?.(`update check of "${target.title}" failed: ${message}`);
            }
          } finally {
            current.splice(current.indexOf(target.title), 1);
            done++;
            emit();
          }
        }, signal),
      ),
    );

    const result: UpdateResult = {
      finishedAt: this.now(),
      checked: done,
      newChapters,
      mangaWithNew: found.size,
      cancelled: signal.aborted,
      errors,
    };
    this.deps.store.set(RESULT_KEY, result);
    emit(false);
    this.deps.changed();
    if (wide && !signal.aborted) this.deps.finished?.();

    if (settings.autoDownload) this.autoDownload(targets, found, settings);
    if (newChapters > 0 && settings.notify && (trigger === 'auto' || !this.deps.focused())) {
      const titles = targets.filter((t) => found.has(t.mangaId)).map((t) => t.title);
      this.deps.notify(notificationText(this.deps.language(), newChapters, titles));
    }
  }

  private autoDownload(targets: UpdateTarget[], found: Map<number, number[]>, settings: UpdateSettings): void {
    const categories = this.deps.categories();
    const ids: number[] = [];
    for (const target of targets) {
      const added = found.get(target.mangaId);
      if (!added || !autoDownloads(target.categoryIds, categories)) continue;
      if (settings.autoDownloadOnlyReading && !target.started) continue;
      const fresh = new Set(added);
      const hidden = this.deps.hiddenScanlators(target.mangaId);
      for (const chapter of this.deps.chapters(target.mangaId)) {
        if (fresh.has(chapter.id) && !chapter.read && !hidden.includes(chapter.scanlator ?? '')) ids.push(chapter.id);
      }
    }
    if (ids.length > 0 && !this.deps.enqueueAuto(ids)) {
      this.deps.log?.(`size limit reached: ${ids.length} new chapter(s) not downloaded`);
    }
  }
}
