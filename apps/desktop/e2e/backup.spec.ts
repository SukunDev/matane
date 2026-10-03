import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRepoKey } from '@matane/extension-runtime/repo';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, addTrustedRepo, launchApp } from './support/app';

// Milestone 5e: a backup made on one profile restores on another: library, categories, progress,
// bookmarks, downloads, settings; the missing extension is offered from the repository it had.
test.describe.configure({ mode: 'serial' });

const publisher = generateRepoKey();
let a: TestApp;
let b: TestApp;
let file: string;

const goto = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash);
const libraryOf = (page: Page) =>
  page.evaluate(() =>
    window.api.invoke('library.list', {
      tab: 'all',
      sort: 'title',
      ascending: true,
      filters: { unread: false, reading: false, bookmarked: false, downloaded: false, status: [], sourceIds: [] },
    }),
  );
const pickFile = (t: TestApp, path: string) =>
  t.app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  }, path);

test.beforeAll(async () => {
  a = await launchApp(['demo']);
  b = await launchApp([]);
  // Profile A reads from a dev folder but also has the repository that offers the extension.
  await a.site.publishRepo({
    path: 'repo',
    name: 'Test Repo',
    privateKeyPem: publisher.privateKeyPem,
    extensions: [{ which: 'demo', version: '1.0.0' }],
  });
  await addTrustedRepo(a.page, `${a.site.origin}/repo/`);
});

test.afterAll(async () => {
  await a?.close();
  await b?.close();
});

test('profile A: a library with a category, progress, a bookmark, a download and a theme', async () => {
  const page = a.page;
  await goto(page, '#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row').first()).toBeVisible();
  const mangaId = Number(/#\/manga\/(\d+)/.exec(await page.evaluate(() => location.hash))![1]);
  await page.evaluate(async (id) => {
    const { downloads } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { downloads: { ...downloads, ahead: 0 } });
    const category = await window.api.invoke('categories.create', { name: 'Favourites' });
    await window.api.invoke('library.add', { mangaId: id, categoryIds: [category.id] });
    const chapters = await window.api.invoke('chapters.list', { mangaId: id });
    const one = chapters.find((c) => c.name === 'Ch. 1')!;
    const two = chapters.find((c) => c.name === 'Ch. 2')!;
    await window.api.invoke('progress.save', { chapterId: one.id, page: 2, pageEnd: 2, total: 4, offset: null });
    await window.api.invoke('chapters.setBookmarked', { chapterIds: [two.id], bookmarked: true });
    await window.api.invoke('downloads.enqueue', { chapterIds: [one.id] });
    await window.api.invoke('settings.set', { theme: 'latte' });
  }, mangaId);
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.api.invoke('downloads.list')))
        .filter((d) => d.status === 'done')
        .map((d) => d.chapterName),
    )
    .toEqual(['Ch. 1']);

  file = join(a.home, 'my-backup.zip');
  await pickFile(a, file);
  await goto(page, '#/settings/data');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to' })).toContainText('my-backup.zip');
});

test('profile B: a damaged file is refused before anything happens', async () => {
  const page = b.page;
  const junk = join(b.home, 'not-a-backup.zip');
  writeFileSync(junk, 'hello');
  await pickFile(b, junk);
  await goto(page, '#/settings/data');
  await page.getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not a Matane backup');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(await libraryOf(page)).toEqual([]);
});

test('profile B: merge brings everything back, and offers the extension it needs', async () => {
  const page = b.page;
  await pickFile(b, file);
  await page.getByRole('button', { name: 'Restore…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('backup-preview')).toContainText('1 manga');
  await expect(dialog).toContainText('Not installed here: E2E Demo');
  await dialog.getByRole('checkbox', { name: /Also restore the app settings/ }).check();
  await dialog.getByRole('button', { name: 'Merge' }).click();
  const summary = dialog.getByTestId('restore-summary');
  await expect(summary).toContainText('1 manga added');
  await expect(summary).toContainText('1 downloaded chapter linked again');
  await expect(summary).toContainText('App settings restored');
  await expect(page.locator('html')).toHaveClass(/latte/);

  // The repository came back with the backup and offers the missing extension.
  await summary.getByTestId('restore-missing').getByRole('button', { name: 'Install' }).click();
  await page.getByRole('dialog').filter({ hasText: 'SHA-256' }).getByRole('button', { name: 'Install' }).click();
  await expect(summary.getByTestId('restore-missing')).toContainText('Installed');
  await dialog.getByRole('button', { name: 'Close' }).last().click();

  const [manga] = await libraryOf(page);
  expect(manga).toMatchObject({ title: 'Paged Hero', downloadedCount: 1 });
  const categories = await page.evaluate(() => window.api.invoke('categories.list'));
  expect(categories.map((c) => c.name)).toContain('Favourites');
  const chapters = await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), manga!.mangaId);
  expect(chapters.find((c) => c.name === 'Ch. 1')).toMatchObject({ lastPage: 2 });
  expect(chapters.find((c) => c.name === 'Ch. 2')).toMatchObject({ bookmarked: true });
  // The source works again with the installed extension.
  await goto(page, `#/manga/${manga!.mangaId}`);
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
});

test('profile B: replace backs up first and asks to be sure', async () => {
  const page = b.page;
  await goto(page, '#/settings/data');
  await page.getByRole('button', { name: 'Restore…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Replace/ }).check();
  const replace = dialog.getByRole('button', { name: 'Replace' });
  await expect(replace).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I understand/ }).check();
  await replace.click();
  await expect(dialog.getByTestId('restore-summary')).toContainText('The previous state was backed up to');
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByTestId('backup-files')).toContainText('matane-before-restore-');
  expect((await libraryOf(page)).map((m) => m.title)).toEqual(['Paged Hero']);
});
