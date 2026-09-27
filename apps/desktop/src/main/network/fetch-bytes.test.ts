import { describe, expect, it } from 'vitest';
import { createFetchBytes } from './fetch-bytes';

const respond = (body: ConstructorParameters<typeof Response>[0], init: ResponseInit = {}) =>
  createFetchBytes(async () => new Response(body, init));

describe('createFetchBytes', () => {
  it('returns the body, or null on 404', async () => {
    expect((await respond('hello')('https://x/a', { maxBytes: 10 }))?.toString()).toBe('hello');
    expect(await respond('gone', { status: 404 })('https://x/a', { maxBytes: 10 })).toBeNull();
  });

  it('fails on HTTP errors and network errors', async () => {
    await expect(respond('no', { status: 503 })('https://x/a', { maxBytes: 10 })).rejects.toMatchObject({
      code: 'http',
      status: 503,
    });
    const offline = createFetchBytes(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline('https://x/a', { maxBytes: 10 })).rejects.toMatchObject({ code: 'network' });
  });

  it('stops reading a body larger than allowed, with or without a content-length', async () => {
    await expect(
      respond('x'.repeat(20), { headers: { 'content-length': '20' } })('https://x/a', { maxBytes: 10 }),
    ).rejects.toThrow(/larger than/);
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
    });
    await expect(respond(stream)('https://x/a', { maxBytes: 100 })).rejects.toThrow(/larger than/);
  });

  it('times out', async () => {
    const hanging = createFetchBytes(
      (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    await expect(hanging('https://x/a', { maxBytes: 10, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
