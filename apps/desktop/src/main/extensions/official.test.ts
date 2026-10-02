import { describe, expect, it } from 'vitest';
import { OFFICIAL_KEYS, OFFICIAL_REPO_URL, officialKeys, officialRepoUrl } from './official';

describe('official repository', () => {
  it('is the published one outside tests', () => {
    expect(officialRepoUrl({})).toBe(OFFICIAL_REPO_URL);
    expect(OFFICIAL_REPO_URL).toMatch(/^https:\/\/.+\/$/);
    expect(officialKeys({})).toEqual([...OFFICIAL_KEYS]);
    expect(OFFICIAL_KEYS.every((key) => /^ed25519:[A-Za-z0-9+/]{43}=$/.test(key))).toBe(true);
  });

  it('is never reached from end-to-end tests', () => {
    expect(officialRepoUrl({ MATANE_E2E: '1' })).toBeNull();
    expect(officialRepoUrl({ MATANE_E2E: '1', MATANE_E2E_OFFICIAL_REPO: 'http://x/official/' })).toBe(
      'http://x/official/',
    );
    // The test hooks do nothing in a normal start.
    expect(officialRepoUrl({ MATANE_E2E_OFFICIAL_REPO: 'http://x/official/' })).toBe(OFFICIAL_REPO_URL);
    expect(officialKeys({ MATANE_E2E: '1', MATANE_E2E_OFFICIAL_KEY: 'ed25519:test' })).toEqual([
      ...OFFICIAL_KEYS,
      'ed25519:test',
    ]);
  });
});
