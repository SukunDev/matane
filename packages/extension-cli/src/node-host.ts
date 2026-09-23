import type { ExtensionManifest, HttpRequest, HttpResponse } from '@manga-reader/extension-sdk';
import { type HostApi, type LogLevel, fromFetchResponse, toFetchParts } from '@manga-reader/extension-runtime';

export const CLI_NAME = 'mr-ext';
export const CLI_VERSION = '0.1.0';
const TIMEOUT_MS = 20_000;

/** Spaces requests so no more than `requests` start within any `perMs` window. */
export class RateLimiter {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly requests: number,
    private readonly perMs: number,
  ) {}

  acquire(): Promise<void> {
    const next = this.queue.then(() => this.wait());
    this.queue = next;
    return next;
  }

  private async wait(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.starts.length > 0 && now - (this.starts[0] ?? 0) >= this.perMs) this.starts.shift();
      if (this.starts.length < this.requests) {
        this.starts.push(now);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.perMs - (now - (this.starts[0] ?? now))));
    }
  }
}

export interface NodeHostOptions {
  manifest: ExtensionManifest;
  log?: (level: LogLevel, message: string) => void;
  /** Called after every request, for the CLI summary. */
  onRequest?: (request: HttpRequest, response: HttpResponse | undefined, durationMs: number) => void;
}

/** Host backed by Node's fetch and in-memory storage; used by `mr-ext test`. */
export function createNodeHost(options: NodeHostOptions): HostApi {
  const { manifest } = options;
  const limiter = manifest.rateLimit ? new RateLimiter(manifest.rateLimit.requests, manifest.rateLimit.perMs) : null;
  const store = new Map<string, unknown>();

  return {
    async http(request) {
      await limiter?.acquire();
      const started = Date.now();
      let response: HttpResponse | undefined;
      try {
        response = await nodeFetch(request);
        return response;
      } finally {
        options.onRequest?.(request, response, Date.now() - started);
      }
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => void store.set(key, value),
      remove: async (key) => void store.delete(key),
    },
    log: options.log ?? ((level, message) => console.error(`[${level}] ${message}`)),
  };
}

export async function nodeFetch(request: HttpRequest): Promise<HttpResponse> {
  const { method, headers, body } = toFetchParts(request);
  if (!headers.has('user-agent')) headers.set('user-agent', `${CLI_NAME}/${CLI_VERSION}`);
  let response: Response;
  try {
    response = await fetch(request.url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw Object.assign(new Error(`${request.url}: ${(error as Error).message}`), { name: 'NetworkError' });
  }
  return fromFetchResponse(response, request.responseType);
}
