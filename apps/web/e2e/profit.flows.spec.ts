/**
 * Profit by purchase-rate lots (owner, Oct 2026), against the real API: the sale editor's "Profit &
 * loss · this bill" pop-up, Party wise Profit & Loss and the item card's "Latest / Avg purchase price".
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
}

const cells = (page: Page, row: number) => page.locator(`#siPop .plt tbody tr:nth-child(${row}) td`);
async function addLine(page: Page, item: string, qty: string) {
  await page.locator('#qeItem').fill(item);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill(qty);
  await page.locator('#qeQty').press('Control+Enter');
}

test('Profit & loss on a bill uses the lots it uses up, oldest first; Party wise P&L shows the same', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  await practice(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#vNewInv #siRows tr[data-ln]')).toHaveCount(1);
  await page.fill('#siParty', 'Mehta');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await addLine(page, 'Practice fan', '150');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/Practice fan/);

  await page.click('#siTools [data-dgt="si:pl"]');
  // Qty, Sale / unit, Cost / unit (the average: 4,000 ÷ 150), Sale value, Cost, Profit, Margin
  await expect(cells(page, 1).nth(3)).toHaveText('26.67');
  await expect(cells(page, 1).nth(4)).toHaveText('6,000.00');
  await expect(cells(page, 1).nth(5)).toHaveText('4,000.00');
  await expect(cells(page, 1).nth(6)).toHaveText('2,000.00');
  await expect(page.locator('#siPop .plsum b')).toHaveText(/2,000\.00$/);
  await expect(page.locator('#siPop small.mu').last()).toHaveText('Cost uses the purchase rate of the stock each sale used (oldest first).');
  await page.click('#siPop [data-dgdone]');

  // a fan never bought (opening stock without a rate) costs 0; selling more than is in stock warns
  await addLine(page, 'Never bought fan', '4');
  await addLine(page, 'Practice fan', '170');
  await page.click('#siTools [data-dgt="si:pl"]');
  await expect(cells(page, 2).nth(5)).toHaveText('0.00');
  await expect(cells(page, 2).nth(3)).toHaveText('—');
  // 150 + 170 = 320 Practice fans, 300 in stock: 20 short, on the later line
  await expect(page.locator('#siPop small.mu').last()).toContainText(/1 item has no purchase entry, so cost is taken as ₹?0\./);
  await expect(page.locator('#siPop small.mu').last()).toContainText('20 PCS sold beyond stock: their cost will be counted when the purchase is entered.');
  await page.click('#siPop [data-dgdone]');

  // a new bill with the owner's example, saved
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#vNewInv #siRows tr[data-ln]')).toHaveCount(1);
  await page.fill('#siParty', 'Mehta');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await addLine(page, 'Practice fan', '150');
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toHaveText('Invoice saved successfully');

  await page.goto(APP + '/reports?r=ppl');
  const row = page.locator('#rpMain tr[data-rpk]', { hasText: 'Mehta Electricals' }).locator('td');
  // Party, Group, Bills, Sale value, Cost, Commission, Profit
  await expect(row.nth(3)).toHaveText('6,000.00');
  await expect(row.nth(4)).toHaveText('4,000.00');
  await expect(row.nth(6)).toHaveText('2,000.00');
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
