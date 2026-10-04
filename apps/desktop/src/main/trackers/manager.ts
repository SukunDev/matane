import {
  TRACKER_SERVICES,
  type TrackEntry,
  type TrackPatch,
  type TrackSearchResult,
  type TrackerInfo,
  type TrackerService,
} from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { TrackRow, TrackersRepository } from '../db/repositories/trackers';
import type { LoginResult } from './oauth';
import type { SecretBox } from './secret';
import {
  type RemoteEntry,
  type TrackerClient,
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

export interface TrackerManagerDeps {
  repo: TrackersRepository;
  clients: Record<TrackerService, TrackerClient>;
  secrets: SecretBox;
  /** Whether an app registration (client id) exists for the tracker. */
  configured: (service: TrackerService) => boolean;
  /** The address to register as the app's redirect URL. */
  redirectUrl: (service: TrackerService) => string;
  /** Logs in through the browser. */
  login: (service: TrackerService, signal: AbortSignal) => Promise<LoginResult>;
  manga: { get(id: number): { id: number } | undefined };
  /** Chapters read of a manga, as a tracker counts them (null: none read). */
  progress: { highestRead(mangaId: number): number | null };
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
  private flushing: Promise<void> | null = null;
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
      const connected = account !== undefined && this.deps.secrets.open(account.tokenEncrypted) !== null;
      return {
        service,
        name: this.deps.clients[service].name,
        configured: this.deps.configured(service),
        connected,
        username: account?.username ?? null,
        expired:
          account !== undefined && (!connected || (account.expiresAt !== null && account.expiresAt <= this.now())),
        encrypted: account ? this.deps.secrets.isEncrypted(account.tokenEncrypted) : null,
        queued: this.deps.repo.queued(service),
        lastError: this.lastError.get(service) ?? null,
        redirectUrl: this.deps.redirectUrl(service),
      };
    });
  }

  private info(service: TrackerService): TrackerInfo {
    return this.list().find((i) => i.service === service)!;
  }

  async connect(service: TrackerService): Promise<TrackerInfo> {
    if (!this.deps.configured(service)) {
      throw new AppError('tracker', `${this.deps.clients[service].name} has no app registration in this build`);
    }
    this.logins.get(service)?.abort();
    const controller = new AbortController();
    this.logins.set(service, controller);
    try {
      const login = await this.deps.login(service, controller.signal);
      return await this.saveLogin(service, login.accessToken, login.expiresInSec);
    } finally {
      if (this.logins.get(service) === controller) this.logins.delete(service);
    }
  }

  cancelConnect(service: TrackerService): void {
    this.logins.get(service)?.abort();
  }

  /** Connects with a token made elsewhere. */
  async setToken(service: TrackerService, token: string): Promise<TrackerInfo> {
    return this.saveLogin(service, token, null);
  }

  private async saveLogin(service: TrackerService, token: string, expiresInSec: number | null): Promise<TrackerInfo> {
    // Asking who this is proves the token works, and gives the name to show.
    const viewer = await this.call(service, () => this.deps.clients[service].viewer(token));
    this.deps.repo.saveAccount({
      service,
      userId: viewer.userId,
      username: viewer.username,
      tokenEncrypted: this.deps.secrets.seal(token),
      expiresAt: expiresInSec ? this.now() + expiresInSec * 1000 : null,
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

  /** The token, or why there is none. */
  private token(service: TrackerService): string {
    const name = this.deps.clients[service].name;
    const account = this.deps.repo.account(service);
    if (!account) throw new AppError('tracker', `${name} is not connected (Settings → Tracking)`);
    const token = this.deps.secrets.open(account.tokenEncrypted);
    if (token === null || (account.expiresAt !== null && account.expiresAt <= this.now())) {
      throw new AppError('tracker', `The ${name} login has expired; connect again in Settings → Tracking`);
    }
    return token;
  }

  /** One request to a tracker, its failures as app errors (and a refused token marks the login expired). */
  private async call<T>(service: TrackerService, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw this.toAppError(service, error);
    }
  }

  private toAppError(service: TrackerService, error: unknown): Error {
    if (error instanceof AppError) return error;
    if (error instanceof TrackerAuthError) {
      this.expire(service);
      return new AppError('tracker', `The ${this.deps.clients[service].name} login no longer works; connect again`);
    }
    if (error instanceof TrackerRateLimitError) return new AppError('rate_limited', error.message);
    if (error instanceof TrackerRequestError) return new AppError('tracker', error.message);
    return new AppError('network', error instanceof Error ? error.message : String(error));
  }

  private expire(service: TrackerService): void {
    const account = this.deps.repo.account(service);
    if (account) this.deps.repo.saveAccount({ ...account, expiresAt: this.now() });
  }

  async search(service: TrackerService, query: string): Promise<TrackSearchResult[]> {
    const token = this.token(service);
    return this.call(service, () => this.deps.clients[service].search(token, query));
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
    const token = this.token(service);
    const remote = await this.call(service, () => this.deps.clients[service].getEntry(token, remoteId));
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
    return toEntry(next, true);
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

  // ------------------------------------------------------------ queue

  start(): void {
    this.interval ??= setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    this.interval.unref?.();
    this.kick();
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
    clearTimeout(this.kickTimer);
    this.kickTimer = undefined;
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
      const account = this.deps.repo.account(service);
      const token = account ? this.deps.secrets.open(account.tokenEncrypted) : null;
      if (!track) {
        // Unlinked meanwhile.
        this.deps.repo.complete(row.id, row.payloadJson);
        continue;
      }
      if (!account || token === null || (account.expiresAt !== null && account.expiresAt <= this.now())) {
        // Nothing to send with: kept for after the next login.
        paused.add(row.service);
        if (account) this.lastError.set(service, 'The login has expired; connect again');
        continue;
      }
      try {
        const remote = await this.deps.clients[service].save(
          token,
          track.remoteId,
          JSON.parse(row.payloadJson) as TrackPatch,
        );
        this.deps.repo.complete(row.id, row.payloadJson);
        this.refreshTitle(track, remote);
        this.lastError.delete(service);
      } catch (error) {
        paused.add(row.service);
        const message = error instanceof Error ? error.message : String(error);
        this.lastError.set(service, message);
        this.deps.log?.(`${service}: update of manga ${row.mangaId} failed: ${message}`);
        if (error instanceof TrackerAuthError) {
          this.expire(service);
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
  };
}
