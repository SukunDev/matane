import { type Server, createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Page, expect, test } from '@playwright/test';
import { type TestApp, launchApp } from './support/app';

// Milestone 5d: Settings → Network. A small HTTP proxy in the test records what goes through it;
// the app sends localhost through a proxy only in tests (MATANE_E2E_PROXY_LOOPBACK).
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;
let proxy: Server;
let proxyPort: number;
const proxied: string[] = [];
/** When set, the proxy answers 407 until it gets these credentials. */
let requireAuth: string | null = null;
const authorized: string[] = [];

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
const network = async () => (await page.evaluate(() => window.api.invoke('settings.get'))).network;
const browse = async (query: string) => {
  await goto(`#/browse/sources/e2e-demo/en?tab=search&q=${query}`);
  await expect(page.locator('a[href*="/manga/"]').first()).toBeVisible();
};

test.beforeAll(async () => {
  // A forward proxy for plain HTTP: absolute-form requests are passed on and recorded.
  proxy = createServer((incoming, outgoing) => {
    if (requireAuth) {
      const given = incoming.headers['proxy-authorization'];
      if (given !== `Basic ${Buffer.from(requireAuth).toString('base64')}`) {
        outgoing.writeHead(407, { 'proxy-authenticate': 'Basic realm="e2e"' }).end();
        return;
      }
      authorized.push(incoming.url ?? '');
    }
    proxied.push(incoming.url ?? '');
    const target = new URL(incoming.url ?? '');
    const forward = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: incoming.method,
        headers: incoming.headers,
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    forward.on('error', () => outgoing.writeHead(502).end());
    incoming.pipe(forward);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyPort = (proxy.address() as AddressInfo).port;
  t = await launchApp(['demo'], { MATANE_E2E_PROXY_LOOPBACK: '1' });
  page = t.page;
  await t.app.evaluate((_electron, url) => {
    (globalThis as unknown as { __matane: { setNetworkTestUrl(url: string): void } }).__matane.setNetworkTestUrl(url);
  }, `${t.site.origin}/api/list?page=1&probe`);
  await page.evaluate(() => (location.hash = '#/library'));
});

test.afterAll(async () => {
  await t?.close();
  proxy?.closeAllConnections();
  await new Promise<void>((resolve) => proxy?.close(() => resolve()));
});

test('a custom User-Agent reaches the sites, and resets to the default', async () => {
  await goto('#/settings/network');
  const field = page.getByRole('textbox', { name: 'User-Agent' });
  await field.fill('MataneTest/1.0');
  await field.press('Enter');
  await expect.poll(async () => (await network()).userAgent).toBe('MataneTest/1.0');
  t.site.userAgents.length = 0;
  await browse('paged');
  expect(t.site.userAgents).toContain('MataneTest/1.0');

  await goto('#/settings/network');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => (await network()).userAgent).toBeNull();
  t.site.userAgents.length = 0;
  await browse('scroll');
  expect(t.site.userAgents.length).toBeGreaterThan(0);
  expect(t.site.userAgents.every((ua) => ua !== 'MataneTest/1.0' && !ua.includes('Electron'))).toBe(true);
});

test('an HTTP proxy carries every request, and turning it off goes direct again', async () => {
  await goto('#/settings/network');
  await page.getByRole('radio', { name: 'HTTP' }).click();
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill(String(proxyPort));
  await page.getByLabel('Port').press('Enter');
  await expect
    .poll(async () => (await network()).proxy)
    .toMatchObject({ mode: 'http', host: '127.0.0.1', port: proxyPort });

  proxied.length = 0;
  await browse('twin');
  expect(proxied.some((url) => url.includes('/api/list') && url.includes('q=twin'))).toBe(true);

  // "Test connection" goes through the proxy too.
  await page.evaluate(() => (location.hash = '#/settings/network'));
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByTestId('network-test')).toContainText('Connected in');
  expect(proxied.some((url) => url.includes('/api/list?page=1&probe'))).toBe(true);

  await page.getByRole('radio', { name: 'None' }).click();
  await expect.poll(async () => (await network()).proxy.mode).toBe('direct');
  proxied.length = 0;
  await browse('filler');
  expect(proxied).toEqual([]);
});

test('a proxy password is stored without ever coming back', async () => {
  await goto('#/settings/network');
  await page.getByRole('radio', { name: 'HTTP' }).click();
  await page.getByLabel('Password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Password')).toHaveAttribute('placeholder', 'A password is saved');
  // A proxy that asks for a login gets the username and the stored password.
  await page.getByLabel('Username (optional)').fill('reader');
  await page.getByLabel('Username (optional)').press('Enter');
  await expect.poll(async () => (await network()).proxy.username).toBe('reader');
  requireAuth = 'reader:s3cret';
  await browse('hero');
  expect(authorized.some((url) => url.includes('q=hero'))).toBe(true);
  requireAuth = null;
  await goto('#/settings/network');
  const info = await page.evaluate(() => window.api.invoke('network.info'));
  expect(info).toMatchObject({ defaultUserAgent: expect.any(String), hasProxyPassword: true });
  expect(JSON.stringify(await page.evaluate(() => window.api.invoke('settings.get')))).not.toContain('s3cret');
  await page.getByRole('button', { name: 'Forget' }).click();
  await expect(page.getByLabel('Password')).toHaveAttribute('placeholder', '');
  await page.getByRole('radio', { name: 'System' }).click();
});

test('DNS-over-HTTPS: presets, and a custom server must be https', async () => {
  await goto('#/settings/network');
  await page.getByRole('radio', { name: 'Automatic' }).click();
  await page.getByRole('radio', { name: 'Quad9' }).click();
  await expect.poll(async () => (await network()).doh).toMatchObject({ mode: 'automatic', provider: 'quad9' });
  await page.getByRole('radio', { name: 'Custom' }).click();
  const url = page.getByLabel('Server URL');
  await url.fill('http://dns.example/dns-query');
  await url.press('Enter');
  await expect(page.getByText('Enter an https:// URL')).toBeVisible();
  await url.fill('https://dns.example/dns-query{?dns}');
  await url.press('Enter');
  await expect(page.getByText('Enter an https:// URL')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Off' }).click();
  // Still browsing fine with everything back to normal.
  await browse('paged');
});
