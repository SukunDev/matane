import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYMAP, SEGMENT_HEIGHT_PX, actionForKey, effectiveKeymap, keyId, pageSegments } from './reader';

describe('pageSegments', () => {
  it('keeps ordinary and fairly long pages whole', () => {
    expect(pageSegments(800, 1200)).toEqual([1200]);
    expect(pageSegments(800, 5000)).toEqual([5000]);
  });

  it('cuts tall pages into equal parts that add up to the page', () => {
    expect(pageSegments(800, 12_000)).toEqual([4000, 4000, 4000]);
    const parts = pageSegments(690, 20_001);
    expect(parts).toHaveLength(6);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(20_001);
    expect(Math.max(...parts)).toBeLessThanOrEqual(SEGMENT_HEIGHT_PX);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(5);
  });

  it('never cuts a page without a width', () => {
    expect(pageSegments(0, 9000)).toEqual([9000]);
  });
});

describe('reader keys', () => {
  const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    keyId({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('names key presses the way the keymap stores them', () => {
    expect(press('a')).toBe('A');
    expect(press('A', { shiftKey: true })).toBe('A');
    expect(press(' ')).toBe('Space');
    expect(press(' ', { shiftKey: true })).toBe('Shift+Space');
    expect(press('=', { ctrlKey: true })).toBe('Ctrl+=');
    expect(press('+', { metaKey: true, shiftKey: true })).toBe('Ctrl++');
    expect(press('ArrowLeft', { altKey: true })).toBe('Alt+ArrowLeft');
    expect(press('Shift', { shiftKey: true })).toBeNull();
    expect(press('Control', { ctrlKey: true })).toBeNull();
  });

  it('puts changes over the defaults and finds the action of a key', () => {
    const keymap = effectiveKeymap({ nextPage: ['L'], menu: [] });
    expect(keymap.nextPage).toEqual(['L']);
    expect(keymap.prevPage).toEqual(DEFAULT_KEYMAP.prevPage);
    expect(actionForKey(keymap, 'L')).toBe('nextPage');
    expect(actionForKey(keymap, 'Space')).toBeNull();
    expect(actionForKey(keymap, 'M')).toBeNull();
    expect(actionForKey(keymap, 'Ctrl++')).toBe('zoomIn');
  });

  it('gives every default key to one action only', () => {
    const all = Object.values(DEFAULT_KEYMAP).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
