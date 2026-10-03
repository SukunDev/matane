import { create } from 'zustand';

interface ReaderPosition {
  /** Chapter whose page is on screen (webtoon mode can scroll into the next chapter). */
  chapterId: number | null;
  /** Zero-based page shown (first page of a spread); -1 on a transition screen. */
  page: number;
  /** Last page seen on screen (last page of a spread, or lowest visible page in a strip). */
  pageEnd: number;
  /** Scrolled fraction of `page` (webtoon), else null. */
  offset: number | null;
  total: number;
  /** Set by the active view; the page slider calls it. */
  jumpTo: ((page: number) => void) | null;
  /** Set by the strip: scrolls to the start of a chapter it has loaded; false when it has not. */
  jumpToChapter: ((chapterId: number) => boolean) | null;
  /** Chapter the webtoon strip scrolled into; the route follows it without a new session. */
  followedChapterId: string | null;
  report: (
    chapterId: number,
    page: number,
    total: number,
    extra?: { pageEnd?: number; offset?: number | null },
  ) => void;
  setJump: (jump: ((page: number) => void) | null) => void;
  setJumpToChapter: (jump: ((chapterId: number) => boolean) | null) => void;
  /** Forget the previous reading session's position (on opening the reader). */
  reset: () => void;
}

export const useReaderPosition = create<ReaderPosition>((set) => ({
  chapterId: null,
  page: 0,
  pageEnd: 0,
  offset: null,
  total: 0,
  jumpTo: null,
  jumpToChapter: null,
  followedChapterId: null,
  report: (chapterId, page, total, extra = {}) =>
    set({ chapterId, page, total, pageEnd: extra.pageEnd ?? page, offset: extra.offset ?? null }),
  setJump: (jumpTo) => set({ jumpTo }),
  setJumpToChapter: (jumpToChapter) => set({ jumpToChapter }),
  reset: () => set({ chapterId: null, page: 0, pageEnd: 0, offset: null, total: 0 }),
}));
