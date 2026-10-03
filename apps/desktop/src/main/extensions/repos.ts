import { REPO_INDEX_FILE, REPO_LIMITS, REPO_SIGNATURE_FILE, type RepoIndex } from '@matane/extension-sdk/repo';
import { RepoError, parseRepoIndex, verifyIndexSignature } from '@matane/extension-runtime/repo';
import type { AddRepoResult, RepoInfo, RepoSignatureProblem, RepoTrust } from '@manga-reader/shared';
import { AppError, toAppErrorData } from '@manga-reader/shared/errors';
import type { RepoRow, ReposRepository } from '../db/repositories/repos';
import type { FetchBytes } from '../network/fetch-bytes';

/** By default, repositories are synced when their index is older than this (and the app is online). */
export const REPO_SYNC_INTERVAL_MS = 24 * 3_600_000;
const SCHEDULE_TICK_MS = 3_600_000;
const FIRST_TICK_MS = 15_000;

const LOOPBACK = /^(localhost|[\w-]+\.localhost|127\.0\.0\.1|\[::1\])$/i;

/**
 * The base URL of a repository from what the user typed: HTTPS only (plain HTTP just for loopback,
 * i.e. development and tests), no query, a trailing "/", and a pasted `…/index.json` is fine too.
 */
export function normalizeRepoUrl(input: string): string {
  let text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError('repo', `Not a URL: ${input}`);
  }
  if (url.protocol === 'http:' && !LOOPBACK.test(url.hostname)) {
    throw new AppError('repo', 'Repositories must use HTTPS');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError('repo', 'Repositories must use HTTPS');
  if (url.username || url.password) throw new AppError('repo', 'Repository URLs cannot contain a login');
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/index\.json$/, '/');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export interface TrustResult {
  trust: RepoTrust;
  problem: RepoSignatureProblem | null;
  /** The key that made a valid signature (the trusted one, or the one named in the index). */
  signedBy: string | null;
}

/**
 * Trust of an index (BRAINSTORM.md §5.8): trusted when the key the user trusted for this repository
 * signed it, otherwise unverified — with the reason, and the signer when the index's own key made a
 * valid signature (so the user can choose to trust it).
 */
export function evaluateTrust(
  indexBytes: Uint8Array,
  signature: string | null,
  keys: { trusted: string | null; named: string | undefined },
): TrustResult {
  if (!signature) return { trust: 'unverified', problem: 'unsigned', signedBy: null };
  const valid = (key: string) => {
    try {
      return verifyIndexSignature(indexBytes, signature, key);
    } catch {
      return false;
    }
  };
  if (keys.trusted && valid(keys.trusted)) return { trust: 'trusted', problem: null, signedBy: keys.trusted };
  if (keys.named && valid(keys.named)) return { trust: 'unverified', problem: 'unknown-key', signedBy: keys.named };
  return { trust: 'unverified', problem: 'bad-signature', signedBy: null };
}

interface Fetched {
  text: string;
  bytes: Buffer;
  signature: string | null;
  index: RepoIndex;
}

export interface RepoServiceDeps {
  repo: ReposRepository;
  fetchBytes: FetchBytes;
  isOnline: () => boolean;
  /** How old an index may get before the schedule syncs it (default a day; a setting). */
  intervalMs?: () => number;
  /** After a repository synced successfully (e.g. to install updates by themselves). */
  onSynced?: (repoId: number) => void;
  now?: () => number;
  log?: (message: string) => void;
}

/** Extension repositories: adding, syncing their signed index, trust (BRAINSTORM.md §5.8, ADR 0022). */
export class RepoService {
  private readonly parsed = new Map<number, { text: string; index: RepoIndex }>();
  private readonly syncing = new Map<number, Promise<void>>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly deps: RepoServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  list(): RepoInfo[] {
    return this.deps.repo.list().map((row) => this.info(row));
  }

  get(repoId: number): RepoInfo {
    return this.info(this.row(repoId));
  }

  /** The last accepted index (null before the first successful sync). */
  index(repoId: number): RepoIndex | null {
    const row = this.row(repoId);
    return row.indexJson === null ? null : this.parse(row.id, row.indexJson);
  }

  /** Absolute URL of a file listed in the repository's index. */
  fileUrl(repoId: number, file: string): string {
    return new URL(file, this.row(repoId).url).toString();
  }

  async add(input: string, confirmUnverified = false): Promise<AddRepoResult> {
    const url = normalizeRepoUrl(input);
    if (this.deps.repo.byUrl(url)) throw new AppError('repo', 'This repository is already added');
    const fetched = await this.fetchIndex(url);
    const trust = this.trustOf(fetched.bytes, fetched.signature, null, fetched.index);
    if (trust.trust === 'unverified' && !confirmUnverified) {
      return {
        status: 'needs-confirmation',
        name: fetched.index.name,
        extensionCount: fetched.index.extensions.length,
        problem: trust.problem,
      };
    }
    const row = this.deps.repo.insert({
      url,
      name: fetched.index.name,
      publicKey: null,
      indexJson: fetched.text,
      signature: fetched.signature,
      lastFetchedAt: this.now(),
      lastError: null,
    });
    return { status: 'added', repo: this.info(row) };
  }

  remove(repoId: number): void {
    this.row(repoId);
    this.deps.repo.remove(repoId);
    this.parsed.delete(repoId);
  }

  /** Trusts the key that signed the current index: later indexes must be signed by it. */
  trustKey(repoId: number): RepoInfo {
    const info = this.get(repoId);
    if (info.trust !== 'unverified') return info;
    if (info.problem !== 'unknown-key' || !info.signedBy) {
      throw new AppError('repo', 'This repository has no valid signature, so there is no key to trust');
    }
    this.deps.repo.update(repoId, { publicKey: info.signedBy });
    return this.get(repoId);
  }

  /** Syncs one repository (or all); failures are recorded on the repository, not thrown. */
  async sync(repoId?: number): Promise<RepoInfo[]> {
    const rows = repoId === undefined ? this.deps.repo.list() : [this.row(repoId)];
    await Promise.all(rows.map((row) => this.syncOne(row.id)));
    return this.list();
  }

  /** Syncs stale repositories now and then (only online). */
  start(): void {
    const tick = () => {
      if (!this.deps.isOnline()) return;
      const stale = this.deps.repo
        .list()
        .filter((row) => row.lastFetchedAt === null || this.now() - row.lastFetchedAt >= this.interval());
      for (const row of stale) void this.syncOne(row.id);
    };
    const first = setTimeout(tick, FIRST_TICK_MS);
    const every = setInterval(tick, SCHEDULE_TICK_MS);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  private interval(): number {
    return this.deps.intervalMs?.() ?? REPO_SYNC_INTERVAL_MS;
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private syncOne(repoId: number): Promise<void> {
    const running = this.syncing.get(repoId);
    if (running) return running;
    const work = this.doSync(repoId).finally(() => this.syncing.delete(repoId));
    this.syncing.set(repoId, work);
    return work;
  }

  private async doSync(repoId: number): Promise<void> {
    const row = this.deps.repo.get(repoId);
    if (!row) return;
    try {
      const fetched = await this.fetchIndex(row.url);
      const next = this.trustOf(fetched.bytes, fetched.signature, row.publicKey, fetched.index);
      const previous = this.info(row).trust;
      // A signed repository never silently turns into an unsigned or differently signed one.
      if (previous !== 'unverified' && next.trust === 'unverified') {
        throw new AppError(
          'repo',
          'The new index is not signed with the key this repository is trusted with; the previous one is kept',
        );
      }
      this.deps.repo.update(repoId, {
        name: fetched.index.name,
        indexJson: fetched.text,
        signature: fetched.signature,
        lastFetchedAt: this.now(),
        lastError: null,
      });
      this.deps.onSynced?.(repoId);
    } catch (error) {
      const { message } = toAppErrorData(error);
      this.deps.log?.(`sync ${row.url}: ${message}`);
      this.deps.repo.update(repoId, { lastError: message });
    }
  }

  private async fetchIndex(url: string): Promise<Fetched> {
    const bytes = await this.deps.fetchBytes(new URL(REPO_INDEX_FILE, url).toString(), {
      maxBytes: REPO_LIMITS.indexBytes,
    });
    if (!bytes) throw new AppError('repo', `No ${REPO_INDEX_FILE} at ${url}`);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AppError('repo', `${REPO_INDEX_FILE} is not UTF-8`);
    }
    let index: RepoIndex;
    try {
      index = parseRepoIndex(bytes);
    } catch (error) {
      throw new AppError('repo', error instanceof RepoError ? error.message : String(error));
    }
    const signatureBytes = await this.deps.fetchBytes(new URL(REPO_SIGNATURE_FILE, url).toString(), {
      maxBytes: 1024,
    });
    return { text, bytes, index, signature: signatureBytes ? signatureBytes.toString('utf8').trim() || null : null };
  }

  private trustOf(bytes: Uint8Array, signature: string | null, trusted: string | null, index: RepoIndex): TrustResult {
    return evaluateTrust(bytes, signature, { trusted, named: index.publicKey });
  }

  private parse(repoId: number, text: string): RepoIndex {
    const cached = this.parsed.get(repoId);
    if (cached?.text === text) return cached.index;
    const index = parseRepoIndex(Buffer.from(text, 'utf8'));
    this.parsed.set(repoId, { text, index });
    return index;
  }

  private info(row: RepoRow): RepoInfo {
    const index = row.indexJson === null ? null : this.parse(row.id, row.indexJson);
    const trust: TrustResult = index
      ? this.trustOf(Buffer.from(row.indexJson!, 'utf8'), row.signature, row.publicKey, index)
      : { trust: 'unverified', problem: null, signedBy: null };
    return {
      id: row.id,
      url: row.url,
      name: row.name ?? row.url,
      ...trust,
      extensionCount: index?.extensions.length ?? 0,
      synced: index !== null,
      lastSyncedAt: row.lastFetchedAt,
      lastError: row.lastError,
    };
  }

  private row(repoId: number): RepoRow {
    const row = this.deps.repo.get(repoId);
    if (!row) throw new AppError('not_found', `Repository ${repoId} does not exist`);
    return row;
  }
}
