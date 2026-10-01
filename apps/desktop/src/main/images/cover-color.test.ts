import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { type MangaRow, coverColorOf } from '../db/repositories/manga';
import { CoverColors, dominantColor } from './cover-color';

const solid = (background: string, width = 40, height = 60) =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();

describe('cover colours', () => {
  it('picks the colour of a cover, not its white background or black lines', async () => {
    // Mostly white, some black, a red band: the cover is "red".
    const cover = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#ffffff' } })
      .composite([
        { input: await solid('#101010', 40, 15), top: 0, left: 0 },
        { input: await solid('#d02020', 40, 12), top: 30, left: 0 },
      ])
      .png()
      .toBuffer();
    const color = await dominantColor(cover);
    expect(parseInt(color.slice(1, 3), 16)).toBeGreaterThan(180);
    expect(parseInt(color.slice(3, 5), 16)).toBeLessThan(60);
    // Without colour at all, the most common one (no tint later).
    const grey = await dominantColor(await solid('#f0f0f0'));
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toBe(grey.slice(5, 7));
  });

  it('only counts for the cover it was taken from', () => {
    const row = {
      coverColor: '#112233 https://a/cover.jpg',
      customCoverPath: null,
      thumbnailUrl: 'https://a/cover.jpg',
    };
    expect(coverColorOf(row)).toBe('#112233');
    expect(coverColorOf({ ...row, thumbnailUrl: 'https://a/new.jpg' })).toBeNull();
    expect(coverColorOf({ ...row, customCoverPath: '/covers/custom/1.png' })).toBeNull();
    expect(coverColorOf({ ...row, coverColor: null })).toBeNull();
  });

  it('measures a served cover once, in the background', async () => {
    let row = {
      id: 7,
      coverColor: null,
      customCoverPath: null,
      thumbnailUrl: 'https://a/c.jpg',
    } as unknown as MangaRow;
    const setCoverColor = vi.fn((_id: number, color: string, key: string) => {
      row = { ...row, coverColor: `${color} ${key}` };
    });
    const colors = new CoverColors({ manga: { get: () => row, setCoverColor } });
    const image = { data: await solid('#20a040'), contentType: 'image/png', sizeBytes: 1 };
    colors.noticed(row, image);
    colors.noticed(row, image);
    await colors.idle();
    expect(setCoverColor).toHaveBeenCalledTimes(1);
    expect(setCoverColor.mock.calls[0]![2]).toBe('https://a/c.jpg');
    colors.noticed(row, image);
    await colors.idle();
    expect(setCoverColor).toHaveBeenCalledTimes(1);
  });
});
