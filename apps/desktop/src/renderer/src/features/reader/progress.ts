import { useEffect } from 'react';
import { ipc } from '../../lib/ipc';
import { useReaderPosition } from './store';

const SAVE_DEBOUNCE_MS = 500;
const HEARTBEAT_EVERY_MS = 15_000;

interface Pending {
  chapterId: number;
  page: number;
  pageEnd: number;
  total: number;
  offset: number | null;
}

function save(progress: Pending): void {
  void ipc.invoke('progress.save', progress).catch(() => undefined);
}

/**
 * Persists the reader position (BRAINSTORM.md §6.1): debounced while reading, flushed right away
 * when the chapter changes or the reader closes. Main ignores it while incognito.
 */
export function useProgressSaver(): void {
  useEffect(() => {
    let pending: Pending | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      if (pending) save(pending);
      pending = null;
    };
    const unsubscribe = useReaderPosition.subscribe((state) => {
      if (state.chapterId === null || state.page < 0 || state.total <= 0) return;
      if (pending && pending.chapterId !== state.chapterId) flush();
      pending = {
        chapterId: state.chapterId,
        page: Math.min(state.page, state.total - 1),
        pageEnd: Math.min(Math.max(state.pageEnd, state.page), state.total - 1),
        total: state.total,
        offset: state.offset,
      };
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });
    window.addEventListener('beforeunload', flush);
    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);
}

/**
 * Tells main the user is actively reading (reading sessions for statistics): on interaction while
 * the window is focused, at most every 15 s, and immediately when the chapter changes.
 */
export function useReadingHeartbeat(): void {
  useEffect(() => {
    let last = 0;
    let lastChapter: number | null = null;
    const beat = (force = false) => {
      const { chapterId } = useReaderPosition.getState();
      if (chapterId === null || !document.hasFocus()) return;
      const now = Date.now();
      if (!force && chapterId === lastChapter && now - last < HEARTBEAT_EVERY_MS) return;
      last = now;
      lastChapter = chapterId;
      void ipc.invoke('reading.heartbeat', { chapterId }).catch(() => undefined);
    };
    const onActivity = () => beat();
    const unsubscribe = useReaderPosition.subscribe((state) => {
      if (state.chapterId !== lastChapter) beat(true);
    });
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    return () => {
      unsubscribe();
      for (const name of events) window.removeEventListener(name, onActivity);
      // Main counts the time since the last heartbeat when the session ends.
      void ipc.invoke('reading.end').catch(() => undefined);
    };
  }, []);
}
