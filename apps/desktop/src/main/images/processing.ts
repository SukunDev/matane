// Pixel work for the reader (BRAINSTORM.md §6.1, ADR 0025): page sizes, border crop and tall-page
// segments. Runs on sharp's own thread pool, so the main thread only awaits.
import sharp, { type FormatEnum, type Sharp } from 'sharp';

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  left: number;
  top: number;
}

export interface Encoded {
  bytes: Buffer;
  contentType: string;
}

/** An image in memory (download) or on disk (cache). */
export type ImageInput = Uint8Array | string;

/** Luminance at or above this is "white" margin, at or below `BLACK` "black" margin. */
const WHITE = 225;
const BLACK = 30;
/** A row or column is margin when at most this share of its pixels differs (JPEG noise, specks). */
const NOISE = 0.005;
/** Less than this many pixels off every side is not worth a cropped copy. */
const MIN_TRIM = 4;
/** A crop leaving less than this share of the page is a mostly blank page: left alone. */
const MIN_AREA = 0.25;

const open = (input: ImageInput): Sharp => sharp(input, { failOn: 'none' });

/** The size the page is shown at (EXIF orientation applied, as the browser does). */
export async function measure(input: ImageInput): Promise<Size> {
  const meta = await open(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw new Error('The image has no size');
  return (meta.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
}

/**
 * The page without its uniform white or black margins, or null when there is nothing to crop (no
 * margin, a margin of a few pixels, or a page that is mostly blank). The margin colour comes from
 * the corners; every side is trimmed on its own.
 */
export async function cropBox(input: ImageInput): Promise<Box | null> {
  const { data, info } = await open(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x: number, y: number) => data[(y * width + x) * channels]!;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const white = corners.filter((v) => v >= WHITE).length;
  const black = corners.filter((v) => v <= BLACK).length;
  if (white < 2 && black < 2) return null;
  const margin = white >= black ? (v: number) => v >= WHITE : (v: number) => v <= BLACK;

  const rowIsMargin = (y: number, from: number, to: number) => {
    let off = 0;
    const allowed = (to - from) * NOISE;
    for (let x = from; x < to; x++) if (!margin(at(x, y)) && ++off > allowed) return false;
    return true;
  };
  const columnIsMargin = (x: number, from: number, to: number) => {
    let off = 0;
    const allowed = (to - from) * NOISE;
    for (let y = from; y < to; y++) if (!margin(at(x, y)) && ++off > allowed) return false;
    return true;
  };

  let top = 0;
  while (top < height - 1 && rowIsMargin(top, 0, width)) top++;
  let bottom = height - 1;
  while (bottom > top && rowIsMargin(bottom, 0, width)) bottom--;
  let left = 0;
  while (left < width - 1 && columnIsMargin(left, top, bottom + 1)) left++;
  let right = width - 1;
  while (right > left && columnIsMargin(right, top, bottom + 1)) right--;

  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  if (Math.max(left, top, width - 1 - right, height - 1 - bottom) < MIN_TRIM) return null;
  if (box.width * box.height < width * height * MIN_AREA) return null;
  return box;
}

/** The page cut to `box`, in the page's own format. */
export async function cropImage(input: ImageInput, box: Box): Promise<Encoded> {
  const format = await formatOf(input);
  return encode(open(input).rotate().extract(box), format);
}

/**
 * The page (cut to `box` first, when given) as consecutive segments of `heights` (see
 * `pageSegments`). Decodes once; each segment is encoded in the page's own format.
 */
export async function splitImage(input: ImageInput, box: Box | null, heights: number[]): Promise<Encoded[]> {
  const format = await formatOf(input);
  let image = open(input).rotate();
  if (box) image = image.extract(box);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const total = heights.reduce((sum, h) => sum + h, 0);
  if (total !== info.height) throw new Error(`Segments cover ${total} px of a ${info.height} px page`);
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const out: Encoded[] = [];
  let top = 0;
  for (const height of heights) {
    out.push(await encode(sharp(data, { raw }).extract({ left: 0, top, width: info.width, height }), format));
    top += height;
  }
  return out;
}

async function formatOf(input: ImageInput): Promise<keyof FormatEnum | undefined> {
  return (await open(input).metadata()).format;
}

/** JPEG and WebP stay as they are; PNG, GIF and the rest become PNG, AVIF/HEIF becomes WebP. */
async function encode(image: Sharp, format: keyof FormatEnum | undefined): Promise<Encoded> {
  switch (format) {
    case 'jpeg':
      return { bytes: await image.jpeg({ quality: 90 }).toBuffer(), contentType: 'image/jpeg' };
    case 'webp':
    case 'heif':
      return { bytes: await image.webp({ quality: 90 }).toBuffer(), contentType: 'image/webp' };
    default:
      return { bytes: await image.png().toBuffer(), contentType: 'image/png' };
  }
}
