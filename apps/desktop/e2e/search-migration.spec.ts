import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, leaveReader } from './support/app';

// Phase 2e: global search and source migration across two fake extensions: "E2E Demo" (English, and
// "E2E Broken", whose searches always fail) and "E2E Mirror" (same catalogue in Indonesian, chapters
// only up to 3).
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const sections = () => page.getByTestId('search-source');
const api = <T>(channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) => (window.api.invoke as (channel: string, input?: unknown) => Promise<unknown>)(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;
const mangaIdOf = async (sourceId: string, title: string) => {
  const result = await api<{ items: { mangaId: number; title: string }[] }>('sources.browse', {
    sourceId,
    kind: 'search',
    page: 1,
    query: title,
  });
  return result.items.find((i) => i.title === title)!.mangaId;
};

test.beforeAll(async () => {
  t = await launchApp();
  page = t.page;
  // Pinned sources are the default set for global search and migration; pinning the fake ones keeps
  // any other installed source (real network) out.
  for (const sourceId of ['e2e-demo/en', 'e2e-mirror/id', 'e2e-demo/broken']) {
    await api('sources.setPinned', { sourceId, pinned: true });
  }
});

test.afterAll(async () => {
  await t?.close();
});

test('searches every source, row by row, without waiting for a failing one', async () => {
  await goto('#/browse/global-search');
  await expect(page.getByText('Search every source at once')).toBeVisible();
  await page.getByLabel('Search every source…').fill('hero');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=hero/);

  await expect(sections()).toHaveCount(3);
  const english = page.getByRole('region', { name: 'E2E Demo' }).first();
  await expect(english).toContainText('Paged Hero');
  await expect(english).toContainText('1 result');
  const broken = page.getByRole('region', { name: 'E2E Broken' });
  await expect(broken.getByRole('alert')).toContainText('503');
  await expect(broken.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText('Searching 3 sources · 2 done')).toBeVisible();
  await expect(page.getByText('100% complete')).toBeVisible();

  const onlyWithResults = page.getByLabel('Only sources with results');
  await onlyWithResults.click();
  await expect(onlyWithResults).toBeChecked();
  await expect(sections()).toHaveCount(2);
  await onlyWithResults.click();
  await expect(onlyWithResults).not.toBeChecked();

  // A custom source set is remembered; "Default" goes back to all installed sources.
  await page.getByRole('button', { name: /^Sources: Default \(3\)/ }).click();
  await page.getByRole('checkbox', { name: /E2E Broken/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Sources: 2 selected/ })).toBeVisible();
  await expect(sections()).toHaveCount(2);
  const settings = await api<{ globalSearch: { sourceIds: string[] } }>('settings.get');
  expect([...settings.globalSearch.sourceIds].sort()).toEqual(['e2e-demo/en', 'e2e-mirror/id']);

  await english.getByRole('link', { name: 'See all' }).click();
  await expect(page).toHaveURL(/browse\/sources\/e2e-demo\/en\?.*tab=search.*q=hero/);
  // The URL changes first; wait for the global search page to be gone.
  await expect(page.getByRole('region', { name: 'E2E Mirror' })).toHaveCount(0);
  await expect(page.getByText('Paged Hero')).toBeVisible();
});

test('migrates read status, bookmarks, categories, reader settings and cover by chapter number', async () => {
  const hero = await mangaIdOf('e2e-demo/en', 'Paged Hero');
  const garden = await mangaIdOf('e2e-demo/en', 'Scroll Garden');
  await api('manga.refresh', { mangaId: hero });
  await api('manga.refresh', { mangaId: garden });
  const category = await api<{ id: number }>('categories.create', { name: 'Favourites' });
  await api('library.add', { mangaId: hero, categoryIds: [category.id] });
  await api('library.add', { mangaId: garden, categoryIds: [] });
  const chapters = await api<{ id: number; number: number }[]>('chapters.list', { mangaId: hero });
  const byNumber = (n: number) => chapters.find((c) => c.number === n)!.id;
  await api('chapters.markRead', { chapterIds: [byNumber(1), byNumber(2)], read: true });
  await api('chapters.setBookmarked', { chapterIds: [byNumber(5)], bookmarked: true });
  // Progress on chapter 3 and a custom cover from its first page.
  await goto(`#/reader/${byNumber(3)}?page=1`);
  await expect(page.getByText('2 / 4').first()).toBeVisible();
  expect(
    await api('manga.setCustomCover', { mangaId: hero, from: { kind: 'page', chapterId: byNumber(3), index: 0 } }),
  ).toBe(true);
  await leaveReader(page);
  await api('manga.setReaderSettings', { mangaId: hero, settings: { mode: 'webtoon' } });

  // Library: select both, Migrate.
  await goto('#/library');
  await page
    .getByTestId('library-item')
    .filter({ hasText: 'Paged Hero' })
    .click({ modifiers: ['Control'] });
  await page
    .getByTestId('library-item')
    .filter({ hasText: 'Scroll Garden' })
    .click({ modifiers: ['Control'] });
  await page.getByRole('toolbar').getByRole('button', { name: 'Migrate' }).click();
  await expect(page.getByRole('heading', { name: 'Migrate 2 manga' })).toBeVisible();

  const rows = page.getByTestId('migration-row');
  const heroRow = rows.filter({ hasText: 'Paged Hero' }).first();
  const gardenRow = rows.filter({ hasText: 'Scroll Garden' }).first();
  // Its own source is skipped; the Indonesian one has the same title.
  await expect(heroRow.getByText('Exact')).toBeVisible();
  await expect(gardenRow.getByText('Exact')).toBeVisible();
  await expect(page.getByText('2 of 2 ready to migrate')).toBeVisible();

  // Manual search picks another manga; picking the right one again restores it.
  await heroRow.getByRole('button', { name: 'Search manually' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTitle('Paged Hero')).toBeVisible();
  await dialog.getByLabel('Title').fill('filler title 3');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await dialog.getByTitle('Filler Title 3').click();
  await expect(heroRow).toContainText('Filler Title 3');
  await expect(heroRow.getByText('Chosen')).toBeVisible();
  await heroRow.getByRole('button', { name: 'Search manually' }).click();
  await page.getByRole('dialog').getByTitle('Paged Hero').click();
  await expect(heroRow).toContainText('Paged Hero');

  await gardenRow.getByLabel('Skip this title').click();
  await expect(page.getByText('1 of 2 ready to migrate')).toBeVisible();
  await page.getByRole('button', { name: 'Migrate 1 manga' }).click();

  const summary = page.getByTestId('migration-summary');
  await expect(summary).toContainText('1Migrated');
  await expect(summary).toContainText('1Skipped');
  await expect(summary).toContainText('0Failed');
  await expect(page.getByText('2 read chapters carried over · 1 chapter could not be matched: Ch. 5')).toBeVisible();

  const target = await mangaIdOf('e2e-mirror/id', 'Paged Hero');
  const info = await api<{
    inLibrary: boolean;
    categoryIds: number[];
    readerSettings: { mode: string } | null;
    hasCustomCover: boolean;
  }>('manga.get', { mangaId: target });
  expect(info).toMatchObject({
    inLibrary: true,
    categoryIds: [category.id],
    readerSettings: { mode: 'webtoon' },
    hasCustomCover: true,
  });
  const migrated = await api<{ number: number; read: boolean; lastPage: number }[]>('chapters.list', {
    mangaId: target,
  });
  expect(migrated.map((c) => [c.number, c.read, c.lastPage])).toEqual([
    [3, false, 1],
    [2, true, 0],
    [1, true, 0],
  ]);
  expect((await api<{ inLibrary: boolean }>('manga.get', { mangaId: hero })).inLibrary).toBe(false);
  expect((await api<{ inLibrary: boolean }>('manga.get', { mangaId: garden })).inLibrary).toBe(true);

  await page.getByRole('link', { name: 'Open new entry' }).click();
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Migrate' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue · Ch. 3' })).toBeVisible();
});
