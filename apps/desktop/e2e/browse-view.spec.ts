import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';
import { type Site, extensionFiles, startSite } from './support/site';

// The cover size slider and the display modes of a source's manga list (Browse).
test.describe.configure({ mode: 'serial' });

const appDir = resolve(__dirname, '..');
const shots = process.env['BROWSE_VIEW_SHOTS'];
let site: Site;
let app: ElectronApplication;
let page: Page;
let home: string;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const browseView = () =>
  page.evaluate(async () => {
    const { browse } = await window.api.invoke('settings.get');
    return { display: browse.display, coverSize: browse.coverSize };
  });
const cards = () => page.locator('a[href*="/manga/"]');
const display = (name: string) => page.getByRole('radio', { name });
/** Columns = cards sharing the first card's top edge. */
const columns = () =>
  cards().evaluateAll((links) => {
    const top = links[0]!.getBoundingClientRect().top;
    return links.filter((a) => Math.abs(a.getBoundingClientRect().top - top) < 2).length;
  });
const shot = async (name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

test.beforeAll(async () => {
  site = await startSite();
  home = mkdtempSync(join(tmpdir(), 'matane-e2e-'));
  const extensionDir = join(home, 'e2e-demo');
  mkdirSync(extensionDir);
  for (const [name, content] of Object.entries(extensionFiles(site.origin)))
    writeFileSync(join(extensionDir, name), content);
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appDir, ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), MATANE_E2E_NO_ONBOARDING: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('aside');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860));
  await page.evaluate((path) => window.api.invoke('extensions.loadDevFolder', { path }), extensionDir);
  await goto('#/browse/sources/e2e-demo/en');
  await expect.poll(() => cards().count()).toBeGreaterThanOrEqual(12);
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(home, { recursive: true, force: true });
});

test('starts as a comfortable grid with titles under the covers', async () => {
  expect(await browseView()).toEqual({ display: 'comfortable', coverSize: 160 });
  await expect(display('Comfortable grid')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('main a[href*="/manga/"] span.line-clamp-2').first()).toBeVisible();
  await shot('comfortable');
});

test('the slider changes the column count and is saved', async () => {
  const before = await columns();
  const slider = page.getByRole('slider', { name: 'Cover size' });
  await slider.focus();
  // One step at a time: waits for each save, so this does not depend on how fast keys repeat.
  for (let size = 170; size <= 240; size += 10) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await browseView()).coverSize).toBe(size);
    await expect(slider).toHaveValue(String(size));
  }
  expect(await columns()).toBeLessThan(before);
  for (let size = 230; size >= 100; size -= 10) {
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await browseView()).coverSize).toBe(size);
    await expect(slider).toHaveValue(String(size));
  }
  expect(await columns()).toBeGreaterThan(before);
  await shot('small-covers');
});

test('compact grid overlays the title on the cover', async () => {
  await display('Compact grid').click();
  await expect.poll(async () => (await browseView()).display).toBe('compact');
  await expect(page.locator('main a[href*="/manga/"] span.line-clamp-2')).toHaveCount(0);
  await expect(page.locator('main a[href*="/manga/"] p.line-clamp-2').first()).toBeVisible();
  await shot('compact');
});

test('covers only shows no titles', async () => {
  await display('Covers only').click();
  await expect.poll(async () => (await browseView()).display).toBe('cover');
  await expect(page.locator('main a[href*="/manga/"] p, main a[href*="/manga/"] span.line-clamp-2')).toHaveCount(0);
  await shot('cover');
});

test('list shows one row per manga without the slider', async () => {
  await display('List').click();
  await expect.poll(async () => (await browseView()).display).toBe('list');
  await expect(page.getByRole('slider', { name: 'Cover size' })).toHaveCount(0);
  expect(await columns()).toBe(1);
  await shot('list');
});

test('infinite scroll keeps loading in list mode', async () => {
  const scroller = page.locator('main .overflow-y-auto').first();
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(() => cards().count()).toBeGreaterThan(12);
  await shot('list-scrolled');
});

test('opens a manga from the list and keeps the view on return', async () => {
  await cards().first().click();
  await expect(page).toHaveURL(/#\/manga\//);
  await page.goBack();
  await expect(cards().first()).toBeVisible();
  await expect(display('List')).toHaveAttribute('aria-checked', 'true');
});

test('the choice survives switching tabs', async () => {
  await page.getByRole('tab', { name: 'Search' }).click();
  await expect(display('List')).toHaveAttribute('aria-checked', 'true');
  expect(await browseView()).toEqual({ display: 'list', coverSize: 100 });
});

test('holding an arrow key on the slider ends on the last step', async () => {
  await display('Comfortable grid').click();
  const slider = page.getByRole('slider', { name: 'Cover size' });
  await slider.focus();
  await expect(slider).toHaveValue('100');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  // 100 → 200 with the keys pressed faster than the saves answer.
  await expect.poll(async () => (await browseView()).coverSize, { timeout: 3000 }).toBe(200);
  await expect(slider).toHaveValue('200');
});

test('the header keeps its height when switching between grid and list', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 860));
  const header = page.locator('main header');
  await display('Comfortable grid').click();
  await expect(page.getByRole('slider', { name: 'Cover size' })).toBeVisible();
  const grid = (await header.boundingBox())!.height;
  await display('List').click();
  await expect(page.getByRole('slider', { name: 'Cover size' })).toHaveCount(0);
  expect((await header.boundingBox())!.height).toBe(grid);
});
