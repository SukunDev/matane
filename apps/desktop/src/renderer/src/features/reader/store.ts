import { create } from 'zustand';

interface ReaderPosition {
  /** Chapter whose page is on screen (webtoon mode can scroll into the next chapter). */
  chapterId: number | null;
  /** Zero-based page shown (first page of a spread); -1 on a transition screen. */
  page: number;
  total: number;
  /** Set by the active view; the page slider calls it. */
  jumpTo: ((page: number) => void) | null;
  /** Chapter the webtoon strip scrolled into; the route follows it without a new session. */
  followedChapterId: string | null;
  report: (chapterId: number, page: number, total: number) => void;
  setJump: (jump: ((page: number) => void) | null) => void;
}

export const useReaderPosition = create<ReaderPosition>((set) => ({
  chapterId: null,
  page: 0,
  total: 0,
  jumpTo: null,
  followedChapterId: null,
  report: (chapterId, page, total) => set({ chapterId, page, total }),
  setJump: (jumpTo) => set({ jumpTo }),
}));
