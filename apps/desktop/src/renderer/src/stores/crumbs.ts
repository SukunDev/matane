import { useEffect } from 'react';
import { create } from 'zustand';

interface CrumbState {
  /** Dynamic breadcrumb labels after the route's static `crumbs` (e.g. source name, manga title). */
  labels: string[];
  set: (labels: string[]) => void;
}

export const useCrumbStore = create<CrumbState>((set) => ({
  labels: [],
  set: (labels) => set({ labels }),
}));

/** Shows `labels` in the title bar while the calling page is mounted. */
export function usePageCrumbs(...labels: (string | undefined)[]): void {
  const key = JSON.stringify(labels);
  useEffect(() => {
    const clean = (JSON.parse(key) as (string | null)[]).filter((l): l is string => Boolean(l));
    useCrumbStore.getState().set(clean);
    return () => useCrumbStore.getState().set([]);
  }, [key]);
}
