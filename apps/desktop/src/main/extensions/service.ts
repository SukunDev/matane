import { resolve } from 'node:path';
import type { HttpRequest, HttpResponse, Preference } from '@manga-reader/extension-sdk';
import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';
import type { ExtensionEntry } from '@manga-reader/shared';
import { AppError, toAppErrorData } from '@manga-reader/shared/errors';
import type { ExtensionsRepository } from '../db/repositories/extensions';
import { sourceIdOf } from '../db/repositories/extensions';
import type { HostMethods, MainMethods } from '../../extension-host/protocol';
import type { RpcHandlers, RpcPeer } from '../../extension-host/rpc';
import type { ExtensionRegistry, RegisteredExtension } from './registry';

export type HostCaller = Pick<RpcPeer<MainMethods, HostMethods>, 'request'>;

export interface ExtensionNetwork {
  request(manifest: ExtensionManifest, request: HttpRequest): Promise<HttpResponse>;
  invalidate(extensionId: string): void;
  /** True while a Cloudflare challenge for this extension is being solved. */
  isSolving(extensionId: string): boolean;
}

export interface ExtensionServiceDeps {
  registry: ExtensionRegistry;
  repo: ExtensionsRepository;
  host: HostCaller;
  network: ExtensionNetwork;
  devFolders: { get(): string[]; set(folders: string[]): void };
  log(extensionId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
  /** The developer log panel: the extension's own lines, failed calls and HTTP traffic. */
  record?(
    extensionId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    kind: 'log' | 'call' | 'http',
    message: string,
  ): void;
  /** Longest main waits for the host (the runtime enforces its own, tighter limits). */
  hostTimeoutMs?: number;
  /** Called with the ids whose runtimes were dropped by a reload. */
  onReload?: (extensionIds: string[]) => void;
}

/** Races a promise against an AbortSignal (the host keeps working; the result is dropped). */
export function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AppError('cancelled', 'Request cancelled'));
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(new AppError('cancelled', 'Request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolvePromise(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Installed extensions: discovery, DB records, and calls into the sandbox. */
export class ExtensionService {
  constructor(private readonly deps: ExtensionServiceDeps) {}

  /** What the extension host may ask of main. */
  readonly mainHandlers: RpcHandlers<MainMethods> = {
    getExtension: ({ extensionId }) => {
      const entry = this.require(extensionId);
      return { code: entry.code, manifest: entry.manifest };
    },
    http: async ({ extensionId, request }) => {
      const manifest = this.require(extensionId).manifest;
      const started = Date.now();
      const what = `${request.method ?? 'GET'} ${request.url}`;
      try {
        const response = await this.deps.network.request(manifest, request);
        const level = response.status >= 400 ? 'warn' : 'debug';
        this.deps.record?.(extensionId, level, 'http', `${what} → ${response.status} (${Date.now() - started} ms)`);
        return response;
      } catch (error) {
        this.deps.record?.(extensionId, 'error', 'http', `${what} failed: ${toAppErrorData(error).message}`);
        throw error;
      }
    },
    storage: ({ extensionId, op, key, value }) => {
      this.require(extensionId);
      if (op === 'get') return this.deps.repo.getStorage(extensionId, key);
      if (op === 'set') this.deps.repo.setStorage(extensionId, key, value);
      else this.deps.repo.removeStorage(extensionId, key);
      return null;
    },
    log: ({ extensionId, level, message }) => {
      this.deps.log(extensionId, level, message);
      this.deps.record?.(extensionId, level, 'log', message);
    },
  };

  async init(): Promise<ExtensionEntry[]> {
    await this.deps.registry.load();
    for (const entry of this.deps.registry.list()) if (entry.manifest) this.deps.repo.upsert(entry.manifest);
    return this.list();
  }

  list(): ExtensionEntry[] {
    const rows = new Map(this.deps.repo.list().map((row) => [row.id, row]));
    return this.deps.registry.list().map((entry) => {
      const row = rows.get(entry.id);
      return this.toEntry(entry, row?.enabled ?? true, entry.origin === 'repo' ? (row?.repoId ?? null) : null);
    });
  }

  get(extensionId: string): RegisteredExtension | undefined {
    return this.deps.registry.get(extensionId);
  }

  isInstalled(extensionId: string): boolean {
    const entry = this.deps.registry.get(extensionId);
    return entry !== undefined && entry.error === null;
  }

  /** Reloads one extension (or all): re-reads bundles, drops runtimes and network state. */
  async reload(extensionId?: string): Promise<ExtensionEntry[]> {
    const before = this.deps.registry.list().map((e) => e.id);
    await this.deps.registry.load();
    const ids = extensionId ? [extensionId] : [...new Set([...before, ...this.deps.registry.list().map((e) => e.id)])];
    for (const id of ids) {
      this.deps.network.invalidate(id);
      await this.deps.host.request('unload', { extensionId: id }).catch(() => undefined);
      const manifest = this.deps.registry.get(id)?.manifest;
      if (manifest) this.deps.repo.upsert(manifest);
    }
    this.deps.onReload?.(ids);
    return this.list();
  }

  async addDevFolder(path: string): Promise<ExtensionEntry> {
    const folder = resolve(path);
    const folders = this.deps.devFolders.get();
    if (!folders.includes(folder)) this.deps.devFolders.set([...folders, folder]);
    await this.reload();
    const entry = this.list().find((e) => e.origin === 'dev' && e.path === folder);
    if (!entry) throw new AppError('extension', `No extension found in ${folder}`);
    return entry;
  }

  async removeDevFolder(path: string): Promise<void> {
    const folder = resolve(path);
    this.deps.devFolders.set(this.deps.devFolders.get().filter((f) => f !== folder));
    await this.reload();
  }

  /**
   * Calls a Source method (or `__info`/`__preferences`) inside the sandbox. `parse` validates the
   * answer; failed calls and invalid answers go to the extension's log.
   */
  async call<T = unknown>(
    extensionId: string,
    sourceKey: string,
    method: string,
    args: unknown[] = [],
    signal?: AbortSignal,
    parse?: (value: unknown) => T,
  ): Promise<T> {
    this.require(extensionId);
    const pending = this.deps.host.request(
      'call',
      { extensionId, sourceKey, method, args, prefs: this.deps.repo.getPrefs(extensionId) },
      { timeoutMs: this.deps.hostTimeoutMs ?? 90_000 },
    );
    try {
      const value = await withSignal(pending, signal);
      return parse ? parse(value) : (value as T);
    } catch (error) {
      const data = toAppErrorData(error);
      if (data.code !== 'cancelled') {
        this.deps.record?.(
          extensionId,
          'error',
          'call',
          `${method}${sourceKey ? ` (${sourceKey})` : ''}: ${data.message}`,
        );
      }
      // A call that timed out while Cloudflare was being solved is really a Cloudflare problem.
      if (error instanceof AppError && error.code === 'timeout' && this.deps.network.isSolving(extensionId)) {
        throw new AppError('cloudflare', 'Waiting for the Cloudflare check to be completed');
      }
      throw error;
    }
  }

  async preferences(extensionId: string): Promise<{ definitions: Preference[]; values: Record<string, unknown> }> {
    const definitions = await this.call<Preference[]>(extensionId, '', '__preferences');
    const stored = this.deps.repo.getPrefs(extensionId);
    const values = Object.fromEntries(definitions.map((p) => [p.key, p.key in stored ? stored[p.key] : p.default]));
    return { definitions, values };
  }

  setPreference(extensionId: string, key: string, value: unknown): void {
    this.require(extensionId);
    this.deps.repo.setPref(extensionId, key, value);
  }

  private require(extensionId: string): RegisteredExtension & { manifest: ExtensionManifest; code: string } {
    const entry = this.deps.registry.get(extensionId);
    if (!entry) throw new AppError('not_installed', `Extension ${extensionId} is not installed`);
    if (!entry.manifest || entry.code === null) {
      throw new AppError('extension', `Extension ${extensionId} failed to load: ${entry.error ?? 'unknown error'}`);
    }
    return entry as RegisteredExtension & { manifest: ExtensionManifest; code: string };
  }

  private toEntry(entry: RegisteredExtension, enabled: boolean, repoId: number | null): ExtensionEntry {
    const manifest = entry.manifest;
    return {
      id: entry.id,
      name: manifest?.name ?? entry.id,
      version: manifest?.version ?? '?',
      apiVersion: manifest?.apiVersion ?? 0,
      description: manifest?.description ?? null,
      nsfw: manifest?.nsfw ?? false,
      enabled,
      origin: entry.origin,
      path: entry.path,
      error: entry.error,
      sourceIds: manifest?.sources.map((s) => sourceIdOf(entry.id, s.key)) ?? [],
      langs: [...new Set(manifest?.sources.map((s) => s.lang) ?? [])].sort(),
      domains: manifest?.domains ?? [],
      repoId,
      hasIcon: entry.iconPath !== null,
    };
  }
}
