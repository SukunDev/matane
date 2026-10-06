import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrackPatch, TrackerService } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { MangaRepository } from '../db/repositories/manga';
import { ProgressRepository } from '../db/repositories/progress';
import { TrackersRepository } from '../db/repositories/trackers';
import { TrackerManager, retryDelay } from './manager';
import { SecretBox } from './secret';
import {
  type RemoteEntry,
  type TrackerClient,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const T0 = Date.UTC(2024, 5, 1);

let dir: string;
let connection: DatabaseConnection;
let repo: TrackersRepository;
let progress: ProgressRepository;
let manager: TrackerManager;
let mangaId: number;
let chapterIds: number[];

let now: number;
let online: boolean;
let incognito: boolean;
let keyring: boolean;
/** What the fake AniList holds: the entry for each remote id (absent: not on the list). */
let remote: Map<string, RemoteEntry>;
let saved: { remoteId: string; patch: TrackPatch }[];
let viewerError: Error | null;
let saveError: Error | null;
let gate: Promise<void> | null;
let logins: number;
/** The tokens the fake trackers were called with, and one they refuse. */
let tokensSeen: string[];
let rejectToken: string | null;
let refreshCalls: string[];
let refreshError: Error | null;
/** Trackers whose progress may not be pulled into the library (Settings → Tracking). */
let pullOff: Set<string>;
const use = (token: string) => {
  tokensSeen.push(token);
  if (rejectToken === '*' || token === rejectToken) throw new TrackerAuthError('refused');
};

const entryOf = (remoteId: string, patch: TrackPatch = {}): RemoteEntry => ({
  remoteId,
  remoteUrl: `https://anilist.co/manga/${remoteId}`,
  remoteTitle: 'Moon Garden',
  status: patch.status ?? null,
  score: patch.score ?? null,
  progress: patch.progress ?? null,
  startedAt: patch.startedAt ?? null,
  finishedAt: patch.finishedAt ?? null,
});

const client: TrackerClient = {
  service: 'anilist',
  name: 'AniList',
  async viewer() {
    if (viewerError) throw viewerError;
    return { userId: '7', username: 'mika' };
  },
  async search(token, query) {
    use(token);
    return [
      {
        remoteId: '30013',
        title: `Result for ${query}`,
        coverUrl: null,
        url: 'https://anilist.co/manga/30013',
        detail: null,
      },
    ];
  },
  async getEntry(token, remoteId) {
    use(token);
    return remote.get(remoteId) ?? null;
  },
  async save(token, remoteId, patch) {
    use(token);
    await gate;
    if (saveError) throw saveError;
    saved.push({ remoteId, patch });
    const updated = {
      ...(remote.get(remoteId) ?? entryOf(remoteId)),
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    remote.set(remoteId, updated as RemoteEntry);
    return updated as RemoteEntry;
  },
};

/** MyAnimeList's kind of tracker: tokens that expire and are renewed. */
const malClient: TrackerClient = {
  ...client,
  service: 'mal',
  name: 'MyAnimeList',
  async refresh(refreshToken) {
    refreshCalls.push(refreshToken);
    await gate;
    if (refreshError) throw refreshError;
    return { accessToken: `access-${refreshCalls.length + 1}`, refreshToken: 'refresh-2', expiresInSec: 3600 };
  },
};

/** Trackers that log in with a username and password (Kitsu also renews its tokens). */
let passwordLogins: [string, string][];
let passwordError: Error | null;
const passwordClient = (service: 'kitsu' | 'mangaupdates', name: string): TrackerClient => ({
  ...client,
  service,
  name,
  async loginWithPassword(username, password) {
    passwordLogins.push([username, password]);
    if (passwordError) throw passwordError;
    return {
      accessToken: `pw-${service}`,
      refreshToken: service === 'kitsu' ? 'pw-refresh' : null,
      expiresInSec: 3600,
    };
  },
  ...(service === 'kitsu'
    ? {
        async refresh(refreshToken: string) {
          refreshCalls.push(refreshToken);
          return { accessToken: 'pw-kitsu-2', refreshToken: 'pw-refresh-2', expiresInSec: 3600 };
        },
      }
    : {}),
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-trackers-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
    .run();
  const changes = new DbChanges(() => undefined);
  const manga = new MangaRepository(connection.db, changes);
  const chapters = new ChaptersRepository(connection.db, changes);
  mangaId = manga.ensure('demo/en', { url: '/m', title: 'Moon Garden' });
  chapterIds = chapters.sync(
    mangaId,
    [5, 4, 3, 2, 1].map((n) => ({ url: `c${n}`, name: `Ch. ${n}`, number: n })),
  ).added;
  // `added` is in the order given: chapter 5 first.
  chapterIds.reverse();
  repo = new TrackersRepository(connection.db, changes);
  progress = new ProgressRepository(connection.db, changes);
  now = T0;
  online = true;
  incognito = false;
  keyring = true;
  remote = new Map();
  saved = [];
  viewerError = null;
  saveError = null;
  gate = null;
  logins = 0;
  tokensSeen = [];
  rejectToken = null;
  refreshCalls = [];
  refreshError = null;
  pullOff = new Set();
  passwordLogins = [];
  passwordError = null;
  manager = new TrackerManager({
    repo,
    clients: {
      anilist: client,
      mal: malClient,
      kitsu: passwordClient('kitsu', 'Kitsu'),
      mangaupdates: passwordClient('mangaupdates', 'MangaUpdates'),
    },
    secrets: new SecretBox({
      isEncryptionAvailable: () => keyring,
      encryptString: (text) => Buffer.from(`sealed:${text}`),
      decryptString: (data) => data.toString().slice('sealed:'.length),
    }),
    configured: () => true,
    redirectUrl: () => 'http://127.0.0.1:47653/callback',
    login: async (service) => {
      logins++;
      return service === 'mal'
        ? { accessToken: 'access-1', refreshToken: 'refresh-1', expiresInSec: 3600 }
        : { accessToken: 'token-1', refreshToken: null, expiresInSec: 31_536_000 };
    },
    manga,
    progress,
    pullEnabled: (service) => !pullOff.has(service),
    incognito: () => incognito,
    isOnline: () => online,
    now: () => now,
  });
  progress.onRead = (id) => manager.onChaptersRead(id);
});

afterEach(() => {
  manager.stop();
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const read = (...numbers: number[]) =>
  progress.markRead(
    numbers.map((n) => chapterIds[n - 1]!),
    true,
    now,
  );
const connect = () => manager.connect('anilist');
const link = (remoteId = '30013') => manager.link({ mangaId, service: 'anilist', remoteId, title: 'Moon Garden' });
const rows = () =>
  connection.sqlite.prepare('SELECT * FROM tracker_queue').all() as {
    attempts: number;
    next_attempt_at: number;
    payload_json: string;
  }[];

describe('accounts', () => {
  it('connects through the login, proves the token, and keeps it sealed', async () => {
    expect(manager.list()[0]).toMatchObject({
      service: 'anilist',
      connected: false,
      configured: true,
      queued: 0,
      encrypted: null,
    });
    const info = await connect();
    expect(info).toMatchObject({
      connected: true,
      username: 'mika',
      expired: false,
      encrypted: true,
      redirectUrl: 'http://127.0.0.1:47653/callback',
    });
    const stored = repo.account('anilist')!;
    expect(stored.tokenEncrypted).toBe(`enc:${Buffer.from('sealed:{"a":"token-1","r":null}').toString('base64')}`);
    // Sealed: the token is not in the clear.
    expect(stored.tokenEncrypted).not.toContain('token-1');
    expect(stored.expiresAt).toBe(T0 + 31_536_000_000);
  });

  it('says when the token is not encrypted (no keyring)', async () => {
    keyring = false;
    expect(await connect()).toMatchObject({ connected: true, encrypted: false });
    expect(repo.account('anilist')!.tokenEncrypted).toBe('plain:{"a":"token-1","r":null}');
  });

  it('does not save a login the tracker refuses', async () => {
    viewerError = new TrackerAuthError('nope');
    await expect(connect()).rejects.toMatchObject({ code: 'tracker' });
    expect(repo.account('anilist')).toBeUndefined();
  });

  it('connects with a token made elsewhere', async () => {
    expect(await manager.setToken('anilist', 'pasted-token-123')).toMatchObject({ connected: true, username: 'mika' });
    expect(logins).toBe(0);
    expect(repo.account('anilist')!.expiresAt).toBeNull();
  });

  it('reports a login that ran out, and one that cannot be read', async () => {
    await connect();
    now = T0 + 31_536_000_001;
    expect(manager.list()[0]).toMatchObject({ connected: true, expired: true });
    now = T0;
    keyring = false;
    expect(manager.list()[0]).toMatchObject({ connected: false, expired: true });
  });

  it('forgets the login and what waited for it, but keeps the links', async () => {
    await connect();
    await link();
    expect(rows()).toHaveLength(1);
    manager.disconnect('anilist');
    expect(manager.list()[0]).toMatchObject({ connected: false, queued: 0 });
    expect(rows()).toHaveLength(0);
    expect(manager.tracks(mangaId)).toHaveLength(1);
    await expect(manager.search('anilist', 'x')).rejects.toMatchObject({
      code: 'tracker',
      message: expect.stringContaining('not connected'),
    });
  });
});

describe('links', () => {
  it('starts a new entry as planning when nothing was read, and sends it', async () => {
    await connect();
    const entry = await link();
    expect(entry).toMatchObject({ remoteTitle: 'Moon Garden', status: 'planning', progress: 0, pending: true });
    await manager.flush();
    expect(saved).toEqual([{ remoteId: '30013', patch: { status: 'planning', progress: 0 } }]);
    expect(manager.tracks(mangaId)[0]).toMatchObject({ pending: false });
    expect(manager.list()[0]!.queued).toBe(0);
  });

  it('starts a new entry as reading with what was read, dated today', async () => {
    await connect();
    read(1, 2, 3);
    await link();
    await manager.flush();
    expect(saved[0]!.patch).toEqual({ progress: 3, status: 'reading', startedAt: T0 });
  });

  it('keeps what the user already has on the tracker, and sends only the chapters it lacks', async () => {
    await connect();
    remote.set('30013', {
      ...entryOf('30013'),
      status: 'on_hold',
      score: 8.5,
      progress: 2,
      startedAt: Date.UTC(2023, 0, 5),
    });
    read(1, 2, 3, 4);
    const entry = await link();
    expect(entry).toMatchObject({ status: 'reading', score: 8.5, progress: 4, startedAt: Date.UTC(2023, 0, 5) });
    await manager.flush();
    expect(saved[0]!.patch).toEqual({ progress: 4, status: 'reading' });
  });

  it('leaves the entry alone when the tracker is already ahead', async () => {
    await connect();
    remote.set('30013', { ...entryOf('30013'), status: 'reading', progress: 20 });
    read(1);
    expect(await link()).toMatchObject({ progress: 20, pending: false });
    await manager.flush();
    expect(saved).toEqual([]);
  });

  it('needs a login, and a manga that exists', async () => {
    await expect(link()).rejects.toMatchObject({ code: 'tracker' });
    await connect();
    await expect(manager.link({ mangaId: 999, service: 'anilist', remoteId: '1' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('removes a link with whatever waited to be sent', async () => {
    await connect();
    await link();
    manager.unlink(mangaId, 'anilist');
    expect(manager.tracks(mangaId)).toEqual([]);
    expect(rows()).toHaveLength(0);
  });

  it('searches through the tracker', async () => {
    await connect();
    expect(await manager.search('anilist', 'moon')).toEqual([expect.objectContaining({ title: 'Result for moon' })]);
  });
});

describe('reading', () => {
  it('moves a linked entry forward as chapters are read, never back', async () => {
    await connect();
    remote.set('30013', { ...entryOf('30013'), status: 'planning', progress: 0 });
    await link();
    read(1, 2, 3);
    await manager.flush();
    expect(saved.at(-1)!.patch).toEqual({ progress: 3, status: 'reading', startedAt: T0 });
    expect(manager.tracks(mangaId)[0]).toMatchObject({ progress: 3, status: 'reading', startedAt: T0 });

    // An earlier chapter read now, or marking chapters unread, changes nothing.
    saved.length = 0;
    read(1);
    progress.markRead([chapterIds[2]!], false);
    await manager.flush();
    expect(saved).toEqual([]);

    read(5);
    await manager.flush();
    expect(saved.at(-1)!.patch).toEqual({ progress: 5, status: 'reading' });
  });

  it('keeps a completed entry completed', async () => {
    await connect();
    remote.set('30013', { ...entryOf('30013'), status: 'completed', progress: 2 });
    await link();
    read(1, 2, 3);
    await manager.flush();
    expect(saved.at(-1)!.patch).toEqual({ progress: 3 });
    expect(manager.tracks(mangaId)[0]!.status).toBe('completed');
  });

  it('counts chapters when none has a number, and rounds a half chapter down', async () => {
    connection.sqlite.prepare('UPDATE chapters SET number = NULL WHERE manga_id = ?').run(mangaId);
    read(1, 2);
    expect(progress.highestRead(mangaId)).toBe(2);
    connection.sqlite.prepare('UPDATE chapters SET number = 4.5 WHERE id = ?').run(chapterIds[0]);
    expect(progress.highestRead(mangaId)).toBe(4);
    expect(progress.highestRead(999)).toBeNull();
  });

  it('says nothing while incognito, and for manga that are not linked', async () => {
    await connect();
    await link();
    await manager.flush();
    saved.length = 0;
    incognito = true;
    read(1, 2);
    await manager.flush();
    expect(saved).toEqual([]);
    incognito = false;
    manager.unlink(mangaId, 'anilist');
    read(3);
    expect(rows()).toHaveLength(0);
  });

  it('does not follow reads for a tracker that is not connected', async () => {
    await connect();
    await link();
    manager.disconnect('anilist');
    read(1);
    expect(rows()).toHaveLength(0);
    expect(manager.tracks(mangaId)[0]!.progress).toBe(0);
  });
});

describe('the queue', () => {
  it('sends one update with the latest values when several came in', async () => {
    await connect();
    await link();
    await manager.flush();
    saved.length = 0;
    read(1);
    read(2, 3);
    manager.update(mangaId, 'anilist', { score: 9 });
    expect(rows()).toHaveLength(1);
    await manager.flush();
    expect(saved).toEqual([{ remoteId: '30013', patch: { progress: 3, status: 'reading', startedAt: T0, score: 9 } }]);
  });

  it('waits while offline and goes out once back online', async () => {
    await connect();
    await link();
    online = false;
    await manager.flush();
    expect(saved).toEqual([]);
    expect(manager.list()[0]!.queued).toBe(1);
    online = true;
    await manager.retry();
    expect(saved).toHaveLength(1);
    expect(manager.list()[0]!.queued).toBe(0);
  });

  it('keeps an edit made while an update is on its way, and sends it next', async () => {
    await connect();
    await link();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const flushing = manager.flush();
    await new Promise((r) => setTimeout(r, 10));
    manager.update(mangaId, 'anilist', { score: 7 });
    release();
    await flushing;
    // What was sent is gone; the edit is still waiting.
    expect(saved).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    gate = null;
    await manager.flush();
    expect(saved.at(-1)!.patch).toMatchObject({ score: 7 });
    expect(rows()).toHaveLength(0);
  });

  it('marks the login expired when the tracker refuses it, keeps the updates, and sends them after a new login', async () => {
    await connect();
    await link();
    saveError = new TrackerAuthError('revoked');
    await manager.flush();
    expect(manager.list()[0]).toMatchObject({ expired: true, queued: 1, lastError: 'revoked' });
    saveError = null;
    await manager.flush();
    expect(saved).toEqual([]);
    expect(manager.list()[0]!.lastError).toContain('expired');
    await expect(manager.search('anilist', 'x')).rejects.toMatchObject({ message: expect.stringContaining('expired') });

    await connect();
    await manager.flush();
    expect(saved).toHaveLength(1);
    expect(manager.list()[0]).toMatchObject({ expired: false, queued: 0, lastError: null });
  });

  it('waits as long as the tracker asks when it is rate limited', async () => {
    await connect();
    await link();
    saveError = new TrackerRateLimitError('slow down', 45_000);
    await manager.flush();
    expect(rows()[0]!.next_attempt_at).toBe(T0 + 45_000);
    saveError = null;
    now = T0 + 44_000;
    await manager.flush();
    expect(saved).toEqual([]);
    now = T0 + 45_000;
    await manager.flush();
    expect(saved).toHaveLength(1);
  });

  it('tries again with growing pauses when something else goes wrong', async () => {
    await connect();
    await link();
    saveError = new Error('socket hang up');
    await manager.flush();
    expect(rows()[0]).toMatchObject({ attempts: 1, next_attempt_at: T0 + 60_000 });
    now = T0 + 60_000;
    await manager.flush();
    expect(rows()[0]).toMatchObject({ attempts: 2, next_attempt_at: T0 + 60_000 + 120_000 });
    expect(manager.list()[0]!.lastError).toBe('socket hang up');
    expect([1, 2, 3, 4, 8, 20].map(retryDelay)).toEqual([60_000, 120_000, 240_000, 480_000, 3_600_000, 3_600_000]);

    saveError = null;
    await manager.retry();
    expect(saved).toHaveLength(1);
  });

  it('holds one tracker back without stopping the rest of its queue behind it', async () => {
    await connect();
    await link();
    saveError = new TrackerRequestError('bad request');
    await manager.flush();
    read(1);
    await manager.flush();
    // The first update failed, so the second (merged into it) is still one waiting row.
    expect(rows()).toHaveLength(1);
    expect(manager.list()[0]!.lastError).toBe('bad request');
  });
});

describe('edits', () => {
  it('saves at once, and sends when it can', async () => {
    await connect();
    await link();
    await manager.flush();
    const entry = manager.update(mangaId, 'anilist', { score: 8.5, status: 'on_hold', progress: 3 });
    expect(entry).toMatchObject({ score: 8.5, status: 'on_hold', progress: 3, pending: true });
    await manager.flush();
    expect(saved.at(-1)!.patch).toEqual({ score: 8.5, status: 'on_hold', progress: 3 });
  });

  it('dates a manga that is finished, unless a date was chosen', async () => {
    await connect();
    await link();
    expect(manager.update(mangaId, 'anilist', { status: 'completed' }).finishedAt).toBe(T0);
    manager.update(mangaId, 'anilist', { status: 'reading', finishedAt: null });
    const chosen = Date.UTC(2024, 0, 2);
    expect(manager.update(mangaId, 'anilist', { status: 'completed', finishedAt: chosen }).finishedAt).toBe(chosen);
  });

  it('refuses edits for a manga that is not linked', async () => {
    expect(() => manager.update(mangaId, 'anilist', { score: 5 })).toThrow(/not linked/);
  });
});

describe('logins that are renewed', () => {
  const connectMal = () => manager.connect('mal');
  const search = () => manager.search('mal', 'moon');
  const stored = () => repo.account('mal')!;
  const secretOf = (sealed: string) =>
    Buffer.from(sealed.slice('enc:'.length), 'base64').toString().slice('sealed:'.length);

  it('keeps the refresh token with the access token, sealed', async () => {
    expect(await connectMal()).toMatchObject({ connected: true, expired: false, name: 'MyAnimeList' });
    expect(JSON.parse(secretOf(stored().tokenEncrypted!))).toEqual({ a: 'access-1', r: 'refresh-1' });
    expect(stored().expiresAt).toBe(T0 + 3_600_000);
  });

  it('uses the stored token while it is good, and renews it shortly before it runs out', async () => {
    await connectMal();
    now = T0 + 30 * 60_000;
    await search();
    expect(tokensSeen).toEqual(['access-1']);
    expect(refreshCalls).toEqual([]);

    now = T0 + 3_600_000 - 30_000;
    await search();
    expect(refreshCalls).toEqual(['refresh-1']);
    expect(tokensSeen.at(-1)).toBe('access-2');
    expect(JSON.parse(secretOf(stored().tokenEncrypted!))).toEqual({ a: 'access-2', r: 'refresh-2' });
    expect(stored().expiresAt).toBe(now + 3_600_000);
    expect(stored().username).toBe('mika');
  });

  it('renews once for requests that come at the same time', async () => {
    await connectMal();
    now = T0 + 3_600_000;
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const both = Promise.all([search(), search()]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await both;
    expect(refreshCalls).toHaveLength(1);
    expect(tokensSeen).toEqual(['access-2', 'access-2']);
  });

  it('treats a run-out access token as fine while a refresh token can make the next, and as expired when not', async () => {
    await connectMal();
    await connect();
    now = T0 + 3_600_000 + 1;
    expect(manager.list().find((i) => i.service === 'mal')).toMatchObject({ connected: true, expired: false });
    now = T0 + 31_536_000_001;
    expect(manager.list().find((i) => i.service === 'anilist')).toMatchObject({ expired: true });
  });

  it('marks the login expired when the refresh token is refused, and stops trying', async () => {
    await connectMal();
    now = T0 + 3_600_000;
    refreshError = new TrackerAuthError('invalid_grant');
    await expect(search()).rejects.toMatchObject({ code: 'tracker' });
    expect(manager.list().find((i) => i.service === 'mal')).toMatchObject({ connected: true, expired: true });
    expect(JSON.parse(secretOf(stored().tokenEncrypted!)).r).toBeNull();
    refreshError = null;
    await expect(search()).rejects.toMatchObject({ code: 'tracker', message: expect.stringContaining('expired') });
    expect(refreshCalls).toHaveLength(1);
  });

  it('keeps the login when the refresh fails for another reason (no network)', async () => {
    await connectMal();
    now = T0 + 3_600_000;
    refreshError = new Error('socket hang up');
    await expect(search()).rejects.toMatchObject({ code: 'network' });
    expect(manager.list().find((i) => i.service === 'mal')).toMatchObject({ connected: true, expired: false });
    refreshError = null;
    await search();
    expect(refreshCalls).toHaveLength(2);
    expect(tokensSeen.at(-1)).toBe('access-3');
  });

  it('renews a token the tracker refuses and repeats the request once', async () => {
    await connectMal();
    rejectToken = 'access-1';
    await search();
    expect(tokensSeen).toEqual(['access-1', 'access-2']);
    // Refused again after the renewal: the login is over.
    rejectToken = '*';
    await expect(search()).rejects.toMatchObject({ code: 'tracker' });
    expect(manager.list().find((i) => i.service === 'mal')).toMatchObject({ expired: true });
  });

  it('sends queued updates with a renewed token', async () => {
    await connectMal();
    await manager.link({ mangaId, service: 'mal', remoteId: '44', title: 'Moon Garden' });
    now = T0 + 3_600_000;
    await manager.flush();
    expect(refreshCalls).toEqual(['refresh-1']);
    expect(saved).toHaveLength(1);
    expect(tokensSeen.at(-1)).toBe('access-2');
  });

  it('still reads a login stored as a bare token, from before refresh tokens', async () => {
    repo.saveAccount({
      service: 'mal',
      userId: '1',
      username: 'old',
      tokenEncrypted: `enc:${Buffer.from('sealed:legacy-token').toString('base64')}`,
      expiresAt: null,
    });
    expect(manager.list().find((i) => i.service === 'mal')).toMatchObject({ connected: true, expired: false });
    await search();
    expect(tokensSeen).toEqual(['legacy-token']);
  });
});

describe('trackers with a password login', () => {
  const info = (service: string) => manager.list().find((i) => i.service === service)!;

  it('says how each tracker logs in, and has no redirect url for a password login', () => {
    expect(info('anilist')).toMatchObject({ login: 'browser', redirectUrl: 'http://127.0.0.1:47653/callback' });
    expect(info('mal')).toMatchObject({ login: 'browser' });
    expect(info('kitsu')).toMatchObject({ login: 'password', redirectUrl: null, name: 'Kitsu' });
    expect(info('mangaupdates')).toMatchObject({ login: 'password', redirectUrl: null });
  });

  it('logs in with the password, keeps only the login that comes back, and proves it', async () => {
    expect(await manager.connectWithPassword('kitsu', 'mika@example.org', 'hunter2')).toMatchObject({
      connected: true,
      username: 'mika',
      login: 'password',
      expired: false,
    });
    expect(passwordLogins).toEqual([['mika@example.org', 'hunter2']]);
    const stored = repo.account('kitsu')!;
    expect(JSON.stringify(stored)).not.toContain('hunter2');
    expect(Buffer.from(stored.tokenEncrypted!.slice(4), 'base64').toString()).toBe(
      'sealed:{"a":"pw-kitsu","r":"pw-refresh"}',
    );
    // The password is not looked at again: renewal works with the refresh token.
    now = T0 + 3_600_000;
    await manager.search('kitsu', 'moon');
    expect(refreshCalls).toEqual(['pw-refresh']);
    expect(tokensSeen.at(-1)).toBe('pw-kitsu-2');
    expect(passwordLogins).toHaveLength(1);
  });

  it('keeps a session token without refresh for MangaUpdates', async () => {
    await manager.connectWithPassword('mangaupdates', 'mika', 'pw');
    expect(Buffer.from(repo.account('mangaupdates')!.tokenEncrypted!.slice(4), 'base64').toString()).toBe(
      'sealed:{"a":"pw-mangaupdates","r":null}',
    );
  });

  it('says what went wrong with a wrong password, and saves nothing', async () => {
    passwordError = new TrackerRequestError('Kitsu did not accept that email and password');
    await expect(manager.connectWithPassword('kitsu', 'mika', 'wrong')).rejects.toMatchObject({
      code: 'tracker',
      message: expect.stringContaining('did not accept'),
    });
    expect(repo.account('kitsu')).toBeUndefined();
    passwordError = new Error('socket hang up');
    await expect(manager.connectWithPassword('kitsu', 'mika', 'pw')).rejects.toMatchObject({ code: 'network' });
  });

  it('keeps the two kinds of login apart', async () => {
    await expect(manager.connect('kitsu')).rejects.toMatchObject({
      code: 'tracker',
      message: expect.stringContaining('username and password'),
    });
    await expect(manager.connectWithPassword('anilist', 'a', 'b')).rejects.toMatchObject({
      code: 'tracker',
      message: expect.stringContaining('browser'),
    });
    expect(logins).toBe(0);
    expect(passwordLogins).toEqual([]);
  });

  it('sends reading to a tracker it logged in to', async () => {
    await manager.connectWithPassword('mangaupdates', 'mika', 'pw');
    await manager.link({ mangaId, service: 'mangaupdates', remoteId: '123', title: 'Moon Garden' });
    read(1, 2);
    await manager.flush();
    expect(saved.at(-1)).toMatchObject({ remoteId: '123', patch: { progress: 2 } });
  });
});

describe('two-way sync', () => {
  const readFlags = () =>
    chapterIds.map(
      (id) => (connection.sqlite.prepare('SELECT read FROM chapters WHERE id = ?').get(id) as { read: number }).read,
    );
  /** The user changed the entry on the tracker's website. */
  const changeRemote = (patch: Partial<RemoteEntry>) => remote.set('30013', { ...remote.get('30013')!, ...patch });
  const linked = async (patch: Partial<RemoteEntry> = {}) => {
    await connect();
    remote.set('30013', { ...entryOf('30013'), status: 'reading', progress: 1, startedAt: T0, ...patch });
    await link();
  };

  it('marks chapters read when the tracker is ahead, and does not send them back', async () => {
    read(1);
    await linked();
    changeRemote({ progress: 4, status: 'completed', score: 9, finishedAt: T0 + 1000 });
    expect(await manager.sync()).toEqual({ checked: 1, readHere: 3, pushed: 0, failed: 0 });
    expect(readFlags()).toEqual([1, 1, 1, 1, 0]);
    expect(manager.tracks(mangaId)[0]).toMatchObject({
      progress: 4,
      status: 'completed',
      score: 9,
      finishedAt: T0 + 1000,
      pending: false,
    });
    await manager.flush();
    expect(saved).toEqual([]);
    expect(rows()).toEqual([]);
    // Nothing bounces on the next one either.
    expect(await manager.sync()).toEqual({ checked: 1, readHere: 0, pushed: 0, failed: 0 });
    expect(rows()).toEqual([]);
  });

  it('brings a tracker that is behind forward', async () => {
    await linked();
    // Read without the hook, as if before the tracker was connected.
    progress.onRead = undefined;
    read(1, 2, 3);
    expect(await manager.sync()).toMatchObject({ pushed: 1, readHere: 0 });
    await manager.flush();
    expect(saved.at(-1)!.patch).toEqual({ progress: 3 });
    expect(remote.get('30013')!.progress).toBe(3);
  });

  it('takes status, score and dates the user changed on the tracker website', async () => {
    await linked();
    changeRemote({ status: 'on_hold', score: 7.5, startedAt: T0 - 5000 });
    await manager.sync();
    expect(manager.tracks(mangaId)[0]).toMatchObject({ status: 'on_hold', score: 7.5, startedAt: T0 - 5000 });
    // The entry was at chapter 1, so that one is read here.
    expect(readFlags()).toEqual([1, 0, 0, 0, 0]);
  });

  it('leaves an edit made here that is not sent yet alone', async () => {
    await linked();
    saveError = new Error('offline-ish');
    manager.update(mangaId, 'anilist', { score: 6 });
    await manager.flush();
    changeRemote({ progress: 5, score: 2 });
    expect(await manager.sync()).toEqual({ checked: 1, readHere: 0, pushed: 0, failed: 0 });
    expect(readFlags()).toEqual([0, 0, 0, 0, 0]);
    expect(manager.tracks(mangaId)[0]).toMatchObject({ score: 6, progress: 1, pending: true });
  });

  it('follows the tracker only where that is on, for the manga and for the tracker', async () => {
    await linked();
    changeRemote({ progress: 3 });
    manager.update(mangaId, 'anilist', { syncBack: false });
    expect(manager.tracks(mangaId)[0]).toMatchObject({ syncBack: false, pending: false });
    expect(rows()).toEqual([]);
    expect(await manager.sync()).toMatchObject({ readHere: 0 });
    expect(readFlags()).toEqual([0, 0, 0, 0, 0]);

    manager.update(mangaId, 'anilist', { syncBack: true });
    pullOff.add('anilist');
    expect(await manager.sync()).toMatchObject({ readHere: 0 });
    pullOff.clear();
    expect(await manager.sync()).toMatchObject({ readHere: 3 });
    expect(readFlags()).toEqual([1, 1, 1, 0, 0]);
  });

  it('does not send while incognito, but still brings the tracker in', async () => {
    await linked();
    progress.onRead = undefined;
    read(1, 2, 3);
    incognito = true;
    expect(await manager.sync()).toMatchObject({ pushed: 0 });
    expect(rows()).toEqual([]);
    changeRemote({ progress: 4 });
    expect(await manager.sync()).toMatchObject({ readHere: 1 });
    expect(readFlags()).toEqual([1, 1, 1, 1, 0]);
  });

  it('can be limited to one tracker or one manga, skips what has no login', async () => {
    await linked();
    changeRemote({ progress: 2 });
    expect(await manager.sync({ service: 'mal' })).toMatchObject({ checked: 0 });
    expect(await manager.sync({ mangaId: mangaId + 99 })).toMatchObject({ checked: 0 });
    expect(await manager.sync({ service: 'anilist', mangaId })).toMatchObject({ checked: 1, readHere: 2 });
    manager.disconnect('anilist');
    expect(await manager.sync()).toMatchObject({ checked: 0 });
  });

  it('ignores an entry that was deleted on the tracker', async () => {
    await linked();
    remote.delete('30013');
    expect(await manager.sync()).toEqual({ checked: 1, readHere: 0, pushed: 0, failed: 0 });
    expect(manager.tracks(mangaId)).toHaveLength(1);
  });

  it('refuses while offline (and says nothing when it was not asked for)', async () => {
    await linked();
    online = false;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'network' });
    await expect(manager.syncQuietly()).resolves.toBeUndefined();
  });

  it('counts a tracker that does not answer, and goes on with the others', async () => {
    await linked();
    rejectToken = '*';
    expect(await manager.sync()).toMatchObject({ checked: 1, failed: 1 });
    await expect(manager.syncQuietly()).resolves.toBeUndefined();
  });

  it('runs one sync at a time', async () => {
    await linked();
    const first = manager.sync();
    expect(manager.sync()).toBe(first);
    await first;
  });
});

describe('hooks', () => {
  it('only calls trackers for chapters that became read', () => {
    const told: number[] = [];
    progress.onRead = (id) => told.push(id);
    progress.markRead([chapterIds[0]!], true);
    progress.markRead([chapterIds[0]!], false);
    expect(told).toEqual([mangaId]);
    progress.save({ chapterId: chapterIds[1]!, page: 0, pageEnd: 0, total: 1, offset: null });
    expect(told).toEqual([mangaId, mangaId]);
    // Already read: reaching the end again is not news.
    progress.save({ chapterId: chapterIds[1]!, page: 0, pageEnd: 0, total: 1, offset: null });
    expect(told).toHaveLength(2);
  });

  it('is typed for the services it supports', () => {
    const service: TrackerService = 'anilist';
    expect(service).toBe('anilist');
  });
});
