import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { TrackPatch } from '@manga-reader/shared';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { mangaTracks, trackerAccounts, trackerQueue } from '../schema';

export type AccountRow = typeof trackerAccounts.$inferSelect;
export type TrackRow = typeof mangaTracks.$inferSelect;
export type QueueRow = typeof trackerQueue.$inferSelect;

/**
 * Tracker accounts, the manga linked to a tracker's entry, and the updates waiting to be sent
 * (ADR 0035). The queue holds at most one row per manga and tracker: a newer change is merged into
 * it, field by field, so what is sent is always the latest.
 */
export class TrackersRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  // ------------------------------------------------------------ accounts

  account(service: string): AccountRow | undefined {
    return this.db.select().from(trackerAccounts).where(eq(trackerAccounts.service, service)).get();
  }

  saveAccount(row: AccountRow): void {
    this.db
      .insert(trackerAccounts)
      .values(row)
      .onConflictDoUpdate({
        target: trackerAccounts.service,
        set: {
          userId: row.userId,
          username: row.username,
          tokenEncrypted: row.tokenEncrypted,
          expiresAt: row.expiresAt,
        },
      })
      .run();
    this.changes.mark('trackers');
  }

  /** Forgets the account and everything still waiting to be sent to it. */
  removeAccount(service: string): void {
    this.db.delete(trackerQueue).where(eq(trackerQueue.service, service)).run();
    this.db.delete(trackerAccounts).where(eq(trackerAccounts.service, service)).run();
    this.changes.mark('trackers');
  }

  // ------------------------------------------------------------ links

  tracksOf(mangaId: number): TrackRow[] {
    return this.db
      .select()
      .from(mangaTracks)
      .where(eq(mangaTracks.mangaId, mangaId))
      .orderBy(mangaTracks.service)
      .all();
  }

  track(mangaId: number, service: string): TrackRow | undefined {
    return this.db
      .select()
      .from(mangaTracks)
      .where(and(eq(mangaTracks.mangaId, mangaId), eq(mangaTracks.service, service)))
      .get();
  }

  saveTrack(row: TrackRow): void {
    const { mangaId, ...values } = row;
    this.db
      .insert(mangaTracks)
      .values(row)
      .onConflictDoUpdate({ target: [mangaTracks.mangaId, mangaTracks.service], set: values })
      .run();
    this.changes.mark(`tracks:${mangaId}`);
  }

  removeTrack(mangaId: number, service: string): void {
    this.db
      .delete(trackerQueue)
      .where(and(eq(trackerQueue.mangaId, mangaId), eq(trackerQueue.service, service)))
      .run();
    this.db
      .delete(mangaTracks)
      .where(and(eq(mangaTracks.mangaId, mangaId), eq(mangaTracks.service, service)))
      .run();
    this.changes.mark(`tracks:${mangaId}`, 'trackers');
  }

  // ------------------------------------------------------------ queue

  /** Queues `patch` for a manga's entry; fields of an update already waiting are overwritten. */
  enqueue(mangaId: number, service: string, patch: TrackPatch, now: number): void {
    const waiting = this.db
      .select()
      .from(trackerQueue)
      .where(and(eq(trackerQueue.mangaId, mangaId), eq(trackerQueue.service, service)))
      .get();
    if (waiting) {
      const merged = { ...(JSON.parse(waiting.payloadJson) as TrackPatch), ...patch };
      this.db
        .update(trackerQueue)
        .set({ payloadJson: JSON.stringify(merged), nextAttemptAt: Math.min(waiting.nextAttemptAt, now) })
        .where(eq(trackerQueue.id, waiting.id))
        .run();
    } else {
      this.db
        .insert(trackerQueue)
        .values({ mangaId, service, payloadJson: JSON.stringify(patch), attempts: 0, nextAttemptAt: now })
        .run();
    }
    this.changes.mark('trackers', `tracks:${mangaId}`);
  }

  /** Updates that may be sent now, oldest first. */
  due(now: number): QueueRow[] {
    return this.db
      .select()
      .from(trackerQueue)
      .where(lte(trackerQueue.nextAttemptAt, now))
      .orderBy(asc(trackerQueue.id))
      .all();
  }

  /** How many updates are waiting, for one tracker or for all. */
  queued(service?: string): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(trackerQueue)
      .where(service ? eq(trackerQueue.service, service) : undefined)
      .get();
    return row?.n ?? 0;
  }

  /** The trackers that have an update waiting for this manga. */
  pendingServices(mangaId: number): Set<string> {
    return new Set(
      this.db
        .select({ service: trackerQueue.service })
        .from(trackerQueue)
        .where(eq(trackerQueue.mangaId, mangaId))
        .all()
        .map((r) => r.service),
    );
  }

  /** A failed try: when to try again. */
  retryLater(id: number, attempts: number, nextAttemptAt: number): void {
    this.db.update(trackerQueue).set({ attempts, nextAttemptAt }).where(eq(trackerQueue.id, id)).run();
    this.changes.mark('trackers');
  }

  /** Makes everything waiting due (the "retry" button, the network coming back). */
  dueNow(now: number, service?: string): void {
    this.db
      .update(trackerQueue)
      .set({ nextAttemptAt: now })
      .where(service ? eq(trackerQueue.service, service) : undefined)
      .run();
  }

  /**
   * Done: the update reached the tracker. It is removed only while it is still what was sent; an edit
   * made meanwhile stays queued, to go out next.
   */
  complete(id: number, sentPayload: string): void {
    this.db
      .delete(trackerQueue)
      .where(and(eq(trackerQueue.id, id), eq(trackerQueue.payloadJson, sentPayload)))
      .run();
    this.changes.mark('trackers');
  }
}
