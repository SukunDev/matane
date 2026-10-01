import { expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Milestone 5c: Discord Rich Presence only shows up when the app has a Discord application id, and
// reading goes on as usual when Discord is not running (as on the test machine).
test('the Discord option needs an application id, and a missing Discord changes nothing', async () => {
  const without = await launchApp([], { MATANE_DISCORD_CLIENT_ID: '' });
  try {
    await without.page.evaluate(() => (location.hash = '#/settings/general'));
    await expect(without.page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(without.page.getByText('Show what I read on Discord')).toHaveCount(0);
  } finally {
    await without.close();
  }

  const t = await launchApp(['demo'], { MATANE_DISCORD_CLIENT_ID: '000000000000000000' });
  try {
    const page = t.page;
    await page.evaluate(() => (location.hash = '#/settings/general'));
    await page.getByRole('switch', { name: 'Show what I read on Discord' }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.api.invoke('settings.get'))).general.discord.enabled)
      .toBe(true);
    await page.evaluate(() => (location.hash = '#/browse/sources/e2e-demo/en?tab=search&q=paged'));
    await page.getByText('Paged Hero').click();
    await page.getByTestId('chapter-row').first().click();
    await expect(page.locator('img[data-page]').first()).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByText('2 / 4').first()).toBeVisible();
  } finally {
    await t.close();
  }
});
