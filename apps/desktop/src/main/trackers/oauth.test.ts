import { type IncomingMessage, request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loopbackAuthorize } from './oauth';

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
function login(extra: { timeoutMs?: number; signal?: AbortSignal; port?: number; requireState?: boolean } = {}) {
  let opened: URL | undefined;
  let listening = 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const result = loopbackAuthorize({
    port: extra.port ?? 0,
    authorizeUrl: (state) => `https://tracker.test/authorize?client_id=1&response_type=token&state=${state}`,
    open: (url) => void (opened = new URL(url)),
    onListening: (port) => {
      listening = port;
      ready();
    },
    requireState: extra.requireState,
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

describe('loopbackAuthorize', () => {
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
    expect(await l.result).toMatchObject({ access_token: 'abc.def', expires_in: '3600', state: l.state() });
    // The server is gone once the login is over.
    await expect(get(l.port(), '/callback')).rejects.toThrow();
  });

  it('accepts a token that comes without a state (a tracker that does not send it back)', async () => {
    const l = login();
    await l.started;
    await get(l.port(), '/done?access_token=tok');
    expect(await l.result).toEqual({ access_token: 'tok' });
  });

  it('refuses a token with the wrong state and goes on waiting for the right one', async () => {
    const l = login();
    await l.started;
    const wrong = await get(l.port(), '/done?access_token=evil&state=nope');
    expect(wrong.status).toBe(400);
    await get(l.port(), `/done?access_token=good&state=${l.state()}`);
    expect((await l.result).access_token).toBe('good');
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

  it('takes the code of the code flow straight from the redirect, with the state it asked for', async () => {
    const l = login({ requireState: true });
    await l.started;
    const page = await get(l.port(), `/callback?code=the-code&state=${l.state()}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Connected');
    expect(await l.result).toEqual({ code: 'the-code', state: l.state() });
  });

  it('insists on the state when the tracker is known to send it back', async () => {
    const l = login({ requireState: true });
    await l.started;
    expect((await get(l.port(), '/callback?code=forged')).status).toBe(400);
    expect((await get(l.port(), '/callback?code=forged&state=nope')).status).toBe(400);
    expect((await get(l.port(), '/done?access_token=forged')).status).toBe(400);
    await get(l.port(), `/callback?code=real&state=${l.state()}`);
    expect((await l.result)['code']).toBe('real');
  });

  it('tells the redirect url with the port it listens on', async () => {
    let seen: { state: string; port: number } | undefined;
    const result = loopbackAuthorize({
      port: 0,
      authorizeUrl: (state, port) => {
        seen = { state, port };
        return `https://tracker.test/authorize?state=${state}`;
      },
      open: () => undefined,
    });
    result.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen!.port).toBeGreaterThan(0);
    await get(seen!.port, '/done?access_token=x');
    await result;
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
