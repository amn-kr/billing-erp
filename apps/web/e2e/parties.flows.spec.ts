/**
 * Parties › a supplier's transactions, against the real API: a purchase bill shows the supplier's own
 * bill number in a small grey line under our number, and the table's search finds the row by it.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

type Who = { email: string; password: string };

async function api(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  return async <T>(path: string, data: object) => {
    const r = await request.post(APP + '/api' + path, { headers, data });
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  };
}

test("a supplier's purchase bill shows the supplier's bill number, and the search finds it", async ({ browser, request }) => {
  const who = await freshShop(request);
  const post = await api(request, who);
  const bulb = await post<{ id: string; name: string }>('/items', { name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18 });
  const kc = await post<{ id: string }>('/parties', { name: 'Kanpur Cables', kind: 'supplier' });
  const bill = (supplierRef: string, date: string) => post('/purchases', {
    kind: 'bill', date, dueDate: date, partyId: kc.id, supplierRef,
    lines: [{ itemId: bulb.id, name: bulb.name, qty: '10', rate: '50', discPct: '0', gstRate: '18' }],
  });
  await bill('KC/2209', '2026-10-01');
  await bill('', '2026-10-02');

  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/parties');
  await page.locator('#ptList .ptr', { hasText: 'Kanpur Cables' }).click();
  const row = (no: string) => page.locator('#ptTx tr', { hasText: no });
  await expect(page.locator('#ptTx tr')).toHaveCount(2);
  // our number stays as it is; the supplier's number is a second line under it, only when there is one
  await expect(row('PB-0001').locator('td').nth(1).locator('small')).toHaveText('Supplier: KC/2209');
  await expect(row('PB-0002').locator('td').nth(1)).toHaveText('PB-0002');
  await expect(row('PB-0002').locator('small')).toHaveCount(0);

  // search by the supplier's number (any case), then by our own number as before
  await page.click('#ptTsBtn');
  await page.fill('#ptTq', 'kc/22');
  await expect(page.locator('#ptTx tr')).toHaveCount(1);
  await expect(row('PB-0001')).toHaveCount(1);
  await page.fill('#ptTq', 'PB-0002');
  await expect(page.locator('#ptTx tr')).toHaveCount(1);
  await expect(row('PB-0002')).toHaveCount(1);
});
