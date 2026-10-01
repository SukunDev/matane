import { pageSegments } from '@manga-reader/shared/reader';
import { create } from 'zustand';
import { ipc } from '../../lib/ipc';
import type { PageSize } from './navigation';

/** How a page is shown (ADR 0025): cropped to its content, and/or one segment of a tall page. */
export interface PageView {
  crop?: boolean;
  segment?: number;
}

export const pageSrc = (chapterId: number, index: number, view: PageView = {}, attempt = 0) => {
  const path = `manga://page/${chapterId}/${index}${view.segment === undefined ? '' : `/seg/${view.segment}`}`;
  const query = new URLSearchParams();
  if (view.crop) query.set('crop', '1');
  if (attempt > 0) query.set('retry', String(attempt));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
};

/** Sizes are kept apart with and without crop: the same page has two. */
export const sizeKey = (chapterId: number, index: number, crop: boolean) =>
  `${chapterId}:${index}${crop ? ':crop' : ''}`;

interface PageSizeState {
  sizes: Record<string, PageSize>;
  set: (entries: { chapterId: number; index: number; crop: boolean; size: PageSize }[]) => void;
}

/**
 * Page sizes as shown, from main (`reader.preparePage`, `reader.pageSizes`): known before an image
 * loads, so double pages pair up and the webtoon strip lays out without jumping.
 */
export const usePageSizes = create<PageSizeState>((set) => ({
  sizes: {},
  set: (entries) =>
    set((state) => {
      const changed = entries.filter(({ chapterId, index, crop, size }) => {
        const old = state.sizes[sizeKey(chapterId, index, crop)];
        return !old || old.width !== size.width || old.height !== size.height;
      });
      if (changed.length === 0) return state;
      const sizes = { ...state.sizes };
      for (const { chapterId, index, crop, size } of changed) sizes[sizeKey(chapterId, index, crop)] = size;
      return { sizes };
    }),
}));

/** Segment heights of a page as shown: several for a tall page in a strip with `split` on. */
export const segmentsOf = (size: PageSize, split: boolean) =>
  split ? pageSegments(size.width, size.height) : [size.height];

const prepared = new Map<string, Promise<PageSize>>();
const seeded = new Set<string>();
const MAX_PREPARED = 500;

/**
 * Has main ready a page (fetched, measured, cropped) and records its size. Shared by the page on
 * screen and the preloader; a retry (`attempt` > 0) asks again.
 */
export function preparePage(chapterId: number, index: number, crop: boolean, attempt = 0): Promise<PageSize> {
  const key = sizeKey(chapterId, index, crop);
  let pending = attempt === 0 ? prepared.get(key) : undefined;
  if (!pending) {
    pending = ipc.invoke('reader.preparePage', { chapterId, index, crop }).then((size) => {
      usePageSizes.getState().set([{ chapterId, index, crop, size }]);
      return size;
    });
    pending.catch(() => prepared.delete(key));
    prepared.set(key, pending);
    while (prepared.size > MAX_PREPARED) prepared.delete(prepared.keys().next().value!);
  }
  return pending;
}

/** Loads the sizes main already knows for a chapter (pages read before), once per chapter. */
export function seedPageSizes(chapterId: number, crop: boolean): void {
  const key = `${chapterId}:${crop}`;
  if (seeded.has(key)) return;
  seeded.add(key);
  ipc
    .invoke('reader.pageSizes', { chapterId, crop })
    .then((list) =>
      usePageSizes
        .getState()
        .set(list.map(({ index, width, height }) => ({ chapterId, index, crop, size: { width, height } }))),
    )
    .catch(() => seeded.delete(key));
}

const preloaded = new Map<string, HTMLImageElement>();
const MAX_PRELOADED = 40;

/**
 * Warms an upcoming page: main fetches, crops and cuts it, and the first segments are decoded by
 * the time the page turns. Keeps references to the last few so they are not collected mid-decode.
 */
export function preloadPage(chapterId: number, index: number, view: { crop: boolean; split: boolean }): void {
  preparePage(chapterId, index, view.crop)
    .then((size) => {
      const segments = segmentsOf(size, view.split);
      const count = Math.min(segments.length, 2);
      for (let n = 0; n < count; n++) {
        warm(pageSrc(chapterId, index, { crop: view.crop, segment: segments.length > 1 ? n : undefined }));
      }
    })
    .catch(() => undefined);
}

function warm(src: string): void {
  if (preloaded.has(src)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  preloaded.set(src, image);
  image.decode().catch(() => preloaded.delete(src));
  while (preloaded.size > MAX_PRELOADED) preloaded.delete(preloaded.keys().next().value!);
}
