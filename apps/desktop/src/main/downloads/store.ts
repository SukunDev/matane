import { stat } from 'node:fs/promises';
import type { Page } from '@manga-reader/extension-sdk';
import type { DownloadFormat } from '@manga-reader/shared';
import type { DownloadsRepository } from '../db/repositories/downloads';
import type { DownloadReader } from './archive';

export interface DownloadedChapter {
  path: string;
  format: DownloadFormat;
}

/**
 * Read side of downloads: whether a chapter is on disk, its page list and page bytes. The reader
 * and page list use it first, so downloaded chapters open with no network at all (§6.5).
 */
export class DownloadStore {
  constructor(
    private readonly repo: DownloadsRepository,
    readonly reader: DownloadReader,
  ) {}

  /** The finished download of a chapter, if its file is still there. */
  async find(chapterId: number): Promise<DownloadedChapter | undefined> {
    const row = this.repo.byChapter(chapterId);
    if (row?.status !== 'done' || !row.path) return undefined;
    const exists = await stat(row.path).then(
      () => true,
      () => false,
    );
    return exists ? { path: row.path, format: row.format } : undefined;
  }

  /** Page list of a downloaded chapter (the reader only needs the count and order). */
  async pages(chapterId: number): Promise<Page[] | undefined> {
    const found = await this.find(chapterId);
    if (!found) return undefined;
    const names = await this.reader.pages(found.path, found.format).catch(() => undefined);
    return names?.map((name, index) => ({ index, url: `download:${name}` }));
  }

  async page(chapterId: number, index: number): Promise<{ bytes: Buffer; contentType: string } | undefined> {
    const found = await this.find(chapterId);
    if (!found) return undefined;
    return this.reader.read(found.path, found.format, index).catch(() => undefined);
  }
}
