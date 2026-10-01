import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';
import { type Site, extensionFiles, startSite } from './support/site';

// One app session walks the Phase 1 flow against a fake site: install → browse → filter → detail →
// read (single RTL, double, transition with a missing chapter) → back → webtoon → offline.
test.describe.configure({ mode: 'serial' });

const appDir = resolve(__dirname, '..');
let site: Site;
let app: ElectronApplication;
let page: Page;
let home: string;
/** Chapter 1 of "Paged Hero", read online first and again offline at the end. */
let firstChapterId: number;

const loadedImages = (prefix: string) =>
  page.evaluate(
    (p) =>
      [...document.querySelectorAll<HTMLImageElement>(`img[src^="${p}"]`)].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
    prefix,
  );
const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const setReader = (patch: Record<string, unknown>) =>
  page.evaluate(async (p) => {
    const settings = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { reader: { ...settings.reader, ...p } });
  }, patch);

test.beforeAll(async () => {
  site = await startSite();
  home = mkdtempSync(join(tmpdir(), 'matane-e2e-'));
  const extensionDir = join(home, 'e2e-demo');
  mkdirSync(extensionDir);
  for (const [name, content] of Object.entries(extensionFiles(site.origin)))
    writeFileSync(join(extensionDir, name), content);

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    // GitHub's Ubuntu runners forbid the unprivileged user namespaces Chromium's sandbox needs.
    args: [appDir, ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(home, 'config'),
      ELECTRON_ENABLE_LOGGING: '1',
      MATANE_E2E_NO_ONBOARDING: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('aside');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860));
  await page.evaluate((path) => window.api.invoke('extensions.loadDevFolder', { path }), extensionDir);
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(home, { recursive: true, force: true });
});

test('lists the extension and browses its source with covers and infinite scroll', async () => {
  await goto('#/browse/extensions');
  await expect(page.getByText('E2E Demo').first()).toBeVisible();
  await goto('#/browse/sources');
  await page.locator('a[href*="/browse/sources/e2e-demo/en"]').first().click();
  // Page 2 may already be prefetched on a tall window (the sentinel looks ~2 screens ahead).
  await expect.poll(() => page.locator('a[href*="/manga/"]').count()).toBeGreaterThanOrEqual(12);
  await expect.poll(() => loadedImages('manga://cover/')).toBeGreaterThanOrEqual(8);
  await page
    .locator('main .overflow-y-auto')
    .first()
    .evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(page.locator('a[href*="/manga/"]')).toHaveCount(24);
  expect(site.hits).toContain('/api/list?page=2&lang=en');
});

test('filters with tri-state genres and keeps them in the URL', async () => {
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Action', exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('tab', { name: 'Search', selected: true })).toBeVisible();
  await expect(page.getByText('Paged Hero')).toBeVisible();
  await expect(page.getByText('Scroll Garden')).toHaveCount(0);
  expect(decodeURIComponent(page.url())).toContain('"genre.Action":"include"');
});

test('shows a source error with a retry button', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=boom');
  await expect(page.getByRole('alert')).toContainText('HTTP 404', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('opens the manga detail and reads right-to-left', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  await expect(page.locator('main a[href*="/reader/"]')).toHaveCount(5); // Start reading + 4 chapters
  await page.getByRole('link', { name: /Start reading/ }).click();
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  firstChapterId = Number(/reader\/(\d+)/.exec(page.url())![1]);
  await page.keyboard.press('ArrowLeft'); // next page in RTL
  await expect(page.getByText('2 / 4').first()).toBeVisible();
});

test('shows the tap zones for a few seconds after changing the preset', async () => {
  await expect(page.getByText(/^Tap zones:/)).toHaveCount(0); // not when the reader opens
  await page.mouse.move(640, 10); // bring the bars back
  await page.getByTitle('Reader settings').click();
  await page.getByRole('radio', { name: 'Kindle' }).click();
  await expect(page.getByText('Tap zones: Kindle')).toBeVisible();
  await page.getByRole('radio', { name: 'L-shape' }).click();
  await expect(page.getByText('Tap zones: L-shape')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Tap zones:/)).toHaveCount(0, { timeout: 4_000 });
});

test('pairs pages in double mode and keeps the spread alone', async () => {
  await setReader({ mode: 'double' });
  await page.keyboard.press('Home');
  await expect.poll(() => loadedImages('manga://page/')).toBe(2);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => loadedImages('manga://page/')).toBe(1); // landscape page 3 stands alone
  await setReader({ mode: 'auto' });
});

test('warns about a missing chapter between chapter 3 and 5', async () => {
  const chapters = await page.evaluate(async () => {
    const hash = location.hash.match(/reader\/(\d+)/)!;
    const chapter = await window.api.invoke('chapter.get', { chapterId: Number(hash[1]) });
    return window.api.invoke('chapters.list', { mangaId: chapter.mangaId });
  });
  const ch3 = chapters.find((c) => c.number === 3)!;
  await goto(`#/reader/${ch3.id}`);
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Finished Ch. 3')).toBeVisible();
  await expect(page.getByText('1 chapter may be missing before this one')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Ch. 5 · Test Scans')).toBeVisible();
});

test('keeps the chapter list after returning from the reader', async () => {
  await page.getByTitle('Back to manga').click({ force: true });
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  // Regression: with cached data the virtual list used to render no rows at all.
  await expect(page.locator('main a[href*="/reader/"]')).toHaveCount(5);
});

test('resumes where reading stopped and marks chapters read', async () => {
  const rows = page.locator('main section div.group a[href*="/reader/"]');
  // Chapter 1 was left on its landscape spread (page 3) in double mode.
  const ch1 = page.locator('main section div.group', { hasText: 'Ch. 1' });
  await expect(ch1).toContainText('Page 3 / 4');
  // History points at chapter 5 (opened last, not finished).
  await expect(page.getByRole('link', { name: 'Continue · Ch. 5' })).toBeVisible();
  await ch1.locator('a').click();
  await expect(page.getByText('3 / 4').first()).toBeVisible();
  await page.getByTitle('Back to manga').click({ force: true });
  await expect(rows).toHaveCount(4);

  // Row menu: mark chapter 5's predecessors read.
  await page.locator('main section div.group', { hasText: 'Ch. 5' }).getByTitle('Chapter actions').click();
  await page.getByRole('menuitem', { name: 'Mark previous as read' }).click();
  await expect(ch1).not.toContainText('Page 3 / 4');
  await expect(page.locator('main section [aria-label="Read"]')).toHaveCount(3);
});

test('reads a manhwa as a continuous webtoon into the next chapter', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=scroll');
  await page.getByText('Scroll Garden').click();
  await page.getByRole('link', { name: /Start reading/ }).click();
  const first = page.url();
  await expect.poll(() => loadedImages('manga://page/')).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 30 && page.url() === first; i++) {
    await page.mouse.move(640, 430);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(150);
  }
  expect(page.url()).not.toBe(first); // the URL followed the strip into chapter 2
  // In the strip the zones scroll instead of turning pages; both edges are labelled.
  await setReader({ tapZones: 'edges' });
  await expect(page.getByText('Tap zones: Edges')).toBeVisible();
  await expect(page.getByText('Scroll down', { exact: true })).toHaveCount(2);
  await setReader({ tapZones: 'l' });
  await expect(page.getByText('Ch. 2 · Test Scans').first()).toBeVisible();
});

test('opens a read chapter again with the site down', async () => {
  await site.close();
  const browse = await page.evaluate(() =>
    window.api
      .invoke('sources.browse', { sourceId: 'e2e-demo/en', kind: 'popular', page: 2 })
      .then(() => 'ok')
      .catch((error: Error) => error.message),
  );
  expect(browse).toContain('"code":"network"'); // the site really is down
  await goto(`#/reader/${firstChapterId}`);
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('2 / 4').first()).toBeVisible();
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
});
