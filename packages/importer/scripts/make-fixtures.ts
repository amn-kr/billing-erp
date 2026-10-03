/**
 * Makes backup files the way a shop would: by using the prototype's own
 * screens (Start fresh, Add party, Add item, …) and then downloading a backup.
 * Output: fixtures/*.backup.json
 *
 *   pnpm --filter @billing/importer fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../fixtures');
const APP = 'file://' + path.resolve(HERE, '../../../reference/design/app.html');

async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  await ctx.route(/^https?:/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T14:00:00+05:30'));
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(APP);
  await page.waitForTimeout(600);
  return { page, close: () => browser.close() };
}

async function startFresh(page: Page, keepItems: boolean) {
  await page.evaluate(() => (window as any).bzOpen());
  await page.fill('#bzfName', 'Gupta Electricals & Hardware');
  await page.fill('#bzfOwner', 'Ravi Gupta');
  await page.fill('#bzfPhone', '+91 94150 12345');
  await page.fill('#bzfEmail', 'ravi@gupta.example.com');
  await page.fill('#bzfAddr', '45, Latouche Road');
  await page.fill('#bzfCity', 'Lucknow');
  await page.fill('#bzfPin', '226001');
  await page.fill('#bzfGstin', '09AAGFG2231M1ZQ');
  await page.fill('#bzfInv', '101');
  await page.fill('#bzfCash', '15000');
  await page.evaluate((keep) => {
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    $('bzfKeep').checked = keep;
    $('bzfOk').checked = true;
    $('bzfOk').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('#bzm input').forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  }, keepItems);
  await page.click('#bzmGo');
  await page.waitForSelector('#vDash:not([hidden])');
  await page.waitForTimeout(400);
}

/** Fills the Add party dialog field by field (all three tabs) and saves. */
/** Move the frozen clock on, as a real person typing would (the prototype makes ids from the time). */
let tick = 0;
const later = (page: Page) => page.clock.setFixedTime(new Date(Date.parse('2026-10-01T14:00:00+05:30') + ++tick * 61_000));

async function addParty(page: Page, f: Record<string, string>, opts: { pay?: boolean; ship?: string } = {}) {
  await later(page);
  await page.evaluate(() => (window as any).openParty());
  for (const tab of ['addr', 'cred', 'extra']) {
    await page.evaluate((t) => (document.querySelector(`#ap [data-aptab="${t}"]`) as HTMLButtonElement)?.click(), tab);
    if (tab === 'cred' && opts.pay) await page.evaluate(() => { (0, eval)('AP').type = 'pay'; });
    await page.evaluate((vals) => {
      document.querySelectorAll<HTMLInputElement>('#ap [data-f]').forEach((el) => {
        if (vals[el.dataset.f!] !== undefined) { el.value = vals[el.dataset.f!]!; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    }, f);
  }
  await page.evaluate(() => (window as any).apSave(false));
  const err = await page.evaluate(() => JSON.stringify((0, eval)('AP').err));
  if (err !== '{}') throw new Error('party not saved: ' + err);
}

async function addItem(page: Page, f: Record<string, string>, svc = false) {
  await later(page);
  await page.evaluate(() => (window as any).openItem());
  if (svc) await page.evaluate(() => { const s = document.getElementById('aiSvc') as HTMLInputElement | null; if (s) { s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  for (const tab of ['price', 'stock']) {
    await page.evaluate((t) => (document.querySelector(`#ai [data-aitab="${t}"]`) as HTMLButtonElement)?.click(), tab);
    await page.evaluate((vals) => {
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#ai [data-f]').forEach((el) => {
        if (vals[el.dataset.f!] !== undefined) { el.value = vals[el.dataset.f!]!; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }, f);
  }
  await page.evaluate(() => (window as any).saveItem(false));
  const err = await page.evaluate(() => JSON.stringify((0, eval)('AI').err));
  if (err !== '{}') throw new Error('item not saved: ' + err);
}

async function save(page: Page, name: string) {
  const b = await page.evaluate(() => (window as any).bkpMake());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(b, null, 1) + '\n');
  console.log(name, Object.keys(b.keys).length, 'keys');
}

// 1. the sample shop, untouched
{
  const { page, close } = await open();
  await save(page, 'sample-shop.backup.json');
  await close();
}

// 2. a real-looking fresh shop, entered through the prototype's dialogs
{
  const { page, close } = await open();
  await startFresh(page, false);
  await addParty(page, {
    name: 'Mehta Electricals', phone: '9415012345', group: 'Wholesale customers', gstin: '09AAJPM7745Q1Z2', email: 'mehta@example.com',
    billing: '12, Aminabad Market', ob: '25,000', obDate: '2026-04-01', days: '30',
  });
  await addParty(page, { name: 'Raju Electrician', phone: '9839011223', group: 'Retail customers', ob: '1500', days: '15' });
  await addParty(page, { name: 'Kanpur Cables Pvt Ltd', phone: '9935512345', group: 'Suppliers', gstin: '09AABCK1234L1Z5', ob: '48000', obDate: '2026-04-01' }, { pay: true });
  await addParty(page, { name: 'Walk-in Ramesh', phone: '' });
  await addItem(page, { name: 'Copper wire 1.5 sq mm (90 m)', hsn: '8544', unit: 'COIL', cat: 'Wires & cables', code: 'CW15', sale: '1890', mrp: '2350', purch: '1560', gst: '18', oq: '25', op: '1540', od: '2026-04-01', min: '10', loc: 'Rack A1' });
  await addItem(page, { name: 'LED bulb 9W', hsn: '8539', unit: 'PCS', cat: 'Lighting', sale: '95', purch: '62', gst: '12', oq: '200', min: '50' });
  await addItem(page, { name: 'MCB 32A double pole', hsn: '8536', unit: 'PCS', cat: 'Switches & MCBs', sale: '420', mrp: '560', purch: '310', gst: '18', oq: '0', min: '5' });
  await addItem(page, { name: 'Fan installation', hsn: '9987', unit: 'NOS', cat: 'Services', sale: '350', gst: '18' }, true);
  await save(page, 'fresh-shop.backup.json');
  await close();
}

// 3. started fresh but kept the sample catalogue
{
  const { page, close } = await open();
  await startFresh(page, true);
  await addParty(page, { name: 'Sonu Wiring Works', phone: '9415522114', group: 'Contractors' });
  await save(page, 'fresh-kept-items.backup.json');
  await close();
}
