/**
 * The Windows app, step 5: the first start asks "This PC only" or "Connect to cloud", keeps the answer
 * (<userData>/mode.json) and never asks again on this computer.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { find, isWelcome, launch, openApp } from './launch';

const { ensurePostgres } = createRequire(import.meta.url)('../scripts/ensure-postgres.cjs') as { ensurePostgres(): string };
// a new computer: no mode chosen (launch.ts skips the choice for the other tests)
const NEW_PC = { BILLING_MODE: '', BILLING_PG_DIR: ensurePostgres() };
const NOWHERE = 'http://localhost:5999';
const kept = (profile: string) => (JSON.parse(fs.readFileSync(path.join(profile, 'mode.json'), 'utf8')) as { mode: string }).mode;
const isBar = (p: { url(): string }) => p.url().includes('/static/titlebar.html');

test('a new computer is asked once: "Connect to cloud" opens the live app, and is kept', async () => {
  const app = await openApp(NOWHERE, NEW_PC);
  const profile = (await app.evaluate(({ app }) => app.getPath('userData'))) as string;
  try {
    const page = await find(app, isWelcome);
    await expect(page.locator('h1')).toHaveText(/^Welcome to \S+/);
    await expect(page.locator('#pickLocal h2')).toHaveText('This PC only');
    await expect(page.locator('#pickCloud h2')).toHaveText('Connect to cloud');
    // the title bar is there as on every other page
    await expect((await find(app, isBar)).locator('#upd')).toBeVisible();
    expect(fs.existsSync(path.join(profile, 'mode.json'))).toBe(false);
    await page.click('#pickCloud');
    // the live app (here: nothing to reach, so the app's own "Not connected" page)
    await page.waitForURL(/\/static\/offline\.html/);
    expect(kept(profile)).toBe('online');
  } finally {
    await app.close();
  }
  // not asked again
  const again = await launch(NOWHERE, NEW_PC, profile);
  try {
    await again.win.waitForSelector('#offline');
    expect(again.app.windows().some(isWelcome)).toBe(false);
  } finally {
    await again.app.close();
  }
});

test('"This PC only" opens the books on this computer, and is kept', async () => {
  const app = await openApp(NOWHERE, NEW_PC);
  const profile = (await app.evaluate(({ app }) => app.getPath('userData'))) as string;
  let origin = '';
  try {
    const page = await find(app, isWelcome);
    await page.click('#pickLocal');
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    origin = new URL(page.url()).origin;
    expect(kept(profile)).toBe('local');
    // the sign-in page of this computer's own server: no demo shop here
    await page.waitForSelector('#vAuth:not([hidden])', { timeout: 60_000 });
    await expect(page.locator('#aGo')).toBeVisible();
    await expect(page.locator('text=Open the demo shop')).toHaveCount(0);
  } finally {
    await app.close();
  }
  const again = await launch(NOWHERE, NEW_PC, profile);
  try {
    expect(new URL(again.win.url()).origin).toBe(origin);
    expect(again.app.windows().some(isWelcome)).toBe(false);
  } finally {
    await again.app.close();
  }
});

test('only the first-start page can choose, and only the two choices', async () => {
  const app = await openApp(NOWHERE, NEW_PC);
  try {
    const page = await find(app, isWelcome);
    const bad = await page.evaluate(() => (window as unknown as { billingWelcome: { choose(m: string): Promise<unknown> } }).billingWelcome.choose('phone').then(() => 'ok', () => 'refused'));
    expect(bad).toBe('refused');
    // the title bar has no way to choose
    const bar = await find(app, isBar);
    expect(await bar.evaluate(() => 'billingWelcome' in window)).toBe(false);
    // still asking
    await expect(page.locator('#pickLocal')).toBeEnabled();
  } finally {
    await app.close();
  }
});
