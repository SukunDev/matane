import { describe, expect, it } from 'vitest';
import { type SyncInput, reconcile } from './reconcile';
import type { RemoteEntry } from './types';

const NOW = Date.UTC(2024, 5, 1);
const remote = (patch: Partial<RemoteEntry> = {}): RemoteEntry => ({
  remoteId: '1',
  remoteUrl: null,
  remoteTitle: 'x',
  status: 'reading',
  score: null,
  progress: 5,
  startedAt: 1000,
  finishedAt: null,
  ...patch,
});
const link = (patch: Partial<SyncInput['track']> = {}): SyncInput['track'] => ({
  progress: 5,
  status: 'reading',
  score: null,
  startedAt: 1000,
  finishedAt: null,
  ...patch,
});
const plan = (input: Partial<SyncInput> = {}) =>
  reconcile({ localRead: 5, track: link(), remote: remote(), pending: false, now: NOW, ...input });

describe('reconcile: progress only moves forward, on both sides', () => {
  it.each([
    ['both are even', { localRead: 5 }, remote({ progress: 5 }), { readUpTo: null, push: null, adopt: {} }],
    [
      'the tracker is ahead: chapters here are marked read',
      { localRead: 3 },
      remote({ progress: 8 }),
      { readUpTo: 8, push: null, adopt: { progress: 8 } },
    ],
    [
      'this side is ahead: the tracker gets an update, and the entry is dated',
      { localRead: 9, track: link({ startedAt: null }) },
      remote({ progress: 5, startedAt: null }),
      { readUpTo: null, push: { progress: 9, startedAt: NOW }, adopt: { progress: 9, startedAt: NOW } },
    ],
    [
      'nothing read here, the tracker says 0',
      { localRead: 0, track: link({ progress: 0 }) },
      remote({ progress: 0 }),
      { readUpTo: null, push: null, adopt: {} },
    ],
    [
      'the tracker has no progress yet',
      { localRead: 0, track: link({ progress: null }) },
      remote({ progress: null }),
      { readUpTo: null, push: null, adopt: {} },
    ],
  ])('%s', (_name, input, entry, expected) => {
    expect(plan({ ...input, remote: entry })).toEqual(expected);
  });

  it('brings a tracker that is behind to "reading" when it was planned, on hold or dropped', () => {
    for (const status of ['planning', 'on_hold', 'dropped'] as const) {
      const result = plan({ localRead: 9, track: link({ status }), remote: remote({ status, progress: 2 }) });
      expect(result.push).toEqual({ progress: 9, status: 'reading' });
      expect(result.adopt).toMatchObject({ progress: 9, status: 'reading' });
    }
  });

  it('never moves a completed entry, and never dates it', () => {
    const result = plan({
      localRead: 30,
      track: link({ status: 'completed', startedAt: null }),
      remote: remote({ status: 'completed', progress: 25, startedAt: null }),
    });
    expect(result.push).toEqual({ progress: 30 });
  });

  it('does not lower anything when the tracker was reset to less than what was read', () => {
    // Read here: 12. The user cleared the tracker to 0 to read again: it is brought forward again.
    const result = plan({ localRead: 12, track: link({ progress: 12 }), remote: remote({ progress: 0 }) });
    expect(result.readUpTo).toBeNull();
    expect(result.push).toMatchObject({ progress: 12 });
  });
});

describe('reconcile: what the tracker website may change', () => {
  it('takes status, score and dates from the tracker', () => {
    const result = plan({
      remote: remote({ status: 'on_hold', score: 8.5, startedAt: 2000, finishedAt: 3000 }),
    });
    expect(result.adopt).toEqual({ status: 'on_hold', score: 8.5, startedAt: 2000, finishedAt: 3000 });
    expect(result.push).toBeNull();
    expect(result.readUpTo).toBeNull();
  });

  it('takes a score that was removed', () => {
    expect(plan({ track: link({ score: 9 }), remote: remote({ score: null }) }).adopt).toEqual({ score: null });
  });

  it('takes the progress together with the rest when the tracker is ahead', () => {
    const result = plan({
      localRead: 2,
      track: link({ progress: 2 }),
      remote: remote({ progress: 6, status: 'completed' }),
    });
    expect(result).toEqual({ readUpTo: 6, push: null, adopt: { status: 'completed', progress: 6 } });
  });
});

describe('reconcile: edits waiting to be sent', () => {
  it('leaves everything to the queue', () => {
    expect(plan({ pending: true, localRead: 1, remote: remote({ progress: 9, score: 7, status: 'dropped' }) })).toEqual(
      {
        readUpTo: null,
        push: null,
        adopt: {},
      },
    );
  });
});
