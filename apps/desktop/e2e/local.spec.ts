import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { type Page, expect, test } from '@playwright/test';
import yazl from 'yazl';
import { type TestApp, launchApp } from './support/app';
import { png } from './support/site';

// Milestone 6a: the local files source reads a folder of CBZ files and image folders, with no
// extension and no network. One app session against a folder built in the test profile.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let library: string;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const loadedImages = (prefix: string) =>
  page.evaluate(
    (p) =>
      [...document.querySelectorAll<HTMLImageElement>(`img[src^="${p}"]`)].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
    prefix,
  );
const page1 = png(120, 180, [166, 227, 161]);

async function cbz(path: string, pages: number) {
  const zip = new yazl.ZipFile();
  for (let i = 1; i <= pages; i++) zip.addBuffer(page1, `${String(i).padStart(3, '0')}.png`);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}

const mangaIdOf = (title: string) =>
  page.evaluate(async (name) => {
    const items = await window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, bookmarked: false, downloaded: false, status: [], sourceIds: [] },
    });
    return items.find((i) => i.title === name)?.mangaId;
  }, title);

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  library = join(t.home, 'local-library');
  mkdirSync(join(library, 'Local Alpha', 'Ch 2'), { recursive: true });
  await cbz(join(library, 'Local Alpha', 'Ch 1.cbz'), 3);
  for (const name of ['001.png', '002.png']) writeFileSync(join(library, 'Local Alpha', 'Ch 2', name), page1);
  writeFileSync(join(library, 'Local Alpha', 'cover.png'), png(60, 90, [203, 166, 247]));
  mkdirSync(join(library, 'One Shot Beta'));
  writeFileSync(join(library, 'One Shot Beta', '001.png'), page1);
});

test.afterAll(async () => {
  await t?.close();
});

test('Settings → Browse chooses the folder, and the source asks for one until then', async () => {
  await goto('#/browse/sources/local/files');
  await expect(page.getByText(/Choose the local folder/)).toBeVisible();

  await goto('#/settings/browse');
  const settings = page.getByTestId('local-settings');
  await expect(settings.getByTestId('local-folder')).toHaveText('No folder chosen yet');
  await page.evaluate((folder) => window.api.invoke('settings.set', { local: { folder } }), library);
  await expect(settings.getByTestId('local-folder')).toHaveText(library);
});

test('lists the manga of the folder with covers, and it is a source like any other', async () => {
  await goto('#/browse/sources');
  await expect(page.locator('a[href*="/browse/sources/local/files"]').first()).toBeVisible();
  await page.locator('a[href*="/browse/sources/local/files"]').first().click();
  await expect(page.locator('main a[title="Local Alpha"]').first()).toBeVisible();
  await expect(page.locator('main a[title="One Shot Beta"]').first()).toBeVisible();
  // `cover.png` for one, the first page for the other.
  await expect.poll(() => loadedImages('manga://cover/')).toBe(2);
});

test('opens a manga: chapters of both kinds, nothing to download or open on the web', async () => {
  await page.locator('main a[title="Local Alpha"]').first().click();
  await expect(page.getByRole('heading', { name: 'Local Alpha' })).toBeVisible();
  await expect(page.getByTestId('chapter-row')).toHaveCount(2);
  await expect(page.getByTestId('chapter-row').first()).toContainText('Ch 2');
  await expect(page.getByTitle('Download')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open in browser' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test('reads an archive chapter and a folder chapter', async () => {
  await page.getByRole('link', { name: /Start reading/ }).click();
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
  await expect(page.getByText('1 / 3').first()).toBeVisible();
  // A manga of unknown type reads left to right.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 / 3').first()).toBeVisible();

  const mangaId = (await mangaIdOf('Local Alpha'))!;
  const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId);
  const folderChapter = chapters.find((c) => c.name === 'Ch 2')!;
  await goto(`#/reader/${folderChapter.id}`);
  await expect.poll(() => loadedImages('manga://page/')).toBe(1);
  await expect(page.getByText('1 / 2').first()).toBeVisible();
});

test('a chapter added to the folder shows up after a refresh', async () => {
  const mangaId = (await mangaIdOf('Local Alpha'))!;
  await cbz(join(library, 'Local Alpha', 'Ch 3.cbz'), 1);
  const result = await page.evaluate(
    (id) => window.api.invoke('manga.refresh', { mangaId: id, requestId: 'e2e-local-refresh' }),
    mangaId,
  );
  expect(result.newChapterIds).toHaveLength(1);
  const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId);
  expect(chapters.map((c) => c.name).sort()).toEqual(['Ch 1', 'Ch 2', 'Ch 3']);
});

test('local chapters are never queued for download', async () => {
  const mangaId = (await mangaIdOf('Local Alpha'))!;
  await page.evaluate(async (id) => {
    const chapters = await window.api.invoke('chapters.list', { mangaId: id });
    await window.api.invoke('downloads.enqueue', { chapterIds: chapters.map((c) => c.id) });
  }, mangaId);
  expect(await page.evaluate(() => window.api.invoke('downloads.list'))).toEqual([]);
});

test('stopping use of the folder brings back the prompt, and the library keeps its manga', async () => {
  await goto('#/settings/browse');
  await page.getByTestId('local-settings').getByRole('button', { name: 'Stop using' }).click();
  await expect(page.getByTestId('local-folder')).toHaveText('No folder chosen yet');
  await goto('#/browse/sources/local/files');
  await expect(page.getByText(/Choose the local folder/)).toBeVisible();
  await goto('#/library');
  await expect(page.getByTestId('library-item')).toHaveCount(1);
});
