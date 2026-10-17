/**
 * Sales › row menu › Delete, against the real API. Delete undoes the invoice like Cancel (stock back,
 * money received kept as the party's advance), then hides it from the list; it is never erased.
 * With the passcode on it asks for it after the confirm window; with it off only the confirm window.
 * Made-up passcodes only.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
type Who = { email: string; password: string };

async function api(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: async <T>(path: string) => (await (await request.get(APP + '/api' + path, { headers })).json()) as T,
    post: async <T>(path: string, data: object) => {
      const r = await request.post(APP + '/api' + path, { headers, data });
      expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
      return (await r.json()) as T;
    },
  };
}

/** A fan in stock and a customer; an invoice for 2 fans with ₹1,000 received on it. */
async function invoice(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const fan = await a.post<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm (delete)', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingDate: '2026-10-01' });
  const verma = await a.post<{ id: string; name: string }>('/parties', { name: 'Verma Traders (delete)', openingBalance: '1000', openingDate: '2026-10-01' });
  const look = async () => ({ stock: (await a.get<{ stock: string }>(`/items/${fan.id}`)).stock, balance: (await a.get<{ balance: string }>(`/parties/${verma.id}`)).balance });
  const before = await look();
  const inv = await a.post<{ id: string; number: string }>('/sales', {
    date: '2026-10-01', dueDate: '2026-10-01', partyId: verma.id,
    lines: [{ itemId: fan.id, name: fan.name, qty: '2', price: '1890', discPct: '0', gstRate: '18' }],
    payments: [{ mode: 'Cash', amount: '1000' }],
  });
  return { a, inv, before, look };
}

async function openDelete(page: Page, number: string) {
  await page.goto(APP + '/sales');
  const row = page.locator(`#slRows tr[data-sno="${number}"]`);
  await row.waitFor();
  const b = (await row.boundingBox())!;
  await page.mouse.click(b.x + 200, b.y + 10, { button: 'right' });
  await expect(page.locator('#slCtx [data-sla="del"]')).toBeEnabled();
  await page.click('#slCtx [data-sla="del"]');
  await expect(page.locator('#slm .mdl h3')).toHaveText(`Delete ${number}?`);
  return row;
}

test('Delete with the passcode: gone from the list; stock back and the money received kept as an advance', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  const { a, inv, before, look } = await invoice(request, who);
  await a.post('/settings/passcode/on', { passcode: PASS });
  const during = await look();
  expect(during.stock).not.toBe(before.stock);
  await signInAs(page, who);

  // the confirm window, then the passcode box; "Keep invoice" leaves it
  let row = await openDelete(page, inv.number);
  await expect(page.locator('#slm')).toContainText('It is hidden from your lists but kept safely in your records. Nothing is erased.');
  await expect(page.locator('#slmOk')).toHaveText('Delete invoice');
  await page.click('#slmOk');
  await expect(page.locator('#pcT')).toHaveText(`Delete ${inv.number}?`);
  await expect(page.locator('#pcSub')).toHaveText('Enter the passcode to delete this invoice. It is hidden from your lists but kept safely in your records. Nothing is erased.');
  await expect(page.locator('#pcGo')).toHaveText('Delete invoice');
  await expect(page.locator('#pcCancel')).toHaveText('Keep invoice');
  await page.click('#pcCancel');
  await expect(page.locator('#pcCancel')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(row).toBeVisible();
  expect(await look()).toEqual(during);

  // a wrong passcode keeps the box open; the right one deletes it
  row = await openDelete(page, inv.number);
  await page.click('#slmOk');
  await page.fill('#pcPin', '0000');
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await page.fill('#pcPin', PASS);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText(`${inv.number} deleted`);
  await expect(row).toHaveCount(0);

  // stock is back; the ₹1,000 received stays with the party as an advance (like cancel)
  const after = await look();
  expect(after.stock).toBe(before.stock);
  expect([before.balance, after.balance]).toEqual(['1000.00', '0.00']); // opening 1000 − advance 1000
  const list = await a.get<{ number: string }[]>('/sales');
  expect(list.map((s) => s.number)).not.toContain(inv.number);
});

test('Delete with the passcode off: only the confirm window; Cancel still looks the same', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  const { inv, before, look } = await invoice(request, who);
  await signInAs(page, who);
  const row = await openDelete(page, inv.number);
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText(`${inv.number} deleted`);
  await expect(page.locator('#pcm:not([hidden])')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect((await look()).stock).toBe(before.stock);

  // a cancelled invoice still shows in the list as Cancelled
  const other = page.locator('#slRows tr[data-sno]').filter({ hasNotText: 'Cancelled' }).first();
  const no = (await other.getAttribute('data-sno'))!;
  const b = (await other.boundingBox())!;
  await page.mouse.click(b.x + 200, b.y + 10, { button: 'right' });
  await page.click('#slCtx [data-sla="cancel"]');
  await expect(page.locator('#slm .mdl h3')).toHaveText(`Cancel ${no}?`);
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText(`${no} cancelled`);
  await expect(page.locator(`#slRows tr[data-sno="${no}"]`)).toContainText('Cancelled');
});
