import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Phase 5f: Settings → Advanced (log level, debug info) and About (how it was installed, licenses).
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const fileLogLevel = () =>
  t.app.evaluate(() => (globalThis as { __matane?: { logLevel: () => unknown } }).__matane!.logLevel());

test.beforeAll(async () => {
  t = await launchApp(['demo']);
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('the log level applies at once and after a restart', async () => {
  await goto('#/settings/advanced');
  const levels = page.getByRole('radiogroup', { name: 'Log level' });
  await expect(levels.getByRole('radio', { name: 'Info' })).toBeChecked();
  expect(await fileLogLevel()).toBe('info');
  await levels.getByRole('radio', { name: 'Debug' }).click();
  await expect.poll(fileLogLevel).toBe('debug');

  await t.restart();
  page = t.page;
  expect(await fileLogLevel()).toBe('debug');
});

test('"Copy debug info" copies versions, extensions and the log end without private data', async () => {
  // A log line with the home folder, a token in a URL and a bearer token.
  const { logPath } = (await page.evaluate(() => window.api.invoke('storage.info'))) as { logPath: string };
  appendFileSync(
    `${logPath}/main.log`,
    `[e2e] fetched https://api.example/feed?token=s3cret from ${homedir()}/x Authorization: Bearer abc.def\n`,
  );

  await goto('#/settings/advanced');
  await page.getByRole('button', { name: 'Copy debug info' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const text = await t.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(text).toContain('### Matane debug info');
  expect(text).toContain('(dev)');
  expect(text).toMatch(/- e2e-demo@\S+ \(dev\)/);
  expect(text).toContain('[e2e] fetched https://api.example/feed?… from ~/x');
  expect(text).not.toContain('s3cret');
  expect(text).not.toContain('abc.def');
  expect(text).not.toContain(homedir());
});

test('About shows how the app was installed and the licenses list', async () => {
  await goto('#/settings/about');
  await expect(page.getByTestId('app-packaging')).toHaveText('Installed as development build');
  await page.getByRole('button', { name: 'Open source licenses' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open source licenses' });
  await expect(dialog).toBeVisible();
  // Written by the renderer build (`build-tools/licenses.ts`): React is in there.
  await dialog.getByRole('textbox').fill('react-dom');
  await expect(dialog.locator('summary', { hasText: /^react-dom \d/ })).toBeVisible();
  await page.keyboard.press('Escape');
});
