/** A shop on the Windows app's own server (single-PC mode), for the tests. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';

const { ensurePostgres } = createRequire(import.meta.url)('../scripts/ensure-postgres.cjs') as { ensurePostgres(): string };
export const PG = ensurePostgres();
export const LOCAL = { BILLING_MODE: 'local', BILLING_PG_DIR: PG };
export const OWNER = { email: 'owner@local-shop.example.com', password: 'local shop password 1' };

/** is the shop's database still running? (pg_ctl status: 0 = running) */
export const dbRunning = (profile: string) => spawnSync(path.join(PG, 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), ['status', '-D', path.join(profile, 'local', 'pgdata')]).status === 0;
export const settings = (profile: string) => JSON.parse(fs.readFileSync(path.join(profile, 'local', 'settings.json'), 'utf8')) as { appPort: number; lastVersion?: string };

/** a new shop on this computer's own server, then signed in on the sign-in page */
export async function newShop(win: Page, who = OWNER, shop = 'Local Traders') {
  await win.waitForSelector('#vAuth:not([hidden])', { timeout: 60_000 });
  await win.evaluate(async ({ shop, ...who }) => {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...who, name: 'Local Owner' }) });
    const { accessToken } = await r.json();
    const b = await fetch('/api/businesses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name: shop, owner: 'Local Owner', state: '09' }) });
    if (!b.ok) throw new Error(await b.text());
  }, { ...who, shop });
  await win.fill('#aEmail', who.email);
  await win.fill('#aPass', who.password);
  await win.click('#aGo');
  await win.waitForSelector('#app');
}

/** bills made through this computer's own server (signed in as the owner); returns their numbers */
export async function bill(win: Page, howMany: number, who = OWNER): Promise<string[]> {
  return win.evaluate(async ({ who, howMany }) => {
    const call = async (url: string, token: string | null, body?: unknown) => {
      const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
      return r.json();
    };
    const { accessToken: t } = await call('/api/auth/login', null, who);
    const parties = await call('/api/parties', t) as { id: string; name: string }[];
    const cust = parties.find((p) => p.name === 'Verma Traders') ?? await call('/api/parties', t, { name: 'Verma Traders' });
    const items = await call('/api/items', t) as { id: string; name: string }[];
    const it = items.find((i) => i.name === 'Ceiling Fan') ?? await call('/api/items', t, { name: 'Ceiling Fan', sale: '100', gstRate: 18 });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const numbers: string[] = [];
    for (let i = 0; i < howMany; i++) {
      const s = await call('/api/sales', t, { partyId: cust.id, date: today, dueDate: today, lines: [{ itemId: it.id, name: it.name, qty: '1', price: '100', discPct: '0', gstRate: '18' }], payments: [] });
      numbers.push(s.number);
    }
    return numbers;
  }, { who, howMany });
}

