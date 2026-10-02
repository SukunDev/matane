import { existsSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import yauzl from 'yauzl';
import { type TestApp, launchApp, leaveReader } from './support/app';

// Phase 3a: download chapters to CBZ, then read them with the site down.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const row = (name: string) => page.locator('main section div.group', { hasText: name });
const downloads = () =>
  page.evaluate(() => window.api.invoke('downloads.list')) as Promise<
    { chapterName: string; status: string; path: string | null; pagesTotal: number | null }[]
  >;
const loadedImages = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLImageElement>('img[src^="manga://page/"]')].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
  );
const zipEntries = (path: string) =>
  new Promise<string[]>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names.sort()));
      zip.readEntry();
    });
  });

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  // Downloads go inside the test profile (launchApp); no download ahead here, only what is asked for.
  await page.evaluate(async () => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ahead: 0 } });
  });
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test.afterAll(async () => {
  await t?.close();
});

test('downloads a chapter from its row and more from a selection, as CBZ with ComicInfo', async () => {
  await row('Ch. 1').getByRole('button', { name: 'Download' }).click();
  await expect(row('Ch. 1').getByTitle('Downloaded')).toBeVisible();

  await row('Ch. 2')
    .getByTestId('chapter-row')
    .click({ modifiers: ['Control'] });
  await row('Ch. 3')
    .getByTestId('chapter-row')
    .click({ modifiers: ['Control'] });
  await page.getByRole('toolbar').getByRole('button', { name: 'Download' }).click();
  await expect(row('Ch. 2').getByTitle('Downloaded')).toBeVisible();
  await expect(row('Ch. 3').getByTitle('Downloaded')).toBeVisible();

  const list = await downloads();
  expect(list.map((d) => [d.chapterName, d.status, d.pagesTotal])).toEqual(
    expect.arrayContaining([
      ['Ch. 1', 'done', 4],
      ['Ch. 2', 'done', 4],
      ['Ch. 3', 'done', 4],
    ]),
  );
  const first = list.find((d) => d.chapterName === 'Ch. 1')!;
  expect(first.path).toMatch(/E2E Demo \(EN\)[/\\]Paged Hero[/\\]Ch\. 1 \[Test Scans\]\.cbz$/);
  expect(await zipEntries(first.path!)).toEqual(['001.png', '002.png', '003.png', '004.png', 'ComicInfo.xml']);

  // Chapter filter and library badge.
  await page.getByRole('button', { name: /^Downloaded/ }).click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(3);
  await page.getByRole('button', { name: /^Downloaded/ }).click();
  await goto('#/library');
  await expect(page.getByTestId('library-item').getByTitle('3 downloaded chapters')).toBeVisible();
});

test('reads a downloaded chapter with the site down', async () => {
  await t.site.close();
  await goto('#/library');
  await page.getByTestId('library-item').first().click();
  await row('Ch. 2').getByTestId('chapter-row').click();
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  await expect.poll(loadedImages).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('2 / 4').first()).toBeVisible();
  await expect.poll(loadedImages).toBeGreaterThanOrEqual(1);
  await leaveReader(page);
});

test('deletes a download from the row menu', async () => {
  const path = (await downloads()).find((d) => d.chapterName === 'Ch. 1')!.path!;
  await row('Ch. 1').getByTitle('Chapter actions').click();
  await page.getByRole('menuitem', { name: 'Delete download' }).click();
  await expect(row('Ch. 1').getByRole('button', { name: 'Download' })).toBeAttached();
  expect(existsSync(path)).toBe(false);
  expect((await downloads()).map((d) => d.chapterName).sort()).toEqual(['Ch. 2', 'Ch. 3']);
});
