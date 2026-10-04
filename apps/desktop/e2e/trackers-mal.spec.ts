import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';
import { type FakeMal, startMal } from './support/mal';

// Milestone 6d: MyAnimeList through the code flow with PKCE, tokens that expire and are renewed, and
// a token revoked on the other side. The browser is played by the test; MyAnimeList is a fake.
test.describe.configure({ mode: 'serial' });

let mal: FakeMal;
let t: TestApp;
let page: Page;
let mangaId: number;
let chapterIds: number[];

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const card = () => page.getByTestId('tracker-mal');
const entry = () => mal.entries.get(44);
const hook = () =>
  t.app.evaluate(() => (globalThis as unknown as { __matane: { loginUrl?: string; oauthPort?: number } }).__matane);
const markRead = (...numbers: number[]) =>
  page.evaluate(
    (ids) => window.api.invoke('chapters.markRead', { chapterIds: ids, read: true }),
    numbers.map((n) => chapterIds[n - 1]!),
  );

test.beforeAll(async () => {
  mal = await startMal();
  t = await launchApp(['demo'], {
    MATANE_E2E_MAL_API: mal.api,
    MATANE_E2E_MAL_TOKEN: mal.tokenUrl,
    MATANE_MAL_CLIENT_ID: 'e2e-mal',
    MATANE_E2E_OAUTH_PORT: '0',
  });
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
  await mal?.close();
});

test('Settings → Tracking logs in with the code flow and PKCE', async () => {
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-state')).toHaveText('Not connected');
  await card().getByRole('button', { name: 'Connect' }).click();
  await expect.poll(async () => (await hook()).loginUrl).toBeTruthy();
  const { loginUrl, oauthPort } = await hook();
  const url = new URL(loginUrl!);
  expect(url.origin + url.pathname).toBe('https://myanimelist.net/v1/oauth2/authorize');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: 'code',
    client_id: 'e2e-mal',
    code_challenge_method: 'plain',
    redirect_uri: `http://127.0.0.1:${oauthPort}/callback`,
  });
  const state = url.searchParams.get('state')!;
  // Plain PKCE: the token endpoint must get the challenge back as the verifier.
  mal.expectedVerifier = url.searchParams.get('code_challenge');

  // A code with the wrong state is refused; Matane goes on waiting.
  expect((await fetch(`http://127.0.0.1:${oauthPort}/callback?code=e2e-code&state=wrong`)).status).toBe(400);
  expect((await fetch(`http://127.0.0.1:${oauthPort}/callback?code=e2e-code&state=${state}`)).status).toBe(200);

  await expect(card().getByTestId('tracker-state')).toContainText('Connected as mika-mal');
  expect(mal.tokenRequests[0]).toMatchObject({
    grant_type: 'authorization_code',
    client_id: 'e2e-mal',
    code: 'e2e-code',
    code_verifier: mal.expectedVerifier,
    redirect_uri: `http://127.0.0.1:${oauthPort}/callback`,
  });
  expect(mal.tokenRequests[0]).not.toHaveProperty('client_secret');
});

test('a manga is linked; the short-lived token is renewed on the way', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByRole('heading', { name: 'Paged Hero' })).toBeVisible();
  mangaId = Number(/manga\/(\d+)/.exec(page.url())![1]);
  chapterIds = (await page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((c) => c.id);

  await page.getByRole('button', { name: 'Tracking' }).click();
  const dialog = page.getByTestId('tracking-mal');
  await expect(dialog.getByTestId('tracking-results').getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Link to Paged Hero', exact: true }).click();
  await expect(dialog.getByTestId('tracking-linked')).toHaveText('Linked to Paged Hero');
  await expect.poll(() => entry()?.status).toBe('plan_to_read');
  // The first access token lasted one second: the link ran on a renewed one.
  expect(mal.tokenRequests.map((r) => r['grant_type'])).toEqual(['authorization_code', 'refresh_token']);
  expect(mal.tokenRequests[1]).toMatchObject({ refresh_token: 'r-1', client_id: 'e2e-mal' });
});

test('chapters read and edits are sent, with whole-number scores', async () => {
  await markRead(1, 2);
  await expect.poll(() => entry()?.num_chapters_read).toBe(2);
  expect(entry()?.status).toBe('reading');
  expect(entry()?.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const dialog = page.getByTestId('tracking-mal');
  await dialog.getByLabel('Score (0–10)').fill('8.6');
  await dialog.getByLabel('Score (0–10)').blur();
  await expect.poll(() => entry()?.score).toBe(9);
});

test('a token revoked on the other side is renewed and the update still goes through', async () => {
  await page.keyboard.press('Escape');
  const token = mal.saves.at(-1)!.token;
  mal.revoke(token);
  const refreshes = mal.tokenRequests.length;
  await markRead(3);
  await expect.poll(() => entry()?.num_chapters_read).toBe(3);
  expect(mal.tokenRequests.length).toBe(refreshes + 1);
  expect(mal.saves.at(-1)!.token).not.toBe(token);
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-state')).toContainText('Connected as mika-mal');
  await expect(card().getByTestId('tracker-queue')).toHaveCount(0);
});

test('the login survives a restart and renews itself afterwards', async () => {
  await t.restart();
  page = t.page;
  await goto('#/settings/tracking');
  await expect(card().getByTestId('tracker-state')).toContainText('Connected as mika-mal');
  // The fourth chapter of this manga is number 5.
  await markRead(4);
  await expect.poll(() => entry()?.num_chapters_read).toBe(5);
});
