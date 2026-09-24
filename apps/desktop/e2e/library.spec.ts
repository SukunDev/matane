import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 2b: library, categories, multi-select, covers. One app session against the fake site.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const libraryItems = () => page.getByTestId('library-item');
const openManga = async (title: string) => {
  await goto('#/browse/sources');
  await page.locator('a[href*="/browse/sources/e2e-demo/en"]').first().click();
  await page.locator(`main a[title="${title}"]`).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
};
const mangaIdOf = async (title: string) =>
  page.evaluate(async (name) => {
    const items = await window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, status: [], sourceIds: [] },
    });
    return items.find((i) => i.title === name)?.mangaId;
  }, title);

test.beforeAll(async () => {
  t = await launchApp();
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('starts empty and points to the sources', async () => {
  await goto('#/library');
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse sources' })).toBeVisible();
});

test('adds a manga without categories straight to the library', async () => {
  await openManga('Paged Hero');
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  // Sidebar count and the browse badge follow db.changed.
  await expect(page.locator('aside a[href$="/library"]')).toContainText('1');
  await page.goBack();
  await expect(page.locator('main a[title="Paged Hero"]').first()).toContainText('In library');
});

test('manages categories in settings and picks them when adding', async () => {
  await goto('#/settings/library');
  await page.getByPlaceholder('New category name').fill('Favourites');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByPlaceholder('New category name').fill('Later');
  await page.getByRole('button', { name: 'Create' }).click();
  const list = page.getByRole('list', { name: 'Categories' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await list.getByRole('button', { name: 'Rename' }).last().click();
  await list.getByRole('textbox').fill('Plan to read');
  await list.getByRole('textbox').press('Enter');
  await expect(list).toContainText('Plan to read');

  await openManga('Scroll Garden');
  await page.getByRole('button', { name: 'Add to library' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Favourites' }).click();
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();

  await goto('#/library');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: /All\s*2/ })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: /Favourites\s*1/ })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: /Plan to read\s*0/ })).toBeVisible();
  await tabs.getByRole('tab', { name: /Default/ }).click();
  await expect(libraryItems()).toHaveCount(1);
  await expect(libraryItems().first()).toHaveAttribute('title', 'Paged Hero');
  await tabs.getByRole('tab', { name: /All/ }).click();
});

test('shows unread counts, searches, filters and sorts', async () => {
  await expect(libraryItems()).toHaveCount(2);
  const paged = page.locator('[data-testid="library-item"][title="Paged Hero"]');
  await expect(paged.getByTitle('4 unread chapters')).toBeVisible();

  await page.getByPlaceholder('Filter current view…').fill('scro');
  await expect(libraryItems()).toHaveCount(1);
  await expect(libraryItems().first()).toHaveAttribute('title', 'Scroll Garden');
  await page.getByPlaceholder('Filter current view…').fill('');
  await expect(libraryItems()).toHaveCount(2);

  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('checkbox', { name: 'Completed' }).click();
  await page.keyboard.press('Escape');
  await expect(libraryItems()).toHaveCount(1);
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.keyboard.press('Escape');
  await expect(libraryItems()).toHaveCount(2);

  await page.getByRole('button', { name: /^Sort:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Title' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Sort: Title' })).toBeVisible();
  const order = async () => libraryItems().evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  const descending = await order();
  await page.getByRole('button', { name: 'Sort: Title' }).click();
  await page.getByRole('menuitem', { name: /Descending|Ascending/ }).click();
  await page.keyboard.press('Escape');
  await expect.poll(order).toEqual([...descending].reverse());

  for (const display of ['Compact grid', 'Covers only', 'List', 'Comfortable grid']) {
    await page.getByRole('radio', { name: display }).click();
    await expect(libraryItems()).toHaveCount(2);
  }
});

test('multi-selects with Ctrl+click and marks read, sets categories, removes', async () => {
  await libraryItems()
    .nth(0)
    .click({ modifiers: ['Control'] });
  await libraryItems()
    .nth(1)
    .click({ modifiers: ['Control'] });
  const bar = page.getByRole('toolbar', { name: 'Selection actions' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByTitle(/unread chapter/)).toHaveCount(0);

  await bar.getByRole('button', { name: 'Set categories' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Plan to read' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: /Plan to read\s*2/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await page.locator('[data-testid="library-item"][title="Scroll Garden"]').click({ modifiers: ['Control'] });
  await bar.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(libraryItems()).toHaveCount(1);
  await expect(page.locator('aside a[href$="/library"]')).toContainText('1');
});

test('keeps a permanent library cover and sets a custom cover from a reader page', async () => {
  const mangaId = await mangaIdOf('Paged Hero');
  expect(mangaId).toBeDefined();
  const userData = await t.app.evaluate(({ app }) => app.getPath('userData'));
  await expect
    .poll(() => readdirSync(join(userData, 'covers')).filter((f) => f.startsWith(`${mangaId}-`)))
    .toHaveLength(1);

  await goto(`#/manga/${mangaId}`);
  await page.getByTestId('chapter-row').last().click();
  const image = page.locator('img[data-page]').first();
  await expect(image).toBeVisible();
  await image.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Set page \d+ as cover/ }).click();
  await expect(page.getByRole('status')).toHaveText('Cover updated');
  const info = await page.evaluate((id) => window.api.invoke('manga.get', { mangaId: id }), mangaId!);
  expect(info.hasCustomCover).toBe(true);

  await goto(`#/manga/${mangaId}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: "Use the source's cover" }).click();
  await expect
    .poll(() => page.evaluate((id) => window.api.invoke('manga.get', { mangaId: id }), mangaId!))
    .toMatchObject({ hasCustomCover: false });
});

test('multi-selects chapters and bookmarks them', async () => {
  const rows = page.getByTestId('chapter-row');
  await rows.nth(0).click({ modifiers: ['Control'] });
  await rows.nth(2).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Selection actions' });
  await expect(bar).toContainText('3 selected');
  await bar.getByRole('button', { name: 'Bookmark' }).click();
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: 'Bookmarked' }).click();
  await expect(rows).toHaveCount(3);
});
