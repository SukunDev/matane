import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyTiles, sniffImageType } from './image';

/** A 4×2 picture: left half red, right half blue. */
const picture = (format: 'png' | 'jpeg' | 'webp') => {
  const image = sharp({ create: { width: 4, height: 2, channels: 3, background: '#ff0000' } }).composite([
    { input: { create: { width: 2, height: 2, channels: 3, background: '#0000ff' } }, left: 2, top: 0 },
  ]);
  const encoded = format === 'png' ? image.png() : format === 'jpeg' ? image.jpeg() : image.webp();
  return encoded.toBuffer();
};

const pixel = async (bytes: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + 3)];
};

const dominant = ([r = 0, , b = 0]: number[]) => (b > 150 && r < 100 ? 'blue' : r > 150 && b < 100 ? 'red' : 'mixed');

describe('applyTiles', () => {
  it('swaps halves and keeps the format', async () => {
    for (const format of ['png', 'webp'] as const) {
      const swapped = await applyTiles(await picture(format), {
        width: 4,
        height: 2,
        ops: [
          { sx: 0, sy: 0, w: 2, h: 2, dx: 2, dy: 0 },
          { sx: 2, sy: 0, w: 2, h: 2, dx: 0, dy: 0 },
        ],
      });
      expect(sniffImageType(swapped)).toBe(`image/${format}`);
      // WebP is lossy: blue stays mostly blue, red mostly red.
      expect(dominant(await pixel(swapped, 0, 1))).toBe('blue');
      expect(dominant(await pixel(swapped, 3, 0))).toBe('red');
    }
  });

  it('re-encodes JPEG as JPEG', async () => {
    const out = await applyTiles(await picture('jpeg'), {
      width: 2,
      height: 2,
      ops: [{ sx: 2, sy: 0, w: 2, h: 2, dx: 0, dy: 0 }],
    });
    expect(sniffImageType(out)).toBe('image/jpeg');
    expect(dominant(await pixel(out, 1, 1))).toBe('blue');
  });

  it('refuses tiles outside the image or the result, and bytes that are not an image', async () => {
    const png = await picture('png');
    await expect(
      applyTiles(png, { width: 4, height: 2, ops: [{ sx: 3, sy: 0, w: 2, h: 1, dx: 0, dy: 0 }] }),
    ).rejects.toThrow(/outside/);
    await expect(
      applyTiles(png, { width: 2, height: 2, ops: [{ sx: 0, sy: 0, w: 2, h: 2, dx: 1, dy: 0 }] }),
    ).rejects.toThrow(/outside/);
    await expect(applyTiles(new Uint8Array([1, 2, 3]), { width: 1, height: 1, ops: [] })).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('sniffImageType', () => {
  it('knows the usual formats and nothing else', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('\0\0\0\x1cftypavif'))).toBe('image/avif');
    expect(sniffImageType(Buffer.from('<html>'))).toBeNull();
  });
});
