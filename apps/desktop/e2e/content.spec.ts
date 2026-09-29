import { generateRepoKey } from '@manga-reader/extension-runtime/repo';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 4c: content languages, adult content and the extension log panel. "E2E Adult" is marked
// NSFW (its requests carry lang=nsfw); "E2E Mirror" is Indonesian.
test.describe.configure({ mode: 'serial' });

const official = generateRepoKey();
let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const setLanguages = (languages: string[] | null) =>
  page.evaluate(async (value) => {
    const { browse } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { browse: { ...browse, languages: value } });
  }, languages);
const sourceLink = (id: string) => page.locator(`a[href*="/browse/sources/${id}/"]`);
const nsfwHits = () => t.site.hits.filter((hit) => hit.includes('lang=nsfw'));

test.beforeAll(async () => {
  t = await launchApp(['demo', 'mirror', 'adult'], { MATANE_E2E_OFFICIAL_KEY: official.publicKey });
  page = t.page;
  // A repository offering the adult extension too (the Available tab hides it the same way).
  await t.site.publishRepo({
    path: 'official',
    name: 'Test Official',
    privateKeyPem: official.privateKeyPem,
    extensions: [
      { which: 'adult', version: '2.0.0' },
      { which: 'mirror', version: '2.0.0' },
    ],
  });
  await page.evaluate((url) => window.api.invoke('repos.add', { url }), `${t.site.origin}/official`);
});

test.afterAll(async () => {
  await t?.close();
});

test('by default only the UI language and English show', async () => {
  await setLanguages(null);
  await goto('#/browse/sources');
  await expect(sourceLink('e2e-demo').first()).toBeVisible();
  await expect(sourceLink('e2e-mirror')).toHaveCount(0);
  // Hidden: the Indonesian MangaDex and mirror sources, and the adult one.
  await expect(page.getByTestId('hidden-by-content')).toContainText('3 sources hidden by your content settings.');

  await goto('#/browse/extensions');
  await page.getByRole('tab', { name: /^Available/ }).click();
  await expect(page.getByTestId('available-row')).toHaveCount(0);
  await expect(page.getByTestId('hidden-by-content')).toContainText('2 extensions hidden');
});

test('content languages are a setting, picked from the Extensions page', async () => {
  await page.getByRole('button', { name: 'Content languages' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Indonesian/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Content languages' })).toContainText('EN, ID');
  await expect(page.getByTestId('available-row')).toHaveCount(1);
  await expect(page.getByTestId('available-row')).toContainText('E2E Mirror');
  expect(await page.evaluate(async () => (await window.api.invoke('settings.get')).browse.languages)).toEqual([
    'en',
    'id',
  ]);
  await goto('#/browse/sources');
  await expect(sourceLink('e2e-mirror').first()).toBeVisible();
});

test('adult sources stay out of Sources, browse and global search while hidden', async () => {
  await goto('#/browse/sources');
  await expect(sourceLink('e2e-adult')).toHaveCount(0);
  await goto('#/browse/sources/e2e-adult/nsfw?tab=popular');
  await expect(page.getByRole('heading', { name: /Adult sources are hidden/ })).toBeVisible();

  await page.evaluate(async () => {
    const { globalSearch } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { globalSearch: { ...globalSearch, sourceIds: null } });
  });
  await goto('#/browse/global-search?q=hero');
  await expect(page.getByText('Paged Hero').first()).toBeVisible();
  expect(nsfwHits()).toEqual([]);
});

test('turning adult content on asks first, then shows it everywhere', async () => {
  await goto('#/settings/browse');
  const toggle = page.getByRole('switch', { name: 'Show NSFW content' });
  await toggle.click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Show adult content?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show NSFW content' }).click();
  await expect(toggle).toBeChecked();

  await goto('#/browse/sources');
  await expect(sourceLink('e2e-adult').first()).toBeVisible();
  await goto('#/browse/sources/e2e-adult/nsfw?tab=popular');
  await expect(page.getByText('Paged Hero')).toBeVisible();
  await goto('#/browse/global-search?q=garden');
  await expect(page.getByText('Scroll Garden').first()).toBeVisible();
  await expect.poll(() => nsfwHits().some((hit) => hit.includes('q=garden'))).toBe(true);

  await goto('#/browse/extensions');
  await page.getByRole('tab', { name: /^Available/ }).click();
  await expect(page.getByTestId('available-row').filter({ hasText: 'E2E Adult' })).toContainText('18+');
});

test('Settings → Browse & extensions holds the repository list and extension updates', async () => {
  await goto('#/settings/browse');
  const repos = page.getByRole('region', { name: 'Repositories' });
  await expect(repos.getByTestId('repo-card')).toContainText('Test Official');
  await expect(repos.getByTestId('repo-card')).toContainText('Verified');
  await page.getByRole('switch', { name: 'Update extensions by themselves' }).click();
  await page.getByRole('radiogroup', { name: 'Check repositories' }).getByRole('radio', { name: '12 h' }).click();
  expect(await page.evaluate(async () => (await window.api.invoke('settings.get')).browse)).toMatchObject({
    autoUpdateExtensions: true,
    repoSyncHours: 12,
  });
});

test('the log of a dev extension shows its lines, requests and errors live', async () => {
  await goto('#/browse/extensions');
  const row = page.getByTestId('extension-row').filter({ hasText: 'E2E Demo' });
  await row.getByRole('button', { name: 'View logs' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'E2E Demo log' })).toBeVisible();

  // While it is open, new lines arrive live.
  await page.evaluate(() =>
    window.api.invoke('sources.browse', { requestId: 'log-1', sourceId: 'e2e-demo/en', kind: 'popular', page: 1 }),
  );
  const lines = dialog.getByRole('list', { name: 'Log lines' });
  await expect(lines).toContainText('popular page 1');
  await expect(lines).toContainText(/GET http:\/\/e2e\.localhost:\d+\/api\/list\?page=1&lang=en → 200/);

  await page
    .evaluate(() =>
      window.api.invoke('sources.browse', {
        requestId: 'log-2',
        sourceId: 'e2e-demo/en',
        kind: 'search',
        page: 1,
        query: 'boom',
      }),
    )
    .catch(() => undefined);
  await expect(lines).toContainText('→ 404');
  await expect(lines).toContainText(/search \(en\): .*404/);

  await dialog.getByRole('radiogroup', { name: 'Level' }).getByRole('radio', { name: 'Errors' }).click();
  await expect(lines.getByRole('listitem')).toHaveCount(1);
  await expect(lines).not.toContainText('popular page 1');

  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(dialog).toContainText('Nothing logged yet');
  await dialog.getByRole('button', { name: 'Close' }).click();
});
