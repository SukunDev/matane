import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 5b: Settings → Reader, remappable keys, zoom, colour filters, saving a page, auto-scroll,
// touch gestures and per-type defaults. "Paged Hero" is a manga (single page, right to left),
// "Scroll Garden" a manhwa (webtoon strip).
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
const chapterOf: Record<string, number> = {};

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const setReader = (patch: Record<string, unknown>) =>
  page.evaluate(async (p) => {
    const settings = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { reader: { ...settings.reader, ...p } });
  }, patch);
const pageShown = (n: number, total = 4) => expect(page.getByText(`${n} / ${total}`).first()).toBeVisible();
const zoomOf = () => page.locator('[data-zoom]').getAttribute('data-zoom').then(Number);
const appZoom = () =>
  t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor());
const keymapRow = (action: string) => page.locator(`[data-testid="keymap-row"][data-action="${action}"]`);

/** Opens chapter 1 of a manga found by searching `query`, starting at page `start`. */
async function openChapter(query: string, title: string, start = 0) {
  if (!chapterOf[title]) {
    await goto(`#/browse/sources/e2e-demo/en?tab=search&q=${query}`);
    await page.getByText(title).click();
    const mangaId = Number(/#\/manga\/(\d+)/.exec(await page.evaluate(() => location.hash))![1]);
    await expect(page.getByTestId('chapter-row').first()).toBeVisible();
    const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId);
    chapterOf[title] = chapters.find((c) => c.name === 'Ch. 1')!.id;
  } else {
    // Leave the reader first: a new start page only counts for a new reading session.
    await goto('#/library');
  }
  await goto(`#/reader/${chapterOf[title]}?page=${start}`);
  await expect(page.locator('[data-page]').first()).toBeVisible();
}

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('Settings → Reader remaps a key and refuses one that is taken', async () => {
  await goto('#/settings/reader');
  await expect(page.getByRole('heading', { name: 'Reader', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();

  await keymapRow('nextPage').getByRole('button', { name: 'Add a key for Next page' }).click();
  await expect(keymapRow('nextPage')).toContainText('Press a key…');
  await page.keyboard.press('m');
  await expect(page.getByRole('alert')).toContainText('M is already used by “Toggle menu”');
  await page.keyboard.press('l');
  await expect(keymapRow('nextPage')).toContainText('L');
  await expect(keymapRow('nextPage')).not.toContainText('Press a key…');
  // Only the change is stored.
  const { reader } = await page.evaluate(() => window.api.invoke('settings.get'));
  expect(reader.keymap).toEqual({ nextPage: ['PageDown', 'Space', 'L'] });
});

test('the new key turns pages, and the old ones still work', async () => {
  await openChapter('paged', 'Paged Hero');
  await pageShown(1);
  await page.keyboard.press('l');
  await pageShown(2);
  await page.keyboard.press('Space');
  await pageShown(3);
  // Right to left: the left arrow goes forward.
  await page.keyboard.press('ArrowRight');
  await pageShown(2);
});

test('zooms the page with Ctrl+wheel and the keys, never the whole window', async () => {
  const box = page.locator('[data-zoom]');
  const before = (await page.locator('img[data-page]').first().boundingBox())!;
  await box.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(zoomOf).toBeGreaterThan(1.5);
  const after = (await page.locator('img[data-page]').first().boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height * 1.4);
  // The zoomed page is on screen, around the cursor, not pushed off somewhere in the bigger box.
  const view = (await box.boundingBox())!;
  expect(after.y).toBeLessThan(view.y + view.height);
  expect(after.y + after.height).toBeGreaterThan(view.y);
  expect(after.x).toBeLessThan(view.x + view.width);
  expect(after.x + after.width).toBeGreaterThan(view.x);
  expect(await appZoom()).toBe(1);

  await page.keyboard.press('Control+0');
  await expect.poll(zoomOf).toBe(1);
  await page.keyboard.press('Control+=');
  await expect.poll(zoomOf).toBe(1.25);
  expect(await appZoom()).toBe(1);
  // Turning the page resets the zoom.
  await page.keyboard.press('l');
  await expect.poll(zoomOf).toBe(1);

  // A page that already fills the screen (fit width) grows past it and can be dragged around.
  await setReader({ fit: 'width' });
  const width = () =>
    page
      .locator('img[data-page]')
      .first()
      .evaluate((img) => img.getBoundingClientRect().width);
  const screen = await page.locator('[data-zoom]').evaluate((el) => el.clientWidth);
  await expect.poll(width).toBeCloseTo(screen, -1);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await expect.poll(width).toBeGreaterThan(screen * 1.5);
  const scroller = page.locator('[data-zoom]');
  const left = await scroller.evaluate((el) => el.scrollLeft);
  const area = (await scroller.boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 150, area.y + area.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBeLessThan(left - 100);
  await pageShown(3); // the drag did not turn the page
  await page.keyboard.press('Control+0');
  await setReader({ fit: 'screen' });
});

test('colour filters apply to the pages only', async () => {
  await setReader({ filters: { brightness: 80, contrast: 100, grayscale: true, invert: false, warm: 0 } });
  await expect
    .poll(() =>
      page
        .locator('img[data-page]')
        .first()
        .evaluate((img) => getComputedStyle(img).filter),
    )
    .toBe('brightness(0.8) grayscale(1)');
  const bar = await page.locator('footer').evaluate((el) => getComputedStyle(el).filter);
  expect(bar).toBe('none');
  await setReader({ filters: { brightness: 100, contrast: 100, grayscale: false, invert: false, warm: 0 } });
});

test('saves and copies the page from its menu', async () => {
  const target = join(t.home, 'saved-page.png');
  await t.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await page.locator('img[data-page]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save image…' }).click();
  await expect(page.getByText('Image saved')).toBeVisible();
  expect(existsSync(target)).toBe(true);
  expect(readFileSync(target).subarray(1, 4).toString()).toBe('PNG');

  await page.locator('img[data-page]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy image' }).click();
  await expect(page.getByText('Image copied')).toBeVisible();
  expect(await t.app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
});

test('a finger swipe turns the page the way it slides, a pinch zooms', async () => {
  await openChapter('paged', 'Paged Hero', 1);
  await pageShown(2);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  // Right to left: dragging the page to the right brings the next one.
  await touch('touchStart', [{ x: 400, y: 400 }]);
  for (let x = 440; x <= 640; x += 40) await touch('touchMove', [{ x, y: 405 }]);
  await touch('touchEnd', []);
  await pageShown(3);

  await touch('touchStart', [
    { x: 500, y: 400 },
    { x: 560, y: 400 },
  ]);
  for (let d = 80; d <= 300; d += 40) {
    await touch('touchMove', [
      { x: 530 - d / 2, y: 400 },
      { x: 530 + d / 2, y: 400 },
    ]);
  }
  await touch('touchEnd', []);
  await expect.poll(zoomOf).toBeGreaterThan(2);
  await page.keyboard.press('Control+0');
});

test('auto-scroll glides down the strip and stops on Space or at the end', async () => {
  await setReader({ autoScrollSpeed: 400 });
  await openChapter('scroll', 'Scroll Garden');
  const scroller = page.locator('[data-zoom]');
  const top = () => scroller.evaluate((el) => el.scrollTop);
  const button = page.getByRole('button', { name: 'Auto-scroll' });
  await page.keyboard.press('s');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(top).toBeGreaterThan(200);
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const stopped = await top();
  await page.waitForTimeout(400);
  expect(await top()).toBe(stopped);

  // At full speed it runs into chapter 2, then stops at the end of the last chapter.
  await setReader({ autoScrollSpeed: 800 });
  await page.keyboard.press('s');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
  await expect(page.getByText('Ch. 2 · Test Scans').first()).toBeVisible();
  expect(await scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)).toBe(true);
});

test('per-type defaults decide what "auto" means', async () => {
  await goto('#/settings/reader');
  await page.getByRole('combobox', { name: 'Reading mode for Manga' }).selectOption('double');
  await expect
    .poll(async () => (await page.evaluate(() => window.api.invoke('settings.get'))).reader.typeDefaults.manga.mode)
    .toBe('double');
  await openChapter('paged', 'Paged Hero');
  // Double pages: the first two portrait pages side by side.
  await expect(page.locator('img[data-page]')).toHaveCount(2);
});
