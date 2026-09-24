import { useEffect } from 'react';
import { create } from 'zustand';

interface NoticeState {
  text: string | null;
  /** Bumped on every notice so repeating the same text restarts the timer. */
  id: number;
  show: (text: string) => void;
  hide: (id: number) => void;
}

/** Short confirmations in the reader ("Cover updated", "Page 12 bookmarked"). */
export const useReaderNotice = create<NoticeState>((set) => ({
  text: null,
  id: 0,
  show: (text) => set((state) => ({ text, id: state.id + 1 })),
  hide: (id) => set((state) => (state.id === id ? { text: null } : state)),
}));

const VISIBLE_MS = 2500;

export function ReaderNotice() {
  const { text, id, hide } = useReaderNotice();
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => hide(id), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [text, id, hide]);
  if (text === null) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-ctp-crust/90 px-4 py-2 text-sm text-ctp-text shadow-lg"
    >
      {text}
    </div>
  );
}
