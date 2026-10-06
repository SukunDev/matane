import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';
import { type FakeKitsu, startKitsu } from './support/kitsu';
import { type FakeMangaUpdates, startMangaUpdates } from './support/mangaupdates';

// Milestone 6e: Kitsu and MangaUpdates log in with a username and password in the app, and keep
// reading in step. Both services are fakes; the password is checked by them and never stored.
test.describe.configure({ mode: 'serial' });

let kitsu: FakeKitsu;
let mu: FakeMangaUpdates;
let t: TestApp;
let page: Page;
let mangaId: number;
let chapterIds: number[];

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const card = (service: string) => page.getByTestId(`tracker-${service}`);
const markRead = (...numbers: number[]) =>
  page.evaluate(
    (ids) => window.api.invoke('chapters.markRead', { chapterIds: ids, read: true }),
    numbers.map((n) => chapterIds[n - 1]!),
  );

test.beforeAll(async () => {
  kitsu = await startKitsu();
  mu = await startMangaUpdates();
  t = await launchApp(['demo'], {
    MATANE_E2E_KITSU_API: kitsu.graphql,
    MATANE_E2E_KITSU_TOKEN: kitsu.tokenUrl,
    MATANE_E2E_MU_API: mu.api,
  });
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
  await kitsu?.close();
  await mu?.close();
});

test('Settings → Tracking logs in to Kitsu and MangaUpdates with a username and password', async () => {
  await goto('#/settings/tracking');
  await expect(card('kitsu').getByTestId('tracker-state')).toHaveText('Not connected');
  // Neither has a browser login, so neither has a redirect url or a Connect button.
  await expect(card('kitsu').getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  const kitsuForm = card('kitsu').getByTestId('password-login');
  await kitsuForm.getByLabel('Email or username').fill('mika@example.org');
  await kitsuForm.getByLabel('Password').fill('wrong');
  await kitsuForm.getByRole('button', { name: 'Log in' }).click();
  await expect(kitsuForm.getByRole('alert')).toContainText('did not accept that email and password');
  // The password does not stay on the screen.
  await expect(kitsuForm.getByLabel('Password')).toHaveValue('');
  await expect(card('kitsu').getByTestId('tracker-state')).toHaveText('Not connected');

  await kitsuForm.getByLabel('Password').fill('hunter2');
  await kitsuForm.getByRole('button', { name: 'Log in' }).click();
  await expect(card('kitsu').getByTestId('tracker-state')).toContainText('Connected as mika-kitsu');
  expect(kitsu.tokenRequests.at(-1)).toMatchObject({ grant_type: 'password', username: 'mika@example.org' });
  expect(kitsu.tokenRequests.at(-1)!['client_id']).toBeTruthy();

  const muForm = card('mangaupdates').getByTestId('password-login');
  await muForm.getByLabel('Username').fill('mika');
  await muForm.getByLabel('Password').fill('pw');
  await muForm.getByRole('button', { name: 'Log in' }).click();
  await expect(card('mangaupdates').getByTestId('tracker-state')).toContainText('Connected as mika');
  await expect(card('kitsu').getByTestId('password-login')).toHaveCount(0);
});

test('a manga is linked to both, which creates its entries', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  mangaId = Number(/manga\/(\d+)/.exec(page.url())![1]);
  // The chapters arrive from the source a moment after the page opens.
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  chapterIds = (await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((c) => c.id);

  await page.getByRole('button', { name: 'Tracking' }).click();
  const kitsuSection = page.getByTestId('tracking-kitsu');
  const muSection = page.getByTestId('tracking-mangaupdates');
  await expect(kitsuSection.getByTestId('tracking-results').getByRole('listitem')).toHaveCount(2);
  await kitsuSection.getByRole('button', { name: 'Link to Paged Hero', exact: true }).click();
  await expect(kitsuSection.getByTestId('tracking-linked')).toHaveText('Linked to Paged Hero');
  await expect(muSection.getByTestId('tracking-results').getByRole('listitem')).toHaveCount(2);
  await muSection.getByRole('button', { name: 'Link to Paged Hero', exact: true }).click();
  await expect(muSection.getByTestId('tracking-linked')).toContainText('Paged Hero');

  await expect.poll(() => kitsu.entries.get('30')?.status).toBe('PLANNED');
  await expect.poll(() => mu.items.get(123)?.list_id).toBe(1);
  // Kitsu's first token lasted a second: it ran on a renewed one.
  expect(kitsu.tokenRequests.map((r) => r['grant_type'])).toContain('refresh_token');
});

test('chapters read are sent to both', async () => {
  await markRead(1, 2);
  await expect.poll(() => kitsu.entries.get('30')?.progress).toBe(2);
  expect(kitsu.entries.get('30')).toMatchObject({ status: 'CURRENT' });
  expect(kitsu.entries.get('30')!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect.poll(() => mu.items.get(123)?.chapter).toBe(2);
  expect(mu.items.get(123)).toMatchObject({ list_id: 0 });
});

test("edits go to both, on each one's own scale", async () => {
  for (const service of ['kitsu', 'mangaupdates']) {
    const score = page.getByTestId(`tracking-${service}`).getByLabel('Score (0–10)');
    await score.fill('9');
    await score.blur();
  }
  // Kitsu rates from 2 to 20, MangaUpdates from 1 to 10.
  await expect.poll(() => kitsu.entries.get('30')?.rating).toBe(18);
  await expect.poll(() => mu.ratings.get(123)).toBe(9);
  await page.getByTestId('tracking-kitsu').getByLabel('Status').selectOption('completed');
  await expect.poll(() => kitsu.entries.get('30')?.status).toBe('COMPLETED');
  await expect.poll(() => kitsu.entries.get('30')?.finishedAt).toMatch(/^\d{4}-/);
  await page.getByTestId('tracking-mangaupdates').getByLabel('Status').selectOption('on_hold');
  await expect.poll(() => mu.items.get(123)?.list_id).toBe(4);
});

test('the logins survive a restart', async () => {
  await t.restart();
  page = t.page;
  await goto('#/settings/tracking');
  await expect(card('kitsu').getByTestId('tracker-state')).toContainText('Connected as mika-kitsu');
  await expect(card('mangaupdates').getByTestId('tracker-state')).toContainText('Connected as mika');
  await page.getByTestId('tracker-kitsu').getByRole('button', { name: 'Disconnect' }).click();
  await expect(card('kitsu').getByTestId('password-login')).toBeVisible();
});
