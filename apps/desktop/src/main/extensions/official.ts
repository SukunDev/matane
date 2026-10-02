/**
 * The official extension repository (BRAINSTORM.md §5.8, ADR 0022): a repository whose index is
 * signed by one of these keys is "official", and the repository at this URL is added once by
 * itself. It lives in github.com/SukunDev/matane-extensions, published to GitHub Pages
 * (docs/matane-extensions/). End-to-end tests never reach it: with `MATANE_E2E` the URL is only the
 * test's own `MATANE_E2E_OFFICIAL_REPO` (none without it), and `MATANE_E2E_OFFICIAL_KEY` adds a key.
 */
export const OFFICIAL_KEYS: readonly string[] = ['ed25519:MorWEtba9PuogLbiYZR/HVUVn+KpY3zsNq8nzqyhAbw='];

/** Base URL of the official repository (ending in "/"). */
export const OFFICIAL_REPO_URL: string | null = 'https://sukundev.github.io/matane-extensions/';

export function officialKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const testKey = env['MATANE_E2E'] ? env['MATANE_E2E_OFFICIAL_KEY'] : undefined;
  return testKey ? [...OFFICIAL_KEYS, testKey] : [...OFFICIAL_KEYS];
}

export function officialRepoUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env['MATANE_E2E']) return env['MATANE_E2E_OFFICIAL_REPO'] ?? null;
  return OFFICIAL_REPO_URL;
}
