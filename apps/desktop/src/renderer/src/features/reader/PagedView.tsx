import type { ChapterInfo, Page, ReaderSettings } from '@manga-reader/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pagesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { ChapterTransition } from './ChapterTransition';
import { type ResolvedDirection, buildSpreads, tapAction } from './navigation';
import { PageImage } from './PageImage';
import { preloadPage, sizeKey, usePageSizes } from './pages';
import { useReaderPosition } from './store';

const PRELOAD_AHEAD = 4;
const WHEEL_COOLDOWN_MS = 250;

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
  const rtl = direction === 'rtl';
  const count = pages.length;
  const sizes = usePageSizes((s) => s.sizes);
  const spreads = useMemo(
    () =>
      double
        ? buildSpreads(count, (index) => sizes[sizeKey(chapter.id, index)], settings.shiftDouble)
        : Array.from({ length: count }, (_, index) => [index]),
    [double, count, sizes, chapter.id, settings.shiftDouble],
  );
  const [anchor, setAnchor] = useState<Anchor>(() =>
    start === 'last' ? Math.max(0, count - 1) : Math.min(Math.max(start, 0), Math.max(count - 1, 0)),
  );
  const spreadIndex = typeof anchor === 'number' ? spreads.findIndex((s) => s.includes(anchor)) : -1;
  const spread = spreadIndex >= 0 ? spreads[spreadIndex]! : [];

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
    report(chapter.id, typeof anchor === 'number' ? anchor : -1, count);
  }, [report, chapter.id, anchor, count]);
  useEffect(() => {
    setJump((page) => setAnchor(Math.min(Math.max(page, 0), count - 1)));
    return () => setJump(null);
  }, [setJump, count]);

  // Warm the next pages, and the next chapter when close to the end.
  useEffect(() => {
    if (typeof anchor !== 'number') return;
    for (let i = anchor + 1; i <= Math.min(anchor + PRELOAD_AHEAD, count - 1); i++) preloadPage(chapter.id, i);
    if (nextChapter && anchor >= count - 3) {
      void queryClient.prefetchQuery(pagesQuery(nextChapter.id)).then(() => {
        preloadPage(nextChapter.id, 0);
        preloadPage(nextChapter.id, 1);
      });
    }
  }, [anchor, count, chapter.id, nextChapter, queryClient]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Block body: Chromium's scrollTo() returns a promise, which React would take as a cleanup.
    scroller.current?.scrollTo({ top: 0, left: rtl ? scroller.current.scrollWidth : 0 });
  }, [anchor, rtl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event)) return;
      const forward = rtl ? ['ArrowLeft', 'a', 'A'] : ['ArrowRight', 'd', 'D'];
      const backward = rtl ? ['ArrowRight', 'd', 'D'] : ['ArrowLeft', 'a', 'A'];
      if (forward.includes(event.key) || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        go(1);
      } else if (backward.includes(event.key) || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        go(-1);
      } else if (event.key === 'Home') {
        setAnchor(0);
      } else if (event.key === 'End') {
        setAnchor(Math.max(0, count - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, rtl, count]);

  // Wheel scrolls a tall page first, then turns the page.
  const lastWheel = useRef(0);
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const down = event.deltaY > 0;
    const scrollable = el.scrollHeight > el.clientHeight + 1;
    const atEdge = down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0;
    if (scrollable && !atEdge) return;
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_COOLDOWN_MS || Math.abs(event.deltaY) < 4) return;
    lastWheel.current = now;
    go(down ? 1 : -1);
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const action = tapAction(
      settings.tapZones,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      rtl,
    );
    if (action === 'menu') onMenu();
    else go(action === 'next' ? 1 : -1);
  };

  const fit = settings.fit;
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
      onClick={onClick}
      onWheel={onWheel}
      className="h-full w-full cursor-pointer overflow-auto"
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
        <div
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
              alt={t('reader.pageAlt', { page: index + 1, total: count })}
              className={imageClass}
              placeholderClassName="h-full min-h-64 w-full max-w-2xl"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
}
