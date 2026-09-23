import type { CloudflareStatus } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { BrowserWindow, type Session } from 'electron';

const POLL_MS = 500;
/** Most challenges clear on their own; after this the user has to help (captcha). */
const SHOW_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 2 * 60_000;

export interface SolveOptions {
  session: Session;
  url: string;
  /** Open visibly right away (the user pressed "Verify"). */
  visible?: boolean;
}

/**
 * Clears Cloudflare challenges in a real browser window that shares the extension's session
 * (partition) and User-Agent, so the resulting `cf_clearance` cookie works for `net.fetch`.
 * Concurrent requests for one extension wait for the same window.
 */
export class CloudflareSolver {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly onStatus: (status: CloudflareStatus) => void) {}

  isSolving(extensionId: string): boolean {
    return this.inflight.has(extensionId);
  }

  solve(extensionId: string, options: SolveOptions): Promise<void> {
    let pending = this.inflight.get(extensionId);
    if (!pending) {
      pending = this.run(extensionId, options).finally(() => this.inflight.delete(extensionId));
      this.inflight.set(extensionId, pending);
    }
    return pending;
  }

  private async run(extensionId: string, { session, url, visible = false }: SolveOptions): Promise<void> {
    const status = (state: CloudflareStatus['state']) => this.onStatus({ extensionId, state });
    const clearance = async () =>
      (await session.cookies.get({ url, name: 'cf_clearance' }).catch(() => []))[0]?.value ?? null;
    const before = await clearance();

    const window = new BrowserWindow({
      width: 960,
      height: 720,
      show: visible,
      title: new URL(url).host,
      autoHideMenuBar: true,
      backgroundColor: '#1e1e2e',
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    status(visible ? 'shown' : 'solving');

    try {
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        let lastStatus = 0;
        window.webContents.on('did-navigate', (_event, _url, code) => (lastStatus = code));
        window.on('closed', () =>
          reject(new AppError('cloudflare', 'The Cloudflare check was closed before it finished')),
        );

        const timer = setInterval(() => {
          void (async () => {
            if (window.isDestroyed()) return clearInterval(timer);
            const value = await clearance();
            const title = window.webContents.getTitle();
            const cleared =
              (value !== null && value !== before) ||
              // Some sites stop challenging without issuing a new cookie.
              (lastStatus >= 200 &&
                lastStatus < 400 &&
                title !== '' &&
                !/just a moment|attention required/i.test(title));
            if (cleared) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - started > GIVE_UP_AFTER_MS) {
              clearInterval(timer);
              reject(new AppError('cloudflare', 'The Cloudflare check did not complete in time'));
            } else if (!window.isVisible() && Date.now() - started > SHOW_AFTER_MS) {
              window.show();
              status('shown');
            }
          })();
        }, POLL_MS);

        void window.loadURL(url).catch(() => undefined);
      });
      status('solved');
    } catch (error) {
      status('failed');
      throw error;
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}
