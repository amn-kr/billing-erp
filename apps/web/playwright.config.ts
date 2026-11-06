import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: the rebuilt app (web + API + Postgres) side by side with
 * the prototype. Screenshot tests compare both at 1280, 1366 and 1920 px
 * (PICTURE_WIDTHS can limit that, see e2e/setup.ts).
 */
// every picture test file: name.visual.spec.ts, and the first one, visual.spec.ts
const PICTURE_FILES = '**/*visual.spec.ts';

export default defineConfig({
  testDir: './e2e',
  // SKIP_VISUAL=1: no picture tests (only files that cannot change a picture changed, see ci.yml)
  ...(process.env.SKIP_VISUAL ? { testIgnore: PICTURE_FILES } : {}),
  // PICTURES_ONLY=1: only the picture tests (after a merge whose flow tests already passed on the PR)
  ...(process.env.PICTURES_ONLY ? { testMatch: PICTURE_FILES } : {}),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // on GitHub a failed test gets two more tries; one that passes on a retry is listed as flaky
  retries: process.env.CI ? 2 : 0,
  // summary-reporter: the flaky list (and failed pictures after a merge) on the GitHub summary page
  reporter: [['list'], ['./e2e/summary-reporter.ts']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  webServer: [
    { command: 'bash e2e/start-api.sh', url: 'http://localhost:3100/api/health', timeout: 120_000, reuseExistingServer: false, stdout: 'pipe' },
    // test mode: shows the old app name, like the prototype and the approved pictures (vite.config.ts)
    { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', timeout: 60_000, reuseExistingServer: false, env: { API_URL: 'http://localhost:3100', BRAND_TEST_MODE: 'old-name' } },
    // the normal build (dist/, as made by `pnpm build`; made here if missing), with the real name: brand.flows.spec.ts
    { command: '[ -f dist/index.html ] || npx vite build; npx vite preview --port 5175 --strictPort', url: 'http://localhost:5175/login', timeout: 180_000, reuseExistingServer: false, env: { API_URL: 'http://localhost:3100' } },
  ],
});
