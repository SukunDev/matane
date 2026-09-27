import type { Chapter, FilterState, ImageFetchResult, MangaSummary, Page } from '@manga-reader/extension-sdk';
import type { BrowseResult, MangaInfo, SourceCapabilities, SourceEntry } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { ExtensionsRepository, SourceRow } from '../db/repositories/extensions';
import type { MangaRepository } from '../db/repositories/manga';
import type { ExtensionService } from './service';
import { validate } from './validate';
import type { DownloadStore } from '../downloads/store';

/** BRAINSTORM.md §6.5; MangaDex image URLs live ~15 min, so the reader re-fetches on 403 (1d). */
export const PAGE_LIST_TTL_MS = 60 * 60_000;

export type BrowseKind = 'popular' | 'latest' | 'search';

export interface SourceServiceDeps {
  extensions: ExtensionService;
  extensionsRepo: ExtensionsRepository;
  manga: MangaRepository;
  chapters: ChaptersRepository;
  /** Page lists of downloaded chapters (no network needed). */
  downloads?: Pick<DownloadStore, 'pages'>;
  now?: () => number;
}

/** Source-level operations: talk to the sandbox, validate the answer, sync it into SQLite. */
export class SourceService {
  private readonly infoCache = new Map<string, SourceCapabilities>();
  private readonly headersCache = new Map<string, Record<string, string>>();

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
    for (const key of this.headersCache.keys()) {
      if (!extensionId || key.startsWith(`${extensionId}/`)) this.headersCache.delete(key);
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

  /** Extra request headers for this source's images (e.g. Referer, or MangaDex's own User-Agent). */
  async imageHeaders(sourceId: string): Promise<Record<string, string>> {
    const cached = this.headersCache.get(sourceId);
    if (cached) return cached;
    const { capabilities } = await this.info(sourceId);
    let headers: Record<string, string> = {};
    if (capabilities.includes('imageHeaders')) {
      const source = this.source(sourceId);
      const value = await this.deps.extensions.call(source.extensionId, source.key, 'imageHeaders');
      headers = validate.headers(value);
    }
    this.headersCache.set(sourceId, headers);
    return headers;
  }

  /** Fire-and-forget `reportImage` (MangaDex@Home asks for one per image). Never blocks images. */
  reportImage(sourceId: string, result: ImageFetchResult): void {
    const capabilities = this.infoCache.get(sourceId)?.capabilities;
    if (!capabilities?.includes('reportImage')) return;
    const source = this.deps.extensionsRepo.getSource(sourceId);
    if (!source) return;
    void this.deps.extensions.call(source.extensionId, source.key, 'reportImage', [result]).catch(() => undefined);
  }

  /** "Open in browser" target: the extension's `getWebUrl`, else `baseUrl + url`. */
  async webUrl(mangaId: number): Promise<string> {
    const row = this.mangaRow(mangaId);
    const source = this.source(row.sourceId);
    const { baseUrl, capabilities } = await this.info(row.sourceId);
    const url = capabilities.includes('getWebUrl')
      ? await this.deps.extensions.call(source.extensionId, source.key, 'getWebUrl', [
          { url: row.url, title: row.title },
        ])
      : new URL(row.url, baseUrl).toString();
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new AppError('parse', 'Extension returned an invalid web URL');
    }
    return url;
  }

  setPinned(sourceId: string, pinned: boolean): void {
    this.deps.extensionsRepo.setSourcePinned(sourceId, pinned);
  }

  getManga(mangaId: number): MangaInfo {
    this.mangaRow(mangaId);
    return this.deps.manga.info(mangaId)!;
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
    return { manga: this.deps.manga.info(updated.id)!, newChapterIds: sync.added };
  }

  /**
   * Page list of a chapter: the download first, then a fresh cache, then the source. When the source
   * is unreachable a stale copy is used, so chapters whose images are cached still open offline.
   */
  async pages(chapterId: number, signal?: AbortSignal): Promise<{ pages: Page[]; fromCache: boolean }> {
    const downloaded = await this.deps.downloads?.pages(chapterId);
    if (downloaded && downloaded.length > 0) return { pages: downloaded, fromCache: true };
    const cached = this.deps.chapters.getCachedPages(chapterId, PAGE_LIST_TTL_MS, this.now());
    if (cached) return { pages: cached, fromCache: true };
    try {
      return { pages: await this.fetchPages(chapterId, signal), fromCache: false };
    } catch (error) {
      const stale = this.deps.chapters.getCachedPages(chapterId, Number.POSITIVE_INFINITY, this.now());
      if (stale && !(error instanceof AppError && error.code === 'cancelled')) return { pages: stale, fromCache: true };
      throw error;
    }
  }

  /** Always asks the source (e.g. image URLs expired); refreshes the cache. */
  async fetchPages(chapterId: number, signal?: AbortSignal): Promise<Page[]> {
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
    return pages;
  }

  /** Image URL of a page: its own `imageUrl`, else the extension's `getImageUrl`. */
  async imageUrl(sourceId: string, page: Page): Promise<string> {
    if (page.imageUrl) return page.imageUrl;
    const source = this.source(sourceId);
    const { capabilities } = await this.info(sourceId);
    if (!capabilities.includes('getImageUrl')) {
      throw new AppError('parse', `Page ${page.index} has no image URL and the source has no getImageUrl`);
    }
    const url = await this.deps.extensions.call(source.extensionId, source.key, 'getImageUrl', [page]);
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new AppError('parse', 'Extension returned an invalid image URL');
    }
    return url;
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
