// After the installer has run (CI, Windows): opens the INSTALLED app and checks that it starts, that its
// own "Not connected" page is inside it, and that it reaches the live app.
//   node scripts/smoke-installed.mjs "<path to the installed .exe>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) throw new Error(`Installed app not found: ${exe}`);

async function open(env) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-smoke-'));
  const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, BILLING_PROFILE_DIR: profile, BILLING_NO_UPDATES: '1', ...env }, timeout: 60_000 });
  return { app, win: await app.firstWindow() };
}

// 1. nothing to reach: the app's own "Not connected" page
{
  const { app, win } = await open({ BILLING_APP_URL: 'http://localhost:5999' });
  await win.waitForSelector('#offline', { timeout: 30_000 });
  console.log('OK  starts, and shows "Not connected" when the app cannot be reached');
  await app.close();
}

// 2. the live app (the free server may need up to a minute to wake)
{
  const { app, win } = await open({});
  await win.waitForSelector('#vAuth:not([hidden]), #app', { timeout: 120_000 });
  console.log(`OK  opens the live app: ${win.url()} (${await win.title()})`);
  await app.close();
}
