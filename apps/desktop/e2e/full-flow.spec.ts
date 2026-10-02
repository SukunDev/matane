import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, leaveReader } from './support/app';

// Phases 2–3 end to end, as a reader would go: library + category → read part of a chapter → quit
// and reopen → continue on the same page → history → chapter bookmark → incognito → global search →
// migrate to the second extension, keeping everything → download → site down → read offline → the
// site adds a chapter → check library → Updates → auto-download.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
const page = (): Page => t.page;
const goto = (hash: string) => page().evaluate((h) => (location.hash = h), hash);
const leave = () => leaveReader(page());
const chapterRow = (name: string) => page().locator('main section div.group', { hasText: name });

test.beforeAll(async () => {
  t = await launchApp();
});

test.afterAll(async () => {
  await t?.close();
});

test('adds a manga to a category and reads part of a chapter', async () => {
  await goto('#/settings/library');
  await page().getByPlaceholder('New category name').fill('Reading');
  await page().getByRole('button', { name: 'Create' }).click();
  await expect(page().getByRole('list', { name: 'Categories' })).toContainText('Reading');

  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page().getByText('Paged Hero').click();
  await page().getByRole('button', { name: 'Add to library' }).click();
  await page().getByRole('dialog').getByRole('checkbox', { name: 'Reading' }).click();
  await page().getByRole('dialog').getByRole('button', { name: 'Add to library' }).click();
  await expect(page().getByRole('button', { name: 'In library' })).toBeVisible();

  await chapterRow('Ch. 1').getByTitle('Chapter actions').click();
  await page().getByRole('menuitem', { name: 'Mark as read' }).click();

  // Chapter 2, right-to-left: two pages on.
  await chapterRow('Ch. 2').getByTestId('chapter-row').click();
  await expect(page().getByText('1 / 4').first()).toBeVisible();
  await page().keyboard.press('ArrowLeft');
  await page().keyboard.press('ArrowLeft');
  await expect(page().getByText('3 / 4').first()).toBeVisible();
  await page().getByRole('button', { name: 'Bookmark this chapter' }).click({ force: true });
  await expect(page().getByRole('button', { name: 'Remove chapter bookmark' })).toBeAttached();
  await leave();
  await expect(chapterRow('Ch. 2')).toContainText('Page 3 / 4');
});

test('continues on the same page after quitting and reopening the app', async () => {
  await t.restart();
  await goto('#/library');
  await page()
    .getByRole('tab', { name: /Reading\s*1/ })
    .click();
  const item = page().getByTestId('library-item').filter({ hasText: 'Paged Hero' });
  await expect(item.getByTitle('3 unread chapters')).toBeVisible();
  await item.click();
  await page().getByRole('link', { name: 'Continue · Ch. 2' }).click();
  await expect(page().getByText('3 / 4').first()).toBeVisible();
  await expect(page().getByRole('button', { name: 'Remove chapter bookmark' })).toBeAttached();
  await leave();

  await goto('#/history');
  const entry = page().getByTestId('history-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('Ch. 2 · Page 3/4');
});

test('reads in incognito without leaving a trace', async () => {
  await page()
    .getByRole('button', { name: /Turn on incognito/ })
    .click();
  await goto('#/library');
  await page().getByTestId('library-item').filter({ hasText: 'Paged Hero' }).click();
  await chapterRow('Ch. 3').getByTestId('chapter-row').click();
  await expect(page().getByText('1 / 4').first()).toBeVisible();
  await page().keyboard.press('ArrowLeft');
  await expect(page().getByText('2 / 4').first()).toBeVisible();
  await leave();
  await expect(chapterRow('Ch. 3')).not.toContainText('Page');
  await page().getByRole('button', { name: 'Incognito', exact: true }).click();

  await goto('#/history');
  await expect(page().getByTestId('history-entry')).toContainText('Ch. 2 · Page 3/4');
});

test('finds the manga in the second extension with global search', async () => {
  // Default set: sources with library manga (E2E Demo) and pinned ones (E2E Mirror).
  await page().evaluate(() => window.api.invoke('sources.setPinned', { sourceId: 'e2e-mirror/id', pinned: true }));
  await goto('#/browse/global-search?q=hero');
  await expect(page().getByRole('button', { name: /^Sources: Default \(2\)/ })).toBeVisible();
  const sections = page().getByTestId('search-source');
  await expect(sections).toHaveCount(2);
  await expect(page().getByRole('region', { name: 'E2E Mirror' })).toContainText('Paged Hero');
  await expect(page().getByRole('region', { name: 'E2E Demo' })).toContainText('In library');
});

test('migrates to the second extension and keeps reading where it stopped', async () => {
  await goto('#/library');
  await page().getByTestId('library-item').filter({ hasText: 'Paged Hero' }).click();
  await page().getByRole('link', { name: 'Migrate' }).click();
  await expect(page().getByRole('heading', { name: 'Migrate 1 manga' })).toBeVisible();
  const row = page().getByTestId('migration-row');
  await expect(row.getByText('Exact')).toBeVisible();
  await expect(row).toContainText('E2E Mirror');
  await page().getByRole('button', { name: 'Migrate 1 manga' }).click();
  await expect(page().getByTestId('migration-summary')).toContainText('1Migrated');
  await expect(page().getByText('1 read chapter carried over')).toBeVisible();

  await page().getByRole('link', { name: 'Open new entry' }).click();
  await expect(page().getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  await expect(page().getByText('E2E Mirror · ID')).toBeVisible();
  await expect(chapterRow('Ch. 2').getByRole('button', { name: 'Remove bookmark' })).toBeVisible();
  await page().getByRole('link', { name: 'Continue · Ch. 2' }).click();
  await expect(page().getByText('3 / 4').first()).toBeVisible();
  await leave();

  await goto('#/library');
  await page()
    .getByRole('tab', { name: /Reading\s*1/ })
    .click();
  const items = page().getByTestId('library-item');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('E2E Mirror');
});

test('downloads a chapter and reads it while the site is down', async () => {
  await page().evaluate(async () => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ahead: 0 } });
  });
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=twin');
  await page().getByText('Twin Scans').click();
  await page().getByRole('button', { name: 'Add to library' }).click();
  await page().getByRole('dialog').getByRole('button', { name: 'Add to library' }).click();
  await expect(page().getByRole('button', { name: 'In library' })).toBeVisible();
  await chapterRow('Ch. 1').getByRole('button', { name: 'Download' }).click();
  await expect(chapterRow('Ch. 1').getByTitle('Downloaded')).toBeVisible();

  t.site.down = true;
  await chapterRow('Ch. 1').getByTestId('chapter-row').click();
  await expect(page().getByText('1 / 4').first()).toBeVisible();
  await expect
    .poll(() =>
      page().evaluate(
        () =>
          [...document.querySelectorAll<HTMLImageElement>('img[src^="manga://page/"]')].filter(
            (i) => i.complete && i.naturalWidth > 0,
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await leave();
  t.site.down = false;
});

test('the site adds a chapter: "Check library" shows it on Updates and downloads it', async () => {
  await goto('#/settings/library');
  await page().getByRole('switch', { name: 'Download new chapters automatically' }).click();
  t.site.addChapter('twin', 5);
  await goto('#/updates');
  await page().getByRole('button', { name: 'Check library' }).click();
  const row = page().getByTestId('update-row').filter({ hasText: 'Twin Scans' });
  await expect(row).toContainText('Ch. 5');
  await expect(row.getByTitle('Downloaded')).toBeVisible();
});
