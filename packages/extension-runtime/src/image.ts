// Host-side pixel work for `transformImage` (BRAINSTORM.md §5.6, ADR 0024), shared by the app and
// `mr-ext test`. Imported via `@manga-reader/extension-runtime/image` (it needs sharp).
import type { ImageTransform } from '@manga-reader/extension-sdk';
import sharp, { type FormatEnum, type OutputInfo } from 'sharp';

type Tiles = NonNullable<ImageTransform['tiles']>;

/** The image cannot be rebuilt (unreadable, or a tile out of bounds). */
export class ImageTransformError extends Error {
  override readonly name = 'ImageTransformError';
}

const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46],
  ['image/webp', (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP'],
  ['image/avif', (b) => ascii(b, 4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(b, 8, 12))],
];

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** The image type from its first bytes (restored images carry no trustworthy header). */
export function sniffImageType(bytes: Uint8Array): string | null {
  return SIGNATURES.find(([, test]) => test(bytes))?.[0] ?? null;
}

/**
 * Rebuilds a scrambled picture (BRAINSTORM.md §5.6): decodes once to raw pixels, copies each
 * rectangle row by row, and encodes again in the original format (GIF and unknown formats as PNG).
 * Rectangles outside the source or the result are refused, so a bad extension cannot read or write
 * out of bounds.
 */
/** Restored bytes and tiles applied: what gets shown, cached and downloaded. */
export async function restoreImage(fetched: Uint8Array, transform: ImageTransform): Promise<Uint8Array> {
  const bytes = transform.bytes ?? fetched;
  return transform.tiles ? applyTiles(bytes, transform.tiles) : bytes;
}

export async function applyTiles(bytes: Uint8Array, tiles: Tiles): Promise<Uint8Array> {
  let decoded: { data: Buffer; info: OutputInfo };
  let format: keyof FormatEnum | undefined;
  try {
    const image = sharp(bytes, { failOn: 'none' });
    format = (await image.metadata()).format;
    decoded = await image.raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new ImageTransformError(`The image to rebuild could not be read: ${(error as Error).message}`);
  }
  const { data, info } = decoded;
  const channels = info.channels;
  const out = Buffer.alloc(tiles.width * tiles.height * channels);
  for (const [i, op] of tiles.ops.entries()) {
    const inside =
      op.sx + op.w <= info.width &&
      op.sy + op.h <= info.height &&
      op.dx + op.w <= tiles.width &&
      op.dy + op.h <= tiles.height;
    if (!inside) throw new ImageTransformError(`Tile ${i} lies outside the image`);
    const rowBytes = op.w * channels;
    for (let row = 0; row < op.h; row++) {
      const from = ((op.sy + row) * info.width + op.sx) * channels;
      const to = ((op.dy + row) * tiles.width + op.dx) * channels;
      data.copy(out, to, from, from + rowBytes);
    }
  }
  const result = sharp(out, { raw: { width: tiles.width, height: tiles.height, channels } });
  switch (format) {
    case 'jpeg':
      return result.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    case 'webp':
      return result.webp({ quality: 92 }).toBuffer();
    case 'heif':
      return result.avif({ quality: 70 }).toBuffer();
    default:
      return result.png().toBuffer();
  }
}
