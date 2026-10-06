import {
  TRACKER_SERVICES,
  type SyncResult,
  type TrackEntry,
  type TrackPatch,
  type TrackSearchResult,
  type TrackerInfo,
  type TrackerService,
} from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { AccountRow, TrackRow, TrackersRepository } from '../db/repositories/trackers';
import { reconcile } from './reconcile';
import type { SecretBox } from './secret';
import {
  type RemoteEntry,
  type TrackerClient,
  type TrackerLogin,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

const MINUTE = 60_000;
/** Between tries of an update that did not go through: a minute, doubling, at most an hour. */
export const retryDelay = (attempts: number) => Math.min(MINUTE * 2 ** Math.max(0, attempts - 1), 60 * MINUTE);
/** After a change, wait a moment so a burst (a chapter marked read a few times) goes out as one. */
const KICK_MS = 1_500;
const FLUSH_EVERY_MS = MINUTE;
/** The first sync after the app opened. */
const START_SYNC_MS = 20_000;
/** A token that runs out within this is renewed before it is used. */
const REFRESH_MARGIN_MS = MINUTE;

/** What is kept sealed for a login: the token and, when the tracker has one, its refresh token. */
interface Credentials {
  accessToken: string;
  refreshToken: string | null;
}
const encode = (credentials: Credentials) =>
  JSON.stringify({ a: credentials.accessToken, r: credentials.refreshToken });
function decode(text: string): Credentials {
  try {
    const parsed = JSON.parse(text) as { a?: unknown; r?: unknown } | null;
    if (parsed && typeof parsed === 'object' && typeof parsed.a === 'string') {
      return { accessToken: parsed.a, refreshToken: typeof parsed.r === 'string' ? parsed.r : null };
    }
  } catch {
    // A bare token.
  }
  return { accessToken: text, refreshToken: null };
}

export interface TrackerManagerDeps {
  repo: TrackersRepository;
  clients: Record<TrackerService, TrackerClient>;
  secrets: SecretBox;
  /** Whether an app registration (client id) exists for the tracker. */
  configured: (service: TrackerService) => boolean;
  /** The address to register as the app's redirect URL. */
  redirectUrl: (service: TrackerService) => string;
  /** Logs in through the browser. */
  login: (service: TrackerService, signal: AbortSignal) => Promise<TrackerLogin>;
  manga: { get(id: number): { id: number } | undefined };
  /** Chapters read of a manga, as a tracker counts them (null: none read). */
  progress: {
    highestRead(mangaId: number): number | null;
    /** Marks chapters read up to what a tracker says, without telling the trackers (returns how many). */
    markReadUpTo(mangaId: number, count: number): number;
  };
  /** Whether chapters read on this tracker may be marked read here (Settings → Tracking); on when absent. */
  pullEnabled?: (service: TrackerService) => boolean;
  /** Reading while incognito is not reported to trackers. */
  incognito: () => boolean;
  isOnline: () => boolean;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Trackers (ADR 0035): accounts, the manga linked to a tracker's entry, and the updates to send.
 * Reading never waits for the network: a chapter read queues an update, and the queue sends it
 * when online, again and again with growing pauses if the tracker is not answering.
 */
export class TrackerManager {
  private readonly logins = new Map<TrackerService, AbortController>();
  private readonly lastError = new Map<TrackerService, string>();
  private readonly refreshes = new Map<TrackerService, Promise<string>>();
  private flushing: Promise<void> | null = null;
  private syncing: Promise<SyncResult> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private kickTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: TrackerManagerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------ accounts

  list(): TrackerInfo[] {
    return TRACKER_SERVICES.map((service) => {
      const account = this.deps.repo.account(service);
      const credentials = account ? this.credentials(account) : null;
      const connected = credentials !== null;
      return {
        service,
        name: this.deps.clients[service].name,
        configured: this.deps.configured(service),
        connected,
        username: account?.username ?? null,
        // A token that ran out is fine while a refresh token can make the next one.
        expired:
          account !== undefined &&
          (credentials === null ||
            (account.expiresAt !== null && account.expiresAt <= this.now() && credentials.refreshToken === null)),
        encrypted: account ? this.deps.secrets.isEncrypted(account.tokenEncrypted) : null,
        queued: this.deps.repo.queued(service),
        lastError: this.lastError.get(service) ?? null,
        login: this.usesPassword(service) ? ('password' as const) : ('browser' as const),
        redirectUrl: this.usesPassword(service) ? null : this.deps.redirectUrl(service),
      };
    });
  }

  /** Trackers without a browser login ask for a username and password. */
  private usesPassword(service: TrackerService): boolean {
    return this.deps.clients[service].loginWithPassword !== undefined;
  }

  private info(service: TrackerService): TrackerInfo {
    return this.list().find((i) => i.service === service)!;
  }

  async connect(service: TrackerService): Promise<TrackerInfo> {
    if (this.usesPassword(service)) {
      throw new AppError('tracker', `${this.deps.clients[service].name} logs in with a username and password`);
    }
    if (!this.deps.configured(service)) {
      throw new AppError('tracker', `${this.deps.clients[service].name} has no app registration in this build`);
    }
    this.logins.get(service)?.abort();
    const controller = new AbortController();
    this.logins.set(service, controller);
    try {
      const login = await this.deps.login(service, controller.signal);
      return await this.saveLogin(service, login);
    } finally {
      if (this.logins.get(service) === controller) this.logins.delete(service);
    }
  }

  /** Logs in with a username and password; only the login that comes back is kept, never the password. */
  async connectWithPassword(service: TrackerService, username: string, password: string): Promise<TrackerInfo> {
    const client = this.deps.clients[service];
    if (!client.loginWithPassword) throw new AppError('tracker', `${client.name} logs in through the browser`);
    let login: TrackerLogin;
    try {
      login = await client.loginWithPassword(username, password);
    } catch (error) {
      throw this.toAppError(service, error);
    }
    return this.saveLogin(service, login);
  }

  cancelConnect(service: TrackerService): void {
    this.logins.get(service)?.abort();
  }

  /** Connects with a token made elsewhere. */
  async setToken(service: TrackerService, token: string): Promise<TrackerInfo> {
    return this.saveLogin(service, { accessToken: token, refreshToken: null, expiresInSec: null });
  }

  private async saveLogin(service: TrackerService, login: TrackerLogin): Promise<TrackerInfo> {
    // Asking who this is proves the token works, and gives the name to show.
    let viewer;
    try {
      viewer = await this.deps.clients[service].viewer(login.accessToken);
    } catch (error) {
      throw this.toAppError(service, error);
    }
    this.deps.repo.saveAccount({
      service,
      userId: viewer.userId,
      username: viewer.username,
      tokenEncrypted: this.deps.secrets.seal(encode(login)),
      expiresAt: login.expiresInSec ? this.now() + login.expiresInSec * 1000 : null,
    });
    this.lastError.delete(service);
    this.deps.log?.(`${service}: connected as ${viewer.username}`);
    this.deps.repo.dueNow(this.now(), service);
    this.kick();
    return this.info(service);
  }

  /** Forgets the login and what was waiting for it; links to entries stay, to carry on after a new login. */
  disconnect(service: TrackerService): void {
    this.deps.repo.removeAccount(service);
    this.lastError.delete(service);
  }

  private credentials(account: AccountRow): Credentials | null {
    const text = this.deps.secrets.open(account.tokenEncrypted);
    return text === null ? null : decode(text);
  }

  /** A token that works now: the stored one, or a fresh one when it is about to run out. */
  private async accessToken(service: TrackerService): Promise<string> {
    const name = this.deps.clients[service].name;
    const account = this.deps.repo.account(service);
    if (!account) throw new AppError('tracker', `${name} is not connected (Settings → Tracking)`);
    const expired = new AppError('tracker', `The ${name} login has expired; connect again in Settings → Tracking`);
    const credentials = this.credentials(account);
    if (!credentials) throw expired;
    const due = account.expiresAt !== null && account.expiresAt - REFRESH_MARGIN_MS <= this.now();
    if (!due) return credentials.accessToken;
    if (credentials.refreshToken !== null && this.deps.clients[service].refresh) {
      return this.refreshLogin(service, credentials.refreshToken);
    }
    if (account.expiresAt! <= this.now()) throw expired;
    return credentials.accessToken;
  }

  /** One refresh at a time per tracker, however many requests ask for it. */
  private refreshLogin(service: TrackerService, refreshToken: string): Promise<string> {
    let pending = this.refreshes.get(service);
    if (!pending) {
      pending = this.renew(service, refreshToken).finally(() => this.refreshes.delete(service));
      this.refreshes.set(service, pending);
    }
    return pending;
  }

  private async renew(service: TrackerService, refreshToken: string): Promise<string> {
    try {
      const login = await this.deps.clients[service].refresh!(refreshToken);
      const account = this.deps.repo.account(service);
      if (account) {
        this.deps.repo.saveAccount({
          ...account,
          // Some trackers do not send a new refresh token: the old one keeps working.
          tokenEncrypted: this.deps.secrets.seal(
            encode({ accessToken: login.accessToken, refreshToken: login.refreshToken ?? refreshToken }),
          ),
          expiresAt: login.expiresInSec ? this.now() + login.expiresInSec * 1000 : null,
        });
      }
      this.deps.log?.(`${service}: login renewed`);
      return login.accessToken;
    } catch (error) {
      // The refresh token is no good either: only a new login helps.
      if (error instanceof TrackerAuthError) this.expire(service);
      throw error;
    }
  }

  /**
   * Runs a request with a working token. A token the tracker refuses is renewed once and the request
   * repeated; when that fails too the login is marked expired. Failures stay the tracker's own errors.
   */
  private async authed<T>(service: TrackerService, run: (token: string) => Promise<T>): Promise<T> {
    let token = await this.accessToken(service);
    try {
      return await run(token);
    } catch (error) {
      if (!(error instanceof TrackerAuthError)) throw error;
      const account = this.deps.repo.account(service);
      const credentials = account ? this.credentials(account) : null;
      if (credentials?.refreshToken && this.deps.clients[service].refresh) {
        token = await this.refreshLogin(service, credentials.refreshToken);
        try {
          return await run(token);
        } catch (again) {
          if (again instanceof TrackerAuthError) this.expire(service);
          throw again;
        }
      }
      this.expire(service);
      throw error;
    }
  }

  /** A request on behalf of the user, its failures as app errors. */
  private async call<T>(service: TrackerService, run: (token: string) => Promise<T>): Promise<T> {
    try {
      return await this.authed(service, run);
    } catch (error) {
      throw this.toAppError(service, error);
    }
  }

  private toAppError(service: TrackerService, error: unknown): Error {
    if (error instanceof AppError) return error;
    if (error instanceof TrackerAuthError) {
      return new AppError('tracker', `The ${this.deps.clients[service].name} login no longer works; connect again`);
    }
    if (error instanceof TrackerRateLimitError) return new AppError('rate_limited', error.message);
    if (error instanceof TrackerRequestError) return new AppError('tracker', error.message);
    return new AppError('network', error instanceof Error ? error.message : String(error));
  }

  /** The login no longer works: no more refreshing, until the next login. */
  private expire(service: TrackerService): void {
    const account = this.deps.repo.account(service);
    if (!account) return;
    const credentials = this.credentials(account);
    this.deps.repo.saveAccount({
      ...account,
      expiresAt: this.now(),
      tokenEncrypted: credentials
        ? this.deps.secrets.seal(encode({ accessToken: credentials.accessToken, refreshToken: null }))
        : account.tokenEncrypted,
    });
  }

  async search(service: TrackerService, query: string): Promise<TrackSearchResult[]> {
    return this.call(service, (token) => this.deps.clients[service].search(token, query));
  }

  // ------------------------------------------------------------ links

  tracks(mangaId: number): TrackEntry[] {
    const pending = this.deps.repo.pendingServices(mangaId);
    return this.deps.repo.tracksOf(mangaId).map((row) => toEntry(row, pending.has(row.service)));
  }

  /**
   * Links a manga to a tracker's entry. An entry the user already has keeps its status, score and
   * dates, and chapters read here that it does not have yet are sent; a new entry starts with what
   * was read (or "planning" when nothing was).
   */
  async link(input: {
    mangaId: number;
    service: TrackerService;
    remoteId: string;
    remoteUrl?: string | null;
    title?: string | null;
  }): Promise<TrackEntry> {
    const { mangaId, service, remoteId } = input;
    if (!this.deps.manga.get(mangaId)) throw new AppError('not_found', `Manga ${mangaId} not found`);
    const remote = await this.call(service, (token) => this.deps.clients[service].getEntry(token, remoteId));
    const read = this.deps.progress.highestRead(mangaId) ?? 0;
    const row: TrackRow = {
      mangaId,
      service,
      remoteId,
      remoteUrl: remote?.remoteUrl ?? input.remoteUrl ?? null,
      remoteTitle: remote?.remoteTitle ?? input.title ?? null,
      status: remote?.status ?? null,
      score: remote?.score ?? null,
      progress: remote?.progress ?? null,
      startedAt: remote?.startedAt ?? null,
      finishedAt: remote?.finishedAt ?? null,
      syncBack: this.deps.repo.track(mangaId, service)?.syncBack ?? true,
    };
    const patch: TrackPatch = {};
    if ((row.progress ?? 0) < read) patch.progress = row.progress = read;
    if (remote === null) {
      patch.status = row.status = read > 0 ? 'reading' : 'planning';
      if (read > 0) patch.startedAt = row.startedAt = this.now();
      patch.progress ??= row.progress = 0;
    } else if (patch.progress !== undefined && row.status !== 'completed') {
      patch.status = row.status = 'reading';
      if (row.startedAt === null) patch.startedAt = row.startedAt = this.now();
    }
    this.deps.repo.saveTrack(row);
    if (Object.keys(patch).length > 0) {
      this.deps.repo.enqueue(mangaId, service, patch, this.now());
      this.kick();
    }
    return toEntry(row, Object.keys(patch).length > 0);
  }

  unlink(mangaId: number, service: TrackerService): void {
    this.deps.repo.removeTrack(mangaId, service);
  }

  /** Edits from the tracking dialog: saved here at once, sent when the tracker can be reached. */
  update(mangaId: number, service: TrackerService, patch: TrackPatch): TrackEntry {
    const row = this.deps.repo.track(mangaId, service);
    if (!row) throw new AppError('not_found', 'This manga is not linked to that tracker');
    const next: TrackRow = { ...row };
    const sent: TrackPatch = {};
    for (const key of ['status', 'score', 'progress', 'startedAt', 'finishedAt'] as const) {
      if (patch[key] === undefined) continue;
      (next as Record<string, unknown>)[key] = patch[key];
      (sent as Record<string, unknown>)[key] = patch[key];
    }
    // Only kept here: whether the tracker's progress is followed for this manga.
    if (patch.syncBack !== undefined) next.syncBack = patch.syncBack;
    // Finishing a manga dates it, unless the user chose a date.
    if (
      patch.status === 'completed' &&
      row.status !== 'completed' &&
      patch.finishedAt === undefined &&
      !next.finishedAt
    ) {
      next.finishedAt = sent.finishedAt = this.now();
    }
    this.deps.repo.saveTrack(next);
    if (Object.keys(sent).length > 0) {
      this.deps.repo.enqueue(mangaId, service, sent, this.now());
      this.kick();
    }
    return toEntry(next, this.deps.repo.pendingServices(mangaId).has(service));
  }

  // ------------------------------------------------------------ reading

  /** Chapters were read: the linked entries move forward (never back). Called by the progress repository. */
  onChaptersRead(mangaId: number): void {
    if (this.deps.incognito()) return;
    const tracks = this.deps.repo.tracksOf(mangaId);
    if (tracks.length === 0) return;
    const read = this.deps.progress.highestRead(mangaId);
    if (read === null) return;
    for (const track of tracks) {
      if (!this.deps.repo.account(track.service) || (track.progress ?? 0) >= read) continue;
      const patch: TrackPatch = { progress: read };
      const next: TrackRow = { ...track, progress: read };
      // A finished manga stays finished (and keeps its dates) however far reading goes.
      if (track.status !== 'completed') {
        patch.status = next.status = 'reading';
        if (track.startedAt === null) patch.startedAt = next.startedAt = this.now();
      }
      this.deps.repo.saveTrack(next);
      this.deps.repo.enqueue(mangaId, track.service as TrackerService, patch, this.now());
    }
    this.kick();
  }

  // ------------------------------------------------------------ sync

  /**
   * Two-way sync (ADR 0038): sends what is queued, then compares each linked manga with its entry.
   * Chapters read on the tracker are marked read here (unless that is off for the tracker or the
   * manga) and a tracker that is behind gets an update; status, score and dates are taken over from
   * the tracker. One sync at a time.
   */
  sync(scope: { service?: TrackerService; mangaId?: number } = {}): Promise<SyncResult> {
    this.syncing ??= this.runSync(scope).finally(() => (this.syncing = null));
    return this.syncing;
  }

  /** A sync nobody asked for: it fails silently (offline, a login that expired) and tries again at the next trigger. */
  async syncQuietly(): Promise<void> {
    try {
      if (this.deps.isOnline()) await this.sync();
    } catch (error) {
      this.deps.log?.(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runSync(scope: { service?: TrackerService; mangaId?: number }): Promise<SyncResult> {
    if (!this.deps.isOnline()) throw new AppError('network', 'You are offline');
    await this.flush();
    const result: SyncResult = { checked: 0, readHere: 0, pushed: 0, failed: 0 };
    const paused = new Set<string>();
    for (const track of this.deps.repo.allTracks()) {
      const service = track.service as TrackerService;
      if (scope.service && scope.service !== service) continue;
      if (scope.mangaId !== undefined && scope.mangaId !== track.mangaId) continue;
      if (paused.has(service) || !this.deps.repo.account(service)) continue;
      result.checked++;
      try {
        const remote = await this.authed(service, (token) =>
          this.deps.clients[service].getEntry(token, track.remoteId),
        );
        if (!remote) continue;
        this.syncOne(track, remote, result);
      } catch (error) {
        // The tracker is not answering (or refuses the login): the rest of its manga wait for next time.
        paused.add(service);
        result.failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.lastError.set(service, message);
        this.deps.log?.(`${service}: sync of manga ${track.mangaId} failed: ${message}`);
      }
    }
    return result;
  }

  private syncOne(track: TrackRow, remote: RemoteEntry, result: SyncResult): void {
    const service = track.service as TrackerService;
    const current = this.deps.repo.track(track.mangaId, service) ?? track;
    const plan = reconcile({
      localRead: this.deps.progress.highestRead(track.mangaId) ?? 0,
      track: current,
      remote,
      pending: this.deps.repo.pendingServices(track.mangaId).has(service),
      now: this.now(),
    });
    const pull = current.syncBack && (this.deps.pullEnabled?.(service) ?? true);
    if (plan.readUpTo !== null && pull) {
      result.readHere += this.deps.progress.markReadUpTo(track.mangaId, plan.readUpTo);
    }
    // Chapters read here while incognito are not reported, so nothing is sent for them now either.
    const push = plan.push !== null && !this.deps.incognito() ? plan.push : null;
    if (push) {
      this.deps.repo.enqueue(track.mangaId, service, push, this.now());
      result.pushed++;
    }
    const adopt = { ...plan.adopt };
    if (plan.push && !push) {
      delete adopt.progress;
      delete adopt.status;
      delete adopt.startedAt;
    }
    if (Object.keys(adopt).length > 0 || remote.remoteTitle !== current.remoteTitle) {
      this.deps.repo.saveTrack({
        ...current,
        ...adopt,
        remoteTitle: remote.remoteTitle ?? current.remoteTitle,
        remoteUrl: remote.remoteUrl ?? current.remoteUrl,
      });
    }
    if (push) this.kick();
  }

  // ------------------------------------------------------------ queue

  start(): void {
    this.interval ??= setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    this.interval.unref?.();
    this.kick();
    // A while after the app opens, compare with the trackers (what was read elsewhere meanwhile).
    this.startTimer ??= setTimeout(() => void this.syncQuietly(), START_SYNC_MS);
    this.startTimer.unref?.();
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
    clearTimeout(this.kickTimer);
    this.kickTimer = undefined;
    clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  /** Sends what is waiting, soon (so a burst of changes goes out together). */
  private kick(): void {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = undefined;
      void this.flush();
    }, KICK_MS);
    this.kickTimer.unref?.();
  }

  /** Makes everything waiting due and sends it now (the retry button, the network coming back). */
  async retry(): Promise<void> {
    this.deps.repo.dueNow(this.now());
    await this.flush();
  }

  /** Sends the updates that are due. One run at a time. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run(): Promise<void> {
    if (!this.deps.isOnline()) return;
    /** Trackers that stopped answering in this run: their other updates wait too. */
    const paused = new Set<string>();
    for (const row of this.deps.repo.due(this.now())) {
      if (paused.has(row.service)) continue;
      const service = row.service as TrackerService;
      const track = this.deps.repo.track(row.mangaId, service);
      if (!track) {
        // Unlinked meanwhile.
        this.deps.repo.complete(row.id, row.payloadJson);
        continue;
      }
      try {
        const remote = await this.authed(service, (token) =>
          this.deps.clients[service].save(token, track.remoteId, JSON.parse(row.payloadJson) as TrackPatch),
        );
        this.deps.repo.complete(row.id, row.payloadJson);
        this.refreshTitle(track, remote);
        this.lastError.delete(service);
      } catch (error) {
        paused.add(row.service);
        const message = error instanceof Error ? error.message : String(error);
        this.lastError.set(service, message);
        this.deps.log?.(`${service}: update of manga ${row.mangaId} failed: ${message}`);
        if (error instanceof TrackerAuthError || (error instanceof AppError && error.code === 'tracker')) {
          // No login that works (already marked expired): kept for after the next login.
        } else if (error instanceof TrackerRateLimitError) {
          this.deps.repo.retryLater(row.id, row.attempts, this.now() + error.retryAfterMs);
        } else {
          this.deps.repo.retryLater(row.id, row.attempts + 1, this.now() + retryDelay(row.attempts + 1));
        }
      }
    }
  }

  /** What the tracker calls the entry may have changed; the fields we sent are already here. */
  private refreshTitle(track: TrackRow, remote: RemoteEntry): void {
    if (remote.remoteTitle === track.remoteTitle && remote.remoteUrl === track.remoteUrl) return;
    const current = this.deps.repo.track(track.mangaId, track.service);
    if (current) {
      this.deps.repo.saveTrack({
        ...current,
        remoteTitle: remote.remoteTitle ?? current.remoteTitle,
        remoteUrl: remote.remoteUrl ?? current.remoteUrl,
      });
    }
  }
}

function toEntry(row: TrackRow, pending: boolean): TrackEntry {
  return {
    mangaId: row.mangaId,
    service: row.service as TrackerService,
    remoteId: row.remoteId,
    remoteUrl: row.remoteUrl,
    remoteTitle: row.remoteTitle,
    status: row.status as TrackEntry['status'],
    score: row.score,
    progress: row.progress,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    pending,
    syncBack: row.syncBack,
  };
}
