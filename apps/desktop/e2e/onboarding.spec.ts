import { type Page, expect, test } from '@playwright/test';
import { type TestApp, deleteSetting, launchApp } from './support/app';

// Milestone 5c: the first-run setup on a new profile; an older profile never sees it.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
const settings = () => page.evaluate(() => window.api.invoke('settings.get'));
const wizard = () => page.getByTestId('onboarding');

test.beforeAll(async () => {
  t = await launchApp(['demo'], { MATANE_E2E_NO_ONBOARDING: '0' });
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('a new profile starts with the setup, step by step', async () => {
  await expect(wizard()).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(wizard()).toContainText('Step 1 of 5');

  // 1. Appearance
  await wizard().getByRole('radio', { name: 'Latte' }).click();
  await expect(page.locator('html')).toHaveClass(/latte/);
  await wizard().getByRole('button', { name: 'Continue' }).click();

  // 2. Content languages
  await expect(wizard()).toContainText('Which languages do you read?');
  // The test profile reads English and Indonesian (launchApp); add Japanese.
  await expect(wizard()).toContainText('2 languages selected');
  await wizard().getByPlaceholder('Search languages…').fill('japan');
  await wizard()
    .getByRole('button', { name: /Japanese/ })
    .click();
  await expect.poll(async () => (await settings()).browse.languages).toEqual(['en', 'id', 'ja']);
  await expect(wizard()).toContainText('3 languages selected');
  await wizard().getByRole('button', { name: 'Continue' }).click();

  // 3. Downloads: the folder in effect (the test profile's).
  await expect(wizard().getByTestId('onboarding-folder')).toContainText('downloads');
  await wizard().getByRole('radio', { name: 'Folder' }).click();
  await expect.poll(async () => (await settings()).downloads.format).toBe('folder');
  await wizard().getByRole('button', { name: 'Continue' }).click();

  // 4. Sources: what is ready to use.
  await expect(wizard().getByTestId('onboarding-ready')).toContainText('E2E Demo');
  await wizard().getByRole('button', { name: 'Back' }).click();
  await expect(wizard()).toContainText('Step 3 of 5');
  await wizard().getByRole('button', { name: 'Continue' }).click();
  await wizard().getByRole('button', { name: 'Continue' }).click();

  // 5. Reader basics, then into the app.
  await expect(wizard()).toContainText('Ctrl + K');
  await wizard().getByRole('button', { name: 'Start reading' }).click();
  await expect(page.locator('aside')).toBeVisible();
  await expect(page).toHaveURL(/#\/library/);
  expect((await settings()).onboarding.done).toBe(true);
});

test('it does not come back, but can be run again from About', async () => {
  await t.restart();
  page = t.page;
  await expect(page.locator('aside')).toBeVisible();
  await expect(wizard()).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/settings/about'));
  await page.getByRole('button', { name: 'Run setup again' }).click();
  await expect(wizard()).toContainText('Step 1 of 5');
  await wizard().getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.locator('aside')).toBeVisible();
});

test('a profile from before the setup counts as set up', async () => {
  // As if an older version wrote this profile: no onboarding setting at all.
  await t.restart(() => deleteSetting(t.home, 'onboarding'));
  page = t.page;
  await expect(page.locator('aside')).toBeVisible();
  await expect(wizard()).toHaveCount(0);
  expect((await settings()).onboarding.done).toBe(true);
});
