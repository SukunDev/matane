import { describe, expect, it } from 'vitest';
import { themeClasses } from './apply-theme';

describe('themeClasses', () => {
  it('follows the OS for the system theme', () => {
    expect(themeClasses('system', true)).toEqual(['mocha']);
    expect(themeClasses('system', false)).toEqual(['latte']);
  });

  it('builds AMOLED on top of Mocha', () => {
    expect(themeClasses('amoled', false)).toEqual(['mocha', 'amoled']);
  });

  it('uses explicit flavors as-is', () => {
    expect(themeClasses('latte', true)).toEqual(['latte']);
    expect(themeClasses('frappe', false)).toEqual(['frappe']);
  });
});
