/**
 * The Windows app, step 7: Move to cloud. A shop that started on this PC (single-PC mode) puts its books
 * into the online app (here the test server, as the live app) under a new online account; the counts
 * are checked on both sides; then this PC opens the online app, and keeps doing so after a restart. The
 * books on the PC are kept, no longer opened.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { APP } from '../../web/e2e/setup';
import { launch } from './launch';
import { bill, dbRunning, LOCAL, newShop } from './shop';

test('Move to cloud: the books go online, are checked, and this PC works online from then on', async () => {
  const email = `moved.${Date.now().toString(36)}@cloud-shop.example.com`;
  const password = 'online password 1';
  const a = await launch(APP, LOCAL);
  try {
    await newShop(a.win);
    expect(await bill(a.win, 2)).toEqual(['INV-0001', 'INV-0002']);
    await a.win.evaluate(() => { history.pushState({}, '', '/settings'); dispatchEvent(new PopStateEvent('popstate')); });
    await a.win.click('#subnav [data-settab="gen"]');
    // the Cloud sync section says where the books are, instead of "Synced"
    await expect(a.win.locator('#mvCard')).toContainText('On this computer only');
    await expect(a.win.locator('#syncSt')).toHaveCount(0);
    await a.win.click('#mvOpen');
    await a.win.click('#mvWho input[value="new"]');
    await a.win.fill('#mvName', 'Local Owner');
    await a.win.fill('#mvEmail', email);
    await a.win.fill('#mvPass', password);
    await expect(a.win.locator('#mvGo')).toBeDisabled();
    await a.win.check('#mvUnderstand');
    await a.win.click('#mvGo');
    await expect(a.win.locator('#mvDone')).toContainText('Everything was checked', { timeout: 120_000 });
    await expect(a.win.locator('#mvm .rcv')).toContainText('2 invoices, 1 parties, 1 items');
    await a.win.click('#mvUse');
    // this PC now opens the online app: sign in there with the online account
    await a.win.waitForURL((u) => u.origin === new URL(APP).origin, { timeout: 30_000 });
    await a.win.waitForSelector('#vAuth:not([hidden])', { timeout: 30_000 });
    await a.win.fill('#aEmail', email);
    await a.win.fill('#aPass', password);
    await a.win.click('#aGo');
    await a.win.waitForSelector('#app');
    await expect(a.win.locator('#orgBtn')).toContainText('Local Traders');
    const next = await a.win.evaluate(async () => {
      const { accessToken } = await (await fetch('/api/auth/refresh', { method: 'POST' })).json();
      return (await (await fetch('/api/sales/next-number?kind=invoice', { headers: { authorization: `Bearer ${accessToken}` } })).json()).number;
    });
    expect(next).toBe('INV-0003');
    // the PC's own server and database were stopped; the books are still on the disk
    expect(dbRunning(a.profile)).toBe(false);
    expect(fs.existsSync(path.join(a.profile, 'local', 'pgdata', 'PG_VERSION'))).toBe(true);
    const mode = JSON.parse(fs.readFileSync(path.join(a.profile, 'mode.json'), 'utf8'));
    expect(mode).toMatchObject({ mode: 'online', movedToCloud: { email } });
  } finally {
    await a.app.close();
  }
  // the next start: straight to the online app (no first-start question, no PC database)
  const again = await launch(APP, { BILLING_MODE: '', BILLING_PG_DIR: LOCAL.BILLING_PG_DIR }, a.profile);
  try {
    expect(new URL(again.win.url()).origin).toBe(new URL(APP).origin);
    expect(dbRunning(a.profile)).toBe(false);
  } finally {
    await again.app.close();
  }
});
