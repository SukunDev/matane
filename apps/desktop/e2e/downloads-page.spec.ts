import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 3b: the Downloads page (mockup 08), download ahead, delete after reading, moving the
// download folder and the size limit.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let mangaId: number;
let chapters: Record<string, number>;

interface Listed {
  id: number;
  chapterId: number;
  chapterName: string;
  status: string;
  path: string | null;
  queueOrder: number;
}

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const downloads = () => page.evaluate(() => window.api.invoke('downloads.list')) as Promise<Listed[]>;
const statusOf = async (name: string) => (await downloads()).find((d) => d.chapterName === name)?.status;
const setDownloads = (patch: Record<string, unknown>) =>
  page.evaluate(async (p) => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ...p } });
  }, patch);
const enqueue = (names: string[]) =>
  page.evaluate(
    (chapterIds) => window.api.invoke('downloads.enqueue', { chapterIds }),
    names.map((n) => chapters[n]!),
  );
const item = (name: string) => page.getByTestId('download-item').filter({ hasText: name });
const tab = (name: RegExp) => page.getByRole('tab', { name });

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  await setDownloads({ ahead: 0 });
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  mangaId = Number(/manga\/(\d+)/.exec(await page.evaluate(() => location.hash))![1]);
  const list = (await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId)) as {
    id: number;
    name: string;
  }[];
  chapters = Object.fromEntries(list.map((c) => [c.name, c.id]));
});

test.afterAll(async () => {
  await t?.close();
});

test('shows the queue grouped per manga; pause, reorder, cancel and resume work', async () => {
  // One chapter at a time with slow pages, so the queue stays put while we look at it.
  await setDownloads({ parallel: 1 });
  t.site.pageDelayMs = 700;
  await enqueue(['Ch. 1', 'Ch. 2', 'Ch. 3', 'Ch. 5']);
  await goto('#/downloads');

  await expect(page.getByTestId('downloads-summary')).toContainText('4 in queue · 1 active');
  await expect(page.getByTestId('download-group')).toContainText('Paged Hero');
  await expect(page.getByTestId('download-group')).toContainText('4 chapters in queue');
  await expect(item('Ch. 1')).toContainText(/Downloading \(\d+%\)/);
  await expect(item('Ch. 2')).toContainText('Queued');

  await page.getByRole('button', { name: 'Pause all' }).click();
  await expect(page.getByRole('button', { name: 'Resume all' })).toBeVisible();
  await expect.poll(async () => (await downloads()).every((d) => d.status === 'paused')).toBe(true);
  await expect(item('Ch. 1')).toContainText('Paused');

  // Alt+↑ moves a chapter up within its manga; dragging does the same.
  await item('Ch. 5').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  const order = async () => (await downloads()).sort((a, b) => a.queueOrder - b.queueOrder).map((d) => d.chapterName);
  await expect.poll(order).toEqual(['Ch. 1', 'Ch. 5', 'Ch. 2', 'Ch. 3']);
  await expect(page.getByTestId('download-item').first()).toContainText('Ch. 1');
  await expect(page.getByTestId('download-item').nth(1)).toContainText('Ch. 5');
  await item('Ch. 3').dragTo(item('Ch. 1'));
  await expect.poll(order).toEqual(['Ch. 3', 'Ch. 1', 'Ch. 5', 'Ch. 2']);

  await item('Ch. 2').getByTitle('Cancel download').click();
  await expect(item('Ch. 2')).toHaveCount(0);
  await expect(tab(/Queue/)).toContainText('3');

  // One chapter resumed on its own finishes; the rest stay paused until "Resume all".
  t.site.pageDelayMs = 0;
  await item('Ch. 5').getByTitle('Resume').click();
  await expect.poll(() => statusOf('Ch. 5')).toBe('done');
  expect(await statusOf('Ch. 1')).toBe('paused');
  await page.getByRole('button', { name: 'Resume all' }).click();
  await expect.poll(() => statusOf('Ch. 1')).toBe('done');
  await expect.poll(() => statusOf('Ch. 3')).toBe('done');
  await expect(page.getByTestId('downloads-summary')).toContainText('0 in queue');

  await tab(/Completed/).click();
  await expect(page.getByTestId('download-done')).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.getByTestId('download-done')).toHaveCount(0);
  await expect(page.getByText('No finished downloads')).toBeVisible();
  // Only off the page: the chapters are still downloaded.
  expect((await downloads()).filter((d) => d.status === 'done')).toHaveLength(3);
  await setDownloads({ parallel: 2 });
});

test('a failing chapter goes to Errors, with details, and Retry finishes it', async () => {
  t.site.failPages = true;
  await enqueue(['Ch. 2']);
  await expect(tab(/Errors/)).toContainText('1');
  await tab(/Errors/).click();
  await expect(item('Ch. 2')).toContainText('Error:');
  await item('Ch. 2').getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('dialog')).toContainText('Download failed');
  await expect(page.getByRole('dialog')).toContainText('404');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  t.site.failPages = false;
  await item('Ch. 2').getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => statusOf('Ch. 2')).toBe('done');
  await expect(page.getByText('No errors')).toBeVisible();
});

test('download ahead queues the next chapters while reading a library manga', async () => {
  await page.evaluate((ids) => window.api.invoke('downloads.delete', { chapterIds: ids }), Object.values(chapters));
  await expect.poll(async () => (await downloads()).length).toBe(0);
  await setDownloads({ ahead: 2 });

  await goto(`#/reader/${chapters['Ch. 1']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await expect.poll(async () => (await downloads()).map((d) => d.chapterName).sort()).toEqual(['Ch. 2', 'Ch. 3']);
  await expect.poll(() => statusOf('Ch. 3')).toBe('done');
  await page.getByTitle('Back to manga').click({ force: true });
});

test('delete after reading removes a chapter once it is read', async () => {
  await setDownloads({ ahead: 0 });
  await goto('#/settings/downloads');
  await page.getByRole('switch', { name: 'Delete after reading' }).click();
  await expect(page.getByRole('radiogroup', { name: 'When' })).toBeVisible();
  const path = (await downloads()).find((d) => d.chapterName === 'Ch. 2')!.path!;
  expect(existsSync(path)).toBe(true);

  await goto(`#/reader/${chapters['Ch. 2']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  for (const n of [2, 3, 4]) {
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText(`${n} / 4`).first()).toBeVisible();
  }
  await expect.poll(() => statusOf('Ch. 2')).toBeUndefined();
  expect(existsSync(path)).toBe(false);
  expect(await statusOf('Ch. 3')).toBe('done');
  await page.getByTitle('Back to manga').click({ force: true });
});

test('changing the folder moves the downloads, which stay readable', async () => {
  const target = join(t.home, 'moved');
  // The native folder picker cannot be driven; answer it from main.
  await t.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, target);
  const before = (await downloads()).find((d) => d.chapterName === 'Ch. 3')!.path!;

  await goto('#/settings/downloads');
  await page.getByRole('button', { name: 'Change…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Move existing downloads?');
  await page.getByRole('button', { name: 'Move files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('download-folder')).toHaveText(target);

  const after = (await downloads()).find((d) => d.chapterName === 'Ch. 3')!.path!;
  expect(after.startsWith(target)).toBe(true);
  expect(existsSync(after)).toBe(true);
  expect(existsSync(before)).toBe(false);

  await t.site.close();
  await goto(`#/reader/${chapters['Ch. 3']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLImageElement>('img[src^="manga://page/"]')].filter(
            (i) => i.complete && i.naturalWidth > 0,
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await page.getByTitle('Back to manga').click({ force: true });
});

test('past the size limit, download ahead stops and manual downloads ask first', async () => {
  await setDownloads({ ahead: 2, limitGb: 1e-9 });
  // Reading Ch. 1 would queue Ch. 2 and Ch. 5; the limit holds that back.
  await goto(`#/reader/${chapters['Ch. 1']}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await downloads()).map((d) => d.chapterName)).toEqual(['Ch. 3']);
  await page.getByTitle('Back to manga').click({ force: true });

  await goto('#/downloads');
  await expect(page.getByRole('status').filter({ hasText: 'Download size limit reached' })).toBeVisible();

  await goto(`#/manga/${mangaId}`);
  const row = page.locator('main section div.group', { hasText: 'Ch. 5' });
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Download size limit reached');
  await page.getByRole('button', { name: 'Download anyway' }).click();
  await expect.poll(() => statusOf('Ch. 5')).toBeDefined();
});
