/**
 * Keys of the official extension repository, built into the app (BRAINSTORM.md §5.8): a repository
 * whose index is signed by one of these is "official". Filled in when the official repository goes
 * live (Fase 4e). End-to-end tests add their own key through `MATANE_E2E_OFFICIAL_KEY`.
 */
export const OFFICIAL_KEYS: readonly string[] = [];

export function officialKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const testKey = env['MATANE_E2E'] ? env['MATANE_E2E_OFFICIAL_KEY'] : undefined;
  return testKey ? [...OFFICIAL_KEYS, testKey] : [...OFFICIAL_KEYS];
}
