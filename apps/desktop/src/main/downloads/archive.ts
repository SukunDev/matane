import { createWriteStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { DownloadFormat } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import yauzl from 'yauzl';
import yazl from 'yazl';

export const COMIC_INFO = 'ComicInfo.xml';
const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};
/** Natural order: "Ch 2" before "Ch 10". */
export const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
/** Page images of a download, in reading order. */
export const pageNames = (names: readonly string[]) => names.filter((n) => IMAGE.test(n)).sort(byName);
export const contentTypeOf = (name: string) => CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';

/**
 * Zips a finished chapter folder into a CBZ. Images are stored as they are (already compressed);
 * `ComicInfo.xml` is deflated. Returns the archive size.
 */
export async function writeCbz(dir: string, target: string): Promise<number> {
  const names = (await readdir(dir)).sort(byName);
  const zip = new yazl.ZipFile();
  for (const name of names) zip.addFile(join(dir, name), name, { compress: name === COMIC_INFO });
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(target));
  return (await stat(target)).size;
}

interface OpenZip {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
  pages: string[];
}

export const openZip = (path: string) =>
  new Promise<OpenZip>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('Could not open the archive'));
        return;
      }
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries, pages: pageNames([...entries.keys()]) }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });

export const readEntry = (zip: yauzl.ZipFile, entry: yauzl.Entry) =>
  new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error('Could not read the archive entry'));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });

/**
 * Reads pages of downloaded chapters without extracting them (docs/BRAINSTORM.md §6.4): CBZ entries
 * are read at random through a small pool of open archives, folders file by file.
 */
export class DownloadReader {
  private readonly open = new Map<string, Promise<OpenZip>>();

  constructor(private readonly maxOpen = 8) {}

  /** Page file names in reading order. */
  async pages(path: string, format: DownloadFormat): Promise<string[]> {
    if (format === 'folder') return pageNames(await readdir(path));
    return (await this.zip(path)).pages;
  }

  async read(path: string, format: DownloadFormat, index: number): Promise<{ bytes: Buffer; contentType: string }> {
    if (format === 'folder') {
      const name = (await this.pages(path, format))[index];
      if (!name) throw new AppError('not_found', `The download has no page ${index}`);
      return { bytes: await readFile(join(path, name)), contentType: contentTypeOf(name) };
    }
    const archive = await this.zip(path);
    const name = archive.pages[index];
    const entry = name === undefined ? undefined : archive.entries.get(name);
    if (!name || !entry) throw new AppError('not_found', `The download has no page ${index}`);
    return { bytes: await readEntry(archive.zip, entry), contentType: contentTypeOf(name) };
  }

  /** Before deleting or moving an archive (Windows keeps open files locked). */
  async close(path: string): Promise<void> {
    const pending = this.open.get(path);
    this.open.delete(path);
    await pending?.then((archive) => archive.zip.close()).catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((path) => this.close(path)));
  }

  private zip(path: string): Promise<OpenZip> {
    let pending = this.open.get(path);
    if (pending) {
      // Most recently used last.
      this.open.delete(path);
      this.open.set(path, pending);
      return pending;
    }
    pending = openZip(path);
    pending.catch(() => this.open.delete(path));
    this.open.set(path, pending);
    if (this.open.size > this.maxOpen) void this.close(this.open.keys().next().value!);
    return pending;
  }
}
