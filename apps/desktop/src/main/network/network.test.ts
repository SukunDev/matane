import { AppError } from '@manga-reader/shared/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionFetcher, type FetchFn, parseRetryAfter } from './extension-fetcher';
import { TokenBucket } from './token-bucket';
import { browserUserAgent } from './user-agent';

type Route = (init: RequestInit) => Response;

function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new TypeError('fetch failed');
    return handler(init);
  };
  return { fetch, calls };
}

const ok =
  (body = 'ok', headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });
const status =
  (code: number, headers: Record<string, string> = {}, body = '') =>
  () =>
    new Response(body, { status: code, headers });
const redirect =
  (to: string, code = 302) =>
  () =>
    new Response(null, { status: code, headers: { location: to } });

const noSleep = vi.fn(async () => undefined);

function fetcher(
  routes: Record<string, Route | Route[]>,
  extra: Partial<ConstructorParameters<typeof ExtensionFetcher>[0]> = {},
) {
  const fake = fakeFetch(routes);
  const instance = new ExtensionFetcher({
    fetch: fake.fetch,
    userAgent: 'Chrome-ish',
    sleep: noSleep,
    ...extra,
  });
  return { ...fake, fetcher: instance };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

afterEach(() => {
  noSleep.mockClear();
  vi.useRealTimers();
});

describe('ExtensionFetcher', () => {
  it('sends the default User-Agent unless the extension sets one', async () => {
    const { fetcher: f, calls } = fetcher({ 'https://example.com/a': ok('hello') });
    await expect(f.request({ url: 'https://example.com/a' })).resolves.toMatchObject({ status: 200, body: 'hello' });
    expect(new Headers(calls[0]?.init.headers).get('user-agent')).toBe('Chrome-ish');

    const own = fetcher({ 'https://example.com/a': ok() });
    await own.fetcher.request({ url: 'https://example.com/a', headers: { 'User-Agent': 'Matane/1.0' } });
    expect(new Headers(own.calls[0]?.init.headers).get('user-agent')).toBe('Matane/1.0');
  });

  it('follows allowed redirects and reports the final URL', async () => {
    const { fetcher: f } = fetcher({
      'https://example.com/a': redirect('/b'),
      'https://example.com/b': redirect('https://img.cdn.example.com/c'),
      'https://img.cdn.example.com/c': ok('final'),
    });
    await expect(f.request({ url: 'https://example.com/a' })).resolves.toMatchObject({
      url: 'https://img.cdn.example.com/c',
      body: 'final',
    });
  });

  it('refuses redirects to non-http schemes', async () => {
    const { fetcher: f, calls } = fetcher({ 'https://example.com/a': redirect('file:///etc/passwd') });
    const error = await rejection(f.request({ url: 'https://example.com/a' }));
    expect(error.code).toBe('network');
    expect(error.message).toMatch(/http\(s\)/);
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/a']);
  });

  it('refuses non-http schemes up front', async () => {
    const { fetcher: f, calls } = fetcher({});
    await expect(f.request({ url: 'file:///etc/passwd' })).rejects.toThrow(/http\(s\)/);
    expect(calls).toHaveLength(0);
  });

  it('turns POST into GET after 303', async () => {
    const { fetcher: f, calls } = fetcher({
      'https://example.com/login': redirect('/home', 303),
      'https://example.com/home': ok(),
    });
    await f.request({ url: 'https://example.com/login', method: 'POST', body: { form: { a: '1' } } });
    expect(calls[1]?.init).toMatchObject({ method: 'GET', body: undefined });
  });

  it('retries 429/5xx for idempotent requests, honouring Retry-After', async () => {
    const { fetcher: f, calls } = fetcher({
      'https://example.com/a': [status(429, { 'retry-after': '2' }), status(503), ok('third time')],
    });
    await expect(f.request({ url: 'https://example.com/a' })).resolves.toMatchObject({ body: 'third time' });
    expect(calls).toHaveLength(3);
    expect(noSleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 2000]);
  });

  it('gives up after maxRetries and returns the last response', async () => {
    const { fetcher: f, calls } = fetcher({ 'https://example.com/a': [status(500), status(500), status(500)] });
    await expect(f.request({ url: 'https://example.com/a' })).resolves.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(3);
  });

  it('does not retry POST', async () => {
    const { fetcher: f, calls } = fetcher({ 'https://example.com/a': [status(503), ok()] });
    await expect(f.request({ url: 'https://example.com/a', method: 'POST' })).resolves.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it('solves a Cloudflare challenge once, then retries', async () => {
    const solve = vi.fn(async () => undefined);
    const challenge = status(403, { 'cf-mitigated': 'challenge' }, '<html>');
    const { fetcher: f } = fetcher({ 'https://example.com/a': [challenge, ok('after')] }, { solveChallenge: solve });
    await expect(f.request({ url: 'https://example.com/a' })).resolves.toMatchObject({ body: 'after' });
    expect(solve).toHaveBeenCalledWith('https://example.com/a');
  });

  it('detects challenge pages by body and fails with code cloudflare when unsolved', async () => {
    const page = status(503, { server: 'cloudflare' }, '<title>Just a moment...</title>');
    const { fetcher: f } = fetcher({ 'https://example.com/a': page });
    expect((await rejection(f.request({ url: 'https://example.com/a' }))).code).toBe('cloudflare');
    const plain503 = fetcher(
      { 'https://example.com/a': status(503, { server: 'cloudflare' }, 'down') },
      { maxRetries: 0 },
    );
    await expect(plain503.fetcher.request({ url: 'https://example.com/a' })).resolves.toMatchObject({ status: 503 });
  });

  it('maps transport failures and cancellation to typed errors', async () => {
    const { fetcher: f } = fetcher({});
    expect((await rejection(f.request({ url: 'https://example.com/down' }))).code).toBe('network');

    const controller = new AbortController();
    const hanging = new ExtensionFetcher({
      fetch: (_url, init) =>
        new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      userAgent: 'x',
    });
    const pending = hanging.request({ url: 'https://example.com/slow' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the fetch start
    controller.abort();
    expect((await rejection(pending)).code).toBe('cancelled');
  });

  it('decodes json and bytes responses', async () => {
    const { fetcher: f } = fetcher({
      'https://example.com/j': ok('{"a":1}', { 'content-type': 'application/json' }),
      'https://example.com/b': ok('hi'),
    });
    await expect(f.request({ url: 'https://example.com/j', responseType: 'json' })).resolves.toMatchObject({
      body: { a: 1 },
    });
    await expect(f.request({ url: 'https://example.com/b', responseType: 'bytes' })).resolves.toMatchObject({
      body: 'aGk=',
    });
  });
});

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then paces requests', async () => {
    vi.useFakeTimers();
    let now = 0;
    const bucket = new TokenBucket(2, 1000, () => now);
    const done: number[] = [];
    const all = [0, 1, 2, 3].map((i) => bucket.take().then(() => done.push(i)));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0, 1]);
    now = 500;
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toEqual([0, 1, 2]);
    now = 1000;
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(all);
    expect(done).toEqual([0, 1, 2, 3]);
  });

  it('drops aborted waiters from the queue', async () => {
    const bucket = new TokenBucket(1, 60_000);
    await bucket.take();
    const controller = new AbortController();
    const waiting = bucket.take(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:05 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(5000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('strips Electron and app tokens from the UA', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Matane/0.0.0 Chrome/146.0.0.0 Electron/44.4.5 Safari/537.36';
    expect(browserUserAgent(ua)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    );
  });
});
