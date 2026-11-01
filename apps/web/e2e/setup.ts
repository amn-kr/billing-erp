import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
// Same frozen clock, timezone and local fonts as the Phase 0 baseline.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const common = createRequire(import.meta.url)('../../../tools/design-baseline/common.cjs') as {
  FROZEN_TIME: string;
  WIDTHS: number[];
  HEIGHTS: Record<number, number>;
  newPage: (b: Browser, w: number) => Promise<Page>;
};

export const { WIDTHS } = common;

/* ---------- waiting for a page to be still before a screenshot ---------- */
const pending = new WeakMap<Page, number>();
/** Counts the page's open requests to the API (the rebuild's screens load data in several requests). */
function trackApi(page: Page) {
  pending.set(page, 0);
  const isApi = (u: string) => u.includes('/api/');
  page.on('request', (r) => { if (isApi(r.url())) pending.set(page, (pending.get(page) ?? 0) + 1); });
  const done = (r: { url(): string }) => { if (isApi(r.url())) pending.set(page, Math.max(0, (pending.get(page) ?? 1) - 1)); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}

/*
 * Tests open their pages straight on the worker's shared browser, which Playwright does not
 * close after each test. Left open, a full run piles up hundreds of live pages and every
 * later test slows down until screenshot tests run out of time. So the first page a new test
 * opens closes the ones earlier tests left behind.
 */
const open: { owner: string; page: Page }[] = [];
async function closeLeftovers(owner: string) {
  const old = open.filter((o) => o.owner !== owner);
  for (const o of old) { open.splice(open.indexOf(o), 1); await o.page.context().close().catch(() => {}); }
}

/** A page from the shared screenshot settings (frozen clock, local fonts), with its API requests counted. */
export async function newPage(browser: Browser, width: number): Promise<Page> {
  let owner = 'hook';
  try { owner = test.info().testId; } catch { /* outside a test: kept until a test opens pages */ }
  await closeLeftovers(owner);
  const page = await common.newPage(browser, width);
  open.push({ owner, page });
  trackApi(page);
  return page;
}

/**
 * Wait until the page is still: no API request open for a quiet spell (a screen
 * often asks for more data once the first answer arrives), every font loaded,
 * and two frames painted. Fixed waits were not enough on a busy CI machine.
 */
export async function settle(page: Page, quietMs = 300, maxMs = 15_000): Promise<void> {
  const start = Date.now();
  let quietSince = (pending.get(page) ?? 0) === 0 ? Date.now() : 0;
  while (Date.now() - start < maxMs) {
    if ((pending.get(page) ?? 0) === 0) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= quietMs) break;
    } else quietSince = 0;
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
const ROOT = path.resolve(HERE, '../../..');
export const PROTOTYPE = 'file://' + path.join(ROOT, 'reference/design/app.html');
export const PROTOTYPE_LOGIN = 'file://' + path.join(ROOT, 'reference/firebase-site/public/index.html');
export const APP = 'http://localhost:5174';

export const OWNER = { email: 'aman@sharma.example.com', password: 'demo-password-1' };

/**
 * The prototype in the same state as a newly set-up shop in the rebuild:
 * Settings › Start fresh with Sharma Electricals' details (empty books,
 * 7-day trial from today), cloud status "synced".
 */
export async function prototypeFresh(page: Page): Promise<void> {
  await page.goto(PROTOTYPE);
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { bzOpen: () => void }).bzOpen());
  await page.fill('#bzfName', 'Sharma Electricals & Hardware');
  await page.fill('#bzfOwner', 'Aman Kumar');
  await page.fill('#bzfPhone', '+91 98765 43210');
  await page.fill('#bzfEmail', 'aman@sharma.example.com');
  await page.fill('#bzfAddr', 'Shop 12, Naka Hindola');
  await page.fill('#bzfCity', 'Lucknow');
  await page.fill('#bzfPin', '226018');
  await page.fill('#bzfGstin', '09ABCPS4821K1Z6');
  await page.evaluate(() => {
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    $('bzfKeep').checked = false;
    $('bzfOk').checked = true;
    $('bzfOk').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('#bzm input').forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  });
  await page.click('#bzmGo');
  await page.waitForSelector('#vDash:not([hidden])');
  await page.evaluate(() => {
    (window as unknown as { SYNC: { setSt: (s: string) => void } }).SYNC.setSt('ok');
    const t = document.getElementById('toast');
    if (t) t.classList.remove('on');
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', OWNER.email);
  await page.fill('#aPass', OWNER.password);
  await page.click('#aGo');
  await page.waitForSelector('#app');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

export const RAVI = { email: 'ravi@gupta.example.com', password: 'demo-password-1' };
/** The shop holding packages/importer/fixtures/sales-shop.backup.json (sales documents). */
export const SALES = { email: 'ravi.sales@gupta.example.com', password: 'demo-password-1' };
export const PURCHASES = { email: 'ravi.purchases@gupta.example.com', password: 'demo-password-1' };
/** The purchase shop plus two bank accounts and money moved by hand (bank-shop.backup.json). */
export const BANK = { email: 'ravi.bank@gupta.example.com', password: 'demo-password-1' };
/** The bank shop plus an electrician with referred bills, a return and two payouts (commission-shop.backup.json). */
export const COMMISSION = { email: 'ravi.commission@gupta.example.com', password: 'demo-password-1' };

/** The prototype showing one of the importer fixtures (restored like "Restore books"). */
export async function prototypeWithBackup(page: Page, fixture = 'fresh-shop'): Promise<void> {
  const fs = await import('node:fs');
  const bk = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/importer/fixtures', `${fixture}.backup.json`), 'utf8'));
  await page.goto(PROTOTYPE);
  await page.evaluate((keys: Record<string, string | null>) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(keys)) if (v != null) localStorage.setItem(k, v);
  }, bk.keys);
  await page.goto(PROTOTYPE);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    (window as unknown as { SYNC: { setSt: (s: string) => void } }).SYNC.setSt('ok');
    document.getElementById('toast')?.classList.remove('on');
  });
  await page.evaluate(() => document.fonts.ready);
}

/** The software owner's panel account in the browser tests (made once per run through the setup page's API). */
export const PANEL = { name: 'Aman Kumar', email: 'owner.panel@example.com', password: 'owner panel pass 1', code: 'e2e-owner-setup-code-0001' };
export const PROTOTYPE_OWNER = 'file://' + path.join(ROOT, 'reference/design/owner-panel.html');

/** Make the panel account if this run hasn't yet (start-api.sh sets OWNER_SETUP_CODE). */
export async function panelAccount(request: APIRequestContext): Promise<typeof PANEL> {
  const open = (await (await request.get(APP + '/api/owner/setup')).json()) as { open: boolean };
  if (open.open) {
    const r = await request.post(APP + '/api/owner/setup', { data: { code: PANEL.code, name: PANEL.name, email: PANEL.email, password: PANEL.password, password2: PANEL.password } });
    if (!r.ok()) throw new Error(`owner setup failed: ${r.status()} ${await r.text()}`);
  }
  return PANEL;
}

/** Sign in as the software owner on the shared sign-in page; lands on /owner. */
export async function signInPanel(page: Page): Promise<void> {
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', PANEL.email);
  await page.fill('#aPass', PANEL.password);
  await page.click('#aGo');
  await page.waitForURL('**/owner');
  await page.waitForSelector('#rows tr');
  await page.evaluate(() => document.fonts.ready);
}

export async function signInAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', who.email);
  await page.fill('#aPass', who.password);
  await page.click('#aGo');
  await page.waitForSelector('#app');
  await page.evaluate(() => document.fonts.ready);
}

/** Open a prototype screen by its view id, or the same screen in the rebuild through the sidebar. */
export async function openPrototypeView(page: Page, view: string) {
  await page.evaluate((v) => (window as unknown as { go: (v: string) => void }).go(v), view);
  await page.waitForTimeout(400);
}

let shops = 0;
/** A brand-new shop for tests that change data, so the screenshot shop stays as imported. */
export async function freshShop(request: APIRequestContext, fixture?: string, opts: { includeSample?: boolean } = {}): Promise<{ email: string; password: string }> {
  const who = { email: `e2e.${Date.now().toString(36)}.${process.pid}.${++shops}@flows.example.com`, password: 'flows password 1' };
  const reg = await request.post(APP + '/api/auth/register', { data: { ...who, name: fixture ? 'Ravi Gupta' : 'Pooja Verma' } }); // the fixtures' owner
  if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
  const biz = await request.post(APP + '/api/businesses', {
    headers: { Authorization: `Bearer ${(await reg.json()).accessToken}` },
    data: { name: 'Verma Traders', owner: 'Pooja Verma', state: '09', gstin: '09AAGFG2231M1ZQ' },
  });
  if (!biz.ok()) throw new Error(`creating the shop failed: ${biz.status()} ${await biz.text()}`);
  if (fixture) {
    const fs = await import('node:fs');
    const text = fs.readFileSync(path.join(ROOT, 'packages/importer/fixtures', `${fixture}.backup.json`), 'utf8');
    const r = await request.post(APP + '/api/imports', { headers: { Authorization: `Bearer ${(await biz.json()).accessToken}` }, data: { fileName: `${fixture}.backup.json`, backup: text, includeSample: !!opts.includeSample } });
    if (!r.ok()) throw new Error(`import failed: ${r.status()} ${await r.text()}`);
  }
  return who;
}

/** Save Settings › Print & invoice choices for a shop (what the owner picks on that screen). */
export async function savePrint(who: { email: string; password: string }, print: Record<string, unknown>): Promise<void> {
  // a connection of its own: signing in here must not sign in the test's browser (it then expects the sign-in page)
  const api = await playwrightRequest.newContext();
  try {
    const login = await api.post(APP + '/api/auth/login', { data: who });
    const r = await api.patch(APP + '/api/settings', { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` }, data: { data: { print } } });
    if (!r.ok()) throw new Error(`saving print settings failed: ${r.status()} ${await r.text()}`);
  } finally {
    await api.dispose();
  }
}

/**
 * The prototype's own invoice: layout "Simple" with its columns and wording
 * (same as PROTO_PRINT in src/features/print/opts.ts). Picture tests that compare
 * the invoice window with the prototype save this first.
 */
export const PROTO_PRINT = {
  theme: 'simple', showEmail: false, sign: 'Authorised signatory', color: '#151b2e',
  cols: { sl: { on: true, label: '#' }, name: { on: true, label: 'Item' }, code: { on: true, label: 'Code' }, brand: { on: true, label: 'Brand' }, series: { on: true, label: 'Series' }, hsn: { on: true, label: 'HSN' }, qty: { on: true, label: 'Qty' }, unit: { on: false, label: 'Unit' }, price: { on: true, label: 'Rate' }, discPct: { on: true, label: 'Disc' }, taxPct: { on: true, label: 'GST' }, rate: { on: false, label: 'Final Rate' }, amount: { on: true, label: 'Amount' } },
};
