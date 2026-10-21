/**
 * Profit by purchase-rate lots (owner, Oct 2026), against the real API: the sale editor's "Profit &
 * loss · this bill" pop-up (a row per lot), Party wise Profit & Loss and the item card's "Latest / Avg purchase price".
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

type It = { id: string; name: string };

/** The owner's example: Practice fan bought 50 × 20, 200 × 30, 50 × 25; a fan never bought; a labour service. */
async function practice(request: APIRequestContext, who: { email: string; password: string }) {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const post = async <T = It>(p: string, data: object): Promise<T> => {
    const r = await request.post(APP + '/api' + p, { headers, data });
    if (!r.ok()) throw new Error(`${p} failed: ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const sup = await post('/parties', { name: 'Kanpur Cables', kind: 'supplier' });
  await post('/parties', { name: 'Mehta Electricals' });
  const fan = await post('/items', { name: 'Practice fan', sale: '40', gstRate: 0, unit: 'PCS' });
  for (const [qty, rate, date] of [['50', '20', '2026-09-01'], ['200', '30', '2026-09-02'], ['50', '25', '2026-09-03']])
    await post('/purchases', { kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [{ itemId: fan.id, name: fan.name, qty, rate, discPct: '0', gstRate: '0' }] });
  await post('/items', { name: 'Never bought fan', sale: '40', gstRate: 0, unit: 'PCS', openingQty: '10', openingDate: '2026-09-01' });
  // the owner's rows example: lots 100 × 35 and 200 × 30
  const bike = await post('/items', { name: 'BIKE PULSAR', sale: '100', gstRate: 0, unit: 'PCS' });
  for (const [qty, rate, date] of [['100', '35', '2026-09-04'], ['200', '30', '2026-09-05']])
    await post('/purchases', { kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [{ itemId: bike.id, name: bike.name, qty, rate, discPct: '0', gstRate: '0' }] });
  // a long table: 16 lots at different rates
  const many = await post('/items', { name: 'Many-lot switch', sale: '90', gstRate: 0, unit: 'PCS' });
  for (let k = 0; k < 16; k++) {
    const date = `2026-09-${String(6 + k).padStart(2, '0')}`;
    await post('/purchases', { kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [{ itemId: many.id, name: many.name, qty: '5', rate: String(40 + k), discPct: '0', gstRate: '0' }] });
  }
}

const cells = (page: Page, row: number) => page.locator(`#siPop .plt tbody tr:nth-child(${row}) td`);
async function addLine(page: Page, item: string, qty: string) {
  await page.locator('#qeItem').fill(item);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill(qty);
  await page.locator('#qeQty').press('Control+Enter');
}

test('Profit & loss on a bill: one row per lot it uses up, oldest first; Party wise P&L shows the same totals', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  await practice(request, who);
  await signInAs(page, who);
  const newBill = async () => {
    await page.goto(APP + '/sales/new');
    await expect(page.locator('#vNewInv #siRows tr[data-ln]')).toHaveCount(1);
    await page.fill('#siParty', 'Mehta');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  };
  const text = async (row: number) => (await cells(page, row).allTextContents()).map((t) => t.trim());

  // the owner's example: BIKE PULSAR, 150 at 100, from the lots 100 × 35 and 50 × 30
  await newBill();
  await addLine(page, 'BIKE PULSAR', '150');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/BIKE PULSAR/);
  await page.click('#siTools [data-dgt="si:pl"]');
  await expect(page.locator('#siPop .plt tbody tr')).toHaveCount(2);
  // Item, Qty, Sale / unit, Cost / unit, Sale value, Cost, Profit, Margin
  expect(await text(1)).toEqual(['BIKE PULSAR', '100', '100.00', '35.00', '10,000.00', '3,500.00', '6,500.00', '65.0%']);
  expect(await text(2)).toEqual(['BIKE PULSAR', '50', '100.00', '30.00', '5,000.00', '1,500.00', '3,500.00', '70.0%']);
  expect((await page.locator('#siPop .plt tfoot td').allTextContents()).map((t) => t.trim())).toEqual(['Total', '', '', '', '15,000.00', '5,000.00', '10,000.00', '66.7%']);
  await expect(page.locator('#siPop .plsum b')).toHaveText(/10,000\.00$/);
  await expect(page.locator('#siPop .plsum em')).toHaveText('66.7% margin');
  await expect(page.locator('#siPop small.mu').last()).toHaveText('Cost uses the purchase rate of the stock each sale used (oldest first).');
  await page.click('#siPop [data-dgdone]');

  // saved, the same totals show in Party wise Profit & Loss
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toHaveText('Invoice saved successfully');
  await page.goto(APP + '/reports?r=ppl');
  const row = page.locator('#rpMain tr[data-rpk]', { hasText: 'Mehta Electricals' }).locator('td');
  // Party, Group, Bills, Sale value, Cost, Commission, Profit
  await expect(row.nth(3)).toHaveText('15,000.00');
  await expect(row.nth(4)).toHaveText('5,000.00');
  await expect(row.nth(6)).toHaveText('10,000.00');

  // a fan never bought (opening stock without a rate) and selling beyond stock: rows of their own at 0, with the warnings
  await newBill();
  await addLine(page, 'Never bought fan', '4');
  await addLine(page, 'BIKE PULSAR', '170');
  await page.click('#siTools [data-dgt="si:pl"]');
  // 150 of the 30.00 lot are left after the saved bill: 150 × 30, then 20 short
  await expect(page.locator('#siPop .plt tbody tr')).toHaveCount(3);
  const all = await Promise.all([1, 2, 3].map(text));
  expect(all).toContainEqual(['Never bought fan', '4', '40.00', '—', '160.00', '0.00', '160.00', '—']);
  expect(all).toContainEqual(['BIKE PULSAR', '150', '100.00', '30.00', '15,000.00', '4,500.00', '10,500.00', '70.0%']);
  expect(all).toContainEqual(['BIKE PULSAR', '20', '100.00', '—', '2,000.00', '0.00', '2,000.00', '—']);
  await expect(page.locator('#siPop small.mu').last()).toContainText(/1 item has no purchase entry, so cost is taken as ₹?0\./);
  await expect(page.locator('#siPop small.mu').last()).toContainText('20 PCS sold beyond stock: their cost will be counted when the purchase is entered.');
  await page.click('#siPop [data-dgdone]');

  // a long table scrolls; the pop-up's heading, the column names, the totals and Done stay in view
  await page.click('#siTabNew');
  await page.fill('#siParty', 'Mehta');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await addLine(page, 'Many-lot switch', '80');
  await page.click('#siTools [data-dgt="si:pl"]');
  await expect(page.locator('#siPop .plt tbody tr')).toHaveCount(16);
  const box = await page.evaluate(() => {
    const w = document.querySelector<HTMLElement>('#siPop .plw')!;
    w.scrollTop = w.scrollHeight;
    const inView = (sel: string) => {
      const el = document.querySelector(sel)!, r = el.getBoundingClientRect(), o = w.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && (!w.contains(el) || (r.top >= o.top - 1 && r.bottom <= o.bottom + 1));
    };
    return { scrolls: w.scrollHeight > w.clientHeight, head: inView('#siPop .dgph'), cols: inView('#siPop .plt thead th'), total: inView('#siPop .plt tfoot td'), sum: inView('#siPop .plsum'), done: inView('#siPop [data-dgdone]') };
  });
  expect(box).toEqual({ scrolls: true, head: true, cols: true, total: true, sum: true, done: true });
});

test('Item card: "Latest / Avg purchase price", and the figures one size smaller', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  await practice(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/items');
  const fig = (label: string) => page.locator('#itHead .itfig > div', { has: page.locator(`small:text-is("${label}")`) });
  const open = async (name: string) => {
    await page.locator('#itList .ptr', { hasText: name }).click();
    await expect(page.locator('#itHead h2')).toHaveText(name);
  };

  // newest bill 25; the stock left averages (50 × 20 + 200 × 30 + 50 × 25) ÷ 300
  await open('Practice fan');
  await expect(fig('Latest / Avg purchase price').locator('b')).toHaveText('25/27.50');
  await expect(page.locator('#itRates td.s b').first()).toHaveText('27.50');
  // no purchase entry at all
  await open('Never bought fan');
  await expect(fig('Latest / Avg purchase price').locator('b')).toHaveText('—');

  // numbers 15px (prototype 16px), bold, larger than the 11px labels; the rate table keeps its 13px
  await open('Practice fan');
  const style = (sel: string) => page.locator(sel).first().evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight]);
  for (const label of ['Sale price', 'Latest / Avg purchase price', 'Margin', 'In stock', 'Stock value'])
    expect(await fig(label).locator('b').evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])).toEqual(['15px', '800']);
  expect(await style('#itHead .itfig > div > small')).toEqual(['11px', '600']);
  expect(await style('#itRates td.s b')).toEqual(['13px', '800']);
});
