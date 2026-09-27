import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatRelative, initials, languageName } from './format';

describe('format helpers', () => {
  it('builds two-letter initials', () => {
    expect(initials('MangaDex')).toBe('MD');
    expect(initials('Starry Archive')).toBe('SA');
    expect(initials('komiku')).toBe('KO');
  });

  it('formats relative times and falls back to dates', () => {
    const now = Date.UTC(2026, 8, 23, 12);
    expect(formatRelative(now - 5 * 60_000, 'en', now)).toBe('5 minutes ago');
    expect(formatRelative(now - 3 * 86_400_000, 'en', now)).toBe('3 days ago');
    expect(formatRelative(now - 3 * 3_600_000, 'id', now)).toBe('3 jam yang lalu');
    expect(formatRelative(Date.UTC(2026, 0, 5), 'en', now)).toBe('Jan 5, 2026');
  });

  it('names languages in the UI language', () => {
    expect(languageName('id', 'en')).toBe('Indonesian');
    expect(languageName('en', 'id')).toBe('Inggris');
  });

  it('formats sizes and short durations', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1536, 'en')).toBe('2 kB');
    expect(formatBytes(38.4 * 1024 ** 2, 'en')).toBe('38.4 MB');
    expect(formatBytes(18.4 * 1024 ** 3, 'id')).toBe('18,4 GB');
    expect(formatDuration(14)).toBe('14s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3780)).toBe('1h 3m');
  });
});
