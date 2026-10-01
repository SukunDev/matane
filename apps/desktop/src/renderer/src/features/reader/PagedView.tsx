import type { ChapterInfo, Page, ReaderSettings } from '@manga-reader/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pagesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { ChapterTransition } from './ChapterTransition';
import { PAGE_ZOOM, ZOOM_STEP, clampZoom } from './gestures';
import { type ReaderHandlers, useReaderKeys } from './keymap';
import { type ResolvedDirection, buildSpreads, tapAction } from './navigation';
import { useReaderNotice } from './notice';
import { PageImage } from './PageImage';
import { preloadPage, seedPageSizes, sizeKey, usePageSizes } from './pages';
import { useReaderPosition } from './store';
import { useGestures } from './useGestures';

const WHEEL_COOLDOWN_MS = 250;
const SCROLL_STEP_PX = 120;
/** Stable empty spread for transition screens (it is an effect dependency). */
const NO_SPREAD: number[] = [];

/** Which slide is shown: a page (first page of its spread) or a transition screen. */
export type Anchor = number | 'prev' | 'next';

export function PagedView({
  chapter,
  pages,
  double,
  direction,
  settings,
  start,
  prevChapter,
  nextChapter,
  onChapter,
  onMenu,
  onExit,
}: {
  chapter: ChapterInfo;
  pages: Page[];
  double: boolean;
  direction: ResolvedDirection;
  settings: ReaderSettings;
  start: number | 'last';
  prevChapter: ChapterInfo | undefined;
  nextChapter: ChapterInfo | undefined;
  onChapter: (target: ChapterInfo, at: 'start' | 'last') => void;
  onMenu: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useReaderNotice((state) => state.show);
  const rtl = direction === 'rtl';
  const count = pages.length;
  const crop = settings.cropBorders;
  const sizes = usePageSizes((s) => s.sizes);
  useEffect(() => seedPageSizes(chapter.id, crop), [chapter.id, crop]);
  const spreads = useMemo(
    () =>
      double
        ? buildSpreads(count, (index) => sizes[sizeKey(chapter.id, index, crop)], settings.shiftDouble)
        : Array.from({ length: count }, (_, index) => [index]),
    [double, count, sizes, chapter.id, crop, settings.shiftDouble],
  );
  const [anchor, setAnchor] = useState<Anchor>(() =>
    start === 'last' ? Math.max(0, count - 1) : Math.min(Math.max(start, 0), Math.max(count - 1, 0)),
  );
  const spreadIndex = typeof anchor === 'number' ? spreads.findIndex((s) => s.includes(anchor)) : -1;
  const spread = spreadIndex >= 0 ? spreads[spreadIndex]! : NO_SPREAD;

  const go = useCallback(
    (delta: 1 | -1) => {
      if (anchor === 'prev') {
        if (delta === 1) setAnchor(spreads[0]?.[0] ?? 'next');
        else if (prevChapter) onChapter(prevChapter, 'last');
        return;
      }
      if (anchor === 'next') {
        if (delta === -1) setAnchor(spreads.at(-1)?.[0] ?? 'prev');
        else if (nextChapter) onChapter(nextChapter, 'start');
        return;
      }
      const target = spreadIndex + delta;
      if (target < 0) setAnchor('prev');
      else if (target >= spreads.length) setAnchor('next');
      else setAnchor(spreads[target]![0]!);
    },
    [anchor, spreads, spreadIndex, prevChapter, nextChapter, onChapter],
  );

  // Report the position and let the page slider jump.
  const report = useReaderPosition((s) => s.report);
  const setJump = useReaderPosition((s) => s.setJump);
  useEffect(() => {
    // The "next" transition means every page was seen; "prev" is before the first page.
    if (anchor === 'next') report(chapter.id, count - 1, count, { pageEnd: count - 1 });
    else if (anchor === 'prev') report(chapter.id, -1, count);
    else report(chapter.id, anchor, count, { pageEnd: Math.max(anchor, ...spread) });
  }, [report, chapter.id, anchor, count, spread]);
  useEffect(() => {
    setJump((page) => setAnchor(Math.min(Math.max(page, 0), count - 1)));
    return () => setJump(null);
  }, [setJump, count]);

  // Warm the next pages, and the next chapter when close to the end.
  useEffect(() => {
    if (typeof anchor !== 'number') return;
    const view = { crop, split: false };
    for (let i = anchor + 1; i <= Math.min(anchor + settings.preloadPages, count - 1); i++) {
      preloadPage(chapter.id, i, view);
    }
    if (nextChapter && anchor >= count - 3) {
      void queryClient.prefetchQuery(pagesQuery(nextChapter.id)).then(() => {
        preloadPage(nextChapter.id, 0, view);
        preloadPage(nextChapter.id, 1, view);
      });
    }
  }, [anchor, count, chapter.id, nextChapter, queryClient, crop, settings.preloadPages]);

  const scroller = useRef<HTMLDivElement>(null);
  // Size of the spread as laid out unzoomed; zooming scales that box (see `zoomBox`).
  const spreadBox = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState({ width: 0, height: 0 });

  // Zoom (Ctrl+wheel, Ctrl +/−/0, pinch, double-click in the middle) belongs to the page on
  // screen: turning the page resets it.
  const [zoom, setZoom] = useState({ value: 1, anchor });
  const level = zoom.anchor === anchor ? zoom.value : 1;
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = scroller.current;
      const target = clampZoom(next, PAGE_ZOOM);
      if (!el || target === level) return;
      // Keep the point under the cursor (or the middle) where it is.
      const rect = el.getBoundingClientRect();
      const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const ratio = target / level;
      pendingScroll.current = { left: (el.scrollLeft + x) * ratio - x, top: (el.scrollTop + y) * ratio - y };
      setZoom({ value: target, anchor });
      notify(t('reader.zoom', { percent: Math.round(target * 100) }));
    },
    [level, anchor, notify, t],
  );
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pendingScroll.current) el.scrollTo(pendingScroll.current);
    pendingScroll.current = null;
  }, [level]);
  useLayoutEffect(() => {
    const el = spreadBox.current;
    if (!el || level > 1) return;
    const measure = () => setBase({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [level, anchor]);

  useEffect(() => {
    // Block body: Chromium's scrollTo() returns a promise, which React would take as a cleanup.
    scroller.current?.scrollTo({ top: 0, left: rtl ? scroller.current.scrollWidth : 0 });
  }, [anchor, rtl]);

  const handlers = useMemo<ReaderHandlers>(
    () => ({
      nextPage: () => go(1),
      prevPage: () => go(-1),
      pageRight: () => go(rtl ? -1 : 1),
      pageLeft: () => go(rtl ? 1 : -1),
      scrollDown: () => scroller.current?.scrollBy({ top: SCROLL_STEP_PX }),
      scrollUp: () => scroller.current?.scrollBy({ top: -SCROLL_STEP_PX }),
      firstPage: () => setAnchor(0),
      lastPage: () => setAnchor(Math.max(0, count - 1)),
      zoomIn: () => zoomTo(level * ZOOM_STEP),
      zoomOut: () => zoomTo(level / ZOOM_STEP),
      zoomReset: () => zoomTo(1),
    }),
    [go, rtl, count, zoomTo, level],
  );
  useReaderKeys(handlers);

  const lastWheel = useRef(0);
  const wasDrag = useGestures(scroller, {
    onZoomWheel: (factor, x, y) => zoomTo(level * factor, x, y),
    onPinch: (factor, x, y) => zoomTo(level * factor, x, y),
    // Dragging moves a page bigger than the screen (zoomed, or a tall page at full width).
    onPan: (dx, dy) => scroller.current?.scrollBy({ left: -dx, top: -dy }),
    // A finger flick turns the page the way it would slide; the mouse drags instead.
    onSwipe: (direction, pointerType) => {
      if (pointerType === 'mouse' || level > 1) return;
      if (direction === 'left') go(rtl ? -1 : 1);
      if (direction === 'right') go(rtl ? 1 : -1);
    },
    // The wheel scrolls a tall (or zoomed) page first, then turns the page.
    onWheel: (event) => {
      const el = scroller.current;
      if (!el || !settings.wheelTurnsPages || level > 1) return;
      const down = event.deltaY > 0;
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      const atEdge = down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0;
      if (scrollable && !atEdge) return;
      const now = Date.now();
      if (now - lastWheel.current < WHEEL_COOLDOWN_MS || Math.abs(event.deltaY) < 4) return;
      lastWheel.current = now;
      go(down ? 1 : -1);
    },
  });

  const tapAt = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return tapAction(
      settings.tapZones,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      rtl !== settings.invertTapZones,
    );
  };
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (wasDrag()) return;
    const action = tapAt(event);
    if (action === 'menu') onMenu();
    else go(action === 'next' ? 1 : -1);
  };
  // Double-click zooms in on the middle zone (where one click only toggles the bars), or back out.
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (level > 1) zoomTo(1);
    else if (tapAt(event) === 'menu') zoomTo(2, event.clientX, event.clientY);
  };

  const fit = settings.fit;
  // Zoomed, the spread keeps its unzoomed layout and is scaled; an outer box of the scaled size
  // gives the scroller something to scroll (a transform alone takes no room).
  const zoomed = level > 1 && base.width > 0;
  const zoomBox = zoomed ? { width: base.width * level, height: base.height * level } : undefined;
  const spreadStyle = zoomed
    ? {
        // Fixed to the unzoomed size: the min-size classes would otherwise follow the bigger outer box.
        width: base.width,
        height: base.height,
        minWidth: base.width,
        minHeight: base.height,
        transform: `scale(${level})`,
        transformOrigin: '0 0',
      }
    : undefined;
  const imageClass = cn(
    'block select-none',
    fit === 'screen' && 'max-h-full max-w-full object-contain',
    fit === 'height' && 'h-full w-auto max-w-none',
    fit === 'width' && 'h-auto w-full',
    fit === 'original' && 'max-w-none',
    spread.length === 2 && fit !== 'original' && (fit === 'width' ? 'w-1/2' : 'max-w-[50%]'),
  );

  return (
    <div
      ref={scroller}
      role="presentation"
      data-zoom={level}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn('h-full w-full touch-none overflow-auto', level > 1 ? 'cursor-grab' : 'cursor-pointer')}
    >
      {anchor === 'prev' || anchor === 'next' ? (
        <ChapterTransition
          className="h-full"
          from={chapter}
          to={anchor === 'next' ? nextChapter : prevChapter}
          direction={anchor}
          onGo={() => go(anchor === 'next' ? 1 : -1)}
          onExit={onExit}
        />
      ) : (
        <div style={zoomBox} className={zoomed ? 'overflow-hidden' : 'contents'}>
          <div
            ref={spreadBox}
            style={spreadStyle}
            className={cn(
              'flex min-h-full w-full justify-center',
              rtl && 'flex-row-reverse',
              fit === 'width' ? 'items-start' : 'h-full items-center',
              (fit === 'height' || fit === 'original') && 'w-max min-w-full',
            )}
          >
            {spread.map((index) => (
              <PageImage
                key={`${chapter.id}:${index}`}
                chapterId={chapter.id}
                index={index}
                crop={crop}
                alt={t('reader.pageAlt', { page: index + 1, total: count })}
                className={imageClass}
                placeholderClassName="h-full min-h-64 w-full max-w-2xl"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
