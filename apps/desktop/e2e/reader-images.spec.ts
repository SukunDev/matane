import { type Locator, type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 5a: main measures, crops and cuts pages for the reader. "Long Strip" (a manhwa, so a
// webtoon strip) has a page with white margins and a 100×12000 page in three coloured bands.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let chapterId: number;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const pageAt = (index: number) => page.locator(`[data-page="${chapterId}:${index}"]`);
const natural = (image: Locator) =>
  image.evaluate((img: HTMLImageElement) => (img.complete ? [img.naturalWidth, img.naturalHeight] : null));
/** Where the top of the strip is inside page `index`, as a fraction of its height. */
const scrolledInto = (index: number) =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    const scroller = element.closest('[data-zoom]')!;
    const rect = element.getBoundingClientRect();
    return (scroller.getBoundingClientRect().top - rect.top) / rect.height;
  }, `[data-page="${chapterId}:${index}"]`);

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  await page.evaluate(async () => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ahead: 0 } });
  });
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=long strip');
  await page.getByText('Long Strip').click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test.afterAll(async () => {
  await t?.close();
});

test('shows a tall page as segments, laid out at its real size', async () => {
  await page.getByRole('link', { name: /Start reading/ }).click();
  chapterId = Number(/#\/reader\/(\d+)/.exec(page.url())![1]);
  await expect.poll(() => natural(pageAt(0))).toEqual([200, 300]);

  const segments = pageAt(1).locator('img[data-segment]');
  await expect(segments).toHaveCount(3);
  // 800 px column: the strip item of the 100×12000 page is 96 000 px tall before any segment
  // arrives (the page itself stays hidden behind its placeholder until the first one loads).
  const item = page.locator('[data-index]').filter({ has: pageAt(1) });
  expect((await item.boundingBox())!.height).toBeCloseTo(96_000, -1);
  // Segments load as they come near (each is 32 000 px tall on screen).
  for (let n = 0; n < 3; n++) {
    await segments.nth(n).evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect.poll(() => natural(segments.nth(n))).toEqual([100, 4000]);
  }
  expect((await pageAt(1).boundingBox())!.height).toBeCloseTo(96_000, -1);
});

test('crops the margins once asked, at once', async () => {
  await page.getByTitle('Reader settings').click({ force: true });
  // Saved through settings, so the box follows a moment later.
  const crop = page.getByRole('checkbox', { name: /Crop borders/ });
  await crop.click();
  await expect(crop).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(pageAt(0)).toHaveAttribute('src', /crop=1/);
  await expect.poll(() => natural(pageAt(0))).toEqual([100, 200]);
});

test('resumes inside the tall page after a restart', async () => {
  await page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    const scroller = element.closest('[data-zoom]')!;
    const rect = element.getBoundingClientRect();
    scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + rect.height / 2;
  }, `[data-page="${chapterId}:1"]`);
  await expect
    .poll(() => page.evaluate((id) => window.api.invoke('chapter.get', { chapterId: id }), chapterId))
    .toMatchObject({ lastPage: 1, pageOffset: expect.closeTo(0.5, 1) });

  await t.restart();
  page = t.page;
  await goto(`#/reader/${chapterId}`);
  await expect(pageAt(1)).toBeAttached();
  await expect.poll(() => scrolledInto(1)).toBeCloseTo(0.5, 1);
  // It stays there: the strip did not jump as pages loaded.
  await page.waitForTimeout(800);
  expect(await scrolledInto(1)).toBeCloseTo(0.5, 1);
});

test('reads the downloaded chapter with the site down, cropped and cut', async () => {
  await page.getByTitle('Back to manga').click({ force: true });
  const row = page.locator('main section div.group', { hasText: 'Ch. 1' });
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(row.getByTitle('Downloaded')).toBeVisible();
  // Nothing from the cache: pages, crops and segments all come from the download.
  await page.evaluate(() => window.api.invoke('storage.clearCache', { kind: 'page' }));
  t.site.down = true;
  await goto(`#/reader/${chapterId}?page=0`);
  await expect.poll(() => natural(pageAt(0))).toEqual([100, 200]);
  const segments = pageAt(1).locator('img[data-segment]');
  await expect(segments).toHaveCount(3);
  await expect.poll(() => natural(segments.first())).toEqual([100, 4000]);
});
