import { createHash } from 'node:crypto';
import type { ImageFetchResult, Page } from '@manga-reader/extension-sdk';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { MangaRepository } from '../db/repositories/manga';
import type { SourceService } from '../extensions/sources';
import { readFile } from 'node:fs/promises';
import type { DownloadStore } from '../downloads/store';
import type { CachedImage, ImageCache, ImageKind } from './cache';
import type { CoverStore } from './covers';
import { ImageTransformError, restoreImage, sniffImageType } from '@manga-reader/extension-runtime/image';

export interface ImageFetcher {
  /** Fetches an image through the extension's session and allowlist; returns the raw response. */
  fetchImage(extensionId: string, url: string, headers: Record<string, string>): Promise<Response>;
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** An image to serve: a file on disk (cache) or bytes read from a downloaded chapter. */
export type ServedImage = CachedImage | { data: Uint8Array; contentType: string; sizeBytes: number };

export interface ImageBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

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
      /** Pages of downloaded chapters are served from the download first. */
      downloads?: Pick<DownloadStore, 'page'>;
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
  async page(chapterId: number, index: number): Promise<ServedImage> {
    const downloaded = await this.deps.downloads?.page(chapterId, index);
    if (downloaded) {
      return { data: downloaded.bytes, contentType: downloaded.contentType, sizeBytes: downloaded.bytes.byteLength };
    }
    return this.cachedPage(chapterId, index);
  }

  /**
   * The bytes of a page for a download: from the download or cache when there, otherwise fetched
   * **without** storing it, so a big download doesn't push what was read out of the cache.
   */
  async pageBytes(chapterId: number, index: number): Promise<ImageBytes> {
    const downloaded = await this.deps.downloads?.page(chapterId, index);
    if (downloaded) return { bytes: downloaded.bytes, contentType: downloaded.contentType };
    const { key, sourceId } = this.pageKey(chapterId, index);
    const cached = await this.deps.cache.get(key);
    if (cached) return { bytes: await readFile(cached.path), contentType: cached.contentType };
    return this.withPageUrl(chapterId, index, (url, page) => this.fetchPage(sourceId, page, url));
  }

  private pageKey(chapterId: number, index: number): { key: string; sourceId: string } {
    const chapter = this.deps.chapters.get(chapterId);
    if (!chapter) throw new AppError('not_found', `Chapter ${chapterId} not found`);
    const manga = this.deps.manga.get(chapter.mangaId);
    if (!manga) throw new AppError('not_found', `Manga ${chapter.mangaId} not found`);
    const key = `page:${manga.sourceId}:${createHash('sha1').update(chapter.url).digest('hex')}:${index}`;
    return { key, sourceId: manga.sourceId };
  }

  /** A cached page, fetched and stored on a miss. */
  private cachedPage(chapterId: number, index: number): Promise<CachedImage> {
    const { key, sourceId } = this.pageKey(chapterId, index);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.loadPage(key, sourceId, chapterId, index).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async loadPage(key: string, sourceId: string, chapterId: number, index: number): Promise<CachedImage> {
    const cached = await this.deps.cache.get(key);
    if (cached) return cached;
    return this.withPageUrl(chapterId, index, async (url, page) => {
      const { bytes, contentType } = await this.fetchPage(sourceId, page, url);
      return this.deps.cache.put(key, 'page', bytes, contentType);
    });
  }

  /**
   * A page image from the source, restored when the extension scrambles or encrypts its images
   * (BRAINSTORM.md §5.6): the extension says how, the host does the pixel work. What is returned is
   * what gets cached and downloaded, so reading offline never needs the extension again.
   */
  private async fetchPage(sourceId: string, page: Page, url: string): Promise<ImageBytes> {
    const transforms = await this.deps.sources.hasImageTransform(sourceId);
    const fetched = await this.fetchBytes(sourceId, url, transforms);
    if (!transforms) return fetched;
    const transform = await this.deps.sources.transformImage(sourceId, page, fetched.bytes);
    let bytes: Uint8Array;
    try {
      bytes = await restoreImage(fetched.bytes, transform);
    } catch (error) {
      if (error instanceof ImageTransformError) throw new AppError('parse', error.message);
      throw error;
    }
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new AppError('parse', 'The restored page is not an image');
    return { bytes, contentType };
  }

  /**
   * Runs `fetch` with the page's image URL. Image URLs can expire (MangaDex@Home ~15 min): on
   * 403/404/410 with a cached page list, the list is fetched again once.
   */
  private async withPageUrl<T>(
    chapterId: number,
    index: number,
    fetch: (url: string, page: Page) => Promise<T>,
  ): Promise<T> {
    const { sourceId } = this.pageKey(chapterId, index);
    const { pages, fromCache } = await this.deps.sources.pages(chapterId);
    const find = (list: typeof pages) => {
      const page = list.find((p) => p.index === index) ?? list[index];
      if (!page) throw new AppError('not_found', `Chapter ${chapterId} has no page ${index}`);
      return page;
    };
    try {
      const page = find(pages);
      return await fetch(await this.deps.sources.imageUrl(sourceId, page), page);
    } catch (error) {
      const expired = error instanceof AppError && error.code === 'http' && [403, 404, 410].includes(error.status ?? 0);
      if (!expired || !fromCache) throw error;
      const page = find(await this.deps.sources.fetchPages(chapterId));
      return fetch(await this.deps.sources.imageUrl(sourceId, page), page);
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
    const { bytes, contentType } = await this.fetchBytes(sourceId, url);
    return this.deps.cache.put(key, kind, bytes, contentType);
  }

  /**
   * One image through the extension's network, checked, and reported to the extension. Encrypted
   * images (`anyType`) may come with any content type; they are checked after restoring.
   */
  private async fetchBytes(sourceId: string, url: string, anyType = false): Promise<ImageBytes> {
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
      if (!anyType && contentType && !/^image\//i.test(contentType)) {
        await response.body?.cancel();
        throw new AppError('parse', `Expected an image but got ${contentType}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      bytes = buffer.byteLength;
      if (bytes === 0 || bytes > MAX_IMAGE_BYTES) throw new AppError('parse', `Unexpected image size (${bytes} bytes)`);
      success = true;
      return { bytes: buffer, contentType };
    } finally {
      const result: ImageFetchResult = { url, success, bytes, durationMs: Date.now() - started, cached: cachedByCdn };
      this.deps.sources.reportImage(sourceId, result);
    }
  }
}
