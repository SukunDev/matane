import { type Session, app, safeStorage } from 'electron';
import type { NetworkSettings } from '@manga-reader/shared';
import { sessionFetch, setProxyCredentials } from './electron-fetch';
import type { NetworkManager } from './manager';
import { hostResolverOptions, proxyConfig } from './settings';

/**
 * Settings key (not an app setting): the proxy password, `enc:` + base64 of `safeStorage`
 * encryption, or `plain:` + base64 on a system without a keyring (Linux without a secret service),
 * where nothing can encrypt it; the settings page says so.
 */
export const PROXY_PASSWORD_KEY = 'network.proxyPassword';
/** What "Test connection" loads: a tiny plain-text page from a large, reliable host. */
const TEST_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const TEST_TIMEOUT_MS = 15_000;

/**
 * Applies Settings → Network (BRAINSTORM.md §6.5) to the whole app: DNS-over-HTTPS for every
 * request, the proxy for requests without a session, the app's session and every extension
 * session, and the global User-Agent. Changes apply at once, open connections are closed.
 */
export class NetworkControl {
  /** What "Test connection" loads (tests point it at their own site). */
  testUrl = TEST_URL;

  constructor(
    private readonly deps: {
      settings: () => NetworkSettings;
      network: NetworkManager;
      defaultSession: Session;
      store: { get(): string | null; set(value: string | null): void };
      /** Tests: send localhost through the proxy too. */
      proxyLoopback?: boolean;
      log?: (message: string) => void;
    },
  ) {
    setProxyCredentials(() => this.credentials());
    app.on('login', (event, _webContents, _details, authInfo, callback) => {
      const credentials = authInfo.isProxy ? this.credentials() : null;
      if (!credentials) return;
      event.preventDefault();
      callback(credentials.username, credentials.password);
    });
  }

  async apply(): Promise<void> {
    const { doh, proxy, userAgent } = this.deps.settings();
    app.configureHostResolver(hostResolverOptions(doh));
    const config = proxyConfig(proxy, { loopback: this.deps.proxyLoopback });
    await app.setProxy(config);
    await this.deps.defaultSession.setProxy(config);
    await this.deps.defaultSession.closeAllConnections();
    await this.deps.network.setProxy(config);
    this.deps.network.setUserAgent(userAgent);
    this.deps.log?.(`network: DNS-over-HTTPS ${hostResolverOptions(doh).secureDnsMode}, proxy ${config.mode}`);
  }

  info(): { defaultUserAgent: string; hasProxyPassword: boolean; passwordEncrypted: boolean } {
    const stored = this.deps.store.get();
    return {
      defaultUserAgent: this.deps.network.defaultUserAgent,
      hasProxyPassword: stored !== null,
      passwordEncrypted: stored === null ? safeStorage.isEncryptionAvailable() : stored.startsWith('enc:'),
    };
  }

  async setProxyPassword(password: string | null): Promise<void> {
    if (password === null || password === '') {
      this.deps.store.set(null);
    } else if (safeStorage.isEncryptionAvailable()) {
      this.deps.store.set(`enc:${safeStorage.encryptString(password).toString('base64')}`);
    } else {
      this.deps.store.set(`plain:${Buffer.from(password, 'utf8').toString('base64')}`);
    }
    // Connections authenticated with the old password are closed.
    await this.apply();
  }

  /** Loads a small page through the app's session (DoH and proxy apply), timing it. */
  async test(): Promise<{ url: string; ok: boolean; status: number | null; ms: number; error: string | null }> {
    const url = this.testUrl;
    const started = Date.now();
    try {
      const response = await sessionFetch(this.deps.defaultSession)(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return { url, ok: response.ok, status: response.status, ms: Date.now() - started, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { url, ok: false, status: null, ms: Date.now() - started, error: message };
    }
  }

  /** Username and password for a proxy that asks (HTTP or SOCKS5 with a username). */
  private credentials(): { username: string; password: string } | null {
    const { proxy } = this.deps.settings();
    if ((proxy.mode !== 'http' && proxy.mode !== 'socks5') || !proxy.username) return null;
    return { username: proxy.username, password: this.password() ?? '' };
  }

  private password(): string | null {
    const stored = this.deps.store.get();
    try {
      if (stored?.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
      if (stored?.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      }
    } catch {
      // Unreadable (another machine's keyring): as if none were stored.
    }
    return null;
  }
}
