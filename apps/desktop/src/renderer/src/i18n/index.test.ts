import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import id from './locales/id.json';
import { resolveLanguage } from './index';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe('i18n', () => {
  it('resolves the OS locale when no language is chosen', () => {
    expect(resolveLanguage(null, 'id-ID')).toBe('id');
    expect(resolveLanguage(null, 'ja-JP')).toBe('en');
    expect(resolveLanguage('id', 'en-US')).toBe('id');
  });

  it('keeps English and Indonesian translations in sync', () => {
    // Plural forms differ per language (English: _one/_other, Indonesian: _other only).
    const bases = (value: unknown) =>
      [...new Set(keys(value).map((key) => key.replace(/_(zero|one|two|few|many|other)$/, '')))].sort();
    expect(bases(id)).toEqual(bases(en));
  });
});
