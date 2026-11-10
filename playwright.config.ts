import { defineConfig } from '@playwright/test';

const port = Number(process.env.ROWLIO_E2E_PORT || 4173);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
