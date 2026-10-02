import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, leaveReader } from './support/app';

// Phase 2c: history, chapter bookmarks, incognito. One app session against the fake site.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
/** Chapter ids of "Paged Hero" by number. */
let chapterIds: Record<number, number>;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const openReader = async (chapter: number, pageIndex: number) => {
  await goto(`#/reader/${chapterIds[chapter]}?page=${pageIndex}`);
  await expect(page.getByText(`${pageIndex + 1} / 4`).first()).toBeVisible();
};
const leave = () => leaveReader(page);
const historyEntries = () => page.getByTestId('history-entry');

test.beforeAll(async () => {
  t = await launchApp();
  page = t.page;
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  const mangaId = Number(/manga\/(\d+)/.exec(page.url())?.[1]);
  const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId);
  chapterIds = Object.fromEntries(chapters.map((c) => [c.number, c.id]));
});

test.afterAll(async () => {
  await t?.close();
});

test('starts empty with incognito off', async () => {
  await goto('#/history');
  await expect(page.getByText('Nothing read yet')).toBeVisible();
  await expect(page.getByText('Incognito mode is off — reading is being recorded')).toBeVisible();
});

test('records history while reading and resumes from it', async () => {
  await openReader(2, 2);
  await leave();
  await goto('#/history');
  await expect(historyEntries()).toHaveCount(1);
  const entry = historyEntries().first();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(entry).toContainText('Paged Hero');
  await expect(entry).toContainText('Ch. 2 · Page 3/4');
  await expect(entry).toContainText('75%');
  await entry.getByRole('button', { name: 'Resume' }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${chapterIds[2]}`));
  await expect(page.getByText('3 / 4').first()).toBeVisible();
});

test('bookmarks the chapter from the reader and filters the library by it', async () => {
  // The top bar icon toggles the chapter bookmark directly (mockup 03).
  await page.getByRole('button', { name: 'Bookmark this chapter' }).click({ force: true });
  await expect(page.getByRole('button', { name: 'Remove chapter bookmark' })).toHaveAttribute('aria-pressed', 'true');
  await leave();

  const row = page.locator('main section div.group', { hasText: 'Ch. 2' });
  await expect(row.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bookmarked', exact: true }).click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bookmarked', exact: true }).click();

  // Library filter (like Mihon): only manga with a bookmarked chapter.
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=scroll');
  await page.getByText('Scroll Garden').click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  await goto('#/library');
  await expect(page.getByTestId('library-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Bookmarked' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
  await expect(page.getByTestId('library-item')).toContainText('Paged Hero');
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Bookmarked' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('records nothing while incognito', async () => {
  await page.getByRole('button', { name: /Turn on incognito/ }).click();
  await expect(page.getByRole('button', { name: 'Incognito', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openReader(3, 1);
  await expect(page.getByRole('button', { name: 'Incognito', exact: true })).toBeVisible();
  await leave();

  const state = await page.evaluate(
    async (id) => ({
      history: await window.api.invoke('history.list'),
      chapter: await window.api.invoke('chapter.get', { chapterId: id }),
    }),
    chapterIds[3]!,
  );
  expect(state.history.map((h) => h.chapterId)).toEqual([chapterIds[2]]);
  expect(state.chapter.lastPage).toBe(0);

  await goto('#/history');
  await expect(page.getByText('Incognito mode is on')).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('Incognito mode is off — reading is being recorded')).toBeVisible();
});

test('removes an entry and clears the history', async () => {
  await historyEntries().first().getByRole('button', { name: 'Remove from history' }).click();
  await expect(page.getByText('Nothing read yet')).toBeVisible();

  await openReader(1, 1);
  await leave();
  await goto('#/history');
  await expect(historyEntries()).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear all history' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear history' }).click();
  await expect(page.getByText('Nothing read yet')).toBeVisible();
});
