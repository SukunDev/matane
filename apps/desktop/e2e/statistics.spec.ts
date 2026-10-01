import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 5d: the statistics page counts what was read in the reader (not chapters only marked
// read), and Settings → Data clears it.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('a new profile has nothing to show yet', async () => {
  await goto('#/statistics');
  await expect(page.getByText('Nothing read yet')).toBeVisible();
});

test('a chapter read in the reader shows up; one only marked read does not', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  const rows = page.locator('main section div.group', { hasText: 'Ch. 1' });
  await rows.locator('a').click();
  // Read through the four pages, a moment on each (the reader reports activity as you go).
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1200);
    await page.keyboard.press('Space');
  }
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paged Hero', level: 1 })).toBeVisible();
  // Chapter 2 only marked read.
  await page.locator('main section div.group', { hasText: 'Ch. 2' }).getByTitle('Chapter actions').click();
  await page.getByRole('menuitem', { name: 'Mark as read' }).click();

  await goto('#/statistics');
  const tiles = page.getByTestId('stats-tiles');
  await expect(tiles).toContainText('Chapters read1');
  await expect(tiles).toContainText('Manga in library1');
  await expect(tiles).toContainText('Current streak1');
  await expect(page.getByTestId('stats-genres')).toContainText('Action');
  await expect(page.getByTestId('stats-top')).toContainText('Paged Hero');
  await expect(page.getByTestId('stats-sources')).toBeVisible();
  // The last 30 days, one column a day; a week is 7.
  await expect(page.getByTestId('stats-column')).toHaveCount(30);
  await page.getByRole('radio', { name: 'Week' }).click();
  await expect(page.getByTestId('stats-column')).toHaveCount(7);
  // Hovering a column says what it is; the table view lists the same.
  await page.getByTestId('stats-column').last().hover();
  await expect(page.getByRole('tooltip')).toContainText('1 ch');
  await page.getByRole('button', { name: 'Show as a table' }).click();
  await expect(page.getByTestId('stats-table').locator('tbody tr')).toHaveCount(7);
  await page.getByRole('radio', { name: 'Year' }).click();
  await expect(page.getByTestId('stats-table').locator('tbody tr')).toHaveCount(12);
});

test('Settings → Data clears the statistics, not the progress', async () => {
  await goto('#/settings/data');
  await page.getByRole('button', { name: 'Clear statistics' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear statistics' }).click();
  await goto('#/statistics');
  await expect(page.getByText('Nothing read yet')).toBeVisible();
  const chapters = await page.evaluate(async () => {
    const [item] = await window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, bookmarked: false, downloaded: false, status: [], sourceIds: [] },
    });
    return window.api.invoke('chapters.list', { mangaId: item!.mangaId });
  });
  expect(
    chapters
      .filter((c) => c.read)
      .map((c) => c.name)
      .sort(),
  ).toEqual(['Ch. 1', 'Ch. 2']);
});
