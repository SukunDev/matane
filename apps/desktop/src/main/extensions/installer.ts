import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ExtensionArchive, checkArchiveHash, readExtensionArchive } from '@matane/extension-runtime/repo';
import { REPO_LIMITS, type RepoEntry } from '@matane/extension-sdk/repo';
import type { AvailableExtension, ExtensionEntry, InstallPreview, UpdateAllResult } from '@manga-reader/shared';
import { AppError, toAppErrorData } from '@manga-reader/shared/errors';
import { compareVersions } from '../app/updater';
import type { FetchBytes } from '../network/fetch-bytes';
import type { RepoService } from './repos';

/** A prepared install waits this long for the user's answer. */
const PREPARED_TTL_MS = 10 * 60_000;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

interface Prepared {
  preview: InstallPreview;
  archive: ExtensionArchive;
  expiresAt: number;
}

export interface InstallerDeps {
  /** `userData/extensions`: one folder per installed extension. */
  dir: string;
  repos: Pick<RepoService, 'list' | 'index' | 'fileUrl'>;
  fetchBytes: FetchBytes;
  extensions: {
    list(): ExtensionEntry[];
    /** Re-reads bundles for this id, drops its runtime and network state. */
    reload(extensionId: string): Promise<unknown>;
  };
  /** Which repository an installed extension came from. */
  origin: { get(extensionId: string): number | null; set(extensionId: string, repoId: number | null): void };
  /** Removes the extension's DB record; its storage and preferences go with it. */
  forget(extensionId: string): void;
  /** Clears the extension's session (cookies, cache, storage). */
  clearSession(extensionId: string): Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Installs, updates and uninstalls extensions from repositories (docs/BRAINSTORM.md §5.8, ADR 0023).
 * Two steps: `prepare` downloads the archive and checks it against the signed index (sha256,
 * contents, manifest) for the install dialog; `install` then writes it atomically.
 */
export class ExtensionInstaller {
  private readonly prepared = new Map<string, Prepared>();
  private readonly busy = new Set<string>();

  constructor(private readonly deps: InstallerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Finishes or undoes an install the app was closed in the middle of. */
  async recover(): Promise<void> {
    const names = await readdir(this.deps.dir).catch((): string[] => []);
    for (const name of names) {
      const path = join(this.deps.dir, name);
      if (name.endsWith('.tmp')) await rm(path, { recursive: true, force: true });
      if (name.endsWith('.old')) {
        const target = join(this.deps.dir, name.slice(0, -4));
        if (await exists(target)) await rm(path, { recursive: true, force: true });
        else await rename(path, target);
      }
    }
  }

  /** What every repository offers, with what is installed. */
  available(): AvailableExtension[] {
    const installed = new Map(this.deps.extensions.list().map((e) => [e.id, e]));
    const result: AvailableExtension[] = [];
    for (const repo of this.deps.repos.list()) {
      const index = this.deps.repos.index(repo.id);
      for (const entry of index?.extensions ?? []) {
        const current = installed.get(entry.id);
        const installedHere = current?.origin === 'repo' && current.repoId === repo.id;
        result.push({
          repoId: repo.id,
          repoName: repo.name,
          trust: repo.trust,
          id: entry.id,
          name: entry.name,
          version: entry.version,
          description: entry.description ?? null,
          nsfw: entry.nsfw,
          langs: entry.langs,
          size: entry.size,
          hasIcon: entry.icon !== null,
          installedVersion: current?.version ?? null,
          installedHere,
          update: installedHere && compareVersions(entry.version, current.version) > 0,
        });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.repoName.localeCompare(b.repoName));
  }

  /** Downloads and verifies an extension; nothing changes until `install(token)`. */
  async prepare(repoId: number, extensionId: string): Promise<InstallPreview> {
    this.dropExpired();
    const repo = this.deps.repos.list().find((r) => r.id === repoId);
    const entry = this.deps.repos.index(repoId)?.extensions.find((e) => e.id === extensionId);
    if (!repo || !entry) throw new AppError('not_found', `${extensionId} is not in this repository`);

    const current = this.deps.extensions.list().find((e) => e.id === extensionId && e.origin === 'repo');
    const from = this.deps.origin.get(extensionId);
    // Updates only come from the repository an extension was installed from (§5.8).
    if (current && from !== null && from !== repoId) {
      throw new AppError('repo', `${entry.name} is installed from another repository; uninstall it first`);
    }

    const bytes = await this.deps.fetchBytes(this.deps.repos.fileUrl(repoId, entry.file), {
      maxBytes: Math.min(entry.size, REPO_LIMITS.archiveBytes),
      timeoutMs: 120_000,
    });
    if (!bytes) throw new AppError('repo', `${entry.file} is missing from the repository`);
    const archive = await this.verify(entry, bytes);

    const token = randomUUID();
    const preview: InstallPreview = {
      token,
      repoId,
      repoName: repo.name,
      trust: repo.trust,
      id: entry.id,
      name: entry.name,
      version: entry.version,
      apiVersion: entry.apiVersion,
      nsfw: entry.nsfw,
      langs: entry.langs,
      size: entry.size,
      sha256: entry.sha256,
      currentVersion: current?.version ?? null,
      hasIcon: entry.icon !== null,
    };
    this.prepared.set(token, { preview, archive, expiresAt: this.now() + PREPARED_TTL_MS });
    return preview;
  }

  cancel(token: string): void {
    this.prepared.delete(token);
  }

  async install(token: string): Promise<ExtensionEntry> {
    this.dropExpired();
    const prepared = this.prepared.get(token);
    if (!prepared) throw new AppError('repo', 'This install expired; start it again');
    this.prepared.delete(token);
    const { preview, archive } = prepared;
    return this.exclusive(preview.id, async () => {
      await this.write(preview.id, archive);
      this.deps.log?.(`installed ${preview.id} ${preview.version} from ${preview.repoName}`);
      await this.deps.extensions.reload(preview.id);
      this.deps.origin.set(preview.id, preview.repoId);
      const entry = this.deps.extensions.list().find((e) => e.id === preview.id);
      if (!entry) throw new AppError('extension', `${preview.id} was installed but did not load`);
      return entry;
    });
  }

  /** Installs every available update. */
  async updateAll(): Promise<UpdateAllResult> {
    const result: UpdateAllResult = { updated: [], failed: [] };
    for (const item of this.available().filter((a) => a.update)) {
      try {
        const preview = await this.prepare(item.repoId, item.id);
        await this.install(preview.token);
        result.updated.push(item.id);
      } catch (error) {
        result.failed.push({ id: item.id, message: toAppErrorData(error).message });
      }
    }
    return result;
  }

  /**
   * Removes an installed extension with its storage, preferences and session. Its sources stay,
   * so library entries are shown as "source not installed" (§5.8).
   */
  async uninstall(extensionId: string): Promise<void> {
    const folder = join(this.deps.dir, extensionId);
    if (!(await exists(folder))) {
      throw new AppError('not_installed', `${extensionId} is not installed from a repository`);
    }
    await this.exclusive(extensionId, async () => {
      const old = `${folder}.old`;
      await rm(old, { recursive: true, force: true });
      await rename(folder, old);
      // Drops the runtime and network state; a built-in with the same id takes over, if any.
      await this.deps.extensions.reload(extensionId);
      this.deps.forget(extensionId);
      await this.deps
        .clearSession(extensionId)
        .catch((error: unknown) =>
          this.deps.log?.(`clearing the session of ${extensionId}: ${toAppErrorData(error).message}`),
        );
      await rm(old, { recursive: true, force: true });
      // What is still there (a built-in or dev copy) gets its record back.
      await this.deps.extensions.reload(extensionId);
      this.deps.log?.(`uninstalled ${extensionId}`);
    });
  }

  private async verify(entry: RepoEntry, bytes: Buffer): Promise<ExtensionArchive> {
    try {
      checkArchiveHash(entry, bytes);
      return await readExtensionArchive(bytes, entry);
    } catch (error) {
      throw new AppError('repo', (error as Error).message);
    }
  }

  /** `<id>.tmp` → (`<id>` → `<id>.old`) → `<id>`: an interrupted install never leaves half a bundle. */
  private async write(id: string, archive: ExtensionArchive): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    const target = join(this.deps.dir, id);
    const tmp = `${target}.tmp`;
    const old = `${target}.old`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp);
    for (const [name, bytes] of Object.entries(archive.files)) await writeFile(join(tmp, name), bytes);
    await rm(old, { recursive: true, force: true });
    if (await exists(target)) await rename(target, old);
    await rename(tmp, target);
    await rm(old, { recursive: true, force: true });
  }

  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new AppError('repo', `${id} is already being installed or removed`);
    this.busy.add(id);
    try {
      return await work();
    } finally {
      this.busy.delete(id);
    }
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [token, prepared] of this.prepared) if (prepared.expiresAt < now) this.prepared.delete(token);
  }
}
