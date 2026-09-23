import type { ChapterInfo, ReaderSettings } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowLeftRight,
  BookOpenText,
  Maximize,
  Minimize,
  Settings2,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { WindowControls } from '../../components/shell/WindowControls';
import { Button } from '../../components/ui/button';
import { appError } from '../../lib/errors';
import { appInfoQuery, ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { chapterQuery, chaptersQuery, mangaQuery, pagesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { isTyping, PagedView } from './PagedView';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { TapZoneOverlay } from './TapZoneOverlay';
import { WebtoonView } from './WebtoonView';
import { adjacentChapter, resolveDirection, resolveMode } from './navigation';
import { useReaderPosition } from './store';

const HIDE_AFTER_MS = 3000;
const EDGE_PX = 90;

const BACKGROUNDS: Record<ReaderSettings['background'], string> = {
  black: 'bg-black',
  gray: 'bg-[#2b2b30]',
  white: 'bg-white',
};

/**
 * Full-screen reader (BRAINSTORM.md §6.1; mockups 03 and 04). `onVisibleChapter` lets webtoon mode
 * move the URL to the chapter being read without restarting the session.
 */
export function ReaderPage({
  chapterId,
  start,
  onVisibleChapter,
}: {
  chapterId: number;
  start: number | 'last';
  onVisibleChapter: (chapter: ChapterInfo) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chapterResult = useQuery(chapterQuery(chapterId));
  const chapter = chapterResult.data;
  const mangaId = chapter?.mangaId ?? 0;
  const manga = useQuery({ ...mangaQuery(mangaId), enabled: mangaId > 0 });
  const chapters = useQuery({ ...chaptersQuery(mangaId), enabled: mangaId > 0 });
  const pages = useQuery(pagesQuery(chapterId));
  const { data: settings } = useQuery(settingsQuery);
  const { data: info } = useQuery(appInfoQuery);
  const updateSettings = useUpdateSettings();
  const reader = settings?.reader;

  // Every change of the tap-zone preset shows the zones for a few seconds (not when opening).
  const [zoneChange, setZoneChange] = useState({ zones: reader?.tapZones, count: 0 });
  if (reader && reader.tapZones !== zoneChange.zones) {
    setZoneChange({
      zones: reader.tapZones,
      count: zoneChange.zones === undefined ? zoneChange.count : zoneChange.count + 1,
    });
  }

  const [overlay, setOverlay] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  useIpcEvent('window.fullScreenChanged', setFullScreen);

  // Overlay: visible on the menu zone or near the top/bottom edge, hidden after a few idle seconds.
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovering = useRef(false);
  const poke = useCallback(() => {
    setOverlay(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!hovering.current) setOverlay(false);
    }, HIDE_AFTER_MS);
  }, []);
  // Bars start visible and hide by themselves unless the pointer rests on them.
  useEffect(() => {
    hideTimer.current = setTimeout(() => {
      if (!hovering.current) setOverlay(false);
    }, HIDE_AFTER_MS);
    return () => clearTimeout(hideTimer.current);
  }, []);
  const toggleOverlay = useCallback(() => {
    clearTimeout(hideTimer.current);
    setOverlay((visible) => !visible);
  }, []);

  const position = useReaderPosition();
  const list = chapters.data ?? [];
  // In webtoon mode the chapter on screen can be a later one than the URL's starting chapter.
  const shown = list.find((c) => c.id === position.chapterId) ?? chapter;
  const prev = shown ? adjacentChapter(list, shown, -1) : undefined;
  const next = shown ? adjacentChapter(list, shown, 1) : undefined;

  const goChapter = useCallback(
    (target: ChapterInfo, at: 'start' | 'last' = 'start') =>
      void navigate({
        to: '/reader/$chapterId',
        params: { chapterId: String(target.id) },
        search: at === 'last' ? { page: 'last' } : {},
        // Chapters replace each other so Back leaves the reader instead of stepping through them.
        replace: true,
      }),
    [navigate],
  );
  const exit = useCallback(() => {
    if (mangaId > 0) void navigate({ to: '/manga/$mangaId', params: { mangaId: String(mangaId) } });
    else void navigate({ to: '/browse/sources' });
  }, [navigate, mangaId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event)) return;
      if (event.key === 'f' || event.key === 'F') {
        void ipc.invoke('window.toggleFullScreen');
      } else if (event.key === 'Escape') {
        if (panelOpen) setPanelOpen(false);
        else if (fullScreen) void ipc.invoke('window.toggleFullScreen', { value: false });
        else exit();
      } else if (event.key === '[' && prev) {
        goChapter(prev);
      } else if (event.key === ']' && next) {
        goChapter(next);
      } else if (event.key === 'm' || event.key === 'M') {
        toggleOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, fullScreen, exit, prev, next, goChapter, toggleOverlay]);

  const error = chapterResult.error ?? pages.error ?? manga.error;
  if (error) {
    const notFound = appError(error).code === 'not_found';
    return (
      <div className="h-full bg-ctp-crust">
        {notFound ? (
          <EmptyState
            icon={BookOpenText}
            title={t('reader.notFound.title')}
            description={t('reader.notFound.description')}
            action={<Button onClick={exit}>{t('reader.backToManga')}</Button>}
          />
        ) : (
          <ErrorState
            error={error}
            sourceId={manga.data?.sourceId}
            onRetry={() => {
              void chapterResult.refetch();
              void pages.refetch();
            }}
          />
        )}
      </div>
    );
  }
  if (!chapter || !reader || !manga.data || !pages.data || !chapters.data) {
    return <div className="h-full bg-black" aria-busy />;
  }

  const mode = resolveMode(reader.mode, manga.data.type);
  const direction = resolveDirection(reader.direction, manga.data.type);
  const rtl = direction === 'rtl' && (mode === 'single' || mode === 'double');
  const save = (patch: Partial<ReaderSettings>) => updateSettings.mutate({ reader: { ...reader, ...patch } });
  const total = position.total || pages.data.pages.length;
  const page = Math.max(position.page, 0);
  const isMac = info?.platform === 'darwin';
  const barHover = {
    onMouseEnter: () => (hovering.current = true),
    onMouseLeave: () => ((hovering.current = false), poke()),
  };

  const prevButton = (
    <Button variant="secondary" size="sm" disabled={!prev} onClick={() => prev && goChapter(prev)}>
      <SkipBack />
      {t('reader.prevChapter')}
    </Button>
  );
  const nextButton = (
    <Button variant="secondary" size="sm" disabled={!next} onClick={() => next && goChapter(next)}>
      {t('reader.nextChapter')}
      <SkipForward />
    </Button>
  );

  return (
    <div
      className={cn('relative h-full overflow-hidden select-none', BACKGROUNDS[reader.background])}
      onMouseMove={(event) => {
        if (event.clientY < EDGE_PX || event.clientY > window.innerHeight - EDGE_PX) poke();
      }}
    >
      {mode === 'webtoon' || mode === 'vertical' ? (
        <WebtoonView
          key={`${chapter.id}:${mode}`}
          chapter={chapter}
          pages={pages.data.pages}
          chapters={chapters.data}
          gap={mode === 'vertical' ? reader.verticalGap : 0}
          settings={reader}
          start={start}
          onVisibleChapter={onVisibleChapter}
          onMenu={toggleOverlay}
          onExit={exit}
        />
      ) : (
        <PagedView
          key={`${chapter.id}:${mode}`}
          chapter={chapter}
          pages={pages.data.pages}
          double={mode === 'double'}
          direction={direction}
          settings={reader}
          start={start}
          prevChapter={prev}
          nextChapter={next}
          onChapter={goChapter}
          onMenu={toggleOverlay}
          onExit={exit}
        />
      )}

      {zoneChange.count > 0 && (
        <TapZoneOverlay
          key={zoneChange.count}
          zones={reader.tapZones}
          rtl={rtl}
          continuous={mode === 'webtoon' || mode === 'vertical'}
        />
      )}

      {/* Top bar */}
      <header
        {...barHover}
        className={cn(
          'drag-region absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-ctp-surface0 bg-ctp-mantle/95 pl-3 text-ctp-text backdrop-blur transition-transform duration-200',
          isMac && 'pl-20',
          !overlay && '-translate-y-full',
        )}
      >
        <Button variant="ghost" size="icon" className="no-drag" title={t('reader.back')} onClick={exit}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 border-l border-ctp-surface1 pl-3">
          <p className="truncate font-semibold">{manga.data.title}</p>
          <p className="truncate text-xs text-ctp-subtext0">
            {shown?.name}
            {shown?.scanlator && ` · ${shown.scanlator}`}
          </p>
        </div>
        <div className="no-drag ml-auto flex h-full items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title={fullScreen ? t('reader.exitFullScreen') : t('reader.fullScreen')}
            onClick={() => void ipc.invoke('window.toggleFullScreen')}
          >
            {fullScreen ? <Minimize /> : <Maximize />}
          </Button>
          <Button
            variant={panelOpen ? 'default' : 'ghost'}
            size="icon"
            title={t('reader.settings.title')}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <Settings2 />
          </Button>
          {!isMac && !fullScreen && <WindowControls />}
        </div>
      </header>

      {panelOpen && (
        <ReaderSettingsPanel settings={reader} mode={mode} onChange={save} onClose={() => setPanelOpen(false)} />
      )}

      {/* Bottom bar */}
      <footer
        {...barHover}
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 flex h-16 items-center gap-4 border-t border-ctp-surface0 bg-ctp-mantle/95 px-5 text-ctp-text backdrop-blur transition-transform duration-200',
          !overlay && 'translate-y-full',
        )}
      >
        {rtl ? nextButton : prevButton}
        <div className={cn('flex flex-1 items-center gap-3 text-xs text-ctp-subtext0', rtl && 'flex-row-reverse')}>
          <span className="w-6 text-center font-mono">1</span>
          <input
            type="range"
            aria-label={t('reader.pageSlider')}
            min={0}
            max={Math.max(total - 1, 0)}
            value={Math.min(page, Math.max(total - 1, 0))}
            onChange={(event) => position.jumpTo?.(Number(event.target.value))}
            style={{ direction: rtl ? 'rtl' : 'ltr' }}
            className="h-1.5 flex-1 accent-(--app-accent)"
          />
          <span className="w-6 text-center font-mono">{total}</span>
        </div>
        <span className="rounded-md border border-ctp-surface1 px-2.5 py-1 font-mono text-xs">
          {t('reader.pageOf', { page: page + 1, total })}
        </span>
        {(mode === 'single' || mode === 'double') && (
          <Button
            variant="secondary"
            size="sm"
            title={t('reader.toggleDirection')}
            onClick={() => save({ direction: direction === 'rtl' ? 'ltr' : 'rtl' })}
            className="font-mono"
          >
            <ArrowLeftRight />
            {direction.toUpperCase()}
          </Button>
        )}
        {rtl ? prevButton : nextButton}
      </footer>

      {/* Page indicator while the bars are hidden. */}
      {!overlay && position.page >= 0 && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ctp-crust/80 px-3 py-1 font-mono text-xs text-ctp-text">
          {t('reader.pageOf', { page: page + 1, total })}
        </span>
      )}
    </div>
  );
}
