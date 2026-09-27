import { mkdir, readdir, rename, rm, rmdir, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Page } from '@manga-reader/extension-sdk';
import type { DownloadFormat, DownloadProgress } from '@manga-reader/shared';
import { AppError, toAppErrorData } from '@manga-reader/shared/errors';
import { createLimiter } from '@manga-reader/shared/limit';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { DownloadRow, DownloadsRepository } from '../db/repositories/downloads';
import type { MangaRepository } from '../db/repositories/manga';
import { sniffBytes } from '../images/covers';
import type { ImageBytes } from '../images/service';
import { COMIC_INFO, writeCbz } from './archive';
import { comicInfoXml } from './comicinfo';
import { chapterBasePath, pageFileName } from './paths';
import type { DownloadStore } from './store';

/** Chapters downloaded at once, and pages at once per chapter (BRAINSTORM.md §6.4). */
export const MAX_CHAPTERS = 2;
export const MAX_PAGES = 4;
/** Retries per page after the first attempt, with exponential backoff (1 s, 2 s, 4 s). */
export const PAGE_RETRIES = 3;
/** A download does not start with less free space than this. */
export const MIN_FREE_BYTES = 300 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 250;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

export interface DownloadManagerDeps {
  repo: DownloadsRepository;
  store: Pick<DownloadStore, 'reader'>;
  manga: MangaRepository;
  chapters: ChaptersRepository;
  /** Name and language of a source (for the folder name). */
  source: (sourceId: string) => { name: string; lang: string } | undefined;
  /** The chapter's page list (cached, or from the source). */
  pages: (chapterId: number) => Promise<Page[]>;
  /** A page's bytes (download, cache or network — never stored in the cache). */
  pageBytes: (chapterId: number, index: number) => Promise<ImageBytes>;
  /** Download folder and format in effect. */
  settings: () => { folder: string; format: DownloadFormat };
  /** Reading direction of a manga, for `ComicInfo.xml`. */
  rightToLeft: (mangaId: number) => boolean;
  webUrl?: (mangaId: number) => Promise<string>;
  onProgress: (progress: DownloadProgress) => void;
  freeBytes?: (dir: string) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: number;
  log?: (message: string) => void;
}

interface Job {
  row: DownloadRow;
  controller: AbortController;
  pagesDone: number;
  pagesTotal: number | null;
  bytes: number;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Worth another try: network trouble, server errors, rate limits. */
function retryable(error: unknown): boolean {
  const { code } = toAppErrorData(error);
  if (code === 'http') {
    const status = error instanceof AppError ? (error.status ?? 0) : 0;
    return status >= 500 || status === 429 || status === 408;
  }
  return code === 'network' || code === 'timeout' || code === 'rate_limited' || code === 'unknown';
}

/**
 * The download queue (BRAINSTORM.md §6.4): persistent, two chapters at once with four pages each,
 * retries with backoff, pause/resume/cancel. A chapter is written to `<name>.tmp/` first (pages
 * already there are kept, so a resumed download skips them), then zipped to CBZ (or the folder is
 * renamed) and moved into place in one rename, so a half-written chapter never looks finished.
 */
export class DownloadManager {
  private readonly running = new Map<number, Job>();
  private started = false;
  /** Set on app quit: the database is about to close, nothing may touch it any more. */
  private closing = false;
  private progressTimer: ReturnType<typeof setInterval> | undefined;
  private lastBytes = new Map<number, number>();
  private lastTick = Date.now();

  constructor(private readonly deps: DownloadManagerDeps) {}

  /** On app start: interrupted downloads go back to the queue, which runs unless paused. */
  start(resume: boolean): void {
    this.deps.repo.resetInterrupted();
    if (!resume) this.deps.repo.setAllStatus('paused', ['queued']);
    this.started = true;
    this.pump();
  }

  enqueue(chapterIds: readonly number[]): void {
    this.deps.repo.enqueue(chapterIds, this.deps.settings().format);
    this.pump();
  }

  pause(ids?: readonly number[]): void {
    if (ids) this.deps.repo.setStatus(ids, 'paused', ['queued', 'downloading']);
    else this.deps.repo.setAllStatus('paused', ['queued', 'downloading']);
    for (const job of this.running.values()) {
      if (!ids || ids.includes(job.row.id)) job.controller.abort();
    }
  }

  resume(ids?: readonly number[]): void {
    if (ids) this.deps.repo.setStatus(ids, 'queued', ['paused']);
    else this.deps.repo.setAllStatus('queued', ['paused']);
    this.pump();
  }

  retry(ids: readonly number[]): void {
    this.deps.repo.setStatus(ids, 'queued', ['error']);
    this.pump();
  }

  reorder(ids: readonly number[]): void {
    this.deps.repo.reorder(ids);
  }

  /** Removes unfinished downloads and their partial files. */
  async cancel(ids: readonly number[]): Promise<void> {
    const rows = ids.flatMap((id) => this.deps.repo.get(id) ?? []).filter((row) => row.status !== 'done');
    await this.removeRows(rows);
  }

  /** Deletes the downloads of these chapters, finished or not. */
  async delete(chapterIds: readonly number[]): Promise<void> {
    await this.removeRows(this.deps.repo.rowsForChapters(chapterIds));
  }

  /**
   * App quit: stop at once without touching the database again. Running chapters stay
   * `downloading` and go back to the queue on the next start; their pages are kept.
   */
  shutdown(): void {
    this.closing = true;
    this.started = false;
    for (const job of this.running.values()) job.controller.abort();
    clearInterval(this.progressTimer);
  }

  /** Waits for running downloads to stop (tests). */
  async stop(): Promise<void> {
    this.started = false;
    for (const job of this.running.values()) job.controller.abort();
    while (this.running.size > 0) await new Promise((r) => setTimeout(r, 10));
    clearInterval(this.progressTimer);
    this.progressTimer = undefined;
  }

  /** Resolves once nothing is queued or running (tests). */
  async idle(): Promise<void> {
    while (this.running.size > 0 || (this.started && this.deps.repo.next([]) !== undefined)) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private async removeRows(rows: DownloadRow[]): Promise<void> {
    for (const row of rows) {
      const job = this.running.get(row.id);
      job?.controller.abort();
    }
    this.deps.repo.remove(rows.map((r) => r.id));
    // Running jobs clean up their own temporary folder once they notice the abort.
    for (const row of rows) {
      if (row.path) {
        await this.deps.store.reader.close(row.path);
        await rm(row.path, { recursive: true, force: true });
        await this.pruneEmpty(dirname(row.path));
      }
      if (!this.running.has(row.id)) {
        const base = this.basePathOf(row);
        if (base) await rm(`${base}.tmp`, { recursive: true, force: true });
      }
    }
  }

  /** Removes empty manga and source folders left behind. */
  private async pruneEmpty(dir: string): Promise<void> {
    const root = this.deps.settings().folder;
    let current = dir;
    while (current.startsWith(root) && current !== root) {
      try {
        await rmdir(current);
      } catch {
        return; // not empty (or gone)
      }
      current = dirname(current);
    }
  }

  private pump(): void {
    if (!this.started || this.closing) return;
    while (this.running.size < MAX_CHAPTERS) {
      const row = this.deps.repo.next([...this.running.keys()]);
      if (!row) break;
      const job: Job = { row, controller: new AbortController(), pagesDone: 0, pagesTotal: null, bytes: 0 };
      this.running.set(row.id, job);
      this.deps.repo.setStatus([row.id], 'downloading', ['queued']);
      void this.run(job).finally(() => {
        this.running.delete(row.id);
        if (this.closing) return;
        this.lastBytes.delete(row.id);
        this.emitProgress();
        this.pump();
      });
    }
    this.ensureProgressTimer();
  }

  private basePathOf(row: Pick<DownloadRow, 'chapterId'>): string | undefined {
    const chapter = this.deps.chapters.get(row.chapterId);
    const manga = chapter && this.deps.manga.get(chapter.mangaId);
    if (!chapter || !manga) return undefined;
    const source = this.deps.source(manga.sourceId);
    return chapterBasePath(this.deps.settings().folder, {
      sourceName: source?.name ?? manga.sourceId,
      sourceLang: source?.lang ?? '',
      mangaTitle: manga.title,
      chapterName: chapter.name || `Chapter ${chapter.id}`,
      scanlator: chapter.scanlator,
    });
  }

  private async run(job: Job): Promise<void> {
    const { row, controller } = job;
    const signal = controller.signal;
    const base = this.basePathOf(row);
    const tmp = `${base}.tmp`;
    try {
      if (!base) throw new AppError('not_found', 'The chapter no longer exists');
      const chapter = this.deps.chapters.get(row.chapterId)!;
      const mangaInfo = this.deps.manga.info(chapter.mangaId)!;
      await mkdir(tmp, { recursive: true });
      const free = await (this.deps.freeBytes ?? freeBytes)(dirname(base));
      if (free < MIN_FREE_BYTES) throw new AppError('unknown', 'Not enough free disk space for downloads');

      const pages = await this.deps.pages(row.chapterId);
      if (pages.length === 0) throw new AppError('not_found', 'The chapter has no pages');
      job.pagesTotal = pages.length;
      const present = new Set(
        (await readdir(tmp)).filter((name) => /^\d{3}\.\w+$/.test(name)).map((name) => Number(name.slice(0, 3)) - 1),
      );
      job.pagesDone = present.size;
      this.deps.repo.progress(row.id, job.pagesDone, pages.length);

      const limit = createLimiter(MAX_PAGES);
      await Promise.all(
        pages
          .map((_, index) => index)
          .filter((index) => !present.has(index))
          .map((index) =>
            limit(async () => {
              if (signal.aborted) return;
              const image = await this.fetchPage(row.chapterId, index, signal);
              if (signal.aborted) return;
              const ext = sniffBytes(image.bytes)?.ext ?? EXT_BY_TYPE[image.contentType ?? ''] ?? '.jpg';
              const file = join(tmp, pageFileName(index, ext));
              await writeFile(`${file}.part`, image.bytes);
              await rename(`${file}.part`, file);
              job.pagesDone++;
              job.bytes += image.bytes.byteLength;
              this.deps.repo.progress(row.id, job.pagesDone, pages.length);
            }, signal),
          ),
      ).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
      if (signal.aborted) return this.aborted(row, tmp);

      await writeFile(
        join(tmp, COMIC_INFO),
        comicInfoXml({
          series: mangaInfo.title,
          title: chapter.name,
          number: chapter.number,
          scanlator: chapter.scanlator,
          writer: mangaInfo.author,
          penciller: mangaInfo.artist,
          genres: mangaInfo.genres,
          summary: mangaInfo.description,
          rightToLeft: this.deps.rightToLeft(mangaInfo.id),
          web: (await this.deps.webUrl?.(mangaInfo.id).catch(() => null)) ?? null,
          languageIso: this.deps.source(mangaInfo.sourceId)?.lang ?? null,
          pageCount: pages.length,
        }),
      );
      const target = await this.freeTarget(row.format === 'cbz' ? `${base}.cbz` : base);
      let size: number;
      if (row.format === 'cbz') {
        const part = `${target}.part`;
        size = await writeCbz(tmp, part);
        await rename(part, target);
        await rm(tmp, { recursive: true, force: true });
      } else {
        await rename(tmp, target);
        size = await folderSize(target);
      }
      // Cancelled while zipping: the row is gone, so is the file. Paused: it is finished anyway.
      if (!this.deps.repo.get(row.id)) {
        await rm(target, { recursive: true, force: true });
        return;
      }
      this.deps.repo.complete(row.id, target, size, pages.length);
    } catch (error) {
      if (signal.aborted) return this.aborted(row, tmp);
      const message = toAppErrorData(error).message;
      this.deps.log?.(`download of chapter ${row.chapterId} failed: ${message}`);
      if (this.deps.repo.get(row.id)) this.deps.repo.fail(row.id, message);
    }
  }

  /** Paused: keep the pages for later. Cancelled (row gone): remove them. */
  private async aborted(row: DownloadRow, tmp: string): Promise<void> {
    if (this.closing) return;
    if (!this.deps.repo.get(row.id)) {
      await rm(tmp, { recursive: true, force: true });
      await this.pruneEmpty(dirname(tmp));
    }
  }

  private async fetchPage(chapterId: number, index: number, signal: AbortSignal): Promise<ImageBytes> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.deps.pageBytes(chapterId, index);
      } catch (error) {
        if (attempt >= PAGE_RETRIES || !retryable(error) || signal.aborted) throw error;
        await sleep((this.deps.backoffMs ?? 1000) * 2 ** attempt);
      }
    }
  }

  /** `path`, or `path (2)`… when something else is already there. */
  private async freeTarget(path: string): Promise<string> {
    if (!(await exists(path))) return path;
    const ext = path.endsWith('.cbz') ? '.cbz' : '';
    const stem = ext ? path.slice(0, -ext.length) : path;
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!(await exists(candidate))) return candidate;
    }
  }

  private ensureProgressTimer(): void {
    if (this.running.size === 0 || this.progressTimer) return;
    this.lastTick = Date.now();
    this.progressTimer = setInterval(() => {
      this.emitProgress();
      if (this.running.size === 0) {
        clearInterval(this.progressTimer);
        this.progressTimer = undefined;
      }
    }, PROGRESS_INTERVAL_MS);
    this.progressTimer.unref?.();
  }

  private emitProgress(): void {
    const now = Date.now();
    const seconds = Math.max((now - this.lastTick) / 1000, 0.001);
    this.lastTick = now;
    const items = [...this.running.values()].map((job) => {
      const speed = (job.bytes - (this.lastBytes.get(job.row.id) ?? job.bytes)) / seconds;
      this.lastBytes.set(job.row.id, job.bytes);
      return {
        id: job.row.id,
        chapterId: job.row.chapterId,
        pagesDone: job.pagesDone,
        pagesTotal: job.pagesTotal,
        bytesPerSecond: Math.max(0, Math.round(speed)),
      };
    });
    this.deps.onProgress({ items });
  }
}

async function freeBytes(dir: string): Promise<number> {
  const info = await statfs(dir);
  return info.bavail * info.bsize;
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) total += (await stat(join(dir, name))).size;
  return total;
}
