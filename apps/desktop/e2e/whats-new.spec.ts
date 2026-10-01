import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp, writeSetting } from './support/app';

// Milestone 5c: after an update the release notes of the running version show once.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
const dialog = () => page.getByRole('dialog', { name: 'What’s new' });

test.beforeAll(async () => {
  t = await launchApp([]);
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('a new profile has nothing new to read about', async () => {
  await page.waitForTimeout(800);
  await expect(dialog()).toHaveCount(0);
});

test('after an update the notes show once, from the bundled changelog', async () => {
  const { version } = await page.evaluate(() => window.api.invoke('app.getInfo'));
  // The last version whose notes were seen is an older one: this start is an update.
  await t.restart(() => writeSetting(t.home, 'app.whatsNewSeen', '0.0.1'));
  page = t.page;
  await expect(dialog()).toBeVisible();
  await expect(dialog()).toContainText(`Version ${version}`);
  await expect(dialog().getByRole('heading', { name: 'Reading and library' })).toBeVisible();
  await dialog().getByRole('button', { name: 'Got it' }).click();
  await expect(dialog()).toHaveCount(0);

  await t.restart();
  page = t.page;
  await page.waitForTimeout(800);
  await expect(dialog()).toHaveCount(0);
});

test('Settings → About opens them any time', async () => {
  await page.evaluate(() => (location.hash = '#/settings/about'));
  await page.getByRole('button', { name: 'What’s new' }).click();
  await expect(dialog()).toContainText('Reading and library');
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
});
