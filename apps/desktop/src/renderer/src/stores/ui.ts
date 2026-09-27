import { create } from 'zustand';

interface UiState {
  /** From main (`app.online`), which watches the network; see `useOnlineSync`. */
  online: boolean;
  setOnline: (online: boolean) => void;
}

/** Transient UI state that is not persisted (persisted preferences live in settings). */
export const useUiStore = create<UiState>((set) => ({
  online: true,
  setOnline: (online) => set({ online }),
}));
