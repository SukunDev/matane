import { ExtensionRuntime, ExtensionRuntimeError, type HostApi, HostError } from '@matane/extension-runtime';
import { type Preference, SDK_API_VERSION } from '@matane/extension-sdk';
import { AppError, type AppErrorCode, codeForExtensionError } from '@manga-reader/shared/errors';
import type { HostInfo, HostMethods, MainMethods } from './protocol';
import type { RpcHandlers, RpcPeer } from './rpc';

type MainRequester = Pick<RpcPeer<HostMethods, MainMethods>, 'request'>;

interface Entry {
  runtime: ExtensionRuntime;
  prefDefaults: Record<string, unknown>;
  lastUsed: number;
  active: number;
}

// What the extension sees when a host call fails: SDK error names (BRAINSTORM.md §5.5).
const SDK_ERROR_NAMES: Partial<Record<AppErrorCode, string>> = {
  cloudflare: 'CloudflareError',
  rate_limited: 'RateLimitedError',
  not_found: 'NotFoundError',
  http: 'HttpError',
};

function toHostError(error: unknown): HostError {
  if (error instanceof AppError) {
    return new HostError(SDK_ERROR_NAMES[error.code] ?? 'NetworkError', error.message, error.status);
  }
  return new HostError('NetworkError', error instanceof Error ? error.message : String(error));
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ExtensionRuntimeError) {
    if (error.code === 'extension') {
      const inner = error.extensionError;
      return new AppError(codeForExtensionError(inner?.name), inner?.message ?? error.message, inner?.status);
    }
    return new AppError(error.code === 'disposed' ? 'cancelled' : error.code, error.message);
  }
  return new AppError('unknown', error instanceof Error ? error.message : String(error));
}

/**
 * Lives in the extension host process: one QuickJS runtime per extension, loaded on first use and
 * disposed after sitting idle. Everything privileged (network, storage) is delegated back to main.
 */
export class ExtensionHost {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<Entry>>();

  constructor(
    private readonly main: MainRequester,
    private readonly info: HostInfo,
    private readonly idleMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  readonly handlers: RpcHandlers<HostMethods> = {
    call: (params) => this.call(params),
    transformImage: ({ extensionId, sourceKey, page, bytes, prefs }) =>
      this.run(extensionId, prefs, (runtime, options) =>
        runtime.transformImage(sourceKey, page, Uint8Array.from(bytes), options),
      ),
    migrateUrls: ({ extensionId, sourceKey, items, fromVersion, prefs }) =>
      this.run(extensionId, prefs, (runtime, options) => runtime.migrateUrls(sourceKey, items, fromVersion, options)),
    unload: ({ extensionId }) => this.unload(extensionId),
    stats: () =>
      [...this.entries].map(([extensionId, entry]) => ({ extensionId, memoryBytes: entry.runtime.memoryUsage() })),
  };

  call({ extensionId, sourceKey, method, args, prefs }: Parameters<HostMethods['call']>[0]): Promise<unknown> {
    return this.run(extensionId, prefs, (runtime, options) => runtime.call(sourceKey, method, args, options));
  }

  /** Runs `work` on the extension's runtime (loaded on demand) with its preferences in effect. */
  private async run<T>(
    extensionId: string,
    prefs: Record<string, unknown>,
    work: (runtime: ExtensionRuntime, options: { prefs: Record<string, unknown> }) => Promise<T>,
  ): Promise<T> {
    const entry = await this.get(extensionId);
    entry.active++;
    entry.lastUsed = this.now();
    try {
      return await work(entry.runtime, { prefs: { ...entry.prefDefaults, ...prefs } });
    } catch (error) {
      const appError = toAppError(error);
      // A runtime that ran out of memory may be in a bad state; start fresh next time.
      if (appError.code === 'memory') await this.unload(extensionId);
      throw appError;
    } finally {
      entry.active--;
      entry.lastUsed = this.now();
    }
  }

  async unload(extensionId: string): Promise<void> {
    const loading = this.loading.get(extensionId);
    if (loading) await loading.catch(() => undefined);
    const entry = this.entries.get(extensionId);
    this.entries.delete(extensionId);
    entry?.runtime.dispose();
  }

  /** Disposes runtimes nobody used for `idleMs`. Called periodically. */
  sweep(): string[] {
    const now = this.now();
    const disposed: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.active === 0 && now - entry.lastUsed >= this.idleMs) {
        this.entries.delete(id);
        entry.runtime.dispose();
        disposed.push(id);
      }
    }
    return disposed;
  }

  loadedIds(): string[] {
    return [...this.entries.keys()];
  }

  private get(extensionId: string): Promise<Entry> {
    const existing = this.entries.get(extensionId);
    if (existing) return Promise.resolve(existing);
    let loading = this.loading.get(extensionId);
    if (!loading) {
      loading = this.load(extensionId).finally(() => this.loading.delete(extensionId));
      this.loading.set(extensionId, loading);
    }
    return loading;
  }

  private async load(extensionId: string): Promise<Entry> {
    const { code, manifest } = await this.main.request('getExtension', { extensionId });
    const host: HostApi = {
      http: (request) =>
        this.main.request('http', { extensionId, request }).catch((e: unknown) => Promise.reject(toHostError(e))),
      storage: {
        get: (key) => this.main.request('storage', { extensionId, op: 'get', key }),
        set: async (key, value) => void (await this.main.request('storage', { extensionId, op: 'set', key, value })),
        remove: async (key) => void (await this.main.request('storage', { extensionId, op: 'remove', key })),
      },
      log: (level, message) => void this.main.request('log', { extensionId, level, message }).catch(() => undefined),
    };
    let runtime: ExtensionRuntime;
    try {
      runtime = await ExtensionRuntime.create({
        code,
        manifest,
        host,
        hostInfo: { ...this.info, apiVersion: SDK_API_VERSION },
      });
    } catch (error) {
      throw new AppError('extension', `Failed to load ${extensionId}: ${toAppError(error).message}`);
    }
    let prefDefaults: Record<string, unknown>;
    try {
      const definitions = await runtime.call<Preference[]>('', '__preferences');
      prefDefaults = Object.fromEntries(definitions.map((p) => [p.key, p.default]));
    } catch (error) {
      runtime.dispose();
      throw toAppError(error);
    }
    const entry: Entry = { runtime, prefDefaults, lastUsed: this.now(), active: 0 };
    this.entries.set(extensionId, entry);
    return entry;
  }
}
