import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Chapter, MangaDetails, MangaPage, MangaSummary, Page } from '@matane/extension-sdk';
import type { DownloadFormat } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { DownloadReader, byName, contentTypeOf, pageNames } from '../downloads/archive';
import { COMIC_INFO_MAX_BYTES, type LocalComicInfo, parseComicInfo, readArchiveComicInfo } from './comicinfo-read';
import { safeJoin } from './paths';

const ARCHIVE = /\.(cbz|zip)$/i;
const COVER = /^(cover|folder|poster)\.(jpe?g|png|webp)$/i;
const MAX_COVER_BYTES = 30 * 1024 * 1024;
export const LOCAL_PAGE_SIZE = 40;

/** The thumbnail url of a local manga; the mtime makes a changed folder fetch its cover again. */
export const coverUrl = (mangaUrl: string, mtimeMs: number) =>
  `local:cover/${encodeURIComponent(mangaUrl)}?m=${Math.round(mtimeMs)}`;

/** The manga url inside a `local:cover/…` thumbnail url, or null for anything else. */
export function mangaOfCoverUrl(url: string): string | null {
  const match = /^local:cover\/([^?]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

interface LocalChapter {
  /** Name shown to the reader: the file or folder name without `.cbz`. */
  name: string;
  /** Relative to the local folder. */
  url: string;
  path: string;
  format: DownloadFormat;
  mtime: number;
}

export interface LocalFilesDeps {
  /** The folder chosen in Settings; null until one is. */
  folder: () => string | null;
}

/**
 * Manga and chapters on disk. Layout: `<folder>/<manga>/<chapter>`, where a chapter is a `.cbz` or
 * `.zip` file or a sub-folder of images; a manga folder that holds images itself is a single
 * chapter. Urls are relative to the folder, so moving it keeps the library and backups valid.
 */
export class LocalFiles {
  readonly reader = new DownloadReader();

  constructor(private readonly deps: LocalFilesDeps) {}

  private root(): string {
    const folder = this.deps.folder();
    if (!folder) throw new AppError('not_found', 'Choose the local folder in Settings → Browse & extensions');
    return folder;
  }

  /** Manga of the folder: by name (popular, search) or newest first (latest), 40 to a page. */
  async manga(kind: 'popular' | 'latest' | 'search', page: number, query = ''): Promise<MangaPage> {
    const root = this.root();
    const entries = await readdir(root, { withFileTypes: true }).catch(() => {
      throw new AppError('not_found', `The local folder ${root} cannot be read`);
    });
    const found: { name: string; mtime: number }[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      // Symlinks count only when they lead somewhere inside the folder.
      const path = await safeJoin(root, entry.name).catch(() => null);
      const info = path ? await stat(path).catch(() => null) : null;
      if (info?.isDirectory()) found.push({ name: entry.name, mtime: info.mtimeMs });
    }
    const needle = query.trim().toLowerCase();
    const list = needle ? found.filter((m) => m.name.toLowerCase().includes(needle)) : found;
    list.sort(
      kind === 'latest' ? (a, b) => b.mtime - a.mtime || byName(a.name, b.name) : (a, b) => byName(a.name, b.name),
    );
    const start = (Math.max(1, page) - 1) * LOCAL_PAGE_SIZE;
    return {
      items: list
        .slice(start, start + LOCAL_PAGE_SIZE)
        .map((m): MangaSummary => ({ url: m.name, title: m.name, thumbnailUrl: coverUrl(m.name, m.mtime) })),
      hasNextPage: start + LOCAL_PAGE_SIZE < list.length,
    };
  }

  async details(url: string): Promise<MangaDetails> {
    const { path } = await this.mangaDir(url);
    const info = await this.comicInfo(path, await this.chapterEntries(path, url));
    return {
      url,
      title: info?.series ?? url,
      thumbnailUrl: coverUrl(url, (await stat(path)).mtimeMs),
      author: info?.writer,
      artist: info?.penciller,
      description: info?.summary,
      genres: info?.genres.length ? info.genres : undefined,
      status: 'unknown',
      type: info?.manga ? 'manga' : undefined,
    };
  }

  /** Newest first, like every source. */
  async chapters(url: string): Promise<Chapter[]> {
    const { path } = await this.mangaDir(url);
    const entries = await this.chapterEntries(path, url);
    return entries.map((c): Chapter => ({ url: c.url, name: c.name, uploadedAt: Math.round(c.mtime) })).reverse();
  }

  async pages(chapterUrl: string): Promise<Page[]> {
    const { path, format } = await this.chapterFile(chapterUrl);
    const names = await this.reader.pages(path, format).catch((error: unknown) => {
      throw new AppError('parse', `${basename(path)} cannot be read: ${(error as Error).message}`);
    });
    return names.map((name, index) => ({ index, url: `local:${name}` }));
  }

  async readPage(chapterUrl: string, index: number): Promise<{ bytes: Buffer; contentType: string }> {
    const { path, format } = await this.chapterFile(chapterUrl);
    return this.reader.read(path, format, index);
  }

  /** The cover of a manga: `cover.jpg|png|webp` in its folder, else the first page of its first chapter. */
  async cover(mangaUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const { path } = await this.mangaDir(mangaUrl);
    const file = (await readdir(path)).find((name) => COVER.test(name));
    if (file) {
      const full = join(path, file);
      if ((await stat(full)).size <= MAX_COVER_BYTES)
        return { bytes: await readFile(full), contentType: contentTypeOf(file) };
    }
    const first = (await this.chapterEntries(path, mangaUrl))[0];
    if (!first) throw new AppError('not_found', `${mangaUrl} has no pages to use as a cover`);
    return this.reader.read(first.path, first.format, 0);
  }

  private async mangaDir(url: string): Promise<{ path: string }> {
    const path = await safeJoin(this.root(), url);
    if (!(await stat(path)).isDirectory()) throw new AppError('not_found', `${url} is not a manga folder`);
    return { path };
  }

  private async chapterFile(chapterUrl: string): Promise<{ path: string; format: DownloadFormat }> {
    const path = await safeJoin(this.root(), chapterUrl);
    return { path, format: (await stat(path)).isDirectory() ? 'folder' : 'cbz' };
  }

  /** Chapters of a manga folder in natural order (oldest first). */
  private async chapterEntries(dir: string, mangaUrl: string): Promise<LocalChapter[]> {
    const root = this.root();
    const found: LocalChapter[] = [];
    let hasImages = false;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const url = `${mangaUrl}/${entry.name}`;
      const path = await safeJoin(root, url).catch(() => null);
      if (!path) continue;
      const info = await stat(path).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) {
        if (pageNames(await readdir(path).catch(() => [])).length > 0) {
          found.push({ name: entry.name, url, path, format: 'folder', mtime: info.mtimeMs });
        }
      } else if (info.isFile() && ARCHIVE.test(entry.name)) {
        found.push({
          name: entry.name.slice(0, -extname(entry.name).length),
          url,
          path,
          format: 'cbz',
          mtime: info.mtimeMs,
        });
      } else if (info.isFile() && pageNames([entry.name]).length > 0) {
        hasImages = true;
      }
    }
    // Images right in the manga folder: one chapter (a one-shot).
    if (found.length === 0 && hasImages) {
      found.push({ name: basename(dir), url: mangaUrl, path: dir, format: 'folder', mtime: (await stat(dir)).mtimeMs });
    }
    return found.sort((a, b) => byName(a.name, b.name));
  }

  /** A `ComicInfo.xml` next to the chapters, or the one inside the first archive. */
  private async comicInfo(dir: string, chapters: LocalChapter[]): Promise<LocalComicInfo | undefined> {
    const file = join(dir, 'ComicInfo.xml');
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.size <= COMIC_INFO_MAX_BYTES) return parseComicInfo(await readFile(file, 'utf8'));
    const first = chapters.find((c) => c.format === 'cbz');
    return first ? readArchiveComicInfo(first.path) : undefined;
  }
}
