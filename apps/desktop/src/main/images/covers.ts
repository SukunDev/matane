import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AppError } from '@manga-reader/shared/errors';
import type { MangaRepository, MangaRow } from '../db/repositories/manga';
import type { CachedImage } from './cache';

const MAX_CUSTOM_BYTES = 20 * 1024 * 1024;

const SIGNATURES: { type: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { type: 'image/png', ext: '.png', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { type: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: '.gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    type: 'image/webp',
    ext: '.webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { type: 'image/avif', ext: '.avif', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif' },
];

/** Image type from the file's first bytes (extensions and names can lie). */
export async function sniffImage(path: string): Promise<{ type: string; ext: string } | undefined> {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16), 0, 16, 0);
    return sniffBytes(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Image type from the first bytes of a file (the extension or content type can't be trusted). */
export function sniffBytes(bytes: Uint8Array): { type: string; ext: string } | undefined {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 16));
  const match = SIGNATURES.find((s) => s.test(head));
  return match && { type: match.type, ext: match.ext };
}

const shortHash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 10);

/**
 * Covers that must survive cache eviction (BRAINSTORM.md §6.5): a permanent copy for every library
 * manga (`userData/covers`, named after the source cover URL so a new cover replaces it), and the
 * user's custom covers (`userData/covers/custom`).
 */
export class CoverStore {
  constructor(
    private readonly dir: string,
    private readonly manga: MangaRepository,
  ) {}

  /** Serves a file as an image, or undefined when it is gone or not an image. */
  async file(path: string): Promise<CachedImage | undefined> {
    try {
      const [info, kind] = await Promise.all([stat(path), sniffImage(path)]);
      if (!kind) return undefined;
      return { key: `file:${path}`, path, contentType: kind.type, sizeBytes: info.size };
    } catch {
      return undefined;
    }
  }

  /** The permanent copy of a library manga's current source cover, if it exists. */
  async library(row: MangaRow): Promise<CachedImage | undefined> {
    if (!row.coverPath || !row.thumbnailUrl) return undefined;
    if (!basename(row.coverPath).startsWith(`${row.id}-${shortHash(row.thumbnailUrl)}`)) return undefined;
    return this.file(row.coverPath);
  }

  /** Keeps a permanent copy of `image` (the cached source cover) for a library manga. */
  async persist(row: MangaRow, image: CachedImage): Promise<void> {
    if (!row.thumbnailUrl) return;
    const kind = await sniffImage(image.path);
    if (!kind) return;
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, `${row.id}-${shortHash(row.thumbnailUrl)}${kind.ext}`);
    if (target === row.coverPath) return;
    await copyFile(image.path, target);
    if (row.coverPath) await rm(row.coverPath, { force: true });
    this.manga.setCoverPath(row.id, target);
  }

  /** Removes the permanent copy (the manga left the library). Custom covers stay. */
  async drop(mangaId: number): Promise<void> {
    const row = this.manga.get(mangaId);
    if (!row?.coverPath) return;
    await rm(row.coverPath, { force: true });
    this.manga.setCoverPath(mangaId, null);
  }

  /** Copies an image (a picked file or a cached reader page) in as the manga's custom cover. */
  async setCustom(mangaId: number, source: string): Promise<void> {
    const row = this.manga.get(mangaId);
    if (!row) throw new AppError('not_found', `Manga ${mangaId} not found`);
    const [info, kind] = await Promise.all([stat(source), sniffImage(source)]);
    if (!kind) throw new AppError('parse', 'That file is not a supported image (PNG, JPEG, GIF, WebP, AVIF)');
    if (info.size > MAX_CUSTOM_BYTES) throw new AppError('parse', 'That image is larger than 20 MB');
    const dir = join(this.dir, 'custom');
    await mkdir(dir, { recursive: true });
    // A new name each time, so the renderer's cover URL (and Chromium's cache) changes too.
    const target = join(dir, `${mangaId}-${Date.now()}${kind.ext}`);
    await copyFile(source, target);
    if (row.customCoverPath) await rm(row.customCoverPath, { force: true });
    this.manga.setCustomCoverPath(mangaId, target);
  }

  /** A custom cover from bytes (a page of a downloaded chapter). */
  async setCustomBytes(mangaId: number, bytes: Uint8Array): Promise<void> {
    const dir = join(this.dir, 'custom');
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${mangaId}-${Date.now()}.tmp`);
    await writeFile(temp, bytes);
    try {
      await this.setCustom(mangaId, temp);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async resetCustom(mangaId: number): Promise<void> {
    const row = this.manga.get(mangaId);
    if (!row?.customCoverPath) return;
    await rm(row.customCoverPath, { force: true });
    this.manga.setCustomCoverPath(mangaId, null);
  }
}
