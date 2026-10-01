import { describe, expect, it } from 'vitest';
import { contrast, coverTint } from './cover-tint';

const rgbOf = (css: string) =>
  /rgb\((\d+) (\d+) (\d+)/
    .exec(css)!
    .slice(1, 4)
    .map((v) => Number(v) / 255) as [number, number, number];
const crust: [number, number, number] = [0x11 / 255, 0x11 / 255, 0x1b / 255];
const base: [number, number, number] = [0xef / 255, 0xf1 / 255, 0xf5 / 255];

describe('coverTint', () => {
  it('keeps the cover hue and readable text on dark and light themes', () => {
    for (const hex of ['#1a237e', '#ff5252', '#ffeb3b', '#2e7d32', '#6a1b9a', '#000080']) {
      const dark = coverTint(hex, 'dark')!;
      expect(contrast(rgbOf(dark.accent), crust)).toBeGreaterThanOrEqual(4.5);
      expect(dark.onAccent).toBe('#11111b');
      const light = coverTint(hex, 'light')!;
      expect(contrast(rgbOf(light.accent), base)).toBeGreaterThanOrEqual(4.5);
      expect(light.onAccent).toBe('#eff1f5');
    }
  });

  it('turns a very bright cover down on Latte and a very dark one up on dark themes', () => {
    const [r, , b] = rgbOf(coverTint('#ffeb3b', 'light')!.accent);
    expect(r).toBeLessThan(0.6);
    expect(b).toBeLessThan(0.3);
    const navy = rgbOf(coverTint('#000080', 'dark')!.accent);
    expect(Math.max(...navy)).toBeGreaterThan(0.6);
  });

  it('gives no tint for grey covers or no colour', () => {
    expect(coverTint('#808080', 'dark')).toBeNull();
    expect(coverTint('#f5f5f0', 'light')).toBeNull();
    expect(coverTint(null, 'dark')).toBeNull();
    expect(coverTint('red', 'dark')).toBeNull();
  });
});
