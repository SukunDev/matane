import type { HttpRequest, HttpResponse } from '@manga-reader/extension-sdk';
import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';
import { type Session, session } from 'electron';
import type { ExtensionNetwork } from '../extensions/service';
import type { CloudflareSolver } from './cloudflare';
import { sessionFetch } from './electron-fetch';
import { ExtensionFetcher } from './extension-fetcher';
import { TokenBucket } from './token-bucket';
import { browserUserAgent } from './user-agent';

/** Used when a manifest declares no rate limit. */
const DEFAULT_RATE = { requests: 10, perMs: 1000 };

interface NetworkEntry {
  version: string;
  session: Session;
  fetcher: ExtensionFetcher;
}

/**
 * One Electron session per extension (`persist:ext-<id>`): cookies, Cloudflare clearance and cache
 * never leak between extensions or into the app's own session.
 */
export class NetworkManager implements ExtensionNetwork {
  private readonly entries = new Map<string, NetworkEntry>();
  readonly userAgent = browserUserAgent(session.defaultSession.getUserAgent());

  constructor(private readonly solver: CloudflareSolver) {}

  request(manifest: ExtensionManifest, request: HttpRequest): Promise<HttpResponse> {
    return this.entry(manifest).fetcher.request(request);
  }

  sessionFor(extensionId: string): Session {
    const ses = session.fromPartition(`persist:ext-${extensionId}`);
    ses.setUserAgent(this.userAgent);
    return ses;
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
    const fetcher = new ExtensionFetcher({
      fetch: sessionFetch(ses),
      domains: manifest.domains,
      limiter: new TokenBucket(rate.requests, rate.perMs),
      userAgent: this.userAgent,
      solveChallenge: (url) => this.solver.solve(manifest.id, { session: ses, url }),
    });
    const entry = { version: manifest.version, session: ses, fetcher };
    this.entries.set(manifest.id, entry);
    return entry;
  }
}
