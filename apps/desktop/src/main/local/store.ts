import type { Page } from '@matane/extension-sdk';
import { LOCAL_SOURCE_ID } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { MangaRepository } from '../db/repositories/manga';
import { type LocalFiles, mangaOfCoverUrl } from './files';

/**
 * The read side of the local source, by chapter id: the page list and page bytes the reader asks
 * for, and covers. Like `DownloadStore`, it answers only for its own chapters (undefined for the
 * rest), so the reader opens them with no extension and no network.
 */
export class LocalStore {
  constructor(
    private readonly deps: {
      files: LocalFiles;
      chapters: Pick<ChaptersRepository, 'get'>;
      manga: Pick<MangaRepository, 'get'>;
    },
  ) {}

  /** The chapter's url when it belongs to the local source. */
  private urlOf(chapterId: number): string | undefined {
    const chapter = this.deps.chapters.get(chapterId);
    if (!chapter) return undefined;
    return this.deps.manga.get(chapter.mangaId)?.sourceId === LOCAL_SOURCE_ID ? chapter.url : undefined;
  }

  async pages(chapterId: number): Promise<Page[] | undefined> {
    const url = this.urlOf(chapterId);
    return url === undefined ? undefined : this.deps.files.pages(url).catch(() => undefined);
  }

  async page(chapterId: number, index: number): Promise<{ bytes: Buffer; contentType: string } | undefined> {
    const url = this.urlOf(chapterId);
    return url === undefined ? undefined : this.deps.files.readPage(url, index).catch(() => undefined);
  }

  /** Bytes behind a `local:cover/…` thumbnail url. */
  async cover(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const manga = mangaOfCoverUrl(url);
    if (manga === null) throw new AppError('not_found', `${url} is not a local cover`);
    return this.deps.files.cover(manga);
  }
}
