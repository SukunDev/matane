import { DEFAULT_SETTINGS } from '@manga-reader/shared';
import { describe, expect, it } from 'vitest';
import { dohUrl, hostResolverOptions, isProxyHost, proxyConfig } from './settings';

const doh = { ...DEFAULT_SETTINGS.network.doh };
const proxy = { ...DEFAULT_SETTINGS.network.proxy };

describe('network settings', () => {
  it('uses the preset or a valid https custom DNS-over-HTTPS server', () => {
    expect(dohUrl({ ...doh, provider: 'google' })).toBe('https://dns.google/dns-query');
    expect(dohUrl({ ...doh, provider: 'custom', customUrl: ' https://dns.example/dns-query{?dns} ' })).toBe(
      'https://dns.example/dns-query{?dns}',
    );
    expect(dohUrl({ ...doh, provider: 'custom', customUrl: 'http://dns.example/dns-query' })).toBeNull();
    expect(dohUrl({ ...doh, provider: 'custom', customUrl: 'not a url' })).toBeNull();
  });

  it('turns DoH on only with a usable server', () => {
    expect(hostResolverOptions(doh)).toMatchObject({ secureDnsMode: 'off', secureDnsServers: [] });
    expect(hostResolverOptions({ ...doh, mode: 'secure' })).toEqual({
      enableBuiltInResolver: true,
      secureDnsMode: 'secure',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query'],
    });
    expect(hostResolverOptions({ ...doh, mode: 'automatic', provider: 'custom', customUrl: 'ftp://x' })).toMatchObject({
      secureDnsMode: 'off',
    });
  });

  it('builds the proxy rules, falling back to the system ones when incomplete', () => {
    expect(proxyConfig(proxy)).toEqual({ mode: 'system' });
    expect(proxyConfig({ ...proxy, mode: 'direct' })).toEqual({ mode: 'direct' });
    expect(proxyConfig({ ...proxy, mode: 'http', host: 'proxy.lan', port: 3128 })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.lan:3128',
    });
    expect(proxyConfig({ ...proxy, mode: 'socks5', host: '10.0.0.2', port: 1080 }, { loopback: true })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://10.0.0.2:1080',
      proxyBypassRules: '<-loopback>',
    });
    expect(proxyConfig({ ...proxy, mode: 'http', host: 'proxy.lan', port: null })).toEqual({ mode: 'system' });
    expect(proxyConfig({ ...proxy, mode: 'http', host: 'user:pw@proxy', port: 8080 })).toEqual({ mode: 'system' });
  });

  it('accepts host names and IP addresses only', () => {
    expect(isProxyHost('127.0.0.1')).toBe(true);
    expect(isProxyHost('my-proxy.example.com')).toBe(true);
    expect(isProxyHost('[::1]')).toBe(true);
    expect(isProxyHost('http://proxy')).toBe(false);
    expect(isProxyHost('proxy:8080')).toBe(false);
    expect(isProxyHost('')).toBe(false);
  });
});
