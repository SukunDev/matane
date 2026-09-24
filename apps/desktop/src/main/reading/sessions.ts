import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { readingSessions } from '../db/schema';

/** No interaction for this long ends the session; the gap is not counted as reading. */
export const IDLE_MS = 2 * 60_000;

interface Current {
  id: number;
  chapterId: number;
  lastBeat: number;
  activeMs: number;
}

/**
 * Records reading sessions (`reading_sessions`) for the statistics page (BRAINSTORM.md §6.3). The
 * reader sends a heartbeat on interaction while the window is focused; time between heartbeats
 * counts as active unless it exceeds IDLE_MS.
 */
export class SessionRecorder {
  private current: Current | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  heartbeat(mangaId: number, chapterId: number): void {
    const now = this.now();
    const current = this.current;
    if (current && current.chapterId === chapterId && now - current.lastBeat <= IDLE_MS) {
      current.activeMs += now - current.lastBeat;
      current.lastBeat = now;
      this.db
        .update(readingSessions)
        .set({ activeMs: current.activeMs })
        .where(eq(readingSessions.id, current.id))
        .run();
    } else {
      this.end(now);
      const row = this.db
        .insert(readingSessions)
        .values({ mangaId, chapterId, startedAt: now, activeMs: 0 })
        .returning({ id: readingSessions.id })
        .get();
      this.current = { id: row.id, chapterId, lastBeat: now, activeMs: 0 };
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.end(), IDLE_MS);
    this.idleTimer.unref?.();
  }

  /**
   * Closes the running session. With `now` (reader closed, chapter changed), the time since the
   * last heartbeat still counts if it is short enough to be reading; the idle timeout passes none.
   */
  end(now?: number): void {
    clearTimeout(this.idleTimer);
    const current = this.current;
    if (!current) return;
    this.current = null;
    if (now !== undefined && now - current.lastBeat <= IDLE_MS) {
      current.activeMs += now - current.lastBeat;
      current.lastBeat = now;
    }
    this.db
      .update(readingSessions)
      .set({ endedAt: current.lastBeat, activeMs: current.activeMs })
      .where(eq(readingSessions.id, current.id))
      .run();
  }
}
