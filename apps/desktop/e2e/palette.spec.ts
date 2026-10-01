import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 5c: the command palette (Ctrl+K) and the detail header coloured by the cover.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const palette = () => page.getByRole('dialog');
const input = () => palette().getByRole('combobox');

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test.afterAll(async () => {
  await t?.close();
});

test('the detail header takes its colour from the cover', async () => {
  // The fake site's covers are mauve (203, 166, 247): a tint is measured and applied.
  await expect(page.locator('section[data-cover-tint]')).toHaveAttribute('data-cover-tint', /^rgb\(/);
  const manga = await page.evaluate(() =>
    window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, bookmarked: false, downloaded: false, status: [], sourceIds: [] },
    }),
  );
  const info = await page.evaluate((id) => window.api.invoke('manga.get', { mangaId: id }), manga[0]!.mangaId);
  expect(info.coverColor).toMatch(/^#[0-9a-f]{6}$/);
});

test('Ctrl+K finds a library manga and opens it', async () => {
  await goto('#/library');
  await page.keyboard.press('Control+k');
  await expect(input()).toBeFocused();
  await input().fill('paged');
  const item = palette().getByRole('option', { name: /Paged Hero/ });
  await expect(item).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette()).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Paged Hero', level: 1 })).toBeVisible();
});

test('after reading, the palette offers to continue', async () => {
  await page.getByTestId('chapter-row').last().click();
  await expect(page.locator('img[data-page]').first()).toBeVisible();
  await goto('#/library');
  await page.getByTitle(/Search the library/).click();
  const recent = palette().getByRole('group', { name: 'Continue reading' });
  await expect(recent.getByRole('option', { name: /Paged Hero/ })).toBeVisible();
  await recent.getByRole('option', { name: /Paged Hero/ }).click();
  await expect(page).toHaveURL(/#\/reader\/\d+/);
});

test('actions and places: incognito, a settings section', async () => {
  await goto('#/library');
  await page.keyboard.press('Control+k');
  await input().fill('incognito');
  await palette().getByRole('option', { name: 'Turn on incognito' }).click();
  await expect(page.getByRole('button', { name: 'Incognito' })).toBeVisible();

  await page.keyboard.press('Control+k');
  await input().fill('set rea');
  await palette().getByRole('option', { name: 'Settings › Reader' }).click();
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await input().fill('incognito');
  await palette().getByRole('option', { name: 'Turn off incognito' }).click();
});

test('Tab searches every source for the text', async () => {
  await page.keyboard.press('Control+k');
  await input().fill('scroll');
  await expect(palette().getByRole('option', { name: /Search “scroll” in all sources/ })).toBeVisible();
  await input().press('Tab');
  await expect(page).toHaveURL(/global-search\?q=scroll/);
  await expect(page.getByText('Scroll Garden').first()).toBeVisible();
});

test('Ctrl+K closes it again, Escape too', async () => {
  await page.keyboard.press('Control+k');
  await expect(palette()).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(palette()).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(palette()).toHaveCount(0);
});
