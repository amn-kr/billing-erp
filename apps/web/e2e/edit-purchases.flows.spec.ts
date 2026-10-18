/**
 * Edit for saved purchase-side documents (group 2), against the real API: the row actions menu opens
 * from the ⋮ button and by right-click on the purchase bills, purchase orders, payments made and debit
 * notes lists; Edit opens the screen the document was made in, filled in, with our own number locked;
 * saving asks for the passcode when it is on (a wrong one is refused). Stock and the supplier balance
 * follow the edit. Made-up passcodes only.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
const D = '2026-10-01';
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

/** Bulbs and wire, a supplier, a bill paid in part with it, a payment made against a second bill, an order turned into a bill, an open order and a debit note. */
async function books(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const bulb = await a.post<{ id: string; name: string }>('/items', { name: 'LED bulb 9W (edit)', sale: '95', purchase: '62', gstRate: 18, openingQty: '20', openingDate: D });
  const wire = await a.post<{ id: string; name: string }>('/items', { name: 'Copper wire 1.5 sq mm (edit)', sale: '1890', purchase: '1500', gstRate: 18, openingDate: D });
  const kc = await a.post<{ id: string; name: string }>('/parties', { name: 'Kanpur Cables (edit)', kind: 'supplier', gstin: '09AAACK1234L1Z5', creditDays: 30 });
  const ln = (it: { id: string; name: string }, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
  const bill = await a.post<{ id: string; number: string }>('/purchases', { kind: 'bill', date: D, dueDate: '2026-10-31', partyId: kc.id, supplierRef: 'KC/2209', lines: [ln(bulb, '100', '58')], payments: [{ mode: 'Cash', amount: '1000', ref: '' }] });
  const bill2 = await a.post<{ id: string; number: string }>('/purchases', { kind: 'bill', date: D, dueDate: '2026-10-31', partyId: kc.id, lines: [ln(wire, '2', '1450')] });
  const pay = await a.post<{ id: string; number: string }>('/payments-made', { partyId: kc.id, date: D, amount: '2000', mode: 'Bank transfer', ref: 'UTR 1', allocations: [{ to: bill2.id, amount: '2000' }] });
  const po = await a.post<{ id: string; number: string }>('/purchases', { kind: 'order', date: D, partyId: kc.id, lines: [ln(wire, '1', '1450')] });
  await a.post('/purchases', { kind: 'bill', date: D, dueDate: '2026-10-31', partyId: kc.id, fromOrderId: po.id, lines: [ln(wire, '1', '1450')] });
  const po2 = await a.post<{ id: string; number: string }>('/purchases', { kind: 'order', date: D, partyId: kc.id, lines: [ln(bulb, '50', '58')] });
  const dn = await a.post<{ id: string; number: string }>('/purchases', { kind: 'debit_note', date: D, partyId: kc.id, againstId: bill.id, reason: 'Damaged goods', lines: [ln(bulb, '5', '58')] });
  const look = async () => ({ bulb: (await a.get<{ stock: string }>(`/items/${bulb.id}`)).stock, balance: (await a.get<{ balance: string }>(`/parties/${kc.id}`)).balance });
  return { a, bill, bill2, pay, po, po2, dn, look };
}

/** Opens a row's menu with its ⋮ button, closes it with Esc, then opens it again by right-click and from the keyboard. */
async function bothWays(page: Page, rows: string, menu: string, no: string) {
  const row = page.locator(rows).filter({ has: page.locator(`[data-slm="${no}"]`) });
  await row.locator('[data-slm]').click();
  await expect(page.locator(menu)).toBeVisible();
  await expect(page.locator(`${menu} .cmh b`)).toHaveText(no);
  await expect(page.locator(`${menu} button`).first()).toHaveText('Edit');
  await expect(page.locator(`${menu} button`).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  const b = (await row.locator('td').first().boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + 10, { button: 'right' });
  await expect(page.locator(menu)).toBeVisible();
  await expect(row).toHaveClass(/ctxon/);
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator(menu)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
}

/** Types the passcode in the box and presses its button. */
async function passcode(page: Page, code: string) {
  await page.locator('#pcm input').first().fill(code);
  await page.keyboard.press('Enter');
}

test('every purchase-side list opens the same actions menu from ⋮ and by right-click; the browser’s own menu stays off', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/purchase-bills');
  await bothWays(page, '#puRows tr', '#puCtx', b.bill.number);
  await page.goto(APP + '/purchase-orders');
  await bothWays(page, '#poRows tr', '#poCtx', b.po2.number);
  await page.goto(APP + '/payments-made');
  await bothWays(page, '#pxRows tr', '#pxCtx', b.pay.number);
  await page.goto(APP + '/debit-notes');
  await bothWays(page, '#dnRows tr', '#dnCtx', b.dn.number);

  // right-click elsewhere on these pages: the browser's own menu is stopped; in a text box it is kept
  const stopped = (sel: string) => page.evaluate((s) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector(s)!.dispatchEvent(e); return e.defaultPrevented; }, sel);
  expect(await stopped('.pthd')).toBe(true);
  expect(await stopped('#dnRows td')).toBe(true);
  expect(await stopped('#dnQ')).toBe(false);

  // an order already turned into a bill, and money paid with a bill: Edit is off, with the reason
  await page.goto(APP + '/purchase-orders');
  await page.locator(`[data-slm="${b.po.number}"]`).click();
  await expect(page.locator('#poCtx [data-sla="edit"]')).toBeDisabled();
  await expect(page.locator('#poCtx [data-sla="edit"]')).toHaveAttribute('title', /^Already turned into bill PB-\d{4}\. Edit the bill instead\.$/);
  await page.keyboard.press('Escape');
  await page.goto(APP + '/payments-made');
  const atBill = page.locator('#pxRows tr').filter({ hasText: b.bill.number });
  await atBill.locator('[data-slm]').click();
  await expect(page.locator('#pxCtx [data-sla="edit"]')).toBeDisabled();
  await expect(page.locator('#pxCtx [data-sla="edit"]')).toHaveAttribute('title', `Paid with ${b.bill.number}. Edit the bill instead.`);
});

test('Edit a purchase bill and a payment made with the passcode: a wrong one is refused; our number is locked; stock and the supplier balance follow', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await b.a.post('/settings/passcode/on', { passcode: PASS });
  const start = await b.look();
  await signInAs(page, who);

  // the bill: 100 bulbs → 80, the supplier's bill number corrected; our number can't be typed over
  await page.goto(APP + '/purchase-bills');
  await page.locator(`[data-slm="${b.bill.number}"]`).click();
  await page.click('#puCtx [data-sla="edit"]');
  await expect(page.locator('#peNo')).toHaveValue(b.bill.number);
  await expect(page.locator('#peNo')).toHaveAttribute('readonly', '');
  await page.locator('#peNo').press('End');
  await page.keyboard.type('9');
  await expect(page.locator('#peNo')).toHaveValue(b.bill.number);
  await expect(page.locator('#peRef')).toHaveValue('KC/2209');
  await page.fill('#peRef', 'KC/2209-A');
  const qty = page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]');
  await expect(qty).toHaveValue('100');
  await qty.fill('80');
  await page.click('#peSave');
  await passcode(page, '1111');
  await expect(page.locator('#pcm')).toContainText('Wrong passcode. 4 tries left.');
  expect(await b.look()).toEqual(start);
  await passcode(page, PASS);
  await expect(page).toHaveURL(/\/purchase-bills$/);
  const row = page.locator(`#puRows tr[data-bno="${b.bill.number}"]`);
  await expect(row).toContainText('KC/2209-A');
  await expect(row).toContainText('5,475.00'); // 80 × 58 + 18%, rounded
  const afterBill = await b.look();
  expect(Number(afterBill.bulb)).toBe(Number(start.bulb) - 20);
  expect(Number(afterBill.balance)).toBe(Number(start.balance) + 1369); // 6844 → 5475: ₹1,369 less to pay

  // the payment made: ₹2,000 → ₹2,500 on the same bill, opened by right-click
  await page.goto(APP + '/payments-made');
  const pr = page.locator(`#pxRows tr[data-pxno="${b.pay.number}"]`);
  const box = (await pr.locator('td').first().boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 10, { button: 'right' });
  await page.click('#pxCtx [data-sla="edit"]');
  await expect(page.locator('#pyT')).toHaveText('Edit payment made');
  await expect(page.locator('#pyNo')).toHaveText(b.pay.number);
  await expect(page.locator('#pyAmt')).toHaveValue('2000');
  await page.fill('#pyAmt', '2500');
  await page.click('#pySave');
  await passcode(page, PASS);
  await expect(page.locator('#ppm')).toBeHidden();
  await expect(pr).toContainText('2,500.00');
  expect(Number((await b.look()).balance)).toBe(Number(afterBill.balance) + 500);
});

test('with the passcode off an edit saves straight away; a bill can’t go below what is already paid', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  // the second bill (₹3,422) has ₹2,000 paid by a payment made: 1 wire (₹1,711) is too little
  await page.goto(APP + `/purchases/new?edit=${b.bill2.id}`);
  const qty = page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]');
  await expect(qty).toHaveValue('2');
  await qty.fill('1');
  await page.click('#peSave');
  // (the ₹ sign shows only when the shop has the currency symbol switched on)
  await expect(page.locator('#peErr')).toHaveText(new RegExp(`^₹?2,000\\.00 is already paid on ${b.bill2.number} \\(${b.pay.number}\\)\\. The bill total can’t be less than that\\. Change those payments or debit notes first\\.$`));
  await expect(page.locator('#pcm')).toBeHidden();
  await qty.fill('3');
  await page.click('#peSave');
  await expect(page).toHaveURL(/\/purchase-bills$/);
  await expect(page.locator(`#puRows tr[data-bno="${b.bill2.number}"]`)).toContainText('5,133.00');

  // the open order: 50 bulbs → 60, no stock change
  const before = await b.look();
  await page.goto(APP + '/purchase-orders');
  await page.locator(`[data-slm="${b.po2.number}"]`).click();
  await page.click('#poCtx [data-sla="edit"]');
  await expect(page.locator('#peNo')).toHaveValue(b.po2.number);
  await page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]').fill('60');
  await page.click('#peSave');
  await expect(page).toHaveURL(/\/purchase-orders$/);
  await expect(page.locator(`#poRows tr[data-pono="${b.po2.number}"]`)).toContainText('4,106.00'); // 60 × 58 + 18%, rounded
  expect(await b.look()).toEqual(before);
});
