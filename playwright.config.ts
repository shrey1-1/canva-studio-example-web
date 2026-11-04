import { defineConfig } from '@playwright/test';

/**
 * Browser tests (npm run e2e). They use the Chrome installed on this machine (no browser download)
 * and start `npm run dev` with a separate database (apps/server/data/e2e-db) unless a dev server
 * is already running, in which case they reuse it.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { AUTH_ATTEMPTS: '100000', DATA_DIR: 'data/e2e-db' },
  },
});
