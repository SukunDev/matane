import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { pageFileName, toPng } from './page-file';

describe('pageFileName', () => {
  it('names a saved page after the manga, chapter and page', () => {
    expect(pageFileName('Long Strip', 'Ch. 12', 2, 'image/jpeg')).toBe('Long Strip - Ch. 12 - p 3.jpg');
    expect(pageFileName('A', 'B', 0, 'image/webp; charset=binary')).toBe('A - B - p 1.webp');
  });

  it('leaves out characters file systems refuse, and unknown types become PNG', () => {
    expect(pageFileName('What? / Why: "Now"', 'Ch.\t1 <end>', 9, null)).toBe('What Why Now - Ch. 1 end - p 10.png');
    expect(pageFileName('A', '', 0, 'image/x-unknown')).toBe('A - p 1.png');
  });
});

describe('toPng', () => {
  it('converts any image for the clipboard', async () => {
    const webp = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ff0000' } })
      .webp()
      .toBuffer();
    const png = await toPng(webp);
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 4, height: 3 });
  });
});
