import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { HttpRequest } from '@manga-reader/extension-sdk';
import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';
import { AppError } from '@manga-reader/shared/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionHost } from './host';
import type { HostMethods, MainMethods } from './protocol';
import { type RpcHandlers, type RpcMessage, RpcPeer, type RpcTransport } from './rpc';

const transport = (port: MessagePort): RpcTransport => ({
  send: (message) => port.postMessage(message),
  listen: (handler) => {
    const listener = (message: RpcMessage) => handler(message);
    port.on('message', listener);
    return () => port.off('message', listener);
  },
});

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function channel() {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  return [transport(port1), transport(port2)] as const;
}

describe('RpcPeer', () => {
  type A = { add(p: { a: number; b: number }): number; fail(p: Record<string, never>): void };
  type B = { ping(p: { n: number }): string };

  it('calls in both directions and carries typed errors', async () => {
    const [left, right] = channel();
    const a = new RpcPeer<A, B>(left, {
      add: ({ a, b }) => a + b,
      fail: () => {
        throw new AppError('not_found', 'nope', 404);
      },
    });
    const b = new RpcPeer<B, A>(right, { ping: async ({ n }) => `pong ${n}` });

    await expect(b.request('add', { a: 2, b: 3 })).resolves.toBe(5);
    await expect(a.request('ping', { n: 7 })).resolves.toBe('pong 7');
    const error = await b.request('fail', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'not_found', message: 'nope', status: 404 });
  });

  it('rejects pending requests when closed and times out silent peers', async () => {
    const [left] = channel();
    const lonely = new RpcPeer<A, B>(left, { add: () => 0, fail: () => undefined });
    await expect(lonely.request('ping', { n: 1 }, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    const pending = lonely.request('ping', { n: 2 });
    lonely.close(new AppError('host_crashed', 'gone'));
    await expect(pending).rejects.toMatchObject({ code: 'host_crashed' });
    await expect(lonely.request('ping', { n: 3 })).rejects.toMatchObject({ code: 'host_crashed' });
  });
});

const manifest: ExtensionManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  apiVersion: 1,
  nsfw: false,
  domains: ['example.com'],
  sources: [{ key: 'en', lang: 'en', name: 'Demo' }],
};

const CODE = `globalThis.__extension = {
  preferences: () => [{ type: 'switch', key: 'hd', label: 'HD', default: true }],
  createSource: (info) => ({
    baseUrl: 'https://example.com',
    async getPopular(page) {
      const res = await http.get('https://example.com/list?page=' + page);
      await storage.set('last', page);
      log.info('listed', page);
      return { items: [{ url: '/a', title: res.body + ' ' + info.lang + ' hd=' + prefs.get('hd') }], hasNextPage: false };
    },
    async search() { await http.get('https://example.com/cf'); },
    async getMangaDetails() { const a = []; while (true) a.push(new Array(100000).fill(1)); },
  }),
};`;

function setup(mainOverrides: Partial<RpcHandlers<MainMethods>> = {}) {
  const [mainSide, hostSide] = channel();
  const store = new Map<string, unknown>();
  const requests: HttpRequest[] = [];
  const logs: string[] = [];
  const getExtension = vi.fn(() => ({ code: CODE, manifest }));
  const main = new RpcPeer<MainMethods, HostMethods>(mainSide, {
    getExtension,
    http: ({ request }) => {
      requests.push(request);
      if (request.url.endsWith('/cf')) throw new AppError('cloudflare', 'challenge');
      return { status: 200, url: request.url, headers: {}, body: 'hello' };
    },
    storage: ({ op, key, value }) => {
      if (op === 'set') store.set(key, value);
      else if (op === 'remove') store.delete(key);
      return op === 'get' ? (store.get(key) ?? null) : null;
    },
    log: ({ level, message }) => void logs.push(`${level} ${message}`),
    ...mainOverrides,
  });
  let now = 0;
  const hostPeer: RpcPeer<HostMethods, MainMethods> = new RpcPeer(hostSide, {
    call: (p) => host.handlers.call(p),
    unload: (p) => host.handlers.unload(p),
    stats: (p) => host.handlers.stats(p),
  });
  const host: ExtensionHost = new ExtensionHost(hostPeer, { appName: 'Test', appVersion: '1' }, 1000, () => now);
  return { main, host, store, requests, logs, getExtension, advance: (ms: number) => (now += ms) };
}

const call = (main: RpcPeer<MainMethods, HostMethods>, method: string, prefs: Record<string, unknown> = {}) =>
  main.request('call', { extensionId: 'demo', sourceKey: 'en', method, args: [1], prefs });

describe('ExtensionHost', () => {
  it('loads the extension on first call and routes http/storage/log through main', async () => {
    const { main, store, requests, logs, getExtension } = setup();
    await expect(call(main, 'getPopular')).resolves.toEqual({
      items: [{ url: '/a', title: 'hello en hd=true' }],
      hasNextPage: false,
    });
    await call(main, 'getPopular', { hd: false });
    expect(getExtension).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.url)).toEqual(['https://example.com/list?page=1', 'https://example.com/list?page=1']);
    expect(store.get('last')).toBe(1);
    expect(logs).toContain('info listed 1');
  });

  it('applies stored preferences over the defaults', async () => {
    const { main } = setup();
    await expect(call(main, 'getPopular', { hd: false })).resolves.toMatchObject({
      items: [{ title: 'hello en hd=false' }],
    });
  });

  it('surfaces host failures to the extension as SDK errors, and back to main as codes', async () => {
    const { main } = setup();
    await expect(call(main, 'search')).rejects.toMatchObject({ code: 'cloudflare' });
    await expect(call(main, 'getLatest')).rejects.toMatchObject({ code: 'not_implemented' });
  });

  it('reloads a runtime after it runs out of memory', async () => {
    const { main, getExtension } = setup();
    await expect(call(main, 'getMangaDetails')).rejects.toMatchObject({ code: 'memory' });
    await call(main, 'getPopular');
    expect(getExtension).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('disposes idle runtimes and reports failed loads', async () => {
    const { main, host, advance } = setup();
    await call(main, 'getPopular');
    expect(host.loadedIds()).toEqual(['demo']);
    advance(999);
    expect(host.sweep()).toEqual([]);
    advance(1);
    expect(host.sweep()).toEqual(['demo']);

    const broken = setup({ getExtension: () => ({ code: 'globalThis.x = 1;', manifest }) });
    await expect(call(broken.main, 'getPopular')).rejects.toMatchObject({
      code: 'extension',
      message: expect.stringMatching(/did not register/),
    });
  });
});
