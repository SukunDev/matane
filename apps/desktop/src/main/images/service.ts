import { createHash } from 'node:crypto';
import type { ImageFetchResult } from '@manga-reader/extension-sdk';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { MangaRepository } from '../db/repositories/manga';
import type { SourceService } from '../extensions/sources';
import type { CachedImage, ImageCache, ImageKind } from './cache';
import type { CoverStore } from './covers';

export interface ImageFetcher {
  /** Fetches an image through the extension's session and allowlist; returns the raw response. */
  fetchImage(extensionId: string, url: string, headers: Record<string, string>): Promise<Response>;
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * Serves images to the renderer without it ever touching the network (BRAINSTORM.md §6.5):
 * disk cache first, otherwise fetched with the source's headers and stored. Concurrent requests
 * for one image share a single fetch.
 */
export class ImageService {
  private readonly inflight = new Map<string, Promise<CachedImage>>();

  constructor(
    private readonly deps: {
      cache: ImageCache;
      manga: MangaRepository;
      chapters: ChaptersRepository;
      sources: SourceService;
      fetcher: ImageFetcher;
      covers?: CoverStore;
      log?: (message: string) => void;
    },
  ) {}

  async cover(mangaId: number): Promise<CachedImage> {
    const row = this.deps.manga.get(mangaId);
    if (!row) throw new AppError('not_found', `Manga ${mangaId} not found`);
    const covers = this.deps.covers;
    // Custom cover → permanent library copy → cache → source (BRAINSTORM.md §6.2, §6.5).
    const custom = row.customCoverPath && covers ? await covers.file(row.customCoverPath) : undefined;
    if (custom) return custom;
    if (!row.thumbnailUrl) throw new AppError('not_found', `Manga ${mangaId} has no cover`);
    const permanent = row.inLibrary && covers ? await covers.library(row) : undefined;
    if (permanent) return permanent;
    // Keyed by URL so a new cover from the source is fetched instead of served stale.
    const key = `cover:${createHash('sha1').update(row.thumbnailUrl).digest('hex')}`;
    const image = await this.load(key, 'browse_cover', row.sourceId, row.thumbnailUrl);
    if (row.inLibrary && covers) {
      await covers
        .persist(row, image)
        .catch((error: unknown) => this.deps.log?.(`cover copy failed: ${String(error)}`));
    }
    return image;
  }

  /**
   * Page `index` of a chapter. The cache key ignores the image URL (MangaDex hands out a new server
   * every visit), so cached pages open without any network. Image URLs can expire (MangaDex@Home
   * ~15 min): on 403/404/410 with a cached page list, the list is fetched again once.
   */
  page(chapterId: number, index: number): Promise<CachedImage> {
    const chapter = this.deps.chapters.get(chapterId);
    if (!chapter) return Promise.reject(new AppError('not_found', `Chapter ${chapterId} not found`));
    const manga = this.deps.manga.get(chapter.mangaId);
    if (!manga) return Promise.reject(new AppError('not_found', `Manga ${chapter.mangaId} not found`));
    const key = `page:${manga.sourceId}:${createHash('sha1').update(chapter.url).digest('hex')}:${index}`;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.loadPage(key, manga.sourceId, chapterId, index).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async loadPage(key: string, sourceId: string, chapterId: number, index: number): Promise<CachedImage> {
    const cached = await this.deps.cache.get(key);
    if (cached) return cached;
    const { pages, fromCache } = await this.deps.sources.pages(chapterId);
    const find = (list: typeof pages) => {
      const page = list.find((p) => p.index === index) ?? list[index];
      if (!page) throw new AppError('not_found', `Chapter ${chapterId} has no page ${index}`);
      return page;
    };
    try {
      return await this.fetchAndStore(key, 'page', sourceId, await this.deps.sources.imageUrl(sourceId, find(pages)));
    } catch (error) {
      const expired = error instanceof AppError && error.code === 'http' && [403, 404, 410].includes(error.status ?? 0);
      if (!expired || !fromCache) throw error;
      const fresh = await this.deps.sources.fetchPages(chapterId);
      return this.fetchAndStore(key, 'page', sourceId, await this.deps.sources.imageUrl(sourceId, find(fresh)));
    }
  }

  private load(key: string, kind: ImageKind, sourceId: string, url: string): Promise<CachedImage> {
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetchAndStore(key, kind, sourceId, url).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async fetchAndStore(key: string, kind: ImageKind, sourceId: string, url: string): Promise<CachedImage> {
    const cached = await this.deps.cache.get(key);
    if (cached) return cached;

    const source = this.deps.sources.source(sourceId);
    const headers = await this.deps.sources.imageHeaders(sourceId);
    const started = Date.now();
    let bytes = 0;
    let success = false;
    let cachedByCdn = false;
    try {
      const response = await this.deps.fetcher.fetchImage(source.extensionId, url, headers);
      cachedByCdn = (response.headers.get('x-cache') ?? '').toUpperCase().startsWith('HIT');
      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError('http', `Image request failed with HTTP ${response.status}`, response.status);
      }
      if (contentType && !/^image\//i.test(contentType)) {
        await response.body?.cancel();
        throw new AppError('parse', `Expected an image but got ${contentType}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      bytes = buffer.byteLength;
      if (bytes === 0 || bytes > MAX_IMAGE_BYTES) throw new AppError('parse', `Unexpected image size (${bytes} bytes)`);
      success = true;
      return await this.deps.cache.put(key, kind, buffer, contentType);
    } finally {
      const result: ImageFetchResult = { url, success, bytes, durationMs: Date.now() - started, cached: cachedByCdn };
      this.deps.sources.reportImage(sourceId, result);
    }
  }
}
