import { queryOptions, useMutation } from '@tanstack/react-query';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

// Extension repositories and what they offer (BRAINSTORM.md §5.8). Both come from main's database
// and repository indexes, so `db.changed` ("repos", "extensions") keeps them fresh.

export const reposQuery = queryOptions({
  queryKey: ['repos'],
  queryFn: () => ipc.invoke('repos.list'),
  ...localQueryDefaults,
});

/** Under the `extensions` key, so installs and uninstalls refresh it too. */
export const availableExtensionsQuery = queryOptions({
  queryKey: ['extensions', 'available'],
  queryFn: () => ipc.invoke('extensions.available'),
  ...localQueryDefaults,
});

export function useSyncRepos() {
  return useMutation({ mutationFn: (repoId?: number) => ipc.invoke('repos.sync', repoId ? { repoId } : undefined) });
}

export const extensionIconUrl = (extensionId: string) => `manga://extension-icon/${encodeURIComponent(extensionId)}`;
export const repoIconUrl = (repoId: number, extensionId: string) =>
  `manga://repo-icon/${repoId}/${encodeURIComponent(extensionId)}`;

/** Extensions still moving from the app to the official repository (see `HandoffBanner`). */
export const handoffQuery = queryOptions({
  queryKey: ['extensions', 'handoff'],
  queryFn: () => ipc.invoke('extensions.handoff'),
  ...localQueryDefaults,
});
