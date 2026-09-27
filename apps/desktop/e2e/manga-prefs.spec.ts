import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 2d: scanlator prefs, per-manga chapter view and reader settings. "Twin Scans" has chapter 1
// by Alpha, 2 by Alpha and Beta, 3 by Beta, 4 by Alpha and Beta.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let mangaId: number;
/** Chapter ids by "<number><group>", e.g. "2Beta". */
let ids: Record<string, number>;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const rows = () => page.getByTestId('chapter-row');
const openDetail = async () => {
  await goto(`#/manga/${mangaId}`);
  await expect(page.getByRole('heading', { name: 'Twin Scans' })).toBeVisible();
};
const setScanlators = async (edit: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) => {
  await page.getByRole('button', { name: /^Scanlators/ }).click();
  const dialog = page.getByRole('dialog');
  await edit(dialog);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
};
const readerSubtitle = (text: string) => expect(page.locator('header').getByText(text)).toBeAttached();
const unreadBadge = () =>
  page.evaluate(async () => {
    const items = await window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, bookmarked: false, downloaded: false, status: [], sourceIds: [] },
    });
    return items.find((i) => i.title === 'Twin Scans')?.unreadCount;
  });

test.beforeAll(async () => {
  t = await launchApp();
  page = t.page;
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=twin');
  await page.getByText('Twin Scans').click();
  await expect(rows()).toHaveCount(6);
  mangaId = Number(/manga\/(\d+)/.exec(page.url())?.[1]);
  const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId);
  ids = Object.fromEntries(chapters.map((c) => [`${c.number}${c.scanlator}`, c.id]));
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test.afterAll(async () => {
  await t?.close();
});

test('hides a scanlator from the list, the unread count and navigation', async () => {
  expect(await unreadBadge()).toBe(4); // numbers 1–4, versions count once
  await setScanlators((dialog) => dialog.getByRole('switch', { name: 'Show Beta' }).click());
  await expect(rows()).toHaveCount(3); // 4 Alpha, 2 Alpha, 1 Alpha
  await expect(page.getByText('3 chapters hidden by scanlator settings')).toBeVisible();
  await expect(page.getByRole('button', { name: /Scanlators\s*1 hidden/ })).toBeVisible();
  await expect.poll(unreadBadge).toBe(3);

  await goto(`#/reader/${ids['1Alpha']}`);
  await readerSubtitle('Ch. 1 · Alpha');
  await page.keyboard.press(']');
  await readerSubtitle('Ch. 2 · Alpha');
  await page.keyboard.press(']'); // chapter 3 exists only by Beta
  await readerSubtitle('Ch. 4 · Alpha');
});

test('prefers the priority scanlator for the next chapter and "continue"', async () => {
  await openDetail();
  await setScanlators(async (dialog) => {
    await dialog.getByRole('switch', { name: 'Show Beta' }).click();
    await dialog.getByRole('listitem').filter({ hasText: 'Beta' }).getByTitle('Move up').click();
  });
  await expect(rows()).toHaveCount(6);
  await expect.poll(unreadBadge).toBe(4);

  // Finish chapter 1 (Alpha); the next version is Beta's, by priority.
  await goto(`#/reader/${ids['1Alpha']}?page=3`);
  await readerSubtitle('Ch. 1 · Alpha');
  await page.keyboard.press(']');
  await readerSubtitle('Ch. 2 · Beta');
  await page.getByTitle('Back to manga').click({ force: true });
  await expect(page.getByRole('link', { name: 'Continue · Ch. 2' })).toHaveAttribute(
    'href',
    new RegExp(`/reader/${ids['2Beta']}$`),
  );
});

test('remembers the chapter list filter and sort per manga', async () => {
  await page.getByTitle('Sort chapters').click();
  await page.getByRole('menuitemradio', { name: 'Chapter number' }).click();
  await page.getByRole('button', { name: /^Descending/ }).click();
  await expect(rows().first()).toContainText('Ch. 1');
  await page.getByRole('button', { name: /^Unread/ }).click();
  await expect(rows().first()).toContainText('Ch. 2');

  // Another manga keeps the default view; coming back restores this one.
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(rows().first()).toContainText('Ch. 5');
  await openDetail();
  await expect(rows().first()).toContainText('Ch. 2');
  await expect(page.getByTitle('Sort chapters')).toContainText('Chapter number');
  const view = await page.evaluate((id) => window.api.invoke('manga.get', { mangaId: id }), mangaId);
  expect(view.chapterView).toMatchObject({ sort: 'number', descending: false, unreadOnly: true });
});

test('saves reader settings for one manga without touching the global ones', async () => {
  await goto(`#/reader/${ids['2Beta']}`);
  await page.getByTitle('Reader settings').click();
  const panel = page.locator('aside');
  await panel.getByRole('button', { name: 'Save as default for this manga' }).click();
  await expect(panel.getByText('Custom settings for this manga')).toBeVisible();
  await panel.getByRole('radio', { name: 'Webtoon' }).click();
  await panel.getByRole('radio', { name: 'Gray' }).click();

  const state = () =>
    page.evaluate(async (id) => {
      const [manga, settings] = await Promise.all([
        window.api.invoke('manga.get', { mangaId: id }),
        window.api.invoke('settings.get'),
      ]);
      return { override: manga.readerSettings, global: settings.reader };
    }, mangaId);
  await expect.poll(async () => (await state()).override?.mode).toBe('webtoon');
  const saved = await state();
  expect(saved.override).toMatchObject({ mode: 'webtoon', background: 'gray' });
  expect(saved.global).toMatchObject({ mode: 'auto', background: 'black' });

  await panel.getByRole('button', { name: 'Reset to global settings' }).click();
  await expect(panel.getByRole('button', { name: 'Save as default for this manga' })).toBeVisible();
  await expect.poll(async () => (await state()).override).toBeNull();
});
