/**
 * The Windows app, step 7b: Bring my online books to this PC. An online shop (on the test server, standing
 * in for the live app) with 2 invoices; a new PC in single-PC mode has no account for that email, says so,
 * and brings the books down; the same email and password then work on the PC and the numbering carries on.
 * Online, the shop is view-only from then on.
 */
import { expect, test } from '@playwright/test';
import { APP } from '../../web/e2e/setup';
import { closeApp, launch } from './launch';
import { LOCAL } from './shop';

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** The online app's API, as a browser would call it. */
async function online<T>(path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const r = await fetch(`${APP}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as T };
}

test('Bring my online books to this PC: the PC says the account isn’t here, brings the books, and online they become view-only', async () => {
  const email = `brought.${Date.now().toString(36)}@online-shop.example.com`;
  const password = 'online password 1';
  // the online shop: 2 invoices
  const reg = await online<{ accessToken: string }>('/auth/register', { email, password, name: 'Online Owner' });
  const shop = await online<{ accessToken: string }>('/businesses', { name: 'Online Traders', owner: 'Online Owner', state: '09' }, reg.json.accessToken);
  const token = shop.json.accessToken;
  const D = today();
  const fan = (await online<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm', sale: '1890', gstRate: 18, openingQty: '25', openingDate: D }, token)).json;
  const verma = (await online<{ id: string }>('/parties', { name: 'Verma Traders', openingBalance: '1000', openingDate: D }, token)).json;
  const sale = { date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] };
  for (let i = 0; i < 2; i++) expect((await online('/sales', sale, token)).status).toBe(201);

  const a = await launch(APP, LOCAL);
  try {
    await a.win.waitForSelector('#vAuth:not([hidden])', { timeout: 60_000 });
    await a.win.fill('#aEmail', email);
    await a.win.fill('#aPass', password);
    await a.win.click('#aGo');
    await expect(a.win.locator('#aNotHere')).toContainText('There’s no account with this email on this computer yet.');
    await a.win.click('#aBring');
    await a.win.click('#bFind');
    await expect(a.win.locator('[data-shop]')).toHaveCount(1);
    await expect(a.win.locator('[data-shop]')).toHaveAttribute('aria-pressed', 'true');
    await a.win.click('#bGo');
    await expect(a.win.locator('#bDone')).toContainText('with the same counts as online: 2 invoices, 1 parties, 1 items', { timeout: 120_000 });
    await a.win.click('#bOpen');
    await a.win.waitForSelector('#app');
    await expect(a.win.locator('#orgBtn')).toContainText('Online Traders');
    await expect(a.win.locator('#movedBar')).toHaveCount(0);
    const next = await a.win.evaluate(async () => {
      const { accessToken } = await (await fetch('/api/auth/refresh', { method: 'POST' })).json();
      return (await (await fetch('/api/sales/next-number?kind=invoice', { headers: { authorization: `Bearer ${accessToken}` } })).json()).number;
    });
    expect(next).toBe('INV-0003');
    // signing in again on the PC: the online password works here now
    await a.win.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
    await a.win.evaluate(() => location.assign('/login'));
    await a.win.waitForSelector('#vAuth:not([hidden])');
    await a.win.fill('#aEmail', email);
    await a.win.fill('#aPass', password);
    await a.win.click('#aGo');
    await a.win.waitForSelector('#app');
  } finally {
    await closeApp(a.app);
  }

  // online: looking still works, changes are refused
  expect((await online<unknown[]>('/sales', undefined, token)).json).toHaveLength(2);
  const refused = await online<{ code: string }>('/sales', sale, token);
  expect(refused.status).toBe(403);
  expect(refused.json.code).toBe('moved_to_pc');
});
