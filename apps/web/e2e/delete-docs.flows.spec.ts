/**
 * Delete in the row menus of debit notes, payments made, credit notes and payments received, and
 * Cancel in the Purchase bills menu (it does the same), against the real API: the red line below
 * View history, the confirm window, the passcode box, gone from the list. What can't be deleted is
 * refused with the reason. Made-up passcodes only.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
const D = '2026-10-01';
type Who = { email: string; password: string };
type It = { id: string; name: string };

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

/** A supplier bill for 20 bulbs with ₹500 paid with it, a bill for 5 switch boards, a debit note and a payment on it; an invoice, two credit notes and a payment received. */
async function books(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const item = (body: object) => a.post<It>('/items', { gstRate: 18, ...body });
  const bulb = await item({ name: 'LED bulb 9W (del)', sale: '95', purchase: '62', openingQty: '50', openingDate: D });
  const fan = await item({ name: 'Ceiling fan (del)', sale: '1890', purchase: '1540', openingQty: '3', openingDate: D });
  const board = await item({ name: 'Switch board (del)', sale: '320', purchase: '200' });
  const kc = await a.post<It>('/parties', { name: 'Kanpur Cables (del)', kind: 'supplier' });
  const verma = await a.post<It>('/parties', { name: 'Verma Traders (del)' });
  const pl = (it: It, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
  const doc = (body: object) => a.post<{ id: string; number: string }>('/purchases', { kind: 'bill', date: D, dueDate: D, partyId: kc.id, transport: '0', labour: '0', ...body });
  const pb1 = await doc({ lines: [pl(bulb, '20', '50')], payments: [{ mode: 'Cash', amount: '500', ref: '' }] });
  const pb2 = await doc({ lines: [pl(board, '5', '200')] });
  const dn = await doc({ kind: 'debit_note', againstId: pb2.id, lines: [pl(board, '1', '200')] });
  const po = await a.post<{ id: string; number: string }>('/payments-made', { partyId: kc.id, date: D, amount: '300', mode: 'Cash', ref: '', allocations: [{ to: pb2.id, amount: '300' }] });
  const inv = await a.post<{ id: string; number: string }>('/sales', { date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '3', price: '1890', discPct: '0', gstRate: '18' }, { itemId: bulb.id, name: bulb.name, qty: '5', price: '95', discPct: '0', gstRate: '18' }] });
  const cn = (itemId: string, qty: string, price: string) => a.post<{ id: string; number: string }>('/credit-notes', { partyId: verma.id, date: D, reason: 'Damaged goods', lines: [{ invoiceId: inv.id, itemId, qty, price, gstRate: '18' }] });
  const cn1 = await cn(bulb.id, '2', '95');
  const cn2 = await cn(fan.id, '1', '1890');
  // the returned fan is sold again: CN 2 can't be deleted
  await a.post('/sales', { date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] });
  const pi = await a.post<{ id: string; number: string }>('/receipts', { partyId: verma.id, date: D, amount: '1000', mode: 'Cash', allocations: [{ to: inv.id, amount: '1000' }] });
  const pay1 = (await a.get<{ number: string; atBill: boolean }[]>('/payments-made')).find((p) => p.atBill)!;
  return { a, kc, bulb, pb1, pb2, dn, po, pay1, cn1, cn2, pi };
}

/** Right-click the row and pick the last, red line of its menu. */
async function pick(page: Page, path: string, rows: string, ctx: string, number: string, action: string) {
  await page.goto(APP + path);
  const row = page.locator(`${rows}="${number}"]`);
  await row.waitFor();
  const b = (await row.boundingBox())!;
  await page.mouse.click(b.x + 200, b.y + 10, { button: 'right' });
  const line = page.locator(`${ctx} [data-sla="${action}"]`);
  await expect(line).toHaveClass('dz');
  // below View history, after a divider
  await expect(page.locator(`${ctx} hr + [data-sla="${action}"]`)).toHaveCount(1);
  await expect(page.locator(`${ctx} [data-sla="hist"] + hr`)).toHaveCount(1);
  return { row, line };
}

/** Confirm the open window, typing the passcode when it is asked. */
async function confirm(page: Page, pass?: string) {
  await page.click('#slmOk');
  if (pass) {
    await page.locator('#pcPin').waitFor();
    await page.fill('#pcPin', pass);
    await page.click('#pcGo');
  }
}

test('Purchase bills › Cancel with the passcode: gone from the list, the money paid stays as an advance; then that payment can be deleted', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const s = await books(request, who);
  await s.a.post('/settings/passcode/on', { passcode: PASS });
  await signInAs(page, who);

  // a payment made with a live bill: Delete is off, with the reason
  let m = await pick(page, '/payments-made', '#pxRows tr[data-pxno', '#pxCtx', s.pay1.number, 'del');
  await expect(m.line).toBeDisabled();
  await expect(m.line).toHaveAttribute('title', `Paid with ${s.pb1.number}. Delete the bill instead.`);
  await page.keyboard.press('Escape');

  m = await pick(page, '/purchase-bills', '#puRows tr[data-bno', '#puCtx', s.pb1.number, 'cancel');
  await expect(m.line).toHaveText('Cancel');
  await m.line.click();
  await expect(page.locator('#slm .mdl h3')).toHaveText(`Cancel ${s.pb1.number}?`);
  // (a new shop shows amounts without the ₹ symbol, Settings)
  await expect(page.locator('#slm')).toContainText('It is hidden from your lists but kept safely in your records. Nothing is erased. Its items go out of stock again, and 500.00 already paid on it stays with Kanpur Cables (del) as an advance.');
  await expect(page.locator('#slmOk')).toHaveText('Cancel bill');
  await page.click('#slmOk');
  await expect(page.locator('#pcT')).toHaveText(`Cancel ${s.pb1.number}?`);
  await page.fill('#pcPin', PASS);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText(`${s.pb1.number} cancelled`);
  await expect(m.row).toHaveCount(0);
  // opening 50, +20 on the bill, −5 sold, +2 returned, −20 when the bill went
  expect((await s.a.get<{ stock: string }>(`/items/${s.bulb.id}`)).stock).toBe('47.000');

  // its payment is now an advance and can be deleted
  m = await pick(page, '/payments-made', '#pxRows tr[data-pxno', '#pxCtx', s.pay1.number, 'del');
  await expect(m.row).toContainText('Advance');
  await m.line.click();
  await expect(page.locator('#slm .mdl h3')).toHaveText(`Delete ${s.pay1.number}?`);
  await confirm(page, PASS);
  await expect(page.locator('#toast')).toHaveText(`${s.pay1.number} deleted`);
  await expect(m.row).toHaveCount(0);
  expect((await s.a.get<{ balance: string }>(`/parties/${s.kc.id}`)).balance).toBe('-644.00'); // PB 2 1180 − DN 236 − 300 paid
});

test('Delete with the passcode off: debit note, payment made, credit note, payment received; refused when goods were sold since', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const s = await books(request, who);
  await signInAs(page, who);
  // to pay Kanpur Cables: PB 1 1180 − 500 paid with it, PB 2 1180 − DN 236 − 300 paid
  expect((await s.a.get<{ balance: string }>(`/parties/${s.kc.id}`)).balance).toBe('-1324.00');

  let m = await pick(page, '/debit-notes', '#dnRows tr[data-dnno', '#dnCtx', s.dn.number, 'del');
  await m.line.click();
  await expect(page.locator('#slm .mdl h3')).toHaveText(`Delete ${s.dn.number}?`);
  await expect(page.locator('#slm')).toContainText(`Its returned items come back into stock, and what it took off ${s.pb2.number} is owed to Kanpur Cables (del) again.`);
  await expect(page.locator('#slmOk')).toHaveText('Delete debit note');
  await confirm(page);
  await expect(page.locator('#toast')).toHaveText(`${s.dn.number} deleted`);
  await expect(m.row).toHaveCount(0);

  m = await pick(page, '/payments-made', '#pxRows tr[data-pxno', '#pxCtx', s.po.number, 'del');
  await m.line.click();
  await expect(page.locator('#slmOk')).toHaveText('Delete payment');
  await confirm(page);
  await expect(page.locator('#toast')).toHaveText(`${s.po.number} deleted`);
  await expect(m.row).toHaveCount(0);
  expect((await s.a.get<{ balance: string }>(`/parties/${s.kc.id}`)).balance).toBe('-1860.00');

  m = await pick(page, '/credit-notes', '#cnRows tr[data-cnno', '#cnCtx', s.cn1.number, 'del');
  await m.line.click();
  await expect(page.locator('#slmOk')).toHaveText('Delete credit note');
  await confirm(page);
  await expect(page.locator('#toast')).toHaveText(`${s.cn1.number} deleted`);
  await expect(m.row).toHaveCount(0);

  // the returned fan was sold again: refused with the reason, nothing changes
  m = await pick(page, '/credit-notes', '#cnRows tr[data-cnno', '#cnCtx', s.cn2.number, 'del');
  await m.line.click();
  await confirm(page);
  await expect(page.locator('#toast')).toHaveText(`Some of it has been sold since: taking ${s.cn2.number}’s “Ceiling fan (del)” out of stock again would make its stock negative.`);
  await page.keyboard.press('Escape');
  await expect(m.row).toBeVisible();

  m = await pick(page, '/payments-received', '#rcRows tr[data-rcno', '#rcCtx', s.pi.number, 'del');
  await m.line.click();
  await expect(page.locator('#slmOk')).toHaveText('Delete payment');
  await confirm(page);
  await expect(page.locator('#toast')).toHaveText(`${s.pi.number} deleted`);
  await expect(m.row).toHaveCount(0);
});
