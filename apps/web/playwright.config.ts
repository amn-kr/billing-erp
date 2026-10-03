import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: the rebuilt app (web + API + Postgres) side by side with
 * the prototype. Screenshot tests compare both at 1280, 1366 and 1920 px.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  webServer: [
    { command: 'bash e2e/start-api.sh', url: 'http://localhost:3100/api/health', timeout: 120_000, reuseExistingServer: false, stdout: 'pipe' },
    { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', timeout: 60_000, reuseExistingServer: false, env: { API_URL: 'http://localhost:3100' } },
  ],
});
