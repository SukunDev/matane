import type {
  MigrationCandidate,
  MigrationOptions,
  MigrationProgress,
  MigrationResult,
  MigrationSearch,
} from '@manga-reader/shared';
import { pickVersion } from '@manga-reader/shared/chapters';
import { AppError, toAppErrorData } from '@manga-reader/shared/errors';
import { type ChaptersRepository, toChapterInfo } from '../db/repositories/chapters';
import type { HistoryRepository } from '../db/repositories/history';
import { type LibraryRepository, normalizeTitle } from '../db/repositories/library';
import { type MangaRepository, scanlatorPrefsOf } from '../db/repositories/manga';
import type { ProgressRepository } from '../db/repositories/progress';
import type { SourceService } from '../extensions/sources';
import type { CoverStore } from '../images/covers';
import type { ImageService } from '../images/service';
import type { LibraryService } from './service';

/** Below this title similarity a search result is not offered as a candidate. */
export const SIMILAR_MIN = 0.6;
const MAX_CANDIDATES = 10;

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/**
 * Title similarity from 0 to 1: 1 when the titles are equal once normalized (case, accents,
 * punctuation and spaces ignored), else the Dice coefficient of their character bigrams.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

export interface MigrationServiceDeps {
  manga: MangaRepository;
  chapters: ChaptersRepository;
  progress: ProgressRepository;
  history: HistoryRepository;
  library: LibraryRepository;
  libraryService: Pick<LibraryService, 'remove'>;
  sources: Pick<SourceService, 'browse' | 'refreshManga'>;
  covers: Pick<CoverStore, 'setCustom'>;
  images: Pick<ImageService, 'cover'>;
  /** Runs `work` in one database transaction. */
  transaction: <T>(work: () => T) => T;
  log?: (message: string) => void;
}

/**
 * Source migration (docs/BRAINSTORM.md §6.2): find the same manga in other sources, then move the
 * reading state over, matching chapters by number.
 */
export class MigrationService {
  constructor(private readonly deps: MigrationServiceDeps) {}

  async findCandidates(mangaId: number, targets: readonly string[], signal?: AbortSignal): Promise<MigrationSearch> {
    const row = this.deps.manga.get(mangaId);
    if (!row) throw new AppError('not_found', `Manga ${mangaId} not found`);
    const found: MigrationCandidate[] = [];
    const errors: MigrationSearch['errors'] = [];
    for (const sourceId of targets) {
      if (sourceId === row.sourceId) continue;
      let items;
      try {
        items = (await this.deps.sources.browse({ sourceId, kind: 'search', page: 1, query: row.title }, signal)).items;
      } catch (error) {
        if (signal?.aborted) throw error;
        const data = toAppErrorData(error);
        errors.push({ sourceId, code: data.code, message: data.message });
        continue;
      }
      const scored = items
        .map((item) => ({ sourceId, item, score: titleSimilarity(row.title, item.title) }))
        .filter((c) => c.score >= SIMILAR_MIN)
        .sort((a, b) => b.score - a.score)
        .map((c): MigrationCandidate => ({ ...c, match: c.score === 1 ? 'exact' : 'similar' }));
      found.push(...scored);
      // Targets are in priority order: an exact match settles it.
      if (scored[0]?.match === 'exact') break;
    }
    // Stable sort: on equal scores the earlier target wins.
    const candidates = [...found].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
    const best = found.find((c) => c.match === 'exact') ?? candidates[0] ?? null;
    return { best, candidates, errors };
  }

  /** One pair after another; a failure is reported and the rest go on. */
  async run(
    items: readonly { fromMangaId: number; toMangaId: number }[],
    options: MigrationOptions,
    onProgress: (progress: MigrationProgress) => void,
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    for (const [index, item] of items.entries()) {
      onProgress({ done: index, total: items.length, current: item.fromMangaId });
      try {
        results.push(await this.migrate(item.fromMangaId, item.toMangaId, options));
      } catch (error) {
        this.deps.log?.(`migration ${item.fromMangaId} → ${item.toMangaId} failed: ${String(error)}`);
        results.push({
          ...item,
          status: 'failed',
          error: toAppErrorData(error).message,
          readMatched: 0,
          unmatched: [],
        });
      }
    }
    onProgress({ done: items.length, total: items.length, current: null });
    return results;
  }

  private async migrate(fromMangaId: number, toMangaId: number, options: MigrationOptions): Promise<MigrationResult> {
    const { manga, chapters, progress, history, library } = this.deps;
    const from = manga.get(fromMangaId);
    const target = manga.get(toMangaId);
    if (!from || !target) throw new AppError('not_found', 'Manga not found');
    if (from.id === target.id) throw new AppError('unknown', 'A manga cannot be migrated to itself');

    // The new source's details and chapters, fresh: matching needs its chapter list.
    await this.deps.sources.refreshManga(toMangaId);

    const source = chapters.list(fromMangaId).map(toChapterInfo);
    const destination = chapters.list(toMangaId).map(toChapterInfo);
    const prefs = scanlatorPrefsOf(target);
    const versions = (number: number | null) => (number === null ? [] : destination.filter((c) => c.number === number));
    const fromInfo = manga.info(fromMangaId)!;
    const categoryIds = options.categories
      ? fromInfo.categoryIds
      : target.inLibrary
        ? (manga.info(toMangaId)?.categoryIds ?? [])
        : [];

    let readMatched = 0;
    const unmatched = new Set<string>();
    this.deps.transaction(() => {
      if (options.readStatus) {
        const read = new Set<number>();
        const numbers = new Map<number, (typeof source)[number]>();
        for (const chapter of source) {
          if (!chapter.read && chapter.lastPage === 0) continue;
          if (chapter.number === null || versions(chapter.number).length === 0) {
            if (chapter.read) unmatched.add(chapter.name);
            continue;
          }
          if (chapter.read) read.add(chapter.number);
          else if (!numbers.has(chapter.number)) numbers.set(chapter.number, chapter);
        }
        const readIds = [...read].flatMap((number) => versions(number).map((c) => c.id));
        if (readIds.length > 0) progress.markRead(readIds, true);
        readMatched = read.size;
        // A chapter in progress keeps its page when the new version has the same page count (or an
        // unknown one); the reader clamps it anyway.
        for (const [number, chapter] of numbers) {
          if (read.has(number) || chapter.totalPages === null) continue;
          const version = pickVersion(versions(number), prefs, chapter.scanlator);
          if (!version || (version.totalPages !== null && version.totalPages !== chapter.totalPages)) continue;
          progress.save({
            chapterId: version.id,
            page: chapter.lastPage,
            pageEnd: chapter.lastPage,
            total: chapter.totalPages,
            offset: chapter.pageOffset,
          });
        }
        const last = history.entry(fromMangaId);
        const lastChapter = last && source.find((c) => c.id === last.chapterId);
        const lastVersion = lastChapter && pickVersion(versions(lastChapter.number), prefs, lastChapter.scanlator);
        if (last && lastVersion) history.touch(toMangaId, lastVersion.id, last.readAt);
      }
      if (options.bookmarks) {
        const ids: number[] = [];
        for (const chapter of source.filter((c) => c.bookmarked)) {
          const matches = versions(chapter.number);
          if (matches.length === 0) unmatched.add(chapter.name);
          ids.push(...matches.map((c) => c.id));
        }
        if (ids.length > 0) chapters.setBookmarked(ids, true);
      }
      if (options.readerSettings && fromInfo.readerSettings)
        manga.setReaderSettings(toMangaId, fromInfo.readerSettings);
      library.add(toMangaId, categoryIds);
    });
    // Permanent cover copy for the library, while the source is reachable.
    void this.deps.images.cover(toMangaId).catch(() => undefined);

    if (options.customCover && from.customCoverPath) {
      await this.deps.covers.setCustom(toMangaId, from.customCoverPath).catch((error: unknown) => {
        this.deps.log?.(`custom cover of manga ${fromMangaId} not copied: ${String(error)}`);
      });
    }
    if (options.removeOld) await this.deps.libraryService.remove([fromMangaId]);

    return {
      fromMangaId,
      toMangaId,
      status: 'migrated',
      error: null,
      readMatched,
      unmatched: [...unmatched],
    };
  }
}
