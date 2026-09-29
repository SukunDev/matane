/**
 * The official extension repository (BRAINSTORM.md §5.8, ADR 0022): a repository whose index is
 * signed by one of these keys is "official", and the repository at this URL is added once by
 * itself. Both are filled in when the repository goes live (Milestone 4f); until then the app
 * behaves as if there were none. End-to-end tests set their own through `MATANE_E2E_OFFICIAL_KEY`
 * and `MATANE_E2E_OFFICIAL_REPO` (only with `MATANE_E2E`).
 */
export const OFFICIAL_KEYS: readonly string[] = [];

/** Base URL of the official repository (ending in "/"), or null while it does not exist. */
export const OFFICIAL_REPO_URL: string | null = null;

export function officialKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const testKey = env['MATANE_E2E'] ? env['MATANE_E2E_OFFICIAL_KEY'] : undefined;
  return testKey ? [...OFFICIAL_KEYS, testKey] : [...OFFICIAL_KEYS];
}

export function officialRepoUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return (env['MATANE_E2E'] ? env['MATANE_E2E_OFFICIAL_REPO'] : undefined) ?? OFFICIAL_REPO_URL;
}
