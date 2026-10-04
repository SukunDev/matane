import { type IncomingMessage, request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loopbackLogin } from './oauth';

/** A request to the login server, as a browser (or something else) would make it. */
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: IncomingMessage['headers'] }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Starts a login on any port; `started` resolves once the server listens. */
function login(extra: { timeoutMs?: number; signal?: AbortSignal; port?: number } = {}) {
  let opened: URL | undefined;
  let listening = 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const result = loopbackLogin({
    port: extra.port ?? 0,
    authorizeUrl: (state) => `https://tracker.test/authorize?client_id=1&response_type=token&state=${state}`,
    open: (url) => void (opened = new URL(url)),
    onListening: (port) => {
      listening = port;
      ready();
    },
    timeoutMs: extra.timeoutMs,
    signal: extra.signal,
  });
  // A test that never reads the outcome must not leave an unhandled rejection behind.
  result.catch(() => undefined);
  return {
    started,
    result,
    port: () => listening,
    state: () => opened!.searchParams.get('state')!,
    opened: () => opened,
  };
}

describe('loopbackLogin', () => {
  it('opens the browser, serves the page that forwards the fragment, and takes the token', async () => {
    const l = login();
    await l.started;
    expect(l.opened()!.origin + l.opened()!.pathname).toBe('https://tracker.test/authorize');
    expect(l.state()).toMatch(/^[0-9a-f]{32}$/);

    const page = await get(l.port(), '/callback');
    expect(page.status).toBe(200);
    expect(page.body).toContain('location.hash');
    expect(page.body).not.toMatch(/https?:\/\/(?!127)/); // nothing from outside
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");

    const done = await get(l.port(), `/done?access_token=abc.def&token_type=Bearer&expires_in=3600&state=${l.state()}`);
    expect(done.status).toBe(200);
    expect(await l.result).toEqual({ accessToken: 'abc.def', expiresInSec: 3600 });
    // The server is gone once the login is over.
    await expect(get(l.port(), '/callback')).rejects.toThrow();
  });

  it('accepts a token that comes without a state (a tracker that does not send it back)', async () => {
    const l = login();
    await l.started;
    await get(l.port(), '/done?access_token=tok');
    expect(await l.result).toEqual({ accessToken: 'tok', expiresInSec: null });
  });

  it('refuses a token with the wrong state and goes on waiting for the right one', async () => {
    const l = login();
    await l.started;
    const wrong = await get(l.port(), '/done?access_token=evil&state=nope');
    expect(wrong.status).toBe(400);
    await get(l.port(), `/done?access_token=good&state=${l.state()}`);
    expect((await l.result).accessToken).toBe('good');
  });

  it('answers only to its own address and to GET', async () => {
    const l = login();
    await l.started;
    expect((await get(l.port(), '/callback', { host: 'evil.example' })).status).toBe(400);
    expect((await get(l.port(), '/callback', { host: `localhost:${l.port()}` })).status).toBe(200);
    expect((await get(l.port(), '/elsewhere')).status).toBe(404);
    expect((await get(l.port(), '/done')).status).toBe(400);
    await get(l.port(), '/done?access_token=x');
    await l.result;
  });

  it('fails when the tracker sends the browser back with an error', async () => {
    const l = login();
    await l.started;
    const outcome = l.result.catch((e: Error) => e);
    await get(l.port(), '/callback?error=access_denied');
    expect(((await outcome) as Error).message).toMatch(/access_denied/);
  });

  it('gives up after the timeout, with a hint about the redirect url', async () => {
    const l = login({ timeoutMs: 40 });
    await l.started;
    await expect(l.result).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringContaining('redirect URL'),
    });
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const l = login({ signal: controller.signal });
    await l.started;
    controller.abort();
    await expect(l.result).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('says so when the port is taken', async () => {
    const first = login();
    await first.started;
    const second = login({ port: first.port() });
    await expect(second.result).rejects.toThrow(/in use/);
    await get(first.port(), '/done?access_token=x');
    await first.result;
  });
});
