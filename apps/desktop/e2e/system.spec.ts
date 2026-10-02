import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, writeSetting } from './support/app';

// Phase 3d: close to tray, start at login, offline mode, the activity indicator and
// Settings → Data & storage.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let chapters: Record<string, number>;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const statusOf = async (name: string) =>
  ((await page.evaluate(() => window.api.invoke('downloads.list'))) as { chapterName: string; status: string }[]).find(
    (d) => d.chapterName === name,
  )?.status;
const enqueue = (names: string[]) =>
  page.evaluate(
    (chapterIds) => window.api.invoke('downloads.enqueue', { chapterIds }),
    names.map((n) => chapters[n]!),
  );
const setOnline = (online: boolean | null) =>
  t.app.evaluate(
    (_electron, value) =>
      (globalThis as { __matane?: { setOnline: (v: boolean | null) => void } }).__matane!.setOnline(value),
    online,
  );
const windowVisible = () => t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible());

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  await page.evaluate(async () => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ahead: 0, parallel: 1 } });
  });
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  const mangaId = Number(/manga\/(\d+)/.exec(await page.evaluate(() => location.hash))![1]);
  const list = (await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId)) as {
    id: number;
    name: string;
  }[];
  chapters = Object.fromEntries(list.map((c) => [c.name, c.id]));
});

test.afterAll(async () => {
  await t?.close();
});

test('close to tray hides the window while a download finishes (or is off without a tray)', async () => {
  const tray = (await page.evaluate(() => window.api.invoke('app.tray'))) as { available: boolean };
  await goto('#/settings/general');
  const toggle = page.getByRole('switch', { name: 'Close to tray' });
  if (!tray.available) {
    await expect(toggle).toBeDisabled();
    await expect(page.getByText('Your desktop has no system tray')).toBeVisible();
    return;
  }
  await toggle.click();
  await expect(toggle).toBeChecked();

  // A slow download, shown in the title bar while it runs.
  t.site.pageDelayMs = 500;
  await enqueue(['Ch. 1']);
  await expect(page.getByTestId('activity')).toContainText('Downloading 1');
  await page.evaluate(() => window.api.invoke('window.close'));
  await expect.poll(windowVisible).toBe(false);
  await expect.poll(() => statusOf('Ch. 1'), { timeout: 15_000 }).toBe('done');
  t.site.pageDelayMs = 0;

  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show());
  await expect.poll(windowVisible).toBe(true);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
});

test('start at login writes the autostart entry and removes it again', async () => {
  const file = join(t.home, 'config', 'autostart', 'matane.desktop');
  await goto('#/settings/general');
  await page.getByRole('switch', { name: 'Start at login' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toMatch(/^Exec=.+\S\n/m);
  await page.getByRole('switch', { name: 'Start at login' }).click();
  await expect.poll(() => existsSync(file)).toBe(false);
});

test('offline: browsing says so, downloads wait, downloaded chapters still read', async () => {
  if ((await statusOf('Ch. 1')) !== 'done') {
    await enqueue(['Ch. 1']);
    await expect.poll(() => statusOf('Ch. 1')).toBe('done');
  }
  await setOnline(false);
  await expect(page.getByRole('banner').getByText('Offline')).toBeVisible();

  await goto('#/browse/sources/e2e-demo/en?tab=popular');
  await expect(page.getByText("You're offline")).toBeVisible();
  await goto('#/browse/global-search?q=hero');
  await expect(page.getByText("You're offline")).toBeVisible();

  await enqueue(['Ch. 2']);
  await goto('#/downloads');
  await expect(page.getByText('Offline: the queue waits')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await statusOf('Ch. 2')).toBe('queued');

  await goto(`#/reader/${chapters['Ch. 1']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLImageElement>('img[src^="manga://page/"]')].filter(
            (i) => i.complete && i.naturalWidth > 0,
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(1);

  await setOnline(true);
  await expect(page.getByRole('banner').getByText('Offline')).toHaveCount(0);
  await expect.poll(() => statusOf('Ch. 2')).toBe('done');
  await goto('#/browse/sources/e2e-demo/en?tab=popular');
  await expect(page.getByText('Paged Hero')).toBeVisible();
});

test('an update check that came due while offline runs once back online', async () => {
  const old = Date.now() - 13 * 3_600_000;
  await t.restart(() => writeSetting(t.home, 'updates.lastCheckAt', old), { MATANE_E2E_OFFLINE: '1' });
  page = t.page;
  await expect(page.getByRole('banner').getByText('Offline')).toBeVisible();
  // The scheduler looks 5 s after start; offline, it waits.
  await page.waitForTimeout(6500);
  const lastCheck = () =>
    page.evaluate(async () => (await window.api.invoke('updates.status')).lastCheckAt) as Promise<number | null>;
  expect(await lastCheck()).toBe(old);
  await setOnline(null);
  await expect.poll(lastCheck).toBeGreaterThan(old);
});

test('Data & storage shows the page cache and clears it; the cache size is a setting', async () => {
  // Ch. 3 is not downloaded: reading it fills the page cache.
  await goto(`#/reader/${chapters['Ch. 3']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await goto('#/settings/data');
  const usage = page.getByTestId('page-cache-usage');
  await expect(usage).toContainText('of 1 GB');
  await expect(usage).not.toContainText(/^0 B/);

  await page.getByRole('button', { name: 'Clear page cache' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear page cache' }).click();
  await expect(usage).toHaveText('0 B of 1 GB');

  await page.getByLabel('Page cache size').selectOption({ label: '256 MB' });
  await expect(usage).toHaveText('0 B of 256 MB');
  expect(await page.evaluate(async () => (await window.api.invoke('settings.get')).cacheSizeMb)).toBe(256);
});

test('About shows the version, and app updates are off in development builds', async () => {
  await goto('#/settings/about');
  const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version: string };
  await expect(page.getByTestId('app-version')).toContainText(`Version ${version}`);
  await expect(page.getByTestId('updater-status')).toHaveText('Updates are off in development builds.');
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await page
    .getByRole('radiogroup', { name: 'When a new version is out' })
    .getByRole('radio', { name: 'Only tell me' })
    .click();
  expect(await page.evaluate(async () => (await window.api.invoke('settings.get')).updater.mode)).toBe('notify');
});
