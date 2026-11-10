/**
 * Single-PC mode (Phase 6, step 4): the shop's own PostgreSQL and server inside the Windows app.
 * Real PostgreSQL 16 (scripts/ensure-postgres.cjs), the real server bundle (dist/server), a fresh app
 * folder per test.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { find, launch, openApp } from './launch';

const { ensurePostgres } = createRequire(import.meta.url)('../scripts/ensure-postgres.cjs') as { ensurePostgres(): string };
const PG = ensurePostgres();
const LOCAL = { BILLING_MODE: 'local', BILLING_PG_DIR: PG };
const OWNER = { email: 'owner@local-shop.example.com', password: 'local shop password 1' };

/** is the shop's database still running? (pg_ctl status: 0 = running) */
const dbRunning = (profile: string) => spawnSync(path.join(PG, 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), ['status', '-D', path.join(profile, 'local', 'pgdata')]).status === 0;
const settings = (profile: string) => JSON.parse(fs.readFileSync(path.join(profile, 'local', 'settings.json'), 'utf8')) as { appPort: number; lastVersion?: string };

/** a new shop on this computer's own server, then signed in on the sign-in page */
async function newShop(win: Page) {
  await win.waitForSelector('#vAuth:not([hidden])', { timeout: 60_000 });
  await win.evaluate(async (who) => {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...who, name: 'Local Owner' }) });
    const { accessToken } = await r.json();
    const b = await fetch('/api/businesses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name: 'Local Traders', owner: 'Local Owner', state: '09' }) });
    if (!b.ok) throw new Error(await b.text());
  }, OWNER);
  await win.fill('#aEmail', OWNER.email);
  await win.fill('#aPass', OWNER.password);
  await win.click('#aGo');
  await win.waitForSelector('#app');
}

test('first start makes the books on this computer; the app works from there', async () => {
  const { app, win, profile } = await launch('http://localhost:5999', LOCAL);
  try {
    // the app's own server on this computer, at the port kept in its settings
    expect(new URL(win.url()).origin).toBe(`http://127.0.0.1:${settings(profile).appPort}`);
    await newShop(win);
    await expect(win.locator('#orgBtn')).toContainText('Local Traders');
    // the database is PostgreSQL 16 in the app's folder, reachable from this computer only
    expect(fs.existsSync(path.join(profile, 'local', 'pgdata', 'PG_VERSION'))).toBe(true);
    expect(fs.readFileSync(path.join(profile, 'local', 'pgdata', 'PG_VERSION'), 'utf8').trim()).toBe('16');
    const conf = fs.readFileSync(path.join(profile, 'local', 'pgdata', 'postgresql.auto.conf'), 'utf8') + fs.readFileSync(path.join(profile, 'local', 'pgdata', 'pg_hba.conf'), 'utf8');
    expect(conf).toMatch(/scram-sha-256/);
    expect(dbRunning(profile)).toBe(true);
  } finally {
    await app.close();
  }
  // closing the app stopped the database cleanly
  expect(dbRunning(profile)).toBe(false);
  expect(settings(profile).lastVersion).toBeTruthy();
});

test('the books, the address and the sign-in stay from one start to the next', async () => {
  const first = await launch('http://localhost:5999', LOCAL);
  const origin = new URL(first.win.url()).origin;
  await newShop(first.win);
  await first.app.close();

  const again = await launch('http://localhost:5999', LOCAL, first.profile);
  try {
    expect(new URL(again.win.url()).origin).toBe(origin);
    // still signed in: straight into the shop
    await again.win.waitForSelector('#app', { timeout: 60_000 });
    await expect(again.win.locator('#orgBtn')).toContainText('Local Traders');
  } finally {
    await again.app.close();
  }
});

test('after the app is killed (crash, power cut) the next start repairs and opens the books', async () => {
  const first = await launch('http://localhost:5999', LOCAL);
  await newShop(first.win);
  // (the sign-in is written to disk within a moment; main.ts)
  await first.win.waitForTimeout(1000);
  // no clean stop: the database is left running, like after a crash of the app
  first.app.process().kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 1000));

  const again = await launch('http://localhost:5999', LOCAL, first.profile);
  try {
    await again.win.waitForSelector('#app', { timeout: 60_000 });
    await expect(again.win.locator('#orgBtn')).toContainText('Local Traders');
  } finally {
    await again.app.close();
  }
  expect(dbRunning(first.profile)).toBe(false);
});

test('a new app version copies the books before upgrading them', async () => {
  const first = await launch('http://localhost:5999', LOCAL);
  await newShop(first.win);
  await first.app.close();
  // pretend the books were last opened by an older version
  const file = path.join(first.profile, 'local', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ...settings(first.profile), lastVersion: '0.0.1' }));

  const again = await launch('http://localhost:5999', LOCAL, first.profile);
  try {
    await again.win.waitForSelector('#app', { timeout: 60_000 });
    const backups = fs.readdirSync(path.join(first.profile, 'local', 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^before-\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}$/);
    expect(fs.existsSync(path.join(first.profile, 'local', 'backups', backups[0]!, 'PG_VERSION'))).toBe(true);
    expect(settings(first.profile).lastVersion).not.toBe('0.0.1');
  } finally {
    await again.app.close();
  }
});

test('if the database cannot start, the app says so plainly', async () => {
  const app = await openApp('http://localhost:5999', { BILLING_MODE: 'local', BILLING_PG_DIR: path.join(os.tmpdir(), 'no-postgres-here') });
  try {
    const page = await find(app, (p) => p.url().includes('/static/starting.html') && p.url().includes('error='));
    await expect(page.locator('#problem h1')).toHaveText('The books could not be opened');
    await expect(page.locator('#log')).toContainText('server.log');
  } finally {
    await app.close();
  }
});

/** bills made through this computer's own server (signed in as the owner); returns their numbers */
async function bill(win: Page, howMany: number): Promise<string[]> {
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
  }, { who: OWNER, howMany });
}

test('bills are numbered on this computer, carry on after a restart, and nothing is fetched from the internet', async () => {
  const first = await launch('http://localhost:5999', LOCAL);
  const origin = new URL(first.win.url()).origin;
  // every address the app's pages ask for, from the first page on
  const asked: string[] = [];
  first.app.context().on('request', (r) => asked.push(r.url()));
  await newShop(first.win);
  expect(await bill(first.win, 2)).toEqual(['INV-0001', 'INV-0002']);
  // the screens' own fonts, kept with the app (scripts/offline-fonts.mjs), so they look the same offline
  await first.win.evaluate(() => document.fonts.ready);
  expect(await first.win.evaluate(() => document.fonts.check('600 14px "Plus Jakarta Sans"'))).toBe(true);
  expect(await first.win.evaluate(() => [...document.fonts].some((f) => f.family.includes('Plus Jakarta Sans') && f.status === 'loaded'))).toBe(true);
  await first.app.close();
  const outside = asked.filter((u) => !u.startsWith(origin + '/') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('file:'));
  expect(outside, 'single-PC mode must not need the internet').toEqual([]);

  const again = await launch('http://localhost:5999', LOCAL, first.profile);
  try {
    await again.win.waitForSelector('#app', { timeout: 60_000 });
    expect(await bill(again.win, 1)).toEqual(['INV-0003']);
  } finally {
    await again.app.close();
  }
});
