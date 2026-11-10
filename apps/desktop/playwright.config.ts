import { defineConfig } from '@playwright/test';

/**
 * The Windows app's tests: the app (Electron) opened on the same test copy of the web app + API the
 * web app's tests use (fresh e2e database, test mode with the old name, like the prototype).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: [
    { command: 'bash e2e/start-api.sh', cwd: '../web', url: 'http://localhost:3100/api/health', timeout: 120_000, reuseExistingServer: false, stdout: 'pipe' },
    { command: 'npx vite --port 5174 --strictPort', cwd: '../web', url: 'http://localhost:5174', timeout: 60_000, reuseExistingServer: false, env: { API_URL: 'http://localhost:3100', BRAND_TEST_MODE: 'old-name' } },
  ],
});
