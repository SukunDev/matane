import { createDecipheriv, createHash } from 'node:crypto';
import type { ExtensionManifest, HttpRequest, HttpResponse, Page, UrlKind } from '@matane/extension-sdk';
import { manifestSchema } from '@matane/extension-sdk/manifest';
import {
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  getQuickJS,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';
import { ExtensionRuntimeError, HostError, type SerializedExtensionError } from './errors.js';
import { HtmlStore } from './html-store.js';
import { PRELUDE } from './prelude.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * What the embedder provides. The app backs `http` with the main-process network layer; the CLI backs
 * it with Node's fetch. Requests reach `http` only after the domain allowlist check.
 */
export interface HostApi {
  http(request: HttpRequest): Promise<HttpResponse>;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  log(level: LogLevel, message: string): void;
}

export interface RuntimeLimits {
  /** QuickJS heap limit. */
  memoryBytes: number;
  /** Longest stretch of synchronous guest code before it is interrupted. */
  syncMs: number;
  /** Default budget for one call, including host/network waits. */
  callTimeoutMs: number;
  /** Per-method overrides, e.g. getChapters needs many requests. */
  methodTimeoutMs: Partial<Record<string, number>>;
}

// Starting values from BRAINSTORM.md §5.1; final numbers come from the Phase 1 benchmark.
export const DEFAULT_LIMITS: RuntimeLimits = {
  memoryBytes: 64 * 1024 * 1024,
  syncMs: 2_000,
  callTimeoutMs: 30_000,
  methodTimeoutMs: { getChapters: 60_000 },
};

const MAX_SLEEP_MS = 30_000;
/** Largest binary value crossing the sandbox boundary (an image, a decrypted file). */
const MAX_BYTES = 30 * 1024 * 1024;

/** What `transformImage` returned: restored bytes (if any) and unchecked tile instructions. */
export interface RawImageTransform {
  bytes?: Uint8Array;
  tiles?: unknown;
}

export interface MigratedUrls {
  /** Per item: the new url, or null to keep it. */
  urls: (string | null)[];
  /** The first few items the extension failed on (kept unchanged). */
  errors: string[];
}

/** AES decryption for `crypto.aesDecrypt` (key of 16/24/32 bytes; `cbc`/`ctr` need a 16-byte iv). */
export function aesDecrypt(
  data: Uint8Array,
  key: Uint8Array,
  mode: unknown,
  iv: Uint8Array | null,
  padding: boolean,
): Uint8Array {
  if (mode !== 'cbc' && mode !== 'ctr' && mode !== 'ecb') {
    throw new HostError('ExtensionError', `aesDecrypt: mode must be cbc, ctr or ecb, not ${String(mode)}`);
  }
  if (![16, 24, 32].includes(key.byteLength)) {
    throw new HostError('ExtensionError', `aesDecrypt: the key must be 16, 24 or 32 bytes, not ${key.byteLength}`);
  }
  if (mode !== 'ecb' && iv?.byteLength !== 16)
    throw new HostError('ExtensionError', `aesDecrypt: ${mode} needs a 16-byte iv`);
  try {
    const decipher = createDecipheriv(`aes-${key.byteLength * 8}-${mode}`, key, mode === 'ecb' ? null : iv);
    decipher.setAutoPadding(padding && mode !== 'ctr');
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (error) {
    throw new HostError('ExtensionError', `aesDecrypt failed: ${(error as Error).message}`);
  }
}

export interface CreateRuntimeOptions {
  /** The bundled `index.js` produced by `mr-ext build`. */
  code: string;
  manifest: ExtensionManifest;
  host: HostApi;
  hostInfo: { appName: string; appVersion: string; apiVersion: number };
  limits?: Partial<RuntimeLimits>;
}

export interface CallOptions {
  /** Current values of the extension preferences, exposed through `prefs.get`. */
  prefs?: Record<string, unknown>;
  timeoutMs?: number;
}

/** One sandboxed extension. Not thread-safe across processes; calls may overlap. */
export class ExtensionRuntime {
  private readonly html = new HtmlStore();
  private readonly deferreds = new Set<QuickJSDeferredPromise>();
  private prefs: Record<string, unknown> = {};
  /** Binary input/output of running `transformImage` calls, by id. */
  private readonly imageIO = new Map<number, { input: Uint8Array; output: Uint8Array | null }>();
  private ioSeq = 0;
  private activeCalls = 0;
  private disposed = false;

  private constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    readonly manifest: ExtensionManifest,
    private readonly host: HostApi,
    private readonly limits: RuntimeLimits,
  ) {}

  static async create(options: CreateRuntimeOptions): Promise<ExtensionRuntime> {
    const manifest = manifestSchema.parse(options.manifest);
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const quickjs = await getQuickJS();
    const runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(1024 * 1024);
    const context = runtime.newContext();
    const instance = new ExtensionRuntime(runtime, context, manifest, options.host, limits);
    try {
      instance.installPrimitives();
      const sourceInfos = Object.fromEntries(manifest.sources.map((source) => [source.key, source]));
      instance.evalVoid(
        `globalThis.host = Object.freeze(${JSON.stringify(options.hostInfo)});` +
          `Object.defineProperty(globalThis, '__sourceInfos', { value: Object.freeze(${JSON.stringify(sourceInfos)}) });`,
        'host-info.js',
      );
      instance.evalVoid(PRELUDE, 'prelude.js');
      instance.evalVoid(options.code, `${manifest.id}/index.js`);
      instance.evalVoid(
        "if (!globalThis.__extension || typeof globalThis.__extension.createSource !== 'function') throw new Error('Bundle did not register an extension (missing defineExtension default export?)');",
        'check.js',
      );
    } catch (error) {
      instance.dispose();
      throw error;
    }
    return instance;
  }

  /** Calls `source[method](...args)` for the given source key and returns its JSON result. */
  async call<T = unknown>(
    sourceKey: string,
    method: string,
    args: unknown[] = [],
    options: CallOptions = {},
  ): Promise<T> {
    if (this.disposed) throw new ExtensionRuntimeError('disposed', 'Runtime is disposed');
    this.activeCalls++;
    if (options.prefs) this.prefs = options.prefs;
    const timeoutMs = options.timeoutMs ?? this.limits.methodTimeoutMs[method] ?? this.limits.callTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const promiseHandle = this.evalSync(
        `__call(${JSON.stringify(sourceKey)}, ${JSON.stringify(method)}, ${JSON.stringify(JSON.stringify(args))})`,
        `call-${method}.js`,
      );
      const settled = this.context.resolvePromise(promiseHandle);
      promiseHandle.dispose();
      this.pump();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ExtensionRuntimeError('timeout', `${method} took longer than ${timeoutMs} ms`)),
          timeoutMs,
        );
      });
      const result = await Promise.race([settled, timeout]);
      if (result.error) {
        const error = this.context.dump(result.error) as SerializedExtensionError;
        result.error.dispose();
        throw this.toRuntimeError(error);
      }
      const json = this.context.getString(result.value);
      result.value.dispose();
      return JSON.parse(json) as T;
    } finally {
      clearTimeout(timer);
      this.activeCalls--;
      // Handles are only valid for the duration of a call; drop them once nothing is running.
      if (this.activeCalls === 0) this.html.clear();
    }
  }

  /**
   * `source.transformImage(page, bytes)` (BRAINSTORM.md §5.6). The bytes cross as an ArrayBuffer, not
   * JSON; the tiles come back unchecked (the embedder validates them before doing pixel work).
   */
  async transformImage(
    sourceKey: string,
    page: Page,
    bytes: Uint8Array,
    options: CallOptions = {},
  ): Promise<RawImageTransform> {
    const id = ++this.ioSeq;
    this.imageIO.set(id, { input: bytes, output: null });
    try {
      const result = await this.call<{ bytes: boolean; tiles: unknown }>(
        sourceKey,
        '__transformImage',
        [id, page],
        options,
      );
      const output = this.imageIO.get(id)?.output;
      return {
        ...(result.bytes && output ? { bytes: output } : {}),
        ...(result.tiles !== null && result.tiles !== undefined ? { tiles: result.tiles } : {}),
      };
    } finally {
      this.imageIO.delete(id);
    }
  }

  /** `source.migrateUrl` over a batch of stored urls (BRAINSTORM.md §5.10). */
  migrateUrls(
    sourceKey: string,
    items: { url: string; kind: UrlKind }[],
    fromVersion: string,
    options: CallOptions = {},
  ): Promise<MigratedUrls> {
    return this.call<MigratedUrls>(sourceKey, '__migrateUrls', [items, fromVersion], options);
  }

  /** Current QuickJS heap usage in bytes (for the benchmark and diagnostics). */
  memoryUsage(): number {
    // Parsed from the text dump on purpose: computeMemoryUsage() allocates in a hidden "system
    // context" of quickjs-emscripten that outlives our context and makes runtime disposal abort.
    const match = /^memory used\s+\d+\s+(\d+)/m.exec(this.runtime.dumpMemoryUsage());
    return match ? Number(match[1]) : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const deferred of this.deferreds) deferred.dispose();
    this.deferreds.clear();
    this.html.clear();
    this.context.dispose();
    this.runtime.dispose();
  }

  // ------------------------------------------------------------------ internals

  private installPrimitives(): void {
    const { context } = this;
    const hostSync = context.newFunction('__hostSync', (opHandle, argsHandle) => {
      const op = context.getString(opHandle);
      const args = JSON.parse(context.getString(argsHandle)) as unknown[];
      try {
        return context.newString(JSON.stringify({ value: this.syncOp(op, args) ?? null }));
      } catch (error) {
        return context.newString(JSON.stringify({ error: serializeHostError(error) }));
      }
    });
    context.setProp(context.global, '__hostSync', hostSync);
    hostSync.dispose();

    const hostAsync = context.newFunction('__hostAsync', (opHandle, argsHandle) => {
      const op = context.getString(opHandle);
      const args = JSON.parse(context.getString(argsHandle)) as unknown[];
      const deferred = context.newPromise();
      this.deferreds.add(deferred);
      void this.asyncOp(op, args).then(
        (value) => this.settle(deferred, JSON.stringify({ value: value ?? null })),
        (error: unknown) => this.settle(deferred, JSON.stringify({ error: serializeHostError(error) })),
      );
      return deferred.handle;
    });
    context.setProp(context.global, '__hostAsync', hostAsync);
    hostAsync.dispose();

    // Binary ops: JSON args plus ArrayBuffers in, an ArrayBuffer or a string out. Errors thrown
    // here become exceptions in the guest (name and message).
    const hostBytes = context.newFunction('__hostBytes', (opHandle, argsHandle, ...bufferHandles) => {
      const op = context.getString(opHandle);
      const args = JSON.parse(context.getString(argsHandle)) as unknown[];
      const buffers = bufferHandles.map((handle) => {
        if (context.typeof(handle) === 'undefined') return null;
        const lifetime = context.getArrayBuffer(handle);
        const copy = Uint8Array.from(lifetime.value);
        lifetime.dispose();
        if (copy.byteLength > MAX_BYTES) throw new HostError('ExtensionError', 'Binary value is too large');
        return copy;
      });
      const result = this.bytesOp(op, args, buffers);
      if (typeof result === 'string') return context.newString(result);
      if (result.byteLength > MAX_BYTES) throw new HostError('ExtensionError', 'Binary value is too large');
      return context.newArrayBuffer(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength));
    });
    context.setProp(context.global, '__hostBytes', hostBytes);
    hostBytes.dispose();
  }

  private bytesOp(op: string, args: unknown[], buffers: (Uint8Array | null)[]): Uint8Array | string {
    const [data, key, iv] = buffers;
    switch (op) {
      case 'aes.decrypt':
        if (!data || !key) throw new HostError('ExtensionError', 'aesDecrypt needs data and a key');
        return aesDecrypt(data, key, args[0], iv ?? null, args[1] !== false);
      case 'base64.decodeBytes':
        return Buffer.from(String(args[0]), 'base64');
      case 'base64.encodeBytes':
        return Buffer.from(data ?? new Uint8Array()).toString('base64');
      case 'image.take': {
        const io = this.imageIO.get(Number(args[0]));
        if (!io) throw new HostError('ExtensionError', 'No image for this call');
        return io.input;
      }
      case 'image.put': {
        const io = this.imageIO.get(Number(args[0]));
        if (!io || !data) throw new HostError('ExtensionError', 'No image for this call');
        io.output = data;
        return '';
      }
      default:
        throw new HostError('ExtensionError', `Unknown host operation ${op}`);
    }
  }

  private settle(deferred: QuickJSDeferredPromise, json: string): void {
    this.deferreds.delete(deferred);
    if (this.disposed || !deferred.alive) return;
    const value = this.context.newString(json);
    deferred.resolve(value);
    value.dispose();
    deferred.dispose();
    this.pump();
  }

  /** Runs queued promise jobs under the CPU budget. */
  private pump(): void {
    if (this.disposed) return;
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.syncMs));
    const result = this.runtime.executePendingJobs();
    if (result.error) result.error.dispose();
    this.runtime.removeInterruptHandler();
    this.disposeStrayContexts();
  }

  /**
   * Works around quickjs-emscripten 0.32: `executePendingJobs` reads the job's context pointer
   * through a typed-array view; when a job grows the WASM memory, that view is detached, the pointer
   * reads as undefined and the library wraps a brand-new context that nothing disposes, so freeing
   * the runtime aborts ("list_empty(&rt->gc_obj_list)"). We only ever use one context.
   */
  private disposeStrayContexts(): void {
    const contexts = (this.runtime as unknown as { contextMap?: Map<number, QuickJSContext> }).contextMap;
    if (!contexts || contexts.size <= 1) return;
    for (const context of [...contexts.values()]) {
      if (context !== this.context && context.alive) context.dispose();
    }
  }

  /** Evaluates code under the CPU budget; throws a runtime error if it fails. */
  private evalSync(code: string, filename: string): QuickJSHandle {
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.syncMs));
    const result = this.context.evalCode(code, filename);
    this.runtime.removeInterruptHandler();
    if (result.error) {
      const error = this.context.dump(result.error) as SerializedExtensionError;
      result.error.dispose();
      throw this.toRuntimeError(error);
    }
    return result.value;
  }

  private evalVoid(code: string, filename: string): void {
    this.evalSync(code, filename).dispose();
  }

  private toRuntimeError(error: SerializedExtensionError | string): ExtensionRuntimeError {
    const serialized: SerializedExtensionError =
      typeof error === 'object' && error !== null
        ? { name: error.name ?? 'Error', message: error.message ?? String(error), status: error.status }
        : { name: 'Error', message: String(error) };
    if (serialized.message === 'interrupted') {
      return new ExtensionRuntimeError(
        'interrupted',
        `Extension code ran longer than ${this.limits.syncMs} ms without yielding`,
      );
    }
    if (/out of memory/i.test(serialized.message)) {
      return new ExtensionRuntimeError('memory', `Extension exceeded its ${this.limits.memoryBytes} byte memory limit`);
    }
    return new ExtensionRuntimeError('extension', `${serialized.name}: ${serialized.message}`, serialized);
  }

  private syncOp(op: string, args: unknown[]): unknown {
    const [a, b] = args;
    switch (op) {
      case 'html.load':
        return this.html.load(String(a), (b ?? {}) as { baseUrl?: string; xml?: boolean });
      case 'html.select':
        return this.html.select(Number(a), String(b));
      case 'html.selectFirst':
        return this.html.selectFirst(Number(a), String(b));
      case 'html.text':
        return this.html.text(Number(a));
      case 'html.html':
        return this.html.html(Number(a));
      case 'html.attr':
        return this.html.attr(Number(a), String(b));
      case 'html.absUrl':
        return this.html.absUrl(Number(a), String(b));
      case 'prefs.get':
        return this.prefs[String(a)];
      case 'log':
        this.host.log(a as LogLevel, (b as string[]).join(' '));
        return null;
      case 'crypto.hash':
        if (a !== 'md5' && a !== 'sha1' && a !== 'sha256')
          throw new HostError('ExtensionError', `Unsupported hash ${String(a)}`);
        return createHash(a).update(String(b)).digest('hex');
      case 'base64.encode':
        return Buffer.from(String(a), 'utf8').toString('base64');
      case 'base64.decode':
        return Buffer.from(String(a), 'base64').toString('utf8');
      case 'utf8.encode':
        return Array.from(Buffer.from(String(a), 'utf8'));
      case 'utf8.decode':
        return Buffer.from(a as number[]).toString('utf8');
      default:
        throw new HostError('ExtensionError', `Unknown host operation ${op}`);
    }
  }

  private async asyncOp(op: string, args: unknown[]): Promise<unknown> {
    const [a, b] = args;
    switch (op) {
      case 'http.request':
        return this.http(a as HttpRequest);
      case 'storage.get':
        return this.host.storage.get(String(a));
      case 'storage.set':
        return this.host.storage.set(String(a), b);
      case 'storage.remove':
        return this.host.storage.remove(String(a));
      case 'sleep':
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(a), 0), MAX_SLEEP_MS)));
        return null;
      default:
        throw new HostError('ExtensionError', `Unknown host operation ${op}`);
    }
  }

  private http(request: HttpRequest): Promise<HttpResponse> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new HostError('NetworkError', `Invalid URL: ${request.url}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new HostError('NetworkError', `Only http(s) URLs are allowed: ${request.url}`);
    }
    return this.host.http({ ...request, url: url.toString() });
  }
}

function serializeHostError(error: unknown): SerializedExtensionError {
  if (error instanceof HostError) return { name: error.name, message: error.message, status: error.status };
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return {
      name: error.name || 'ExtensionError',
      message: error.message,
      status: typeof status === 'number' ? status : undefined,
    };
  }
  return { name: 'ExtensionError', message: String(error) };
}
