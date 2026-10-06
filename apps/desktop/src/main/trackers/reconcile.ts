import type { TrackPatch } from '@manga-reader/shared';
import type { RemoteEntry } from './types';

export interface SyncInput {
  /** Chapters read here, as a tracker counts them (0 when none). */
  localRead: number;
  /** What the link held after the last sync. */
  track: {
    progress: number | null;
    /** As stored (any text); only compared with the tracker's. */
    status: string | null;
    score: number | null;
    startedAt: number | null;
    finishedAt: number | null;
  };
  /** The tracker's entry now. */
  remote: RemoteEntry;
  /** An edit made here is still waiting to be sent. */
  pending: boolean;
  now: number;
}

export interface SyncPlan {
  /** Mark the chapters up to this number read here. */
  readUpTo: number | null;
  /** What the link holds from now on, where it differs. */
  adopt: Partial<Pick<RemoteEntry, 'status' | 'score' | 'progress' | 'startedAt' | 'finishedAt'>>;
  /** What to send to the tracker, when it is behind. */
  push: TrackPatch | null;
}

const NOTHING: SyncPlan = { readUpTo: null, adopt: {}, push: null };

/**
 * Two-way sync of one linked manga (ADR 0038). Progress only moves forward, on both sides: the one
 * that is behind is brought up to the other. Status, score and dates are the tracker's, which the user
 * may have changed on its website. A change made here that is still queued wins over all of it, and
 * is left to the queue: nothing is decided until it has been sent.
 */
export function reconcile({ localRead, track, remote, pending, now }: SyncInput): SyncPlan {
  if (pending) return NOTHING;
  const plan: SyncPlan = { readUpTo: null, adopt: {}, push: null };

  for (const key of ['status', 'score', 'startedAt', 'finishedAt'] as const) {
    if (remote[key] !== track[key]) (plan.adopt as Record<string, unknown>)[key] = remote[key];
  }

  const remoteProgress = remote.progress ?? 0;
  if (remoteProgress > localRead) {
    plan.readUpTo = remoteProgress;
    plan.adopt.progress = remoteProgress;
  } else if (localRead > remoteProgress) {
    const push: TrackPatch = { progress: localRead };
    // Reading again moves an entry out of planning, on hold or dropped, but never out of completed.
    if (remote.status !== 'completed' && remote.status !== 'reading') push.status = 'reading';
    if (remote.status !== 'completed' && remote.startedAt === null) push.startedAt = now;
    plan.push = push;
    plan.adopt.progress = localRead;
    if (push.status) plan.adopt.status = push.status;
    if (push.startedAt !== undefined) plan.adopt.startedAt = push.startedAt;
  } else if ((track.progress ?? 0) !== remoteProgress) {
    plan.adopt.progress = remoteProgress;
  }
  return plan;
}
