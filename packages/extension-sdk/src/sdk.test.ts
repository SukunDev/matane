import { describe, expect, it } from 'vitest';
import { parseRelativeDate } from './date.js';
import { HttpError, NotFoundError } from './errors.js';
import { isAllowedHost, manifestSchema } from './manifest.js';

describe('isAllowedHost', () => {
  const domains = ['mangadex.org', '*.mangadex.network'];

  it('matches exact hosts and wildcard subdomains', () => {
    expect(isAllowedHost('mangadex.org', domains)).toBe(true);
    expect(isAllowedHost('MangaDex.org', domains)).toBe(true);
    expect(isAllowedHost('abc.def.mangadex.network', domains)).toBe(true);
  });

  it('rejects look-alikes, parents of wildcards and other subdomains', () => {
    expect(isAllowedHost('api.mangadex.org', domains)).toBe(false);
    expect(isAllowedHost('mangadex.network', domains)).toBe(false);
    expect(isAllowedHost('evilmangadex.network', domains)).toBe(false);
    expect(isAllowedHost('mangadex.org.evil.com', domains)).toBe(false);
  });
});

describe('parseRelativeDate', () => {
  const now = Date.UTC(2026, 0, 10);

  it.each([
    ['2 hours ago', now - 2 * 3_600_000],
    ['an hour ago', now - 3_600_000],
    ['5 menit yang lalu', now - 5 * 60_000],
    ['3 hari lalu', now - 3 * 86_400_000],
    ['Yesterday', now - 86_400_000],
    ['kemarin', now - 86_400_000],
    ['hari ini', now],
    ['just now', now],
  ])('parses %s', (text, expected) => {
    expect(parseRelativeDate(text, now)).toBe(expected);
  });

  it('returns undefined for unrecognised text', () => {
    expect(parseRelativeDate('Jan 5, 2026', now)).toBeUndefined();
    expect(parseRelativeDate('3 fortnights ago', now)).toBeUndefined();
  });
});

describe('manifestSchema', () => {
  const valid = {
    id: 'mangadex',
    name: 'MangaDex',
    version: '1.0.0',
    apiVersion: 1,
    domains: ['api.mangadex.org', '*.mangadex.network'],
    sources: [{ key: 'en', lang: 'en', name: 'MangaDex' }],
  };

  it('accepts a valid manifest and defaults nsfw to false', () => {
    expect(manifestSchema.parse(valid).nsfw).toBe(false);
  });

  it.each([
    ['uppercase id', { id: 'MangaDex' }],
    ['non-semver version', { version: '1.0' }],
    ['empty domains', { domains: [] }],
    ['url instead of domain', { domains: ['https://mangadex.org'] }],
    ['no sources', { sources: [] }],
  ])('rejects %s', (_, patch) => {
    expect(manifestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('errors', () => {
  it('keep their names and status for the host bridge', () => {
    const error = new HttpError(503, 'down');
    expect(error.name).toBe('HttpError');
    expect(error.status).toBe(503);
    expect(new NotFoundError('gone')).toBeInstanceOf(Error);
  });
});
