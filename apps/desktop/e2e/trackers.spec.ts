import { type Page, expect, test } from '@playwright/test';
import { type FakeAniList, startAniList } from './support/anilist';
import { type TestApp, launchApp } from './support/app';

// Milestone 6c: connect AniList (through the loopback login, with the browser played by the test),
// link a manga, and watch reading, edits, outages and incognito reach a fake AniList.
test.describe.configure({ mode: 'serial' });

let tracker: FakeAniList;
let t: TestApp;
let page: Page;
let mangaId: number;
let chapterIds: number[];

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const progress = () => tracker.entries.get(30013)?.progress;
const card = () => page.getByTestId('tracker-anilist');
const hook = () =>
  t.app.evaluate(() => (globalThis as unknown as { __matane: { loginUrl?: string; oauthPort?: number } }).__matane);
const markRead = (...numbers: number[]) =>
  page.evaluate(
    (ids) => window.api.invoke('chapters.markRead', { chapterIds: ids, read: true }),
    numbers.map((n) => chapterIds[n - 1]!),
  );

test.beforeAll(async () => {
  tracker = await startAniList();
  t = await launchApp(['demo'], {
    MATANE_E2E_ANILIST_API: tracker.url,
    MATANE_ANILIST_CLIENT_ID: 'e2e-client',
    MATANE_E2E_OAUTH_PORT: '0',
  });
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
  await tracker?.close();
});

test('Settings → Tracking logs in through the browser round trip', async () => {
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-state')).toHaveText('Not connected');
  await card().getByRole('button', { name: 'Connect' }).click();
  await expect(card().getByRole('button', { name: /Waiting for the browser/ })).toBeVisible();

  // The test is the browser: it reads the address Matane would open, then follows the redirect.
  await expect.poll(async () => (await hook()).loginUrl).toBeTruthy();
  const { loginUrl, oauthPort } = await hook();
  const url = new URL(loginUrl!);
  expect(url.origin + url.pathname).toBe('https://anilist.co/api/v2/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe('e2e-client');
  expect(url.searchParams.get('response_type')).toBe('token');
  const state = url.searchParams.get('state')!;

  expect((await fetch(`http://127.0.0.1:${oauthPort}/callback`)).status).toBe(200);
  // A token with the wrong state is refused; Matane goes on waiting.
  expect((await fetch(`http://127.0.0.1:${oauthPort}/done?access_token=${tracker.token}&state=wrong`)).status).toBe(
    400,
  );
  expect(
    (await fetch(`http://127.0.0.1:${oauthPort}/done?access_token=${tracker.token}&state=${state}&expires_in=31536000`))
      .status,
  ).toBe(200);

  await expect(card().getByTestId('tracker-state')).toContainText('Connected as mika');
  await expect(card().getByRole('button', { name: 'Disconnect' })).toBeVisible();
});

test('a manga is searched on AniList and linked, which creates its entry', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  mangaId = Number(/manga\/(\d+)/.exec(page.url())![1]);
  chapterIds = (await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((c) => c.id);
  expect(chapterIds).toHaveLength(4);

  await page.getByRole('button', { name: 'Tracking' }).click();
  const dialog = page.getByTestId('tracking-anilist');
  // The title is searched at once.
  await expect(dialog.getByTestId('tracking-results').getByRole('listitem')).toHaveCount(2);
  await expect(dialog.getByText('One shot · 2021 · 1 chapters')).toBeVisible();
  await dialog.getByRole('button', { name: 'Link to Paged Hero', exact: true }).click();
  await expect(dialog.getByTestId('tracking-linked')).toHaveText('Linked to Paged Hero');

  // A new entry with nothing read starts as planning.
  await expect.poll(() => tracker.entries.get(30013)?.status).toBe('PLANNING');
  await expect(dialog.getByTestId('tracking-pending')).toHaveCount(0);
});

test('chapters read are sent, as the highest number', async () => {
  await markRead(1, 2);
  await expect.poll(progress).toBe(2);
  expect(tracker.entries.get(30013)).toMatchObject({ status: 'CURRENT' });
  expect(tracker.entries.get(30013)!.startedAt.year).not.toBeNull();
  // Marking an earlier chapter read again, or one chapter unread, sends nothing.
  const sent = tracker.saves.length;
  await markRead(1);
  await page.evaluate(
    (ids) => window.api.invoke('chapters.markRead', { chapterIds: ids, read: false }),
    [chapterIds[1]!],
  );
  await new Promise((r) => setTimeout(r, 2500));
  expect(tracker.saves).toHaveLength(sent);
});

test('edits in the dialog are saved and sent', async () => {
  const dialog = page.getByTestId('tracking-anilist');
  await dialog.getByLabel('Score (0–10)').fill('9');
  await dialog.getByLabel('Score (0–10)').blur();
  await expect.poll(() => tracker.entries.get(30013)?.scoreRaw).toBe(90);
  await dialog.getByLabel('Status').selectOption('on_hold');
  await expect.poll(() => tracker.entries.get(30013)?.status).toBe('PAUSED');
  await dialog.getByLabel('Status').selectOption('reading');
  await expect.poll(() => tracker.entries.get(30013)?.status).toBe('CURRENT');
});

test('updates wait while AniList is down, and go out when asked again', async () => {
  await page.keyboard.press('Escape');
  tracker.failWith = 503;
  await markRead(3);
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-queue')).toContainText('1 update waiting to be sent');
  await expect(card().getByTestId('tracker-queue')).toContainText('Last problem');
  expect(progress()).toBe(2);

  tracker.failWith = null;
  await card().getByRole('button', { name: 'Send now' }).click();
  await expect.poll(progress).toBe(3);
  await expect(card().getByTestId('tracker-queue')).toHaveCount(0);
});

test('nothing is sent while incognito', async () => {
  await page.evaluate(() => window.api.invoke('settings.set', { incognito: true }));
  const sent = tracker.saves.length;
  await markRead(4);
  await new Promise((r) => setTimeout(r, 2500));
  expect(tracker.saves).toHaveLength(sent);
  expect(progress()).toBe(3);
  await page.evaluate(() => window.api.invoke('settings.set', { incognito: false }));
});

test('the login and the link survive a restart; disconnecting keeps the link', async () => {
  await t.restart();
  page = t.page;
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-state')).toContainText('Connected as mika');
  await card().getByRole('button', { name: 'Disconnect' }).click();
  await expect(card().getByTestId('tracker-state')).toHaveText('Not connected');
  const tracks = await page.evaluate((id) => window.api.invoke('trackers.tracks', { mangaId: id }), mangaId);
  expect(tracks).toEqual([
    expect.objectContaining({ service: 'anilist', remoteId: '30013', remoteTitle: 'Paged Hero', progress: 3 }),
  ]);
  // Without a login the dialog points to Settings.
  await goto(`#/manga/${mangaId}`);
  await page.getByRole('button', { name: 'Tracking' }).click();
  await expect(page.getByTestId('tracking-none')).toContainText('No tracker is connected');
});
