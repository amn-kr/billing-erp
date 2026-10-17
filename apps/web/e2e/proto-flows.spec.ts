/**
 * The prototype's own business-flow checks (reference/tests/flows.js), run against the rebuild
 * and its API, one after another in one shop (the banking fixture: customers, a supplier,
 * invoices, an open challan, cash and two banks). Each step checks the books through the API
 * after doing the work on screen, as the prototype's checks did through its own data.
 *
 * Differences from flows.js, on purpose:
 * - "no bill tabs on screen": the rebuild has bill tabs, which the owner asked for (rules in sales.flows).
 * - "party statements = balances": the statement is a Phase 4 report; it is checked there.
 * - "everything persists after reload": the books are on the server; the screens show the same after a reload.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

test.describe.configure({ mode: 'serial' });

let page: Page;
let token = '';
let who: { email: string; password: string };
const api = async (request: APIRequestContext, path: string) => {
  const r = await request.get(APP + '/api' + path, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok(), path).toBe(true);
  return r.json();
};
const balanceOf = async (request: APIRequestContext, name: string) =>
  Number(((await api(request, '/parties')) as { name: string; balance: string }[]).find((p) => p.name === name)!.balance);
const cash = async (request: APIRequestContext) =>
  Number(((await api(request, '/banking/accounts')) as { kind: string; balance: string }[]).find((a) => a.kind === 'cash')!.balance);
const pick = async (sel: string, text: string) => { await page.fill(sel, text); await page.waitForTimeout(150); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); };
const choose = async (sel: string, text: string) => { const v = await page.locator(`${sel} option`, { hasText: text }).first().getAttribute('value'); await page.selectOption(sel, v!); };

const errors: string[] = [];
let inv = { no: '', total: 0 };

test.beforeAll(async ({ browser, request }) => {
  who = await freshShop(request, 'bank-shop');
  const r = await request.post(APP + '/api/auth/login', { data: who });
  token = (await r.json()).accessToken;
  page = await newPage(browser, 1366);
  page.on('pageerror', (e) => errors.push(e.message));
  await signInAs(page, who);
});
test.afterAll(async () => { await page.close(); });

test('a new invoice is dated today', async () => {
  await page.goto(APP + '/sales/new');
  // the shared clock is frozen on 1 October 2026 (India time)
  await expect(page.locator('#siDate')).toHaveValue('2026-10-01');
});

test('an invoice raises the party balance', async ({ request }) => {
  const before = await balanceOf(request, 'Mehta Electricals');
  await page.goto(APP + '/sales/new');
  inv.no = await page.locator('#siNo').inputValue();
  await pick('#siParty', 'Mehta');
  for (const [item, q] of [['LED bulb', '3'], ['Copper wire', '1']] as const) {
    await page.locator('#qeItem').fill(item);
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('#qeQty').fill(q);
    await page.locator('#qeQty').press('Control+Enter');
  }
  // rapid entry puts the newest line on top, as in the prototype
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/Copper wire/);
  await expect(page.locator('#siRows tr[data-ln="1"] [data-f="name"]')).toHaveValue(/LED bulb/);
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toHaveText('Invoice saved successfully');
  await page.keyboard.press('Escape');
  const sale = ((await api(request, '/sales?kind=invoice')) as { number: string; total: string; date: string }[]).find((s) => s.number === inv.no)!;
  inv.total = Number(sale.total);
  expect(sale.date.slice(0, 10)).toBe('2026-10-01');
  expect(await balanceOf(request, 'Mehta Electricals')).toBeCloseTo(before + inv.total, 2);
});

test('a cash payment lowers the balance, goes to the cash book and marks the invoice paid', async ({ request }) => {
  const bal = await balanceOf(request, 'Mehta Electricals');
  const cash0 = await cash(request);
  await page.goto(APP + '/payments-received');
  await page.click('#rcNew');
  await choose('#rcParty', 'Mehta Electricals');
  await page.waitForSelector('#rcBills input[data-rca]');
  // only this invoice is settled, so the amount is typed against it
  await page.fill('#rcAmt', String(inv.total));
  await page.locator('#rcAmt').dispatchEvent('input');
  await page.selectOption('#rcModeI', 'Cash');
  for (const row of await page.locator('#rcBills tr', { has: page.locator('input[data-rca]') }).all())
    await row.locator('input[data-rca]').fill((await row.textContent())!.includes(inv.no) ? String(inv.total) : '0');
  await page.click('#rcSave');
  await expect(page.locator('#rcm')).toBeHidden();
  expect(await balanceOf(request, 'Mehta Electricals')).toBeCloseTo(bal - inv.total, 2);
  expect(await cash(request)).toBeCloseTo(cash0 + inv.total, 2);
  const sale = ((await api(request, '/sales?kind=invoice')) as { number: string; balance: string }[]).find((s) => s.number === inv.no)!;
  expect(Number(sale.balance)).toBe(0);
});

test('a credit note against the invoice gives the customer credit', async ({ request }) => {
  const bal = await balanceOf(request, 'Mehta Electricals');
  await page.goto(APP + '/credit-notes');
  await page.click('#cnNew');
  await choose('#cnParty', 'Mehta Electricals');
  await page.click(`#cnInvs [data-cninv="${inv.no}"]`);
  await page.waitForSelector('#cnRowsI [data-cnq]');
  await page.fill('#cnRowsI tr[data-cnk="0"] [data-cnq]', '1');
  await page.locator('#cnRowsI tr[data-cnk="0"] [data-cnq]').dispatchEvent('input');
  await page.click('#cnSave');
  await expect(page.locator('#cnm')).toBeHidden();
  expect(await balanceOf(request, 'Mehta Electricals')).toBeLessThan(bal - 0.01);
});

test('a purchase bill is saved and raises what the shop owes; a payment made lowers it', async ({ request }) => {
  const owe = await balanceOf(request, 'Kanpur Cables Pvt Ltd');
  await page.goto(APP + '/purchases/new?kind=bill');
  await pick('#peParty', 'Kanpur');
  await pick('#peRows tr[data-ln="0"] .pe-item', 'LED bulb');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '10');
  await page.fill('#peRef', 'SUP-77');
  const billNo = await page.locator('#peNo').inputValue();
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText('Purchase Bill saved successfully');
  const bill = ((await api(request, '/purchases?kind=bill')) as { number: string; total: string }[]).find((b) => b.number === billNo)!;
  const owe2 = await balanceOf(request, 'Kanpur Cables Pvt Ltd');
  expect(Math.abs(owe2 - owe)).toBeCloseTo(Number(bill.total), 2);

  await page.goto(APP + '/payments-made');
  await page.click('#pxNew');
  await choose('#pySup', 'Kanpur Cables');
  await page.fill('#pyAmt', '1000');
  await page.locator('#pyAmt').dispatchEvent('input');
  await page.click('#pySave');
  await expect(page.locator('#toast')).toHaveText('Payment Out saved successfully');
  expect(Math.abs(Math.abs(await balanceOf(request, 'Kanpur Cables Pvt Ltd')) - Math.abs(owe2))).toBeCloseTo(1000, 2);
});

test('an expense paid in cash lowers cash', async ({ request }) => {
  const c1 = await cash(request);
  await page.goto(APP + '/expenses');
  await page.click('#exNew');
  await page.selectOption('#xpCat', 'Rent');
  await page.fill('#xpLines [data-f="amt"]', '777');
  await page.click('#xpSave');
  await expect(page.locator('#xpm')).toBeHidden();
  expect(await cash(request)).toBeCloseTo(c1 - 777, 2);
});

test('a challan converts to an invoice', async () => {
  await page.goto(APP + '/delivery-challans');
  await page.click('#dcRows [data-dcconv="DC-0002"]');
  await expect(page).toHaveURL(/\/sales\/new\?challan=/);
  await expect(page.locator('#siParty')).toHaveValue(/Mehta Electricals/);
  await expect(page.locator('#siRows tr[data-ln] [data-f="name"]').first()).not.toHaveValue('');
});

test('closing the bill asks first: Esc keeps it, Enter Enter discards and goes back to Sales', async () => {
  await page.click('#siCancel');
  await expect(page.locator('#dcf')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dcf')).toBeHidden();
  await expect(page).toHaveURL(/\/sales\/new/);
  await page.click('#siCancel');
  await expect(page.locator('#dcf')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sales$/);
});

test('opening a new bill does not use up its number', async () => {
  await page.goto(APP + '/sales/new');
  const n1 = await page.locator('#siNo').inputValue();
  await page.goto(APP + '/sales');
  await page.waitForSelector('#slRows tr[data-sno]');
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#siNo')).toHaveValue(n1);
});

test('everything is still there after a reload', async () => {
  const counts = async () => {
    const out: number[] = [];
    for (const [path, rows] of [['/sales', '#slRows tr[data-sno]'], ['/payments-received', '#rcRows tr[data-rcno]'], ['/credit-notes', '#cnRows tr[data-cnno]'], ['/purchase-bills', '#puRows tr[data-bno]'], ['/expenses', '#exRows tr[data-exk]'], ['/payments-made', '#pxRows tr']] as const) {
      await page.goto(APP + path);
      await page.waitForSelector(rows);
      out.push(await page.locator(rows).count());
    }
    return out.join();
  };
  const before = await counts();
  await page.reload();
  await page.waitForSelector('#app');
  expect(await counts()).toBe(before);
});

test('a reload keeps the screen you were on', async () => {
  for (const [path, view] of [['/purchase-bills', '#vPur'], ['/expenses', '#vExp'], ['/bank-accounts', '#vBks'], ['/parties', '#vParties']] as const) {
    await page.goto(APP + path);
    await page.waitForSelector(view);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(path + '$'));
    await expect(page.locator(view)).toBeVisible();
  }
});

test('names with quotes are shown as text, never run', async ({ request }) => {
  const r = await request.post(APP + '/api/expense-categories', { headers: { Authorization: `Bearer ${token}` }, data: { name: 'x" onmouseover="window.__x=1' } });
  expect(r.ok()).toBe(true);
  await page.goto(APP + '/expenses');
  await page.click('#exCats');
  await expect(page.locator('#xcm')).toBeVisible();
  await page.hover('#xcList');
  for (const el of await page.locator('#xcList .xcrow').all()) await el.hover();
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  await expect(page.locator('#xcList input[value="x\\" onmouseover=\\"window.__x=1"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
