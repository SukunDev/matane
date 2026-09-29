import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRepoKey } from '@matane/extension-runtime/repo';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 4e: the official repository is added by itself, and an extension that used to come with
// the app (here: a dev folder that goes away, standing in for the built-in MangaDex) moves to it by
// itself ("handoff"). The official URL and key are the test's own (MATANE_E2E_OFFICIAL_*).
test.describe.configure({ mode: 'serial' });

const official = generateRepoKey();
let t: TestApp;
let page: Page;
let folder: string;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const officialEnv = () => ({
  MATANE_E2E_OFFICIAL_KEY: official.publicKey,
  MATANE_E2E_OFFICIAL_REPO: `${t.site.origin}/official/`,
});
const restart = async () => {
  await t.restart(undefined, officialEnv());
  page = t.page;
};
const demo = () =>
  page.evaluate(async () => (await window.api.invoke('extensions.list')).find((e) => e.id === 'e2e-demo') ?? null);
const banner = () => page.getByTestId('handoff-banner');

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
  // An "old version" profile: a manga in the library from an extension the app brought along.
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
  // The new version no longer has it built in.
  await page.evaluate((path) => window.api.invoke('extensions.removeDevFolder', { path }), join(t.home, 'e2e-demo'));
  expect(await demo()).toBeNull();
  folder = await t.site.publishRepo({
    path: 'official',
    name: 'Matane Official',
    privateKeyPem: official.privateKeyPem,
    extensions: [{ which: 'demo', version: '1.0.0' }],
  });
});

test.afterAll(async () => {
  await t?.close();
});

test('offline, the official repository is added and the move waits for the network', async () => {
  t.site.down = true;
  await restart();
  await goto('#/library');
  await expect(banner()).toContainText('E2E Demo will be installed from the official repository');
  const repos = await page.evaluate(() => window.api.invoke('repos.list'));
  expect(repos).toEqual([
    expect.objectContaining({ official: true, synced: false, url: `${t.site.origin}/official/` }),
  ]);
});

test('a failed install shows why; "Install now" retries and moves it', async () => {
  t.site.down = false;
  const zip = join(folder, 'extensions', 'e2e-demo-1.0.0.zip');
  const good = readFileSync(zip);
  const bad = Buffer.from(good);
  bad[bad.length - 50]! ^= 1;
  writeFileSync(zip, bad);

  await banner().getByRole('button', { name: 'Install now' }).click();
  await expect(banner()).toContainText('E2E Demo could not be installed from the official repository');
  await expect(banner()).toContainText('sha256 mismatch');
  expect(await demo()).toBeNull();

  writeFileSync(zip, good);
  await banner().getByRole('button', { name: 'Install now' }).click();
  await expect(banner()).toHaveCount(0);
  expect(await demo()).toMatchObject({ origin: 'repo', version: '1.0.0' });

  // The library manga works again: its chapters load from the source.
  await page.locator('[data-testid="library-item"][title="Paged Hero"]').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  await goto('#/browse/extensions');
  const row = page.getByTestId('extension-row').filter({ hasText: 'E2E Demo' });
  await expect(row).toContainText('Official · Verified');
});

test('an uninstalled extension and a removed official repository stay gone', async () => {
  await page.evaluate(() => window.api.invoke('extensions.uninstall', { extensionId: 'e2e-demo' }));
  await restart();
  await page.waitForTimeout(1500);
  expect(await demo()).toBeNull();
  await goto('#/library');
  await expect(banner()).toHaveCount(0);

  await page.evaluate(async () => {
    const repo = (await window.api.invoke('repos.list')).find((r) => r.official);
    await window.api.invoke('repos.remove', { repoId: repo!.id });
  });
  await restart();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.api.invoke('repos.list'))).toEqual([]);
});

test('online at start, the move happens by itself', async () => {
  // A second old profile, this time opened online with a good repository.
  const other = await launchApp(['demo']);
  try {
    const p = other.page;
    await p.evaluate((h) => (location.hash = h), '#/browse/sources/e2e-demo/en?tab=search&q=scroll');
    await p.getByText('Scroll Garden').click();
    await p.getByRole('button', { name: 'Add to library' }).click();
    await expect(p.getByRole('button', { name: 'In library' })).toBeVisible();
    await p.evaluate((path) => window.api.invoke('extensions.removeDevFolder', { path }), join(other.home, 'e2e-demo'));
    await other.site.publishRepo({
      path: 'official',
      name: 'Matane Official',
      privateKeyPem: official.privateKeyPem,
      extensions: [{ which: 'demo', version: '1.0.0' }],
    });
    await other.restart(undefined, {
      MATANE_E2E_OFFICIAL_KEY: official.publicKey,
      MATANE_E2E_OFFICIAL_REPO: `${other.site.origin}/official/`,
    });
    const extension = () =>
      other.page.evaluate(async () => (await window.api.invoke('extensions.list')).find((e) => e.id === 'e2e-demo'));
    await expect.poll(async () => (await extension())?.origin, { timeout: 15_000 }).toBe('repo');
    await other.page.evaluate((h) => (location.hash = h), '#/library');
    await expect(other.page.getByTestId('handoff-banner')).toHaveCount(0);
    await other.page.locator('[data-testid="library-item"][title="Scroll Garden"]').click();
    await expect(other.page.getByTestId('chapter-row')).toHaveCount(2);
  } finally {
    await other.close();
  }
});
