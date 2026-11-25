import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3011',
  },
  webServer: {
    command: 'npm run seed && npm run start:dummy',
    url: 'http://127.0.0.1:3011/api/config',
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120_000,
    env: {
      DATA_DIR: './data/playwright-admin-audit-tests',
      HOST: '127.0.0.1',
      PORT: '3011',
      UPI_ID: 'missionselection@upi',
      UPI_PAYEE_NAME: 'Mission Selection',
    },
  },
});
