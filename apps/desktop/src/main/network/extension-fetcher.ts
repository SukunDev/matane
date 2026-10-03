import { fromFetchResponse, toFetchParts } from '@matane/extension-runtime/http-bridge';
import type { HttpRequest, HttpResponse } from '@matane/extension-sdk';
import { AppError } from '@manga-reader/shared/errors';
import type { TokenBucket } from './token-bucket';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ExtensionFetcherOptions {
  /** Performs one HTTP exchange; redirects are followed here, not by `fetch`. */
  fetch: FetchFn;
  limiter?: TokenBucket | null;
  /** Used when the extension does not set its own User-Agent. */
  userAgent: string;
  /** Opens the challenge in a browser window; resolves once cleared, rejects on failure. */
  solveChallenge?: (url: string) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  maxRedirects?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
const RETRY_CAP_MS = 30_000;

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AppError('cancelled', 'Request cancelled'));
      },
      { once: true },
    );
  });

/** Seconds or an HTTP date, per RFC 9110. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Cloudflare "managed challenge" / "I'm under attack" pages. */
export async function isCloudflareChallenge(response: Response): Promise<boolean> {
  if (response.status !== 403 && response.status !== 503 && response.status !== 429) return false;
  if (response.headers.get('cf-mitigated') === 'challenge') return true;
  if (!/cloudflare/i.test(response.headers.get('server') ?? '')) return false;
  const text = await response.clone().text();
  return /challenge-platform|cf-chl-|<title>Just a moment/i.test(text);
}

/**
 * Network access for one extension: domain allowlist on every hop, rate limit, timeout,
 * retries for 429/5xx honouring Retry-After, and Cloudflare challenge solving.
 */
export class ExtensionFetcher {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRedirects: number;
  private readonly sleep: NonNullable<ExtensionFetcherOptions['sleep']>;

  constructor(private readonly options: ExtensionFetcherOptions) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async request(request: HttpRequest, signal?: AbortSignal): Promise<HttpResponse> {
    const { response, url } = await this.fetchRaw(request, signal);
    return fromFetchResponse(response, request.responseType, url);
  }

  /** Like `request`, but hands back the streaming Response (images, downloads). */
  async fetchRaw(request: HttpRequest, signal?: AbortSignal): Promise<{ response: Response; url: string }> {
    const method = (request.method ?? 'GET').toUpperCase();
    let challengeSolved = false;
    for (let attempt = 0; ; attempt++) {
      await this.options.limiter?.take(signal);
      const { response, url } = await this.exchange(request, signal);

      if (!challengeSolved && (await isCloudflareChallenge(response))) {
        if (!this.options.solveChallenge) throw new AppError('cloudflare', `Cloudflare challenge at ${url}`);
        await this.options.solveChallenge(url);
        challengeSolved = true;
        attempt--; // solving does not count as a retry
        continue;
      }

      const retryable = response.status === 429 || (response.status >= 500 && response.status !== 501);
      if (retryable && IDEMPOTENT.has(method) && attempt < this.maxRetries) {
        const delay = parseRetryAfter(response.headers.get('retry-after')) ?? 1000 * 2 ** attempt;
        if (delay <= RETRY_CAP_MS) {
          await response.body?.cancel();
          await this.sleep(delay, signal);
          continue;
        }
      }
      return { response, url };
    }
  }

  /** One logical request: follows redirects itself so each hop passes the allowlist. */
  private async exchange(request: HttpRequest, signal?: AbortSignal): Promise<{ response: Response; url: string }> {
    const parts = toFetchParts(request);
    if (!parts.headers.has('user-agent')) parts.headers.set('user-agent', this.options.userAgent);
    let { method, body } = parts;
    let url = request.url;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (signal?.aborted) throw new AppError('cancelled', 'Request cancelled');
      this.checkAllowed(url);
      const timeout = AbortSignal.timeout(this.timeoutMs);
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method,
          headers: parts.headers,
          body,
          redirect: 'manual',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw new AppError('cancelled', 'Request cancelled');
        if (timeout.aborted) throw new AppError('network', `Timed out after ${this.timeoutMs} ms: ${url}`);
        throw new AppError('network', `${url}: ${error instanceof Error ? error.message : String(error)}`);
      }

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url).toString();
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
          parts.headers.delete('content-type');
        }
        continue;
      }
      return { response, url };
    }
    throw new AppError('network', `Too many redirects for ${request.url}`);
  }

  private checkAllowed(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError('network', `Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AppError('network', `Only http(s) URLs are allowed: ${url}`);
    }
  }
}
