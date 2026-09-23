import type { Chapter, FilterState, MangaSummary, Page } from '@manga-reader/extension-sdk';
import type { BrowseResult, MangaInfo, SourceCapabilities, SourceEntry } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { ExtensionsRepository, SourceRow } from '../db/repositories/extensions';
import { type MangaRepository, toMangaInfo } from '../db/repositories/manga';
import type { ExtensionService } from './service';
import { validate } from './validate';

/** BRAINSTORM.md §6.5; MangaDex image URLs live ~15 min, so the reader re-fetches on 403 (1d). */
export const PAGE_LIST_TTL_MS = 60 * 60_000;

export type BrowseKind = 'popular' | 'latest' | 'search';

export interface SourceServiceDeps {
  extensions: ExtensionService;
  extensionsRepo: ExtensionsRepository;
  manga: MangaRepository;
  chapters: ChaptersRepository;
  now?: () => number;
}

/** Source-level operations: talk to the sandbox, validate the answer, sync it into SQLite. */
export class SourceService {
  private readonly infoCache = new Map<string, SourceCapabilities>();

  constructor(private readonly deps: SourceServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  list(): SourceEntry[] {
    return this.deps.extensionsRepo.listSources().map((row) => ({
      id: row.id,
      extensionId: row.extensionId,
      key: row.key,
      name: row.name,
      lang: row.lang,
      pinned: row.pinned,
      lastUsedAt: row.lastUsedAt,
      installed:
        this.deps.extensions.isInstalled(row.extensionId) &&
        (this.deps.extensions.get(row.extensionId)?.manifest?.sources.some((s) => s.key === row.key) ?? false),
    }));
  }

  /** Forget cached `__info` after a reload (capabilities may change). */
  clearCache(extensionId?: string): void {
    for (const key of this.infoCache.keys()) {
      if (!extensionId || key.startsWith(`${extensionId}/`)) this.infoCache.delete(key);
    }
  }

  async info(sourceId: string, signal?: AbortSignal): Promise<SourceCapabilities> {
    const cached = this.infoCache.get(sourceId);
    if (cached) return cached;
    const source = this.source(sourceId);
    const info = validate.capabilities(
      await this.deps.extensions.call(source.extensionId, source.key, '__info', [], signal),
    );
    this.infoCache.set(sourceId, info);
    return info;
  }

  async filters(sourceId: string, signal?: AbortSignal) {
    const { capabilities } = await this.info(sourceId, signal);
    if (!capabilities.includes('getFilters')) return [];
    const source = this.source(sourceId);
    return validate.filters(await this.deps.extensions.call(source.extensionId, source.key, 'getFilters', [], signal));
  }

  async browse(
    input: { sourceId: string; kind: BrowseKind; page: number; query?: string; filters?: FilterState },
    signal?: AbortSignal,
  ): Promise<BrowseResult> {
    const source = this.source(input.sourceId);
    const [method, args]: [string, unknown[]] =
      input.kind === 'popular'
        ? ['getPopular', [input.page]]
        : input.kind === 'latest'
          ? ['getLatest', [input.page]]
          : ['search', [input.query ?? '', input.page, input.filters ?? {}]];
    const page = validate.mangaPage(
      await this.deps.extensions.call(source.extensionId, source.key, method, args, signal),
    );
    const items = this.deps.manga.upsertSummaries(source.id, page.items, this.now());
    this.deps.extensionsRepo.touchSource(source.id, this.now());
    return { items, hasNextPage: page.hasNextPage };
  }

  /** Asks each installed source that supports it to recognise a pasted web URL. */
  async resolveUrl(url: string, signal?: AbortSignal): Promise<{ sourceId: string; mangaId: number } | null> {
    for (const entry of this.list()) {
      if (!entry.installed) continue;
      const { capabilities } = await this.info(entry.id, signal).catch(() => ({ capabilities: [] as string[] }));
      if (!capabilities.includes('resolveUrl')) continue;
      const summary = validate.summaryOrNull(
        await this.deps.extensions.call(entry.extensionId, entry.key, 'resolveUrl', [url], signal),
      );
      if (summary) return { sourceId: entry.id, mangaId: this.deps.manga.ensure(entry.id, summary, this.now()) };
    }
    return null;
  }

  getManga(mangaId: number): MangaInfo {
    return toMangaInfo(this.mangaRow(mangaId));
  }

  /** Fetches details and chapters, then syncs both into the DB. */
  async refreshManga(mangaId: number, signal?: AbortSignal): Promise<{ manga: MangaInfo; newChapterIds: number[] }> {
    const row = this.mangaRow(mangaId);
    const source = this.source(row.sourceId);
    const summary: MangaSummary = { url: row.url, title: row.title, thumbnailUrl: row.thumbnailUrl ?? undefined };
    const call = (method: string, args: unknown[]) =>
      this.deps.extensions.call(source.extensionId, source.key, method, args, signal);

    const details = validate.mangaDetails(await call('getMangaDetails', [summary]));
    // Extensions identify manga by url; never let details move a row to another url.
    const detailsForChapters = { ...details, url: row.url };
    const chapters = validate.chapters(await call('getChapters', [detailsForChapters]));
    const updated = this.deps.manga.updateDetails(mangaId, detailsForChapters, this.now());
    const sync = this.deps.chapters.sync(mangaId, chapters, this.now());
    return { manga: toMangaInfo(updated), newChapterIds: sync.added };
  }

  async pages(chapterId: number, signal?: AbortSignal): Promise<{ pages: Page[]; fromCache: boolean }> {
    const cached = this.deps.chapters.getCachedPages(chapterId, PAGE_LIST_TTL_MS, this.now());
    if (cached) return { pages: cached, fromCache: true };
    const chapter = this.deps.chapters.get(chapterId);
    if (!chapter) throw new AppError('not_found', `Chapter ${chapterId} not found`);
    const manga = this.mangaRow(chapter.mangaId);
    const source = this.source(manga.sourceId);
    const arg: Chapter = {
      url: chapter.url,
      name: chapter.name,
      number: chapter.number ?? undefined,
      scanlator: chapter.scanlator ?? undefined,
      uploadedAt: chapter.uploadedAt ?? undefined,
    };
    const pages = validate.pages(
      await this.deps.extensions.call(source.extensionId, source.key, 'getPages', [arg], signal),
    );
    this.deps.chapters.cachePages(chapterId, pages, this.now());
    return { pages, fromCache: false };
  }

  source(sourceId: string): SourceRow {
    const row = this.deps.extensionsRepo.getSource(sourceId);
    if (!row) throw new AppError('not_installed', `Source ${sourceId} is unknown`);
    if (!this.deps.extensions.isInstalled(row.extensionId)) {
      throw new AppError('not_installed', `The extension for ${sourceId} is not installed`);
    }
    return row;
  }

  private mangaRow(mangaId: number) {
    const row = this.deps.manga.get(mangaId);
    if (!row) throw new AppError('not_found', `Manga ${mangaId} not found`);
    return row;
  }
}
