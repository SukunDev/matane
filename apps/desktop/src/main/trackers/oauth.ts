import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { AppError } from '@manga-reader/shared/errors';

export const LOGIN_TIMEOUT_MS = 180_000;

export interface LoopbackOptions {
  /** The port the tracker's app is registered to send the browser to (0: any, for tests). */
  port: number;
  /** The address to open in the browser. */
  /** The address to open; `port` is where the server listens (the redirect URL for a port-less test). */
  authorizeUrl: (state: string, port: number) => string;
  /** The tracker sends `state` back (the code flow always does): a login without it is refused. */
  requireState?: boolean;
  open: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called once the server listens, with its port. */
  onListening?: (port: number) => void;
}

const PAGE = (body: string, script = '') =>
  `<!doctype html><meta charset="utf-8"><title>Matane</title><body style="font:16px system-ui;margin:3em;text-align:center">${body}${script}`;

/**
 * Sends the user to a tracker's login in the system browser and waits for the browser to come back to
 * `http://127.0.0.1:<port>/callback`, resolving with what the redirect carried (`access_token` for the
 * implicit grant, `code` for the code flow, plus `state` and the rest).
 *
 * - The code flow comes back as `/callback?code=…`.
 * - The implicit grant puts the token in the URL *fragment*, which never reaches a server, so that
 *   page (ours: one inline script, nothing from outside) forwards it to `/done`.
 *
 * The server lives only while the login runs, answers only to this machine's own address, and takes
 * the first answer with the right `state` (always checked when `requireState`, else when it is sent).
 */
export function loopbackAuthorize(options: LoopbackOptions): Promise<Record<string, string>> {
  const state = randomBytes(16).toString('hex');
  return new Promise<Record<string, string>>((resolve, reject) => {
    let settled = false;
    const server = createServer();
    const timer = setTimeout(
      () =>
        finish(
          new AppError(
            'timeout',
            "The login did not come back in time; check that the tracker app's redirect URL matches Matane's",
          ),
        ),
      options.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    const onAbort = () => finish(new AppError('cancelled', 'Login cancelled'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    function finish(outcome: Record<string, string> | Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      server.close();
      server.closeAllConnections();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    }

    const send = (res: ServerResponse, status: number, html: string) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      });
      res.end(html);
    };

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const port = (server.address() as { port: number } | null)?.port;
      const host = req.headers.host ?? '';
      // Only requests to our own address (a web page cannot reach this with another Host).
      if (req.method !== 'GET' || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
        send(res, 400, PAGE('Bad request'));
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const params = Object.fromEntries(url.searchParams);
      const stateMatches = (returned: string | undefined) =>
        returned === undefined ? !options.requireState : returned === state;
      const mismatch = () =>
        send(res, 400, PAGE('This login does not match the one Matane started. You can close this window.'));
      if (url.pathname === '/callback') {
        const error = url.searchParams.get('error');
        if (error) {
          send(res, 200, PAGE('The login was refused. You can close this window.'));
          finish(new AppError('unknown', `The tracker refused the login (${error})`));
          return;
        }
        if (params['code'] !== undefined) {
          if (params['code'].length > 4096 || !stateMatches(params['state'])) return mismatch();
          send(res, 200, PAGE('<h2>Connected</h2><p>You can close this window and go back to Matane.</p>'));
          finish(params);
          return;
        }
        send(
          res,
          200,
          PAGE(
            '<p id="m">Finishing the login…</p>',
            `<script>var h=location.hash.slice(1);if(h){location.replace('/done?'+h)}else{document.getElementById('m').textContent='No login came back. You can close this window.'}</script>`,
          ),
        );
      } else if (url.pathname === '/done') {
        const token = params['access_token'];
        if (!token || token.length > 4096 || !stateMatches(params['state'])) return mismatch();
        send(res, 200, PAGE('<h2>Connected</h2><p>You can close this window and go back to Matane.</p>'));
        finish(params);
      } else {
        send(res, 404, PAGE('Not found'));
      }
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'EADDRINUSE'
          ? new AppError(
              'unknown',
              `Port ${options.port} is in use, so the login cannot come back to Matane. Close what uses it and try again`,
            )
          : error,
      );
    });
    server.listen(options.port, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      options.onListening?.(port);
      Promise.resolve(options.open(options.authorizeUrl(state, port))).catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}
