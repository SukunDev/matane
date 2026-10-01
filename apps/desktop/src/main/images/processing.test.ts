import { pageSegments } from '@manga-reader/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cropBox, cropImage, measure, splitImage } from './processing';

/** A `width`×`height` page of `background` with a `content` rectangle at `box`. */
async function page(
  width: number,
  height: number,
  background: string,
  box: { left: number; top: number; width: number; height: number } | null,
  format: 'png' | 'jpeg' = 'png',
): Promise<Buffer> {
  let image = sharp({ create: { width, height, channels: 3, background } });
  if (box) {
    const content = await sharp({
      create: { width: box.width, height: box.height, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    image = sharp(
      await image
        .composite([{ input: content, left: box.left, top: box.top }])
        .png()
        .toBuffer(),
    );
  }
  return format === 'jpeg' ? image.jpeg({ quality: 80 }).toBuffer() : image.png().toBuffer();
}

describe('measure', () => {
  it('reports the size as shown, EXIF orientation applied', async () => {
    const plain = await page(100, 50, '#ffffff', null, 'jpeg');
    await expect(measure(plain)).resolves.toEqual({ width: 100, height: 50 });
    const rotated = await sharp(plain).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await expect(measure(rotated)).resolves.toEqual({ width: 50, height: 100 });
  });
});

describe('cropBox', () => {
  const content = { left: 40, top: 50, width: 100, height: 200 };

  it('finds the content inside white or black margins', async () => {
    await expect(cropBox(await page(200, 300, '#ffffff', content))).resolves.toEqual(content);
    await expect(cropBox(await page(200, 300, '#000000', content))).resolves.toEqual(content);
  });

  it('copes with JPEG noise around the margins', async () => {
    const box = await cropBox(await page(200, 300, '#ffffff', content, 'jpeg'));
    expect(box).not.toBeNull();
    expect(Math.abs(box!.left - content.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.top - content.top)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.width - content.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(box!.height - content.height)).toBeLessThanOrEqual(4);
  });

  it('leaves pages alone without margins, with a thin one, or mostly blank', async () => {
    await expect(cropBox(await page(200, 300, '#ff8800', null))).resolves.toBeNull();
    await expect(
      cropBox(await page(200, 300, '#ff8800', { left: 0, top: 0, width: 200, height: 300 })),
    ).resolves.toBeNull();
    await expect(
      cropBox(await page(200, 300, '#ffffff', { left: 2, top: 2, width: 196, height: 296 })),
    ).resolves.toBeNull();
    await expect(
      cropBox(await page(200, 300, '#ffffff', { left: 90, top: 140, width: 20, height: 20 })),
    ).resolves.toBeNull();
  });

  it('trims only the sides that have a margin', async () => {
    const strip = { left: 0, top: 30, width: 200, height: 240 };
    await expect(cropBox(await page(200, 300, '#ffffff', strip))).resolves.toEqual(strip);
  });
});

describe('cropImage and splitImage', () => {
  it('cuts the crop box out, keeping the format', async () => {
    const box = { left: 40, top: 50, width: 100, height: 200 };
    const cropped = await cropImage(await page(200, 300, '#ffffff', box, 'jpeg'), box);
    expect(cropped.contentType).toBe('image/jpeg');
    await expect(measure(cropped.bytes)).resolves.toEqual({ width: 100, height: 200 });
  });

  it('cuts a tall page into the planned segments, in order', async () => {
    const width = 20;
    const height = 10_001;
    // Each row's grey value is its y modulo 256, so a segment's first row tells where it starts.
    const raw = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) raw.fill(y % 256, y * width, (y + 1) * width);
    const strip = await sharp(raw, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const heights = pageSegments(width, height);
    expect(heights).toEqual([3333, 3333, 3335]);
    const segments = await splitImage(strip, null, heights);
    expect(segments).toHaveLength(3);
    let top = 0;
    for (const [i, segment] of segments.entries()) {
      expect(segment.contentType).toBe('image/png');
      const { data, info } = await sharp(segment.bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([width, heights[i]]);
      expect(data[0]).toBe(top % 256);
      top += heights[i]!;
    }
  });

  it('crops before cutting, and refuses a plan that does not fit', async () => {
    const box = { left: 10, top: 100, width: 80, height: 6000 };
    const tall = await page(100, 6200, '#ffffff', box);
    const heights = pageSegments(box.width, box.height);
    const segments = await splitImage(tall, box, heights);
    expect(segments).toHaveLength(2);
    await expect(measure(segments[1]!.bytes)).resolves.toEqual({ width: 80, height: 3000 });
    await expect(splitImage(tall, null, heights)).rejects.toThrow('Segments cover 6000 px of a 6200 px page');
  });
});
