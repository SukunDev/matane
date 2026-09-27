import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { type Site, type SiteExtension, extensionFiles, startSite } from './site';

export interface TestApp {
  site: Site;
  app: ElectronApplication;
  page: Page;
  home: string;
  /**
   * Quits and starts the app again on the same profile (`app`/`page` are replaced); `between`
   * runs while it is closed (e.g. to edit the database).
   */
  restart: (between?: () => void) => Promise<void>;
  close: () => Promise<void>;
}

async function start(home: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    // GitHub's Ubuntu runners forbid the unprivileged user namespaces Chromium's sandbox needs.
    args: [resolve(__dirname, '../..'), ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), ELECTRON_ENABLE_LOGGING: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('aside');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860));
  return { app, page };
}

/**
 * Fake site + a fresh app profile with the site's extensions loaded from dev folders ("e2e-demo",
 * and "e2e-mirror" as a second extension). Dev folders are remembered, so a restart keeps them.
 */
export async function launchApp(extensions: SiteExtension[] = ['demo', 'mirror']): Promise<TestApp> {
  const site = await startSite();
  const home = mkdtempSync(join(tmpdir(), 'matane-e2e-'));
  const started = await start(home);
  const test: TestApp = {
    site,
    home,
    ...started,
    restart: async (between) => {
      await test.app.close();
      between?.();
      Object.assign(test, await start(home));
    },
    close: async () => {
      await test.app.close();
      await site.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
  // Downloads (manual or download ahead) stay inside the test profile, never in ~/Documents.
  await test.page.evaluate(
    async (folder) => {
      const { downloads } = await window.api.invoke('settings.get');
      await window.api.invoke('settings.set', { downloads: { ...downloads, folder } });
    },
    join(home, 'downloads'),
  );
  for (const which of extensions) {
    const dir = join(home, `e2e-${which}`);
    mkdirSync(dir);
    for (const [name, content] of Object.entries(extensionFiles(site.origin, which))) {
      writeFileSync(join(dir, name), content);
    }
    await test.page.evaluate((path) => window.api.invoke('extensions.loadDevFolder', { path }), dir);
  }
  return test;
}
