import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ExtensionManifest, HttpRequest, HttpResponse } from '@matane/extension-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionRuntimeError } from './errors.js';
import { ExtensionRuntime, type HostApi, type RuntimeLimits } from './runtime.js';

const manifest: ExtensionManifest = {
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  apiVersion: 1,
  nsfw: false,
  domains: ['example.com', '*.cdn.example.com'],
  sources: [{ key: 'en', lang: 'en', name: 'Test' }],
};

/** Wraps a source object literal (as JS source) into what `mr-ext build` produces. */
const bundle = (sourceBody: string, extra = '') =>
  `globalThis.__extension = { createSource: (info) => ({ baseUrl: 'https://example.com', info, ${sourceBody} }) ${extra} };`;

function createHost(responses: Record<string, Partial<HttpResponse>> = {}) {
  const store = new Map<string, unknown>();
  const logs: string[] = [];
  const host: HostApi = {
    http: vi.fn(async (request: HttpRequest): Promise<HttpResponse> => {
      const response = responses[request.url];
      if (!response) return { status: 404, url: request.url, headers: {}, body: '' };
      return { status: 200, url: request.url, headers: {}, body: '', ...response };
    }),
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => void store.set(key, value),
      remove: async (key) => void store.delete(key),
    },
    log: (level, message) => void logs.push(`${level}: ${message}`),
  };
  return { host, store, logs };
}

const runtimes: ExtensionRuntime[] = [];
async function load(code: string, host: HostApi = createHost().host, limits?: Partial<RuntimeLimits>) {
  const runtime = await ExtensionRuntime.create({
    code,
    manifest,
    host,
    hostInfo: { appName: 'Matane', appVersion: '0.0.0-test', apiVersion: 1 },
    limits,
  });
  runtimes.push(runtime);
  return runtime;
}
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

async function expectRuntimeError(promise: Promise<unknown>, code: ExtensionRuntimeError['code']) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExtensionRuntimeError);
  expect((error as ExtensionRuntimeError).code).toBe(code);
  return error as ExtensionRuntimeError;
}

describe('ExtensionRuntime', () => {
  it('calls source methods with JSON arguments and exposes source info and host info', async () => {
    const runtime = await load(
      bundle(
        `async getPopular(page) { return { items: [{ url: '/p' + page, title: this.info.lang + ' ' + host.appName }], hasNextPage: page < 2 }; }`,
      ),
    );
    await expect(runtime.call('en', 'getPopular', [1])).resolves.toEqual({
      items: [{ url: '/p1', title: 'en Matane' }],
      hasNextPage: true,
    });
    await expect(runtime.call('en', '__info')).resolves.toEqual({ baseUrl: 'https://example.com', capabilities: [] });
  });

  it('parses HTML on the host and returns plain data', async () => {
    const { host } = createHost({
      'https://example.com/popular': {
        body: '<div class="card"><a href="/m/1"><img src="/c/1.jpg"></a><h3> One </h3></div><div class="card"><a href="/m/2"></a><h3>Two</h3></div>',
      },
    });
    const runtime = await load(
      bundle(`async getPopular() {
        const res = await http.get('https://example.com/popular');
        const doc = html.load(res.body, { baseUrl: 'https://example.com' });
        return { items: doc.select('.card').map((el) => ({
          url: el.selectFirst('a').attr('href'),
          title: el.selectFirst('h3').text(),
          thumbnailUrl: el.selectFirst('img') ? el.selectFirst('img').absUrl('src') : undefined,
        })), hasNextPage: false };
      }`),
      host,
    );
    await expect(runtime.call('en', 'getPopular', [1])).resolves.toEqual({
      items: [
        { url: '/m/1', title: 'One', thumbnailUrl: 'https://example.com/c/1.jpg' },
        { url: '/m/2', title: 'Two' },
      ],
      hasNextPage: false,
    });
  });

  it('exposes no Node or browser escape hatches', async () => {
    const runtime = await load(
      bundle(
        `async getPopular() { return { items: [], hasNextPage: false, globals: [typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof __hostSync, typeof __hostAsync] }; }`,
      ),
    );
    const result = await runtime.call<{ globals: string[] }>('en', 'getPopular', [1]);
    expect(result.globals).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  it('enforces the manifest domain allowlist', async () => {
    const { host } = createHost();
    const runtime = await load(
      bundle(`async getPopular(page) {
        const urls = ['https://evil.com/x', 'https://example.com.evil.com/x', 'file:///etc/passwd', 'https://img.cdn.example.com/a.jpg'];
        const outcomes = [];
        for (const url of urls) {
          try { const r = await http.request({ url }); outcomes.push('ok ' + r.status); } catch (e) { outcomes.push(e.name); }
        }
        return outcomes;
      }`),
      host,
    );
    await expect(runtime.call('en', 'getPopular', [1])).resolves.toEqual([
      'NetworkError',
      'NetworkError',
      'NetworkError',
      'ok 404',
    ]);
    expect(host.http).toHaveBeenCalledTimes(1);
  });

  it('surfaces HTTP status errors from http.get with their status', async () => {
    const runtime = await load(bundle(`async getPopular() { await http.get('https://example.com/missing'); }`));
    const error = await expectRuntimeError(runtime.call('en', 'getPopular', [1]), 'extension');
    expect(error.extensionError).toMatchObject({ name: 'HttpError', status: 404 });
  });

  it('interrupts runaway synchronous code and stays usable afterwards', async () => {
    const runtime = await load(
      bundle(
        `async getPopular(page) { if (page === 1) { while (true) {} } return { items: [], hasNextPage: false }; }`,
      ),
      undefined,
      { syncMs: 100 },
    );
    await expectRuntimeError(runtime.call('en', 'getPopular', [1]), 'interrupted');
    await expect(runtime.call('en', 'getPopular', [2])).resolves.toEqual({ items: [], hasNextPage: false });
  });

  it('enforces the memory limit', async () => {
    const runtime = await load(
      bundle(`async getPopular() { const chunks = []; while (true) chunks.push(new Array(100000).fill(1)); }`),
      undefined,
      { memoryBytes: 16 * 1024 * 1024 },
    );
    await expectRuntimeError(runtime.call('en', 'getPopular', [1]), 'memory');
  });

  it('times out calls that wait too long', async () => {
    const runtime = await load(bundle(`async getPopular() { await timers.sleep(5000); }`), undefined, {
      callTimeoutMs: 100,
    });
    await expectRuntimeError(runtime.call('en', 'getPopular', [1]), 'timeout');
  });

  it('provides storage, prefs, logging and crypto helpers', async () => {
    const { host, store, logs } = createHost();
    const runtime = await load(
      bundle(`async getPopular() {
        await storage.set('token', { a: 1 });
        const token = await storage.get('token');
        const missing = await storage.get('nope');
        console.log('hello', { n: 1 });
        return { token, missing: missing === undefined, quality: prefs.get('quality'), md5: crypto.md5('abc'),
          b64: base64.decode(base64.encode('héllo')), bytes: utf8.encode('hi') };
      }`),
      host,
    );
    const result = await runtime.call('en', 'getPopular', [1], { prefs: { quality: 'data-saver' } });
    expect(result).toEqual({
      token: { a: 1 },
      missing: true,
      quality: 'data-saver',
      md5: '900150983cd24fb0d6963f7d28e17f72',
      b64: 'héllo',
      bytes: [104, 105],
    });
    expect(store.get('token')).toEqual({ a: 1 });
    expect(logs).toContain('info: hello {"n":1}');
  });

  it('invalidates HTML handles once the call finishes', async () => {
    const { host } = createHost({ 'https://example.com/': { body: '<p>x</p>' } });
    const runtime = await load(
      bundle(`async getPopular(page) {
        if (page === 1) { globalThis.kept = html.load((await http.get('https://example.com/')).body); return 'kept'; }
        return globalThis.kept.text();
      }`),
      host,
    );
    await runtime.call('en', 'getPopular', [1]);
    const error = await expectRuntimeError(runtime.call('en', 'getPopular', [2]), 'extension');
    expect(error.message).toMatch(/Stale HTML handle/);
  });

  it('reports unimplemented optional methods and preferences', async () => {
    const runtime = await load(
      bundle(
        `async getPopular() { return null; }`,
        `, preferences: () => [{ type: 'switch', key: 'hd', label: 'HD', default: true }]`,
      ),
    );
    const error = await expectRuntimeError(runtime.call('en', 'getLatest', [1]), 'extension');
    expect(error.extensionError?.name).toBe('NotImplementedError');
    await expect(runtime.call('en', '__preferences')).resolves.toEqual([
      { type: 'switch', key: 'hd', label: 'HD', default: true },
    ]);
  });

  it('reports heap usage and still disposes cleanly afterwards', async () => {
    const runtime = await load(
      bundle(`async getPopular() { globalThis.big = new Array(200000).fill(1); return null; }`),
    );
    const before = runtime.memoryUsage();
    await runtime.call('en', 'getPopular', [1]);
    expect(runtime.memoryUsage()).toBeGreaterThan(before + 1_000_000);
    runtime.dispose();
    runtimes.splice(runtimes.indexOf(runtime), 1);
  });

  it('survives large allocations after an await (WASM memory growth during pending jobs)', async () => {
    const runtime = await load(
      bundle(`async getPopular() {
        await timers.sleep(1);
        const items = [];
        for (let i = 0; i < 200000; i++) items.push({ url: '/' + i, title: 'Title ' + i });
        return { items: items.slice(0, 2), hasNextPage: items.length > 2 };
      }`),
      undefined,
      { memoryBytes: 256 * 1024 * 1024, syncMs: 30_000 },
    );
    await expect(runtime.call('en', 'getPopular', [1])).resolves.toMatchObject({ hasNextPage: true });
    runtime.dispose();
    runtimes.splice(runtimes.indexOf(runtime), 1);
  }, 30_000);

  it('rejects bundles that do not register an extension', async () => {
    await expect(load('globalThis.nothing = 1;')).rejects.toThrow(/did not register/);
  });
});

describe('binary data and Phase 4 hooks', () => {
  it('decrypts AES in the host and moves bytes as base64', async () => {
    const key = randomBytes(16);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const secret = Buffer.concat([cipher.update('hello from the host'), cipher.final()]);
    const runtime = await load(
      bundle(`async search(input) {
        const [data, key, iv] = input.split(':').map((b) => base64.decodeBytes(b));
        const plain = crypto.aesDecrypt(data, key, { mode: 'cbc', iv });
        const ctr = crypto.aesDecrypt(plain, key, { mode: 'ctr', iv });
        return { items: [{ url: utf8.decode(plain), title: base64.encodeBytes(ctr) }], hasNextPage: plain instanceof Uint8Array };
      }`),
    );
    const input = [secret, key, iv].map((b) => b.toString('base64')).join(':');
    const result = await runtime.call<{ items: { url: string; title: string }[]; hasNextPage: boolean }>(
      'en',
      'search',
      [input],
    );
    expect(result.items[0]?.url).toBe('hello from the host');
    expect(result.hasNextPage).toBe(true);
    const ctr = createDecipheriv('aes-128-ctr', key, iv);
    expect(result.items[0]?.title).toBe(
      Buffer.concat([ctr.update(Buffer.from('hello from the host')), ctr.final()]).toString('base64'),
    );
  });

  it('reports bad AES input as an extension error', async () => {
    const runtime = await load(
      bundle(
        `async getPopular() { crypto.aesDecrypt([1, 2, 3], 'short key', { mode: 'cbc', iv: new Uint8Array(16) }); }`,
      ),
    );
    const error = await expectRuntimeError(runtime.call('en', 'getPopular', [1]), 'extension');
    expect(error.message).toMatch(/key must be 16, 24 or 32 bytes/);
  });

  it('runs transformImage on bytes that cross as ArrayBuffers', async () => {
    const runtime = await load(
      bundle(`transformImage(page, bytes) {
        const out = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ 0x5a;
        return { bytes: out, tiles: { width: 2, height: 1, ops: [{ sx: 1, sy: 0, w: 1, h: 1, dx: 0, dy: 0 }] }, index: page.index };
      }`),
    );
    const input = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251);
    const result = await runtime.transformImage('en', { index: 3, imageUrl: 'https://example.com/3.jpg' }, input);
    expect(result.bytes).toHaveLength(input.length);
    expect(result.bytes![1000]).toBe(input[1000]! ^ 0x5a);
    expect(result.tiles).toEqual({ width: 2, height: 1, ops: [{ sx: 1, sy: 0, w: 1, h: 1, dx: 0, dy: 0 }] });
    await expect(runtime.call('en', '__info')).resolves.toMatchObject({ capabilities: ['transformImage'] });
  });

  it('migrates urls in batches, keeping the ones it fails on', async () => {
    const runtime = await load(
      bundle(`migrateUrl(url, kind, from) {
        if (url === '/bad') throw new Error('cannot read ' + url);
        if (kind === 'chapter') return null;
        return from === '1.0.0' ? '/series' + url : url;
      }`),
    );
    const result = await runtime.migrateUrls(
      'en',
      [
        { url: '/a', kind: 'manga' },
        { url: '/bad', kind: 'manga' },
        { url: '/a/1', kind: 'chapter' },
      ],
      '1.0.0',
    );
    expect(result).toEqual({ urls: ['/series/a', null, null], errors: ['/bad: cannot read /bad'] });
    // Without the hook, nothing changes.
    const plain = await load(bundle(`async getPopular() { return null; }`));
    await expect(plain.migrateUrls('en', [{ url: '/a', kind: 'manga' }], '1.0.0')).resolves.toEqual({
      urls: [null],
      errors: [],
    });
  });
});
