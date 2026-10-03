import type { HttpRequest, HttpResponse } from '@matane/extension-sdk';
import type { ExtensionManifest } from '@matane/extension-sdk/manifest';
import { type Session, session } from 'electron';
import type { ExtensionNetwork } from '../extensions/service';
import type { CloudflareSolver } from './cloudflare';
import { sessionFetch } from './electron-fetch';
import { ExtensionFetcher } from './extension-fetcher';
import { TokenBucket } from './token-bucket';
import { browserUserAgent } from './user-agent';

/** Used when a manifest declares no rate limit. */
const DEFAULT_RATE = { requests: 10, perMs: 1000 };
/** Images come from CDNs, not the rate-limited API; they get their own, looser bucket. */
const IMAGE_RATE = { requests: 20, perMs: 1000 };

interface NetworkEntry {
  version: string;
  session: Session;
  fetcher: ExtensionFetcher;
  images: ExtensionFetcher;
}

/**
 * One Electron session per extension (`persist:ext-<id>`): cookies, Cloudflare clearance and cache
 * never leak between extensions or into the app's own session.
 */
export class NetworkManager implements ExtensionNetwork {
  private readonly entries = new Map<string, NetworkEntry>();
  /** Sessions handed out, each with the proxy being applied to it (Settings → Network). */
  private readonly sessions = new Map<string, { session: Session; proxy: Promise<void> }>();
  private proxy: Electron.ProxyConfig | null = null;
  /** The browser User-Agent without Electron's tokens; `setUserAgent` can replace it. */
  readonly defaultUserAgent = browserUserAgent(session.defaultSession.getUserAgent());
  private customUserAgent: string | null = null;

  constructor(private readonly solver: CloudflareSolver) {}

  get userAgent(): string {
    return this.customUserAgent ?? this.defaultUserAgent;
  }

  async request(manifest: ExtensionManifest, request: HttpRequest): Promise<HttpResponse> {
    const entry = this.entry(manifest);
    await this.proxyReady(manifest.id);
    return entry.fetcher.request(request);
  }

  /** Image fetch through the extension's session and allowlist, with its own rate bucket. */
  async fetchImage(manifest: ExtensionManifest, url: string, headers: Record<string, string>): Promise<Response> {
    const entry = this.entry(manifest);
    await this.proxyReady(manifest.id);
    const { response } = await entry.images.fetchRaw({ url, headers });
    return response;
  }

  sessionFor(extensionId: string): Session {
    const ses = session.fromPartition(`persist:ext-${extensionId}`);
    ses.setUserAgent(this.userAgent);
    if (!this.sessions.has(extensionId)) {
      this.sessions.set(extensionId, {
        session: ses,
        proxy: this.proxy ? ses.setProxy(this.proxy) : Promise.resolve(),
      });
    }
    return ses;
  }

  /** The proxy for every extension session, now and later ones. */
  async setProxy(config: Electron.ProxyConfig): Promise<void> {
    this.proxy = config;
    for (const entry of this.sessions.values()) {
      entry.proxy = entry.session.setProxy(config);
      // Open connections would keep using the old route.
      await entry.proxy;
      await entry.session.closeAllConnections();
    }
  }

  /** A global User-Agent instead of the browser's (null = back to it); extensions' own still win. */
  setUserAgent(userAgent: string | null): void {
    if (userAgent === this.customUserAgent) return;
    this.customUserAgent = userAgent;
    this.entries.clear();
    for (const { session: ses } of this.sessions.values()) ses.setUserAgent(this.userAgent);
  }

  private proxyReady(extensionId: string): Promise<void> {
    return this.sessions.get(extensionId)?.proxy ?? Promise.resolve();
  }

  /** Opens the challenge visibly (the user pressed "Verify"). */
  async solveVisible(extensionId: string, url: string): Promise<void> {
    await this.solver.solve(extensionId, { session: this.sessionFor(extensionId), url, visible: true });
  }

  invalidate(extensionId: string): void {
    this.entries.delete(extensionId);
  }

  isSolving(extensionId: string): boolean {
    return this.solver.isSolving(extensionId);
  }

  private entry(manifest: ExtensionManifest): NetworkEntry {
    const existing = this.entries.get(manifest.id);
    if (existing && existing.version === manifest.version) return existing;
    const ses = this.sessionFor(manifest.id);
    const rate = manifest.rateLimit ?? DEFAULT_RATE;
    const solveChallenge = (url: string) => this.solver.solve(manifest.id, { session: ses, url });
    const fetcher = new ExtensionFetcher({
      fetch: sessionFetch(ses),
      limiter: new TokenBucket(rate.requests, rate.perMs),
      userAgent: this.userAgent,
      solveChallenge,
    });
    const images = new ExtensionFetcher({
      fetch: sessionFetch(ses),
      limiter: new TokenBucket(IMAGE_RATE.requests, IMAGE_RATE.perMs),
      userAgent: this.userAgent,
      solveChallenge,
      timeoutMs: 30_000,
    });
    const entry = { version: manifest.version, session: ses, fetcher, images };
    this.entries.set(manifest.id, entry);
    return entry;
  }
}
