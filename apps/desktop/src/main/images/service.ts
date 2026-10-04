import { createHash } from 'node:crypto';
import type { ImageFetchResult, Page } from '@matane/extension-sdk';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { MangaRepository, MangaRow } from '../db/repositories/manga';
import type { SourceService } from '../extensions/sources';
import { readFile } from 'node:fs/promises';
import type { DownloadStore } from '../downloads/store';
import type { CachedImage, ImageCache, ImageKind } from './cache';
import type { CoverColors } from './cover-color';
import type { CoverStore } from './covers';
import { ImageTransformError, restoreImage, sniffImageType } from '@matane/extension-runtime/image';
import { pageSegments } from '@manga-reader/shared';
import type { PageMetaStore, PageMeta } from './page-meta';
import { type Box, type ImageInput, type Size, cropBox, cropImage, measure, splitImage } from './processing';

export interface ImageFetcher {
  /** Fetches an image through the extension's session; returns the raw response. */
  fetchImage(extensionId: string, url: string, headers: Record<string, string>): Promise<Response>;
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** An image to serve: a file on disk (cache) or bytes read from a downloaded chapter. */
export type ServedImage = CachedImage | { data: Uint8Array; contentType: string; sizeBytes: number };

export interface ImageBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

/** How the reader shows a page: border crop, and which segment of a tall page (ADR 0025). */
export interface PageView {
  crop: boolean;
  segment?: number;
}

/**
 * Serves images to the renderer without it ever touching the network (docs/BRAINSTORM.md §6.5):
 * disk cache first, otherwise fetched with the source's headers and stored. Concurrent requests
 * for one image share a single fetch.
 */
export class ImageService {
  private readonly inflight = new Map<string, Promise<CachedImage>>();
  /** Measuring, cropping and cutting of one page at a time (keyed by page key + work). */
  private readonly work = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: {
      cache: ImageCache;
      meta: PageMetaStore;
      manga: MangaRepository;
      chapters: ChaptersRepository;
      sources: SourceService;
      fetcher: ImageFetcher;
      covers?: CoverStore;
      /** Told about every cover served, to measure its colour (detail header). */
      coverColors?: Pick<CoverColors, 'noticed'>;
      /** Pages of downloaded chapters are served from the download first. */
      downloads?: Pick<DownloadStore, 'page'>;
      /** The local files source: its covers come from disk, not through an extension's network. */
      local?: { sourceId: string; cover(url: string): Promise<{ bytes: Uint8Array; contentType: string }> };
      log?: (message: string) => void;
    },
  ) {}

  async cover(mangaId: number): Promise<CachedImage> {
    const row = this.deps.manga.get(mangaId);
    if (!row) throw new AppError('not_found', `Manga ${mangaId} not found`);
    const image = await this.findCover(row);
    this.deps.coverColors?.noticed(row, image);
    return image;
  }

  private async findCover(row: MangaRow): Promise<CachedImage> {
    const mangaId = row.id;
    const covers = this.deps.covers;
    // Custom cover → permanent library copy → cache → source (docs/BRAINSTORM.md §6.2, §6.5).
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
   * Page `index` of a chapter. The cache key ignores the image URL (some sites hand out a new server
   * every visit), so cached pages open without any network. Image URLs can expire (minutes on
   * some sites): on 403/404/410 with a cached page list, the list is fetched again once.
   */
  async page(chapterId: number, index: number): Promise<ServedImage> {
    const downloaded = await this.deps.downloads?.page(chapterId, index);
    if (downloaded) {
      return { data: downloaded.bytes, contentType: downloaded.contentType, sizeBytes: downloaded.bytes.byteLength };
    }
    return this.cachedPage(chapterId, index);
  }

  /**
   * A page as the reader shows it: the page itself, cropped to its content, and/or one segment of
   * a tall page. Crops and segments are cached like pages (they come back after eviction from the
   * page, which may be a download); the page itself and downloads are never changed.
   */
  async pageView(chapterId: number, index: number, view: PageView): Promise<ServedImage> {
    if (!view.crop && view.segment === undefined) return this.page(chapterId, index);
    const { key } = this.pageKey(chapterId, index);
    const image = await this.page(chapterId, index);
    const meta = await this.meta(key, image, view.crop);
    const box = view.crop ? trimmed(meta) : null;
    const shown = box ?? meta;
    const heights = pageSegments(shown.width, shown.height);
    const segment = view.segment ?? 0;
    if (segment >= heights.length) throw new AppError('not_found', `Page ${index} has no segment ${segment}`);
    if (view.segment === undefined || heights.length === 1) {
      return box ? this.variant(`${key}#c`, async () => [await cropImage(input(image), box)]) : image;
    }
    return this.variant(`${key}#${box ? 'c' : ''}s`, () => splitImage(input(image), box, heights), segment);
  }

  /**
   * Readies a page for the reader (fetched or read from the download, measured, crop computed when
   * asked) and returns the size it is shown at.
   */
  async preparePage(chapterId: number, index: number, crop: boolean): Promise<Size> {
    const { key } = this.pageKey(chapterId, index);
    const meta = await this.meta(key, await this.page(chapterId, index), crop);
    return sizeOf(meta, crop);
  }

  /** Sizes already known for a chapter's pages; with `crop`, only pages whose crop is known. */
  pageSizes(chapterId: number, crop: boolean): (Size & { index: number })[] {
    return this.deps.meta
      .list(this.chapterPrefix(chapterId).prefix)
      .filter(({ meta }) => !crop || meta.crop)
      .map(({ index, meta }) => ({ index, ...sizeOf(meta, crop) }));
  }

  /** Empties the page or browse-cover cache; page sizes and crops go with the pages. */
  async clearCache(kind: ImageKind): Promise<void> {
    await this.deps.cache.clear(kind);
    if (kind === 'page') this.deps.meta.clear();
  }

  /**
   * The size (and crop box when asked) of the image under `key`, measured once. A different image
   * under the same key (fetched again, downloaded again) is measured again and its old variants go.
   */
  private meta(key: string, image: ServedImage, crop: boolean): Promise<PageMeta> {
    return this.once(`${key}#meta${crop ? '+crop' : ''}`, async () => {
      let meta = this.deps.meta.get(key);
      if (!meta || meta.bytes !== image.sizeBytes) {
        const size = await measure(input(image));
        await this.deps.cache.deletePrefix(`${key}#`);
        this.deps.meta.put(key, image.sizeBytes, size);
        meta = { ...size, bytes: image.sizeBytes, crop: undefined };
      }
      if (crop && !meta.crop) {
        const box = (await cropBox(input(image))) ?? { left: 0, top: 0, width: meta.width, height: meta.height };
        this.deps.meta.setCrop(key, box);
        meta = { ...meta, crop: box };
      }
      return meta;
    });
  }

  /**
   * Cached variant number `n` of a page (`<prefix><n>`), made with `make` on a miss. `make`
   * returns every variant of the set at once (all segments come from one decode).
   */
  private async variant(
    prefix: string,
    make: () => Promise<{ bytes: Uint8Array; contentType: string }[]>,
    n = 0,
  ): Promise<CachedImage> {
    const cached = await this.deps.cache.get(`${prefix}${n}`);
    if (cached) return cached;
    await this.once(prefix, async () => {
      const made = await make();
      for (const [i, item] of made.entries()) {
        await this.deps.cache.put(`${prefix}${i}`, 'page', item.bytes, item.contentType);
      }
    });
    const image = await this.deps.cache.get(`${prefix}${n}`);
    if (!image) throw new AppError('unknown', `Page variant ${prefix}${n} was not stored`);
    return image;
  }

  private once<T>(key: string, run: () => Promise<T>): Promise<T> {
    let pending = this.work.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = run().finally(() => this.work.delete(key));
      this.work.set(key, pending);
    }
    return pending;
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
    const { prefix, sourceId } = this.chapterPrefix(chapterId);
    return { key: `${prefix}${index}`, sourceId };
  }

  private chapterPrefix(chapterId: number): { prefix: string; sourceId: string } {
    const chapter = this.deps.chapters.get(chapterId);
    if (!chapter) throw new AppError('not_found', `Chapter ${chapterId} not found`);
    const manga = this.deps.manga.get(chapter.mangaId);
    if (!manga) throw new AppError('not_found', `Manga ${chapter.mangaId} not found`);
    return {
      prefix: `page:${manga.sourceId}:${createHash('sha1').update(chapter.url).digest('hex')}:`,
      sourceId: manga.sourceId,
    };
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
      // A new image: whatever was measured or cut from an older one under this key is stale.
      await this.deps.cache.deletePrefix(`${key}#`);
      this.deps.meta.delete(key);
      return this.deps.cache.put(key, 'page', bytes, contentType);
    });
  }

  /**
   * A page image from the source, restored when the extension scrambles or encrypts its images
   * (docs/BRAINSTORM.md §5.6): the extension says how, the host does the pixel work. What is returned is
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
   * Runs `fetch` with the page's image URL. Image URLs can expire (minutes on some sites): on
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
    if (this.deps.local && sourceId === this.deps.local.sourceId) return this.deps.local.cover(url);
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

const input = (image: ServedImage): ImageInput => ('data' in image ? image.data : image.path);

/** The crop box when it removes something, else null. */
function trimmed(meta: PageMeta): Box | null {
  const box = meta.crop;
  return box && (box.width !== meta.width || box.height !== meta.height) ? box : null;
}

function sizeOf(meta: PageMeta, crop: boolean): Size {
  const box = crop ? trimmed(meta) : null;
  return box ? { width: box.width, height: box.height } : { width: meta.width, height: meta.height };
}
