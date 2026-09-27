import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, writeSetting } from './support/app';

// Phase 3c: the library update checker, the Updates page (mockup 07), skip rules, auto-download
// per category and the check at start once the interval passed.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const row = (text: string) => page.getByTestId('update-row').filter({ hasText: text });
const setSettings = (key: 'updates' | 'downloads', patch: Record<string, unknown>) =>
  page.evaluate(
    async ([k, p]) => {
      const current = await window.api.invoke('settings.get');
      await window.api.invoke('settings.set', { [k]: { ...current[k as 'updates'], ...(p as object) } });
    },
    [key, patch] as const,
  );
const downloads = () =>
  page.evaluate(() => window.api.invoke('downloads.list')) as Promise<{ mangaTitle: string; chapterName: string }[]>;
const checkLibrary = async () => {
  await page.getByRole('button', { name: 'Check library' }).click();
  await expect(page.getByRole('button', { name: 'Check library' })).toBeEnabled();
  await expect(page.getByRole('status', { name: 'Checking for updates' })).toHaveCount(0);
};
const addToLibrary = async (query: string, title: string, category?: string) => {
  await goto(`#/browse/sources/e2e-demo/en?tab=search&q=${query}`);
  await page.getByText(title).click();
  await expect(page.getByTestId('chapter-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add to library' }).click();
  // With categories, adding asks which ones.
  const dialog = page.getByRole('dialog');
  if (category) await dialog.getByRole('checkbox', { name: category }).click();
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
};
test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  await setSettings('downloads', { ahead: 0 });
  await page.evaluate(() => window.api.invoke('categories.create', { name: 'Weekly' }));
  await addToLibrary('paged', 'Paged Hero', 'Weekly');
  // Completed: skipped by default.
  await addToLibrary('scroll', 'Scroll Garden');
});

test.afterAll(async () => {
  await t?.close();
});

test('"Check library" finds a new chapter, shows it on Updates and counts it in the sidebar', async () => {
  await goto('#/updates');
  await expect(page.getByText('No new chapters')).toBeVisible();

  t.site.addChapter('paged', 6);
  t.site.addChapter('strip', 3);
  await goto('#/library');
  // Checked from elsewhere: the sidebar badge counts it until the page is opened.
  const started = await page.evaluate(() => window.api.invoke('updates.check', { scope: { kind: 'all' } }));
  expect(started).toEqual({ started: true, reason: null });
  const updatesLink = page.getByRole('link', { name: /^Updates/ });
  await expect(updatesLink).toContainText('1');

  await updatesLink.click();
  await expect(page.getByTestId('updates-group').first()).toContainText('Today');
  await expect(page.getByTestId('updates-group').first()).toContainText('1 chapter');
  await expect(row('Paged Hero')).toContainText('Ch. 6');
  // Scroll Garden is completed: skipped.
  await expect(row('Scroll Garden')).toHaveCount(0);
  await expect(updatesLink).not.toContainText('1');
  await expect(page.getByTestId('updates-schedule')).toContainText('Last checked');
  await expect(page.getByTestId('updates-schedule')).toContainText('next check in 12 hours');
});

test('marks read, downloads a new chapter and reads it from the Updates page', async () => {
  await row('Ch. 6').getByTitle('Mark as read').click();
  await expect(row('Ch. 6').getByTitle('Mark as unread')).toContainText('Read');
  await row('Ch. 6').getByTitle('Mark as unread').click();

  await page.getByTestId('updates-group').first().getByRole('button', { name: 'Download 1' }).click();
  await expect(row('Ch. 6').getByTitle('Downloaded')).toBeVisible();

  await row('Ch. 6').getByTitle('Read now').click();
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await goto('#/updates');
});

test('skip rules come from the settings; errors per manga are listed', async () => {
  await goto('#/settings/library');
  await page.getByRole('switch', { name: 'Skip completed manga' }).click();
  await goto('#/updates');
  await checkLibrary();
  await expect(row('Scroll Garden')).toContainText('Ch. 3');

  // One manga fails: the others are checked, the error is kept.
  t.site.failManga.add('paged');
  await checkLibrary();
  await expect(page.getByText('1 manga could not be checked')).toBeVisible();
  await page.getByText('1 manga could not be checked').click();
  await expect(page.getByRole('dialog')).toContainText('Paged Hero');
  await expect(page.getByRole('dialog')).toContainText('503');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  t.site.failManga.clear();
});

test('auto-downloads new chapters, except in an excluded category', async () => {
  await goto('#/settings/library');
  await page.getByRole('switch', { name: 'Download new chapters automatically' }).click();
  await page
    .getByRole('radiogroup', { name: 'Auto-download for Weekly' })
    .getByRole('radio', { name: 'Exclude' })
    .click();
  await expect(
    page.getByRole('radiogroup', { name: 'Auto-download for Weekly' }).getByRole('radio', { name: 'Exclude' }),
  ).toHaveAttribute('aria-checked', 'true');

  t.site.addChapter('paged', 7);
  t.site.addChapter('strip', 4);
  await goto('#/updates');
  await checkLibrary();
  await expect(row('Ch. 7')).toBeVisible();
  await expect
    .poll(async () => (await downloads()).map((d) => `${d.mangaTitle} ${d.chapterName}`))
    .toContain('Scroll Garden Ch. 4');
  expect((await downloads()).map((d) => `${d.mangaTitle} ${d.chapterName}`)).not.toContain('Paged Hero Ch. 7');
});

test('checks by itself when the app opens after the interval passed', async () => {
  t.site.addChapter('paged', 8);
  await t.restart(() => writeSetting(t.home, 'updates.lastCheckAt', Date.now() - 13 * 3_600_000));
  page = t.page;
  await goto('#/updates');
  await expect(row('Ch. 8')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('updates-schedule')).toContainText('next check in 12 hours');
});
