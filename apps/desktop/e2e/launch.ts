/** Opening the Windows app in tests. Its window has two pages: the title bar, and the app's page below it. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** the first-start page: "This PC only" or "Connect to cloud" */
export const isWelcome = (p: Page) => p.url().includes('/static/welcome.html');
export const MAIN = path.join(HERE, '..', 'dist', 'main.cjs');

const isBar = (p: Page) => p.url().includes('/static/titlebar.html');
/** the app's page: the app's address or the "Not connected" page (a page still starting has neither) */
const isApp = (p: Page) => /^https?:/.test(p.url()) || p.url().includes('/static/offline.html');

/** wait for one of the app's pages: the title bar, or the page with the app (or "Not connected") */
export async function find(app: ElectronApplication, want: (p: Page) => boolean): Promise<Page> {
  // single-PC mode's first start makes the database first: allow a minute
  for (let i = 0; i < 1200; i++) {
    const p = app.windows().find(want);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('The app’s page did not open');
}

/** open the app without waiting for any page */
export function openApp(appUrl: string, env: Record<string, string> = {}, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-desktop-'))): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN],
    // BILLING_MODE online: skip the first-start choice (welcome.spec.ts tests it with BILLING_MODE '')
    env: { ...process.env, BILLING_APP_URL: appUrl, BILLING_PROFILE_DIR: profile, BILLING_TEST: '1', BILLING_MODE: 'online', TZ: 'Asia/Kolkata', ...env },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
}

export async function launch(appUrl: string, env: Record<string, string> = {}, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-desktop-'))): Promise<{ app: ElectronApplication; win: Page; bar: Page; profile: string }> {
  const app = await openApp(appUrl, env, profile);
  const win = await find(app, isApp);
  const bar = await find(app, isBar);
  return { app, win, bar, profile };
}
