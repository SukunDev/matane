import { defineConfig } from '@playwright/test';

// End-to-end tests drive the built app (out/) through Playwright's Electron support.
// Run with `pnpm e2e` (builds first); on headless Linux wrap it in `xvfb-run -a`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
