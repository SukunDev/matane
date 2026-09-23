import { create } from 'zustand';

interface UiState {
  online: boolean;
  setOnline: (online: boolean) => void;
}

/** Transient UI state that is not persisted (persisted preferences live in settings). */
export const useUiStore = create<UiState>((set) => ({
  online: navigator.onLine,
  setOnline: (online) => set({ online }),
}));

window.addEventListener('online', () => useUiStore.getState().setOnline(true));
window.addEventListener('offline', () => useUiStore.getState().setOnline(false));
