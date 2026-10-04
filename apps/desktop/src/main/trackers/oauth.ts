import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { AppError } from '@manga-reader/shared/errors';

export const LOGIN_TIMEOUT_MS = 180_000;

export interface LoginResult {
  accessToken: string;
  /** Seconds the token lasts, when the tracker says. */
  expiresInSec: number | null;
}

export interface LoopbackLoginOptions {
  /** The port the tracker's app is registered to send the browser to (0: any, for tests). */
  port: number;
  /** The address to open in the browser. */
  authorizeUrl: (state: string) => string;
  open: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called once the server listens, with its port. */
  onListening?: (port: number) => void;
}

const PAGE = (body: string, script = '') =>
  `<!doctype html><meta charset="utf-8"><title>Matane</title><body style="font:16px system-ui;margin:3em;text-align:center">${body}${script}`;

/**
 * Logs in through the system browser with the implicit grant: the tracker redirects the browser to
 * `http://127.0.0.1:<port>/callback#access_token=…`. A fragment never reaches a server, so that page
 * (ours, with one inline script and nothing from outside) forwards it to `/done`. The server lives
 * only while the login runs, answers only to this machine's own address, and takes the first token
 * that comes with the right `state` (when the tracker sends one back).
 */
export function loopbackLogin(options: LoopbackLoginOptions): Promise<LoginResult> {
  const state = randomBytes(16).toString('hex');
  return new Promise<LoginResult>((resolve, reject) => {
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

    function finish(outcome: LoginResult | Error) {
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
      if (url.pathname === '/callback') {
        const error = url.searchParams.get('error');
        if (error) {
          send(res, 200, PAGE('The login was refused. You can close this window.'));
          finish(new AppError('unknown', `The tracker refused the login (${error})`));
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
        const token = url.searchParams.get('access_token');
        const returned = url.searchParams.get('state');
        if (!token || token.length > 4096 || (returned !== null && returned !== state)) {
          send(res, 400, PAGE('This login does not match the one Matane started. You can close this window.'));
          return;
        }
        const expires = Number(url.searchParams.get('expires_in'));
        send(res, 200, PAGE('<h2>Connected</h2><p>You can close this window and go back to Matane.</p>'));
        finish({ accessToken: token, expiresInSec: Number.isFinite(expires) && expires > 0 ? expires : null });
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
      Promise.resolve(options.open(options.authorizeUrl(state))).catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}
