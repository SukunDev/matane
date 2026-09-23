import { create } from 'zustand';
import type { PageSize } from './navigation';

export const pageSrc = (chapterId: number, index: number, attempt = 0) =>
  `manga://page/${chapterId}/${index}${attempt > 0 ? `?retry=${attempt}` : ''}`;

interface PageSizeState {
  sizes: Record<string, PageSize>;
  set: (chapterId: number, index: number, size: PageSize) => void;
}

/** Natural page sizes, measured once an image decodes (double-page pairing, webtoon heights). */
export const usePageSizes = create<PageSizeState>((set) => ({
  sizes: {},
  set: (chapterId, index, size) =>
    set((state) => {
      const key = `${chapterId}:${index}`;
      const old = state.sizes[key];
      if (old && old.width === size.width && old.height === size.height) return state;
      return { sizes: { ...state.sizes, [key]: size } };
    }),
}));

export const sizeKey = (chapterId: number, index: number) => `${chapterId}:${index}`;

const preloaded = new Map<string, HTMLImageElement>();
const MAX_PRELOADED = 40;

/**
 * Warms upcoming pages: main fetches and caches them, and the decoded bitmap is ready when the
 * page turns. Keeps references to the last few so they are not collected mid-decode.
 */
export function preloadPage(chapterId: number, index: number): void {
  const src = pageSrc(chapterId, index);
  if (preloaded.has(src)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  preloaded.set(src, image);
  image
    .decode()
    .then(() =>
      usePageSizes.getState().set(chapterId, index, { width: image.naturalWidth, height: image.naturalHeight }),
    )
    .catch(() => preloaded.delete(src));
  while (preloaded.size > MAX_PRELOADED) preloaded.delete(preloaded.keys().next().value!);
}
