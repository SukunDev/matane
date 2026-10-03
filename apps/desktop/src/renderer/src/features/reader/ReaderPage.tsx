import {
  type ChapterInfo,
  type MangaInfo,
  type MangaReaderSettings,
  MANGA_READER_KEYS,
  type ReaderSettings,
  effectiveReaderSettings,
  toMangaReaderSettings,
} from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bookmark,
  BookOpenText,
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { IncognitoToggle } from '../../components/IncognitoToggle';
import { ErrorState } from '../../components/ErrorState';
import { WindowControls } from '../../components/shell/WindowControls';
import { Button } from '../../components/ui/button';
import { appError } from '../../lib/errors';
import { readerOrigin } from '../../lib/reader-origin';
import { appInfoQuery, ipc, settingsQuery, useIpcEvent, useUpdateSettings } from '../../lib/ipc';
import { chapterQuery, chaptersQuery, mangaQuery, pagesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { ReaderNotice } from './notice';
import { PagedView } from './PagedView';
import { readerStyle } from './filters';
import { type ReaderHandlers, ReaderKeysContext, actionForKey, effectiveKeymap, isTyping, keyId } from './keymap';
import { PageContextMenu } from './PageContextMenu';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { TapZoneOverlay } from './TapZoneOverlay';
import { WebtoonView } from './WebtoonView';
import { adjacentChapter, resolveDirection, resolveMode } from './navigation';
import { useProgressSaver, useReadingHeartbeat } from './progress';
import { useReaderPosition } from './store';

const HIDE_AFTER_MS = 3000;
const EDGE_PX = 90;

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
  /** Explicit start page (search param); otherwise the saved position. */
  start: number | 'last' | undefined;
  onVisibleChapter: (chapter: ChapterInfo) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  // Always re-read: the saved position may have changed since the list was last fetched.
  const chapterResult = useQuery({ ...chapterQuery(chapterId), refetchOnMount: 'always' });
  const chapter = chapterResult.data;
  const mangaId = chapter?.mangaId ?? 0;
  const manga = useQuery({ ...mangaQuery(mangaId), enabled: mangaId > 0 });
  const chapters = useQuery({ ...chaptersQuery(mangaId), enabled: mangaId > 0 });
  const pages = useQuery(pagesQuery(chapterId));
  const { data: settings } = useQuery(settingsQuery);
  const { data: info } = useQuery(appInfoQuery);
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  // Global settings with this manga's override on top (BRAINSTORM.md §6.1).
  const override = manga.data?.readerSettings ?? null;
  const reader = settings && effectiveReaderSettings(settings.reader, override);
  const setMangaReader = useMutation({
    mutationFn: (value: MangaReaderSettings | null) =>
      ipc.invoke('manga.setReaderSettings', { mangaId, settings: value }),
    onMutate: (value) =>
      queryClient.setQueryData(mangaQuery(mangaId).queryKey, (current: MangaInfo | undefined) =>
        current ? { ...current, readerSettings: value } : current,
      ),
  });
  // A new session must not mistake the previous one's position for the live one (see below).
  useLayoutEffect(() => useReaderPosition.getState().reset(), []);
  useProgressSaver();
  useReadingHeartbeat();
  const setChapterBookmark = useMutation({
    mutationFn: (input: { chapterId: number; bookmarked: boolean }) =>
      ipc.invoke('chapters.setBookmarked', { chapterIds: [input.chapterId], bookmarked: input.bookmarked }),
  });

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
  const prefs = manga.data?.scanlatorPrefs;
  const prev = shown ? adjacentChapter(list, shown, -1, prefs) : undefined;
  const next = shown ? adjacentChapter(list, shown, 1, prefs) : undefined;

  const goChapter = useCallback(
    (target: ChapterInfo, at: 'start' | 'last' = 'start') => {
      // The strip has it loaded: scroll there without reloading the reader.
      if (at === 'start' && useReaderPosition.getState().jumpToChapter?.(target.id)) return;
      useReaderPosition.setState({ followedChapterId: null });
      void navigate({
        to: '/reader/$chapterId',
        params: { chapterId: String(target.id) },
        search: at === 'last' ? { page: 'last' } : {},
        // Chapters replace each other so Back leaves the reader instead of stepping through them.
        replace: true,
      });
    },
    [navigate],
  );
  const exit = useCallback(() => {
    if (mangaId <= 0) {
      void navigate({ to: '/browse/sources' });
    } else if (readerOrigin() === `/manga/${mangaId}`) {
      // Opened from this manga: step back so Back from the manga continues to the list before it.
      router.history.back();
    } else {
      // Opened from elsewhere (History, Updates…): the manga takes the reader's place in the stack.
      void navigate({ to: '/manga/$mangaId', params: { mangaId: String(mangaId) }, replace: true });
    }
  }, [navigate, router, mangaId]);

  // One key listener for the whole reader (BRAINSTORM.md §6.1: keys can be remapped). The view on
  // screen lends the page actions (`useReaderKeys`); the reader itself handles the rest.
  const viewKeys = useRef<ReaderHandlers>({});
  const [autoScroll, setAutoScroll] = useState(false);
  const stopAutoScroll = useCallback(() => setAutoScroll(false), []);
  // Auto-scroll belongs to the strip (webtoon and vertical modes).
  const resolvedMode = reader && manga.data ? resolveMode(reader.mode, manga.data.type, reader.typeDefaults) : null;
  const strip = resolvedMode === 'webtoon' || resolvedMode === 'vertical';
  const keymap = useMemo(() => effectiveKeymap(settings?.reader.keymap ?? {}), [settings?.reader.keymap]);
  useEffect(() => {
    const own: ReaderHandlers = {
      fullscreen: () => void ipc.invoke('window.toggleFullScreen'),
      exit: () => {
        if (panelOpen) setPanelOpen(false);
        else if (fullScreen) void ipc.invoke('window.toggleFullScreen', { value: false });
        else exit();
      },
      prevChapter: () => prev && goChapter(prev),
      nextChapter: () => next && goChapter(next),
      menu: toggleOverlay,
      autoScroll: () => strip && setAutoScroll((on) => !on),
    };
    const onKey = (event: KeyboardEvent) => {
      // Handled already, e.g. Escape closing a popover or menu.
      if (event.defaultPrevented || isTyping(event)) return;
      const key = keyId(event);
      const action = key ? actionForKey(keymap, key) : null;
      const handler = action ? (viewKeys.current[action] ?? own[action]) : undefined;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keymap, strip, panelOpen, fullScreen, exit, prev, next, goChapter, toggleOverlay]);

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
  if (!chapter || !chapterResult.isFetchedAfterMount || !reader || !manga.data || !pages.data || !chapters.data) {
    return <div className="h-full bg-black" aria-busy />;
  }

  // Resume where the chapter was left, unless it was finished (then start over).
  // Switching modes remounts the view mid-session: keep the page on screen, not the saved one.
  const live = position.chapterId === chapter.id && position.page >= 0 ? position : null;
  const resumeAt = live?.page ?? start ?? (chapter.read ? 0 : chapter.lastPage);
  const resumeOffset = live ? live.offset : start === undefined && !chapter.read ? chapter.pageOffset : null;
  const mode = resolveMode(reader.mode, manga.data.type, reader.typeDefaults);
  const direction = resolveDirection(reader.direction, manga.data.type, reader.typeDefaults);
  const rtl = direction === 'rtl' && (mode === 'single' || mode === 'double');
  // With an override, the manga's fields change the override and the rest (tap zones) the global
  // settings; without one, everything is global.
  const save = (patch: Partial<ReaderSettings>) => {
    const global = settings!.reader;
    if (!override) {
      updateSettings.mutate({ reader: { ...global, ...patch } });
      return;
    }
    const own = Object.entries(patch).filter(([key]) => (MANGA_READER_KEYS as readonly string[]).includes(key));
    const rest = Object.entries(patch).filter(([key]) => !(MANGA_READER_KEYS as readonly string[]).includes(key));
    if (own.length > 0) setMangaReader.mutate({ ...override, ...Object.fromEntries(own) });
    if (rest.length > 0) updateSettings.mutate({ reader: { ...global, ...Object.fromEntries(rest) } });
  };
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
      style={readerStyle(reader)}
      className="reader-pages relative h-full overflow-hidden select-none"
      onMouseMove={(event) => {
        if (event.clientY < EDGE_PX || event.clientY > window.innerHeight - EDGE_PX) poke();
      }}
    >
      <ReaderKeysContext value={viewKeys}>
        <PageContextMenu mangaId={chapter.mangaId}>
          {mode === 'webtoon' || mode === 'vertical' ? (
            <WebtoonView
              key={`${chapter.id}:${mode}:${reader.cropBorders}:${reader.splitTall}`}
              chapter={chapter}
              pages={pages.data.pages}
              chapters={chapters.data}
              prefs={manga.data.scanlatorPrefs}
              gap={mode === 'vertical' ? reader.verticalGap : 0}
              settings={reader}
              start={resumeAt}
              startOffset={resumeOffset}
              autoScroll={autoScroll && strip}
              onAutoScrollEnd={stopAutoScroll}
              onVisibleChapter={onVisibleChapter}
              onMenu={toggleOverlay}
              onExit={exit}
            />
          ) : (
            <PagedView
              key={`${chapter.id}:${mode}:${reader.cropBorders}:${reader.splitTall}`}
              chapter={chapter}
              pages={pages.data.pages}
              double={mode === 'double'}
              direction={direction}
              settings={reader}
              start={resumeAt}
              prevChapter={prev}
              nextChapter={next}
              onChapter={goChapter}
              onMenu={toggleOverlay}
              onExit={exit}
            />
          )}
        </PageContextMenu>
      </ReaderKeysContext>

      {zoneChange.count > 0 && (
        <TapZoneOverlay
          key={zoneChange.count}
          zones={reader.tapZones}
          rtl={rtl !== reader.invertTapZones}
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
          <IncognitoToggle className="mr-1" />
          {shown && (
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={shown.bookmarked}
              title={shown.bookmarked ? t('reader.unbookmarkChapter') : t('reader.bookmarkChapter')}
              onClick={() => setChapterBookmark.mutate({ chapterId: shown.id, bookmarked: !shown.bookmarked })}
              className={cn(shown.bookmarked && 'text-primary hover:text-primary')}
            >
              <Bookmark className={cn(shown.bookmarked && 'fill-current')} />
            </Button>
          )}
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
        <ReaderSettingsPanel
          settings={reader}
          mode={mode}
          mangaOverride={override !== null}
          onChange={save}
          onSaveForManga={() => setMangaReader.mutate(toMangaReaderSettings(reader))}
          onResetManga={() => setMangaReader.mutate(null)}
          onClose={() => setPanelOpen(false)}
        />
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
        {strip && (
          <Button
            variant={autoScroll ? 'default' : 'secondary'}
            size="sm"
            aria-pressed={autoScroll}
            title={t('reader.autoScrollHint')}
            onClick={() => {
              setAutoScroll((on) => !on);
              setOverlay(false);
            }}
          >
            {autoScroll ? <Pause /> : <Play />}
            {t('reader.autoScroll')}
          </Button>
        )}
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

      <ReaderNotice />

      {/* Page indicator while the bars are hidden. */}
      {!overlay && reader.pageIndicator && position.page >= 0 && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ctp-crust/80 px-3 py-1 font-mono text-xs text-ctp-text">
          {t('reader.pageOf', { page: page + 1, total })}
        </span>
      )}
    </div>
  );
}
