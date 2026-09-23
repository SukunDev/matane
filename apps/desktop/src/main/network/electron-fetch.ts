import { Readable } from 'node:stream';
import { type Session, net } from 'electron';
import type { FetchFn } from './extension-fetcher';

/**
 * `fetch` on top of `net.request` for one session. Electron's own `net.fetch` rejects on
 * `redirect: 'manual'` ("Redirect was cancelled"), but ExtensionFetcher needs the 3xx response to
 * check every hop against the allowlist. Redirects are never followed here.
 */
export function sessionFetch(session: Session): FetchFn {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      const request = net.request({
        url,
        method: init.method ?? 'GET',
        session,
        useSessionCookies: true,
        credentials: 'include',
        redirect: 'manual',
        bypassCustomProtocolHandlers: true,
      });
      new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));

      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        action();
      };
      const onAbort = () => {
        request.abort();
        finish(() => reject(signal?.reason ?? new Error('aborted')));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
        request.abort();
        const headers = toHeaders(responseHeaders);
        headers.set('location', redirectUrl);
        finish(() => resolve(new Response(null, { status: statusCode, headers })));
      });
      request.on('response', (response) => {
        const headers = toHeaders(response.headers);
        // IncomingMessage is a Node Readable at runtime; the typings only list its events.
        const stream = response as unknown as Readable;
        const nullBody = response.statusCode === 204 || response.statusCode === 304 || init.method === 'HEAD';
        const body = nullBody ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>);
        if (nullBody) stream.resume();
        finish(() => resolve(new Response(body, { status: response.statusCode, headers })));
      });
      request.on('error', (error) => finish(() => reject(error)));

      if (typeof init.body === 'string') request.write(init.body);
      request.end();
    });
}

function toHeaders(raw: Record<string, string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}
