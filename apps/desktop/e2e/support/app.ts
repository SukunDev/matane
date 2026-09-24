import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { type Site, extensionFiles, startSite } from './site';

export interface TestApp {
  site: Site;
  app: ElectronApplication;
  page: Page;
  home: string;
  close: () => Promise<void>;
}

/** Fake site + a fresh app profile with the e2e-demo extension loaded from a dev folder. */
export async function launchApp(): Promise<TestApp> {
  const site = await startSite();
  const home = mkdtempSync(join(tmpdir(), 'matane-e2e-'));
  const extensionDir = join(home, 'e2e-demo');
  mkdirSync(extensionDir);
  for (const [name, content] of Object.entries(extensionFiles(site.origin)))
    writeFileSync(join(extensionDir, name), content);

  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    // GitHub's Ubuntu runners forbid the unprivileged user namespaces Chromium's sandbox needs.
    args: [resolve(__dirname, '../..'), ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), ELECTRON_ENABLE_LOGGING: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('aside');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860));
  await page.evaluate((path) => window.api.invoke('extensions.loadDevFolder', { path }), extensionDir);
  return {
    site,
    app,
    page,
    home,
    close: async () => {
      await app.close();
      await site.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
