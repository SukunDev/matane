import type { ChapterInfo, Page, ReaderSettings, ScanlatorPrefs } from '@manga-reader/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pagesQuery } from '../../lib/sources';
import { ChapterTransition } from './ChapterTransition';
import { adjacentChapter, tapAction } from './navigation';
import { PageImage } from './PageImage';
import { preloadPage, seedPageSizes, sizeKey, usePageSizes } from './pages';
import { useReaderPosition } from './store';
import { STRIP_WINDOW, pruneSegments } from './strip';
import { STRIP_ZOOM, ZOOM_STEP, clampZoom } from './gestures';
import { type ReaderHandlers, useReaderKeys } from './keymap';
import { useReaderNotice } from './notice';
import { useGestures } from './useGestures';

interface Segment {
  chapter: ChapterInfo;
  pages: Page[];
}

type Item =
  | { kind: 'page'; chapter: ChapterInfo; index: number; total: number }
  | { kind: 'divider'; from: ChapterInfo; to: ChapterInfo | undefined };

const DEFAULT_RATIO = 1.45;
const DIVIDER_HEIGHT = 260;
const SCROLL_STEP_PX = 120;

const itemKey = (item: Item) => (item.kind === 'page' ? `${item.chapter.id}:${item.index}` : `divider:${item.from.id}`);

/**
 * Continuous strip (webtoon: no gaps; vertical: gaps between pages). The next chapter is appended
 * below, and the previous one put above, as the reader nears an end, separated by transition cards.
 * Only a window of chapters around the one on screen stays loaded.
 */
export function WebtoonView({
  chapter,
  pages,
  chapters,
  prefs,
  gap,
  settings,
  start,
  startOffset,
  autoScroll = false,
  onAutoScrollEnd,
  onVisibleChapter,
  onMenu,
  onExit,
}: {
  chapter: ChapterInfo;
  pages: Page[];
  chapters: ChapterInfo[];
  /** Hidden/preferred scanlators: which version of the next chapter to append. */
  prefs: ScanlatorPrefs;
  gap: number;
  settings: ReaderSettings;
  start: number | 'last';
  /** Scrolled fraction of the start page to restore (resume inside a long webtoon page). */
  startOffset?: number | null;
  /** Scroll by itself at `settings.autoScrollSpeed` until the end, a click, Space or losing focus. */
  autoScroll?: boolean;
  onAutoScrollEnd?: () => void;
  onVisibleChapter: (chapter: ChapterInfo) => void;
  onMenu: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [segments, setSegments] = useState<Segment[]>([{ chapter, pages }]);
  const [loadingNext, setLoadingNext] = useState(false);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const sizes = usePageSizes((s) => s.sizes);
  const crop = settings.cropBorders;
  const split = settings.splitTall;
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 800 });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Zoom widens or narrows the column (wider than the window scrolls sideways).
  const [zoom, setZoom] = useState(1);
  const columnWidth = Math.round(Math.min(settings.webtoonWidth, viewport.width) * zoom);

  // Pages read before are laid out at their real size straight away.
  useEffect(() => {
    for (const segment of segments) seedPageSizes(segment.chapter.id, crop);
  }, [segments, crop]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    segments.forEach((segment, i) => {
      segment.pages.forEach((_, index) =>
        list.push({ kind: 'page', chapter: segment.chapter, index, total: segment.pages.length }),
      );
      const next = segments[i + 1]?.chapter ?? adjacentChapter(chapters, segment.chapter, 1, prefs);
      list.push({ kind: 'divider', from: segment.chapter, to: next });
    });
    return list;
  }, [segments, chapters, prefs]);

  const estimate = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item || item.kind === 'divider') return DIVIDER_HEIGHT;
      const size = sizes[sizeKey(item.chapter.id, item.index, crop)];
      const ratio = size ? size.height / size.width : DEFAULT_RATIO;
      return Math.round(columnWidth * ratio) + gap;
    },
    [items, sizes, columnWidth, gap, crop],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: estimate,
    overscan: 3,
    getItemKey: (i) => itemKey(items[i]!),
  });

  // Chapters added or dropped above the screen shift everything: keep the row on top where it was.
  const anchor = useRef<{ key: string; delta: number } | null>(null);
  const captureAnchor = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const row = virtualizer.getVirtualItems().find((r) => r.end > el.scrollTop + 1);
    if (row) anchor.current = { key: String(row.key), delta: el.scrollTop - row.start };
  }, [virtualizer]);
  useLayoutEffect(() => {
    const kept = anchor.current;
    anchor.current = null;
    if (!kept || !scroller.current) return;
    const index = items.findIndex((item) => itemKey(item) === kept.key);
    const row = index >= 0 ? virtualizer.measurementsCache[index] : undefined;
    if (row) scroller.current.scrollTop = row.start + kept.delta;
  }, [items, virtualizer]);
  // Page sizes arrive as images decode; re-measure so the strip does not jump.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, sizes, columnWidth, gap]);

  // Initial position (e.g. coming back from the next chapter lands on the last page).
  const positioned = useRef(false);
  // Loading the previous chapter waits until the start position is in place.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (positioned.current) return;
    positioned.current = true;
    const target = start === 'last' ? pages.length - 1 : start;
    if (target > 0) virtualizer.scrollToIndex(target, { align: 'start' });
  }, [virtualizer, start, pages.length]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Resume inside the start page once its real height is known (long strips can be many screens
  // tall, so the estimated height would land far off).
  // Read once: the parent may pass the live position later, which must not cancel the restore.
  const [initialOffset] = useState(startOffset ?? 0);
  const [restoring, setRestoring] = useState(initialOffset > 0);
  const startIndex = start === 'last' ? pages.length - 1 : start;
  const startSize = sizes[sizeKey(chapter.id, startIndex, crop)];
  useEffect(() => {
    if (!restoring || !startSize) return;
    const frame = requestAnimationFrame(() => {
      const item = virtualizer.measurementsCache[startIndex];
      if (item && scroller.current) scroller.current.scrollTop = item.start + initialOffset * item.size;
      setRestoring(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [restoring, startSize, initialOffset, startIndex, virtualizer]);

  const range = virtualizer.getVirtualItems();
  const scrollTop = virtualizer.scrollOffset ?? 0;
  const firstVisible = range.find((row) => row.end > scrollTop + 1) ?? range[0];
  const current = firstVisible ? items[firstVisible.index] : undefined;
  const currentChapter = current?.kind === 'page' ? current.chapter : current?.from;
  // Where the top page is scrolled to, and the lowest page of that chapter on screen (read once
  // its last page or the chapter's end divider shows).
  const offset = firstVisible ? Math.min(Math.max((scrollTop - firstVisible.start) / firstVisible.size, 0), 1) : 0;
  let pageEnd = current?.kind === 'page' ? current.index : 0;
  for (const row of range) {
    if (row.start >= scrollTop + viewport.height) continue;
    const item = items[row.index];
    if (item?.kind === 'page' && item.chapter.id === currentChapter?.id) pageEnd = Math.max(pageEnd, item.index);
    if (item?.kind === 'divider' && item.from.id === currentChapter?.id) pageEnd = Number.MAX_SAFE_INTEGER;
  }

  // Position report + URL follow the chapter on screen.
  const report = useReaderPosition((s) => s.report);
  const lastChapter = useRef(chapter.id);
  useEffect(() => {
    // Until the saved position is restored, the top of the strip is not where the reader is.
    if (!current || restoring) return;
    if (current.kind === 'page') {
      report(current.chapter.id, current.index, current.total, {
        pageEnd: Math.min(pageEnd, current.total - 1),
        offset: Math.round(offset * 1000) / 1000,
      });
    }
    if (currentChapter && currentChapter.id !== lastChapter.current) {
      lastChapter.current = currentChapter.id;
      onVisibleChapter(currentChapter);
    }
  }, [current, currentChapter, report, onVisibleChapter, pageEnd, offset, restoring]);

  const setJump = useReaderPosition((s) => s.setJump);
  useEffect(() => {
    setJump((page) => {
      const target = items.findIndex(
        (item) => item.kind === 'page' && item.chapter.id === currentChapter?.id && item.index === page,
      );
      if (target >= 0) virtualizer.scrollToIndex(target, { align: 'start' });
    });
    return () => setJump(null);
  }, [setJump, items, currentChapter, virtualizer]);

  // Previous/next chapter: scroll there when it is loaded, instead of reloading the reader.
  const setJumpToChapter = useReaderPosition((s) => s.setJumpToChapter);
  useEffect(() => {
    setJumpToChapter((chapterId) => {
      const target = items.findIndex(
        (item) => item.kind === 'page' && item.chapter.id === chapterId && item.index === 0,
      );
      if (target < 0) return false;
      virtualizer.scrollToIndex(target, { align: 'start' });
      return true;
    });
    return () => setJumpToChapter(null);
  }, [setJumpToChapter, items, virtualizer]);

  const currentId = currentChapter?.id;
  const currentSegment = segments.findIndex((segment) => segment.chapter.id === currentId);

  // Drop chapters far from the one on screen.
  useEffect(() => {
    if (currentId === undefined || pruneSegments(segments, currentId) === segments) return;
    captureAnchor();
    setSegments((list) => pruneSegments(list, currentId));
  }, [segments, currentId, captureAnchor]);

  // Put the previous chapter above when the top comes into view.
  const firstIndex = range[0]?.index ?? 0;
  useEffect(() => {
    const head = segments[0]!;
    const before = adjacentChapter(chapters, head.chapter, -1, prefs);
    if (!before || loadingPrev || !settled || restoring || firstIndex > 3) return;
    // Only while the chapter on screen is near the top, or it would be dropped again.
    if (currentSegment < 0 || currentSegment > STRIP_WINDOW - 1) return;
    setLoadingPrev(true);
    queryClient
      .fetchQuery(pagesQuery(before.id))
      .then(({ pages: earlier }) =>
        setSegments((list) => {
          if (list[0]?.chapter.id !== head.chapter.id) return list;
          captureAnchor();
          return [{ chapter: before, pages: earlier }, ...list];
        }),
      )
      .catch(() => undefined)
      .finally(() => setLoadingPrev(false));
  }, [
    firstIndex,
    segments,
    chapters,
    prefs,
    loadingPrev,
    settled,
    restoring,
    currentSegment,
    queryClient,
    captureAnchor,
  ]);

  // Append the next chapter when the end comes into view; preload pages just below the fold.
  const lastIndex = range.at(-1)?.index ?? 0;
  useEffect(() => {
    for (let i = lastIndex + 1; i <= lastIndex + settings.preloadPages; i++) {
      const item = items[i];
      if (item?.kind === 'page') preloadPage(item.chapter.id, item.index, { crop, split });
    }
    const tail = segments.at(-1)!;
    const next = adjacentChapter(chapters, tail.chapter, 1, prefs);
    if (!next || loadingNext || lastIndex < items.length - 4) return;
    // Only while the chapter on screen is near the end, or it would be dropped again.
    if (currentSegment >= 0 && currentSegment < segments.length - STRIP_WINDOW) return;
    setLoadingNext(true);
    queryClient
      .fetchQuery(pagesQuery(next.id))
      .then(({ pages: nextPages }) => setSegments((list) => [...list, { chapter: next, pages: nextPages }]))
      .catch(() => undefined)
      .finally(() => setLoadingNext(false));
  }, [
    lastIndex,
    items,
    segments,
    chapters,
    prefs,
    loadingNext,
    currentSegment,
    queryClient,
    crop,
    split,
    settings.preloadPages,
  ]);

  const scrollByScreen = useCallback((dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'smooth' });
  }, []);

  const notify = useReaderNotice((state) => state.show);
  const pendingCenter = useRef<number | null>(null);
  const zoomTo = useCallback(
    (next: number) => {
      const el = scroller.current;
      const target = clampZoom(next, STRIP_ZOOM);
      if (!el || target === zoom) return;
      // Keep the middle of the screen where it is in the strip.
      pendingCenter.current = (el.scrollTop + el.clientHeight / 2) / Math.max(virtualizer.getTotalSize(), 1);
      setZoom(target);
      notify(t('reader.zoom', { percent: Math.round(target * 100) }));
    },
    [zoom, virtualizer, notify, t],
  );
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || pendingCenter.current === null) return;
    virtualizer.measure();
    el.scrollTop = pendingCenter.current * virtualizer.getTotalSize() - el.clientHeight / 2;
    pendingCenter.current = null;
  }, [zoom, virtualizer]);

  // Auto-scroll: a steady glide, stopped at the end of the last chapter there is, or when the
  // window loses focus.
  const hasMore = loadingNext || adjacentChapter(chapters, segments.at(-1)!.chapter, 1, prefs) !== undefined;
  const more = useRef(hasMore);
  const endAutoScroll = useRef(onAutoScrollEnd);
  useLayoutEffect(() => {
    more.current = hasMore;
    endAutoScroll.current = onAutoScrollEnd;
  });
  useEffect(() => {
    const el = scroller.current;
    if (!autoScroll || !el) return;
    let last = performance.now();
    let carry = 0;
    let frame = 0;
    const step = (now: number) => {
      carry += (settings.autoScrollSpeed * Math.min(now - last, 100)) / 1000;
      last = now;
      const whole = Math.floor(carry);
      if (whole > 0) {
        el.scrollTop += whole;
        carry -= whole;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && !more.current) {
        endAutoScroll.current?.();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const stop = () => endAutoScroll.current?.();
    window.addEventListener('blur', stop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('blur', stop);
    };
  }, [autoScroll, settings.autoScrollSpeed]);

  const handlers = useMemo<ReaderHandlers>(() => {
    const down = () => (autoScroll ? onAutoScrollEnd?.() : scrollByScreen(1));
    return {
      nextPage: down,
      pageRight: down,
      prevPage: () => scrollByScreen(-1),
      pageLeft: () => scrollByScreen(-1),
      scrollDown: () => scroller.current?.scrollBy({ top: SCROLL_STEP_PX }),
      scrollUp: () => scroller.current?.scrollBy({ top: -SCROLL_STEP_PX }),
      firstPage: () => {
        const first = items.findIndex((item) => item.kind === 'page' && item.chapter.id === currentId);
        virtualizer.scrollToIndex(Math.max(first, 0), { align: 'start' });
      },
      lastPage: () => {
        const last = items.findLastIndex((item) => item.kind === 'page' && item.chapter.id === currentId);
        virtualizer.scrollToIndex(last >= 0 ? last : items.length - 1, { align: 'end' });
      },
      zoomIn: () => zoomTo(zoom * ZOOM_STEP),
      zoomOut: () => zoomTo(zoom / ZOOM_STEP),
      zoomReset: () => zoomTo(1),
    };
  }, [autoScroll, onAutoScrollEnd, scrollByScreen, virtualizer, items, currentId, zoomTo, zoom]);
  useReaderKeys(handlers);

  // Touch scrolls natively; the mouse can drag the strip, and pinch or Ctrl+wheel zoom.
  const wasDrag = useGestures(scroller, {
    onZoomWheel: (factor) => zoomTo(zoom * factor),
    onPinch: (factor) => zoomTo(zoom * factor),
    onPan: (dx, dy, pointerType) => {
      if (pointerType === 'mouse') scroller.current?.scrollBy({ left: -dx, top: -dy });
    },
  });

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (wasDrag()) return;
    if (autoScroll) {
      onAutoScrollEnd?.();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const action = tapAction(
      settings.tapZones,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      settings.invertTapZones,
    );
    if (action === 'menu') onMenu();
    else scrollByScreen(action === 'next' ? 1 : -1);
  };

  return (
    <div
      ref={scroller}
      role="presentation"
      data-zoom={zoom}
      onClick={onClick}
      className="h-full w-full cursor-pointer touch-pan-x touch-pan-y overflow-auto [overflow-anchor:none]"
    >
      <div className="relative mx-auto" style={{ height: virtualizer.getTotalSize(), width: columnWidth }}>
        {range.map((row) => {
          const item = items[row.index]!;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0"
              style={{ transform: `translateY(${row.start}px)`, paddingBottom: item.kind === 'page' ? gap : 0 }}
            >
              {item.kind === 'page' ? (
                <PageImage
                  chapterId={item.chapter.id}
                  index={item.index}
                  crop={crop}
                  split={split}
                  alt={t('reader.pageAlt', { page: item.index + 1, total: item.total })}
                  className="block h-auto w-full select-none"
                  placeholderClassName="w-full"
                  placeholderStyle={{ height: estimate(row.index) - gap }}
                />
              ) : (
                <ChapterTransition
                  continuous={item.to !== undefined}
                  from={item.from}
                  to={item.to}
                  direction="next"
                  onExit={onExit}
                  className="min-h-[260px]"
                />
              )}
            </div>
          );
        })}
      </div>
      {loadingNext && (
        <p className="flex items-center justify-center gap-2 py-6 text-ctp-subtext0">
          <Loader2 className="size-4 animate-spin text-primary" />
          {t('reader.loadingNext')}
        </p>
      )}
    </div>
  );
}
