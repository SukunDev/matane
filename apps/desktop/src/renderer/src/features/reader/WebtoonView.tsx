import type { ChapterInfo, Page, ReaderSettings } from '@manga-reader/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pagesQuery } from '../../lib/sources';
import { ChapterTransition } from './ChapterTransition';
import { adjacentChapter, tapAction } from './navigation';
import { PageImage } from './PageImage';
import { preloadPage, sizeKey, usePageSizes } from './pages';
import { isTyping } from './PagedView';
import { useReaderPosition } from './store';

interface Segment {
  chapter: ChapterInfo;
  pages: Page[];
}

type Item =
  | { kind: 'page'; chapter: ChapterInfo; index: number; total: number }
  | { kind: 'divider'; from: ChapterInfo; to: ChapterInfo | undefined };

const DEFAULT_RATIO = 1.45;
const DIVIDER_HEIGHT = 260;

/**
 * Continuous strip (webtoon: no gaps; vertical: gaps between pages). The next chapter is appended
 * below the current one as the reader nears the end, separated by a transition card.
 */
export function WebtoonView({
  chapter,
  pages,
  chapters,
  gap,
  settings,
  start,
  startOffset,
  onVisibleChapter,
  onMenu,
  onExit,
}: {
  chapter: ChapterInfo;
  pages: Page[];
  chapters: ChapterInfo[];
  gap: number;
  settings: ReaderSettings;
  start: number | 'last';
  /** Scrolled fraction of the start page to restore (resume inside a long webtoon page). */
  startOffset?: number | null;
  onVisibleChapter: (chapter: ChapterInfo) => void;
  onMenu: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [segments, setSegments] = useState<Segment[]>([{ chapter, pages }]);
  const [loadingNext, setLoadingNext] = useState(false);
  const sizes = usePageSizes((s) => s.sizes);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 800 });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columnWidth = Math.min(settings.webtoonWidth, viewport.width);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    segments.forEach((segment, i) => {
      segment.pages.forEach((_, index) =>
        list.push({ kind: 'page', chapter: segment.chapter, index, total: segment.pages.length }),
      );
      const next = segments[i + 1]?.chapter ?? adjacentChapter(chapters, segment.chapter, 1);
      list.push({ kind: 'divider', from: segment.chapter, to: next });
    });
    return list;
  }, [segments, chapters]);

  const estimate = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item || item.kind === 'divider') return DIVIDER_HEIGHT;
      const size = sizes[sizeKey(item.chapter.id, item.index)];
      const ratio = size ? size.height / size.width : DEFAULT_RATIO;
      return Math.round(columnWidth * ratio) + gap;
    },
    [items, sizes, columnWidth, gap],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: estimate,
    overscan: 3,
    getItemKey: (i) => {
      const item = items[i]!;
      return item.kind === 'page' ? `${item.chapter.id}:${item.index}` : `divider:${item.from.id}`;
    },
  });
  // Page sizes arrive as images decode; re-measure so the strip does not jump.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, sizes, columnWidth, gap]);

  // Initial position (e.g. coming back from the next chapter lands on the last page).
  const positioned = useRef(false);
  useEffect(() => {
    if (positioned.current) return;
    positioned.current = true;
    const target = start === 'last' ? pages.length - 1 : start;
    if (target > 0) virtualizer.scrollToIndex(target, { align: 'start' });
  }, [virtualizer, start, pages.length]);

  // Resume inside the start page once its real height is known (long strips can be many screens
  // tall, so the estimated height would land far off).
  // Read once: the parent may pass the live position later, which must not cancel the restore.
  const [initialOffset] = useState(startOffset ?? 0);
  const [restoring, setRestoring] = useState(initialOffset > 0);
  const startIndex = start === 'last' ? pages.length - 1 : start;
  const startSize = sizes[sizeKey(chapter.id, startIndex)];
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

  // Append the next chapter when the end comes into view; preload pages just below the fold.
  const lastIndex = range.at(-1)?.index ?? 0;
  useEffect(() => {
    for (let i = lastIndex + 1; i <= lastIndex + 3; i++) {
      const item = items[i];
      if (item?.kind === 'page') preloadPage(item.chapter.id, item.index);
    }
    const tail = segments.at(-1)!;
    const next = adjacentChapter(chapters, tail.chapter, 1);
    if (!next || loadingNext || lastIndex < items.length - 4) return;
    setLoadingNext(true);
    queryClient
      .fetchQuery(pagesQuery(next.id))
      .then(({ pages: nextPages }) => setSegments((list) => [...list, { chapter: next, pages: nextPages }]))
      .catch(() => undefined)
      .finally(() => setLoadingNext(false));
  }, [lastIndex, items, segments, chapters, loadingNext, queryClient]);

  const scrollByScreen = useCallback((dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event)) return;
      const el = scroller.current;
      if (!el) return;
      if (
        event.key === 'PageDown' ||
        (event.key === ' ' && !event.shiftKey) ||
        event.key === 'd' ||
        event.key === 'D'
      ) {
        event.preventDefault();
        scrollByScreen(1);
      } else if (
        event.key === 'PageUp' ||
        (event.key === ' ' && event.shiftKey) ||
        event.key === 'a' ||
        event.key === 'A'
      ) {
        event.preventDefault();
        scrollByScreen(-1);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        el.scrollBy({ top: (event.key === 'ArrowDown' ? 1 : -1) * 120 });
      } else if (event.key === 'Home') {
        virtualizer.scrollToIndex(0);
      } else if (event.key === 'End') {
        virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrollByScreen, virtualizer, items.length]);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const action = tapAction(
      settings.tapZones,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      false,
    );
    if (action === 'menu') onMenu();
    else scrollByScreen(action === 'next' ? 1 : -1);
  };

  return (
    <div ref={scroller} role="presentation" onClick={onClick} className="h-full w-full cursor-pointer overflow-y-auto">
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
