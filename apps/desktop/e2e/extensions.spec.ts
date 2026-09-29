import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRepoKey } from '@matane/extension-runtime/repo';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 4b: extension repositories. The fake site serves repositories built with `mr-ext repo`;
// the "official" key is the test's own (MATANE_E2E_OFFICIAL_KEY).
test.describe.configure({ mode: 'serial' });

const official = generateRepoKey();
const community = generateRepoKey();

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const tab = (name: RegExp) => page.getByRole('tab', { name });
const dialog = () => page.getByRole('dialog');
const publishOfficial = (version: string, domains?: string[]) =>
  t.site.publishRepo({
    path: 'official',
    name: 'Test Official',
    privateKeyPem: official.privateKeyPem,
    extensions: [{ which: 'demo', version, domains, description: 'Everything the tests need' }],
  });
const installedVersion = () =>
  page.evaluate(
    async () => (await window.api.invoke('extensions.list')).find((e) => e.id === 'e2e-demo')?.version ?? null,
  );
const syncRepos = () => page.evaluate(() => window.api.invoke('repos.sync'));
const installedRow = () => page.getByTestId('extension-row').filter({ hasText: 'E2E Demo' });

async function addRepo(url: string) {
  const panel = page.getByTestId('repositories-panel');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await panel.getByRole('button', { name: 'Add repository' }).click();
  await dialog().getByLabel('Repository URL').fill(url);
  await dialog().getByRole('button', { name: 'Add', exact: true }).click();
}

test.beforeAll(async () => {
  // No dev folders: everything comes from repositories.
  t = await launchApp([], { MATANE_E2E_OFFICIAL_KEY: official.publicKey });
  page = t.page;
  await publishOfficial('1.0.0');
});

test.afterAll(async () => {
  await t?.close();
});

test('adds the official repository and installs from it through the install dialog', async () => {
  await goto('#/browse/extensions');
  await tab(/^Available/).click();
  await expect(page.getByText('No repositories yet')).toBeVisible();

  await addRepo(`${t.site.origin}/official`);
  const card = page.getByTestId('repo-card').filter({ hasText: 'Test Official' });
  await expect(card).toContainText('Verified');
  await expect(card).toContainText('1 extension');

  const row = page.getByTestId('available-row').filter({ hasText: 'E2E Demo' });
  await expect(row).toContainText('Official · Verified');
  await expect(row).toContainText('Everything the tests need');
  await row.getByRole('button', { name: 'Install' }).click();

  await expect(dialog()).toContainText('Test Official (official)');
  await expect(dialog().getByRole('list', { name: 'This extension can access:' })).toHaveText('e2e.localhost');
  await expect(dialog()).toContainText('API version 1');
  await expect(dialog()).toContainText('SHA-256 verified');
  await expect(dialog()).not.toContainText('not verified');
  await dialog().getByRole('button', { name: 'Install' }).click();
  await expect(dialog()).toHaveCount(0);

  await tab(/^Installed/).click();
  await expect(installedRow()).toContainText('v1.0.0');
  await expect(installedRow()).toContainText('Up to date');
  await expect(installedRow()).toContainText('Official · Verified');
  // The icon comes from the installed bundle.
  await expect
    .poll(() =>
      installedRow()
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
        .catch(() => false),
    )
    .toBe(true);
});

test('the installed source browses, and a manga goes into the library', async () => {
  await goto('#/browse/sources/e2e-demo/en?tab=search&q=paged');
  await page.getByText('Paged Hero').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library' })).toBeVisible();
});

test('an update that reaches a new domain asks again; one that does not just installs', async () => {
  await publishOfficial('1.1.0', ['e2e.localhost', 'img.e2e.localhost']);
  await syncRepos();
  await goto('#/browse/extensions');
  await expect(page.getByRole('status', { name: 'Update available: 1' })).toBeVisible();
  await expect(tab(/^Updates/)).toContainText('1');

  await installedRow().getByRole('button', { name: 'Update to v1.1.0' }).click();
  const domains = dialog().getByRole('list', { name: 'This extension can access:' });
  await expect(domains.getByRole('listitem')).toHaveCount(2);
  await expect(domains.getByRole('listitem').filter({ hasText: 'img.e2e.localhost' })).toContainText('New');
  await expect(dialog()).toContainText('Version 1.1.0 can reach sites that 1.0.0 could not');
  await dialog().getByRole('button', { name: 'Update' }).click();
  await expect(dialog()).toHaveCount(0);
  await expect.poll(installedVersion).toBe('1.1.0');
  await expect(page.getByRole('status', { name: /Update available/ })).toHaveCount(0);

  await publishOfficial('1.2.0', ['e2e.localhost', 'img.e2e.localhost']);
  await syncRepos();
  await page.getByRole('button', { name: 'Update all' }).click();
  await expect.poll(installedVersion).toBe('1.2.0');
  await expect(dialog()).toHaveCount(0);
});

test('a tampered archive is refused', async () => {
  const folder = await publishOfficial('1.3.0', ['e2e.localhost', 'img.e2e.localhost']);
  await syncRepos();
  const zip = join(folder, 'extensions', 'e2e-demo-1.3.0.zip');
  const bytes = readFileSync(zip);
  bytes[bytes.length - 60]! ^= 1;
  writeFileSync(zip, bytes);

  await installedRow().getByRole('button', { name: 'Update to v1.3.0' }).click();
  await expect(dialog().getByRole('alert')).toContainText('Cannot install this extension');
  await expect(dialog().getByRole('alert')).toContainText('sha256 mismatch');
  await expect(dialog().getByRole('button', { name: 'Update' })).toBeDisabled();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  expect(await installedVersion()).toBe('1.2.0');
  // Repaired for the next tests.
  await publishOfficial('1.3.0', ['e2e.localhost', 'img.e2e.localhost']);
});

test('uninstalling keeps the manga as "not installed"; installing again brings it back', async () => {
  await installedRow().getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Uninstall' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Uninstall' }).click();
  await expect(installedRow()).toHaveCount(0);

  const source = () =>
    page.evaluate(async () => (await window.api.invoke('sources.list')).find((s) => s.id === 'e2e-demo/en'));
  await expect.poll(async () => (await source())?.installed).toBe(false);
  await goto('#/library');
  await expect(page.locator('[data-testid="library-item"][title="Paged Hero"]')).toBeVisible();
  await goto('#/browse/sources/e2e-demo/en?tab=popular');
  await expect(page.getByText('Not installed')).toBeVisible();

  await goto('#/browse/extensions');
  await tab(/^Available/).click();
  await page
    .getByTestId('available-row')
    .filter({ hasText: 'E2E Demo' })
    .getByRole('button', { name: 'Install' })
    .click();
  await dialog().getByRole('button', { name: 'Install' }).click();
  await expect.poll(installedVersion).toBe('1.3.0');
  await expect.poll(async () => (await source())?.installed).toBe(true);
  await goto('#/library');
  await page.locator('[data-testid="library-item"][title="Paged Hero"]').click();
  await expect(page.getByTestId('chapter-row')).toHaveCount(4);
});

test('an unverified repository needs a confirmation; its key can then be trusted', async () => {
  await t.site.publishRepo({
    path: 'community',
    name: 'Community Repo',
    privateKeyPem: community.privateKeyPem,
    extensions: [{ which: 'mirror', version: '0.5.0' }],
  });
  await goto('#/browse/extensions');
  await addRepo(`${t.site.origin}/community/index.json`);
  await expect(dialog().getByRole('alert')).toContainText('"Community Repo" (1 extension) is not verified');
  await expect(dialog().getByRole('alert')).toContainText('Signed with a key this app does not know.');
  await dialog().getByRole('button', { name: 'Add anyway' }).click();
  await expect(dialog()).toHaveCount(0);

  const card = page.getByTestId('repo-card').filter({ hasText: 'Community Repo' });
  await expect(card).toContainText('Unverified');
  await tab(/^Available/).click();
  const row = page.getByTestId('available-row').filter({ hasText: 'E2E Mirror' });
  await expect(row).toContainText('Community Repo · Unverified');
  await row.getByRole('button', { name: 'Install' }).click();
  await expect(dialog()).toContainText('This repository is not verified. Only install extensions you trust.');
  await dialog().getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Trust this key' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(community.publicKey);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Trust this key' }).click();
  await expect(card).toContainText('Trusted key');
  await expect(row).toContainText('Community Repo · Trusted key');
});

test('a forged index is reported as a bad signature', async () => {
  const folder = await t.site.publishRepo({
    path: 'forged',
    name: 'Forged Repo',
    privateKeyPem: community.privateKeyPem,
    extensions: [{ which: 'mirror', version: '0.6.0' }],
  });
  const indexFile = join(folder, 'index.json');
  writeFileSync(indexFile, readFileSync(indexFile, 'utf8').replace('"Forged Repo"', '"Forged Repo!"'));
  await addRepo(`${t.site.origin}/forged`);
  await expect(dialog().getByRole('alert')).toContainText('The signature does not match the index.');
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(async () => (await window.api.invoke('repos.list')).length)).toBe(2);
});

test('installed extensions and repositories survive a restart', async () => {
  await t.restart();
  page = t.page;
  expect(await installedVersion()).toBe('1.3.0');
  const repos = await page.evaluate(() => window.api.invoke('repos.list'));
  expect(repos.map((r) => [r.name, r.trust])).toEqual([
    ['Test Official', 'official'],
    ['Community Repo', 'trusted'],
  ]);
  await goto('#/browse/sources/e2e-demo/en?tab=popular');
  await expect(page.getByText('Paged Hero')).toBeVisible();
});

test('with automatic updates on, a sync installs updates that reach no new site', async () => {
  await page.evaluate(async () => {
    const { browse } = await window.api.invoke('settings.get');
    await window.api.invoke('settings.set', { browse: { ...browse, autoUpdateExtensions: true } });
  });
  await publishOfficial('1.4.0', ['e2e.localhost', 'img.e2e.localhost']);
  await syncRepos();
  await expect.poll(installedVersion).toBe('1.4.0');

  // A new site still waits for the user.
  await publishOfficial('1.5.0', ['e2e.localhost', 'img.e2e.localhost', 'cdn.e2e.localhost']);
  await syncRepos();
  await goto('#/browse/extensions');
  await expect(installedRow().getByRole('button', { name: 'Update to v1.5.0' })).toBeVisible();
  expect(await installedVersion()).toBe('1.4.0');
});
