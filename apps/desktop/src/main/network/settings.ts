import type { NetworkSettings } from '@manga-reader/shared';

/** DNS-over-HTTPS templates of the presets (docs/BRAINSTORM.md §6.5). */
export const DOH_URLS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  adguard: 'https://dns.adguard-dns.com/dns-query',
} as const;

/** The DoH server in effect, or null for an invalid custom one (only https:// URLs). */
export function dohUrl(doh: NetworkSettings['doh']): string | null {
  if (doh.provider !== 'custom') return DOH_URLS[doh.provider];
  // Kept as typed: a DoH template may hold `{?dns}`, which URL normalising would escape.
  const text = doh.customUrl.trim();
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname ? text : null;
  } catch {
    return null;
  }
}

/** Options for `app.configureHostResolver`; without a usable server DoH stays off. */
export function hostResolverOptions(doh: NetworkSettings['doh']): Electron.ConfigureHostResolverOptions {
  const server = doh.mode === 'off' ? null : dohUrl(doh);
  return server
    ? { enableBuiltInResolver: true, secureDnsMode: doh.mode, secureDnsServers: [server] }
    : { enableBuiltInResolver: true, secureDnsMode: 'off', secureDnsServers: [] };
}

/** A proxy host: a name or an IP address, nothing else (no scheme, path or credentials). */
export function isProxyHost(host: string): boolean {
  return (
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host) ||
    /^\[[0-9a-f:]+\]$/i.test(host)
  );
}

/**
 * The proxy for every session. HTTP/SOCKS5 without a valid host and port falls back to the
 * system settings. `loopback`: also send localhost through it (tests only; Chromium skips it).
 */
export function proxyConfig(
  proxy: NetworkSettings['proxy'],
  options: { loopback?: boolean } = {},
): Electron.ProxyConfig {
  if (proxy.mode === 'direct') return { mode: 'direct' };
  const host = proxy.host.trim();
  if ((proxy.mode === 'http' || proxy.mode === 'socks5') && proxy.port && isProxyHost(host)) {
    const scheme = proxy.mode === 'http' ? 'http' : 'socks5';
    return {
      mode: 'fixed_servers',
      proxyRules: `${scheme}://${host}:${proxy.port}`,
      ...(options.loopback ? { proxyBypassRules: '<-loopback>' } : {}),
    };
  }
  return { mode: 'system' };
}
