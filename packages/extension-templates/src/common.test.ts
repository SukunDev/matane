import { describe, expect, it } from 'vitest';
import {
  clean,
  jsonAfter,
  known,
  parseAbsoluteDate,
  parseDate,
  parseStatus,
  parseType,
  splitLabel,
  toPath,
  toUrl,
  unique,
} from './common';

describe('urls', () => {
  it('stores the part after the base url, and gives the full url back', () => {
    const base = 'https://site.example.org/';
    expect(toPath('https://site.example.org/manga/a/', base)).toBe('/manga/a/');
    expect(toPath('HTTPS://SITE.example.org/manga/a/', base)).toBe('/manga/a/');
    expect(toPath('https://site.example.org', base)).toBe('/');
    expect(toPath('https://other.example.org/x', base)).toBe('https://other.example.org/x');
    expect(toUrl('/manga/a/', base)).toBe('https://site.example.org/manga/a/');
    expect(toUrl('manga/a/', 'https://site.example.org')).toBe('https://site.example.org/manga/a/');
    expect(toUrl('https://cdn.example.org/a.jpg', base)).toBe('https://cdn.example.org/a.jpg');
  });

  it('keeps a sub-folder install working', () => {
    const base = 'https://example.org/reader/';
    expect(toPath('https://example.org/reader/manga/a/', base)).toBe('/manga/a/');
    expect(toUrl('/manga/a/', base)).toBe('https://example.org/reader/manga/a/');
  });
});

describe('text', () => {
  it('collapses whitespace, non-breaking spaces included', () => {
    expect(clean('  A \n\t gardener on   the moon ')).toBe('A gardener on the moon');
    expect(clean(undefined)).toBe('');
  });

  it('reads "Label: value" and "Label value" rows', () => {
    expect(splitLabel('Status: Ongoing')).toEqual(['status', 'Ongoing']);
    expect(splitLabel('Author(s): Mika Example')).toEqual(['author(s)', 'Mika Example']);
    expect(splitLabel('Status Completed')).toEqual(['status', 'Completed']);
    expect(splitLabel('Type Manhwa')).toEqual(['type', 'Manhwa']);
    expect(splitLabel('Released 2024')).toBeUndefined();
  });

  it('drops the placeholders themes print for unknown values', () => {
    for (const value of ['-', '–', 'N/A', 'Unknown', '?', 'none']) expect(known(value)).toBeUndefined();
    expect(known(' Mika ')).toBe('Mika');
    expect(known(undefined)).toBeUndefined();
  });

  it('maps status and type words, in English and Indonesian', () => {
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Berjalan')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseStatus('Tamat')).toBe('completed');
    expect(parseStatus('On Hold')).toBe('hiatus');
    expect(parseStatus('Dropped')).toBe('cancelled');
    expect(parseStatus('???')).toBe('unknown');
    expect(parseType('Manhwa')).toBe('manhwa');
    expect(parseType('Korean Manhua')).toBe('manhua');
    expect(parseType('Novel')).toBeUndefined();
  });
});

describe('dates', () => {
  it('reads calendar dates in English and Indonesian', () => {
    expect(parseAbsoluteDate('January 5, 2024')).toBe(Date.UTC(2024, 0, 5));
    expect(parseAbsoluteDate('Jan 5th 2024')).toBe(Date.UTC(2024, 0, 5));
    expect(parseAbsoluteDate('5 Januari 2023')).toBe(Date.UTC(2023, 0, 5));
    expect(parseAbsoluteDate('12 Agustus 2022')).toBe(Date.UTC(2022, 7, 12));
    expect(parseAbsoluteDate('2024-03-09')).toBe(Date.UTC(2024, 2, 9));
    expect(parseAbsoluteDate('soon')).toBeUndefined();
    expect(parseAbsoluteDate('5 Smarch 2023')).toBeUndefined();
  });

  it('tries "3 days ago" first, then the calendar', () => {
    const now = Date.UTC(2024, 5, 10);
    expect(parseDate('3 days ago', now)).toBe(now - 3 * 86_400_000);
    expect(parseDate('yesterday', now)).toBe(now - 86_400_000);
    expect(parseDate('March 1, 2024', now)).toBe(Date.UTC(2024, 2, 1));
    expect(parseDate('5 januari 2024', now)).toBe(Date.UTC(2024, 0, 5));
    expect(parseDate('', now)).toBeUndefined();
  });
});

describe('jsonAfter', () => {
  it('finds the object after a marker, however much code surrounds it', () => {
    const script = `var a = {x: 1}; ts_reader.run({"a": {"b": [1, 2]}, "s": "} { \\" tricky", "t": 'x'}); other({"c": 3});`;
    expect(jsonAfter(script.replace("'x'", '"x"'), /ts_reader\.run\(\s*/)).toEqual({
      a: { b: [1, 2] },
      s: '} { " tricky',
      t: 'x',
    });
  });

  it('gives up quietly when there is no marker, no object, or broken JSON', () => {
    expect(jsonAfter('nothing here', /ts_reader\.run\(/)).toBeUndefined();
    expect(jsonAfter('ts_reader.run(42)', /ts_reader\.run\(/)).toBeUndefined();
    expect(jsonAfter('ts_reader.run({"a": })', /ts_reader\.run\(/)).toBeUndefined();
    expect(jsonAfter('ts_reader.run({"a": 1', /ts_reader\.run\(/)).toBeUndefined();
  });
});

describe('unique', () => {
  it('keeps the first of each url, in order', () => {
    expect(
      unique([
        { url: 'a', n: 1 },
        { url: 'b', n: 2 },
        { url: 'a', n: 3 },
      ]),
    ).toEqual([
      { url: 'a', n: 1 },
      { url: 'b', n: 2 },
    ]);
  });
});
