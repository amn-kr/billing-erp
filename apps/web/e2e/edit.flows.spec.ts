/**
 * Edit for saved sales-side documents (group 1), against the real API: the row actions menu opens
 * from the ⋮ button and by right-click on every list; Edit opens the window the document was made
 * in, filled in; saving asks for the passcode when it is on (a wrong one is refused). Stock and the
 * party balance follow the edit. Right-click on empty space opens nothing. Made-up passcodes only.
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

/** A fan and bulbs in stock, a customer, an invoice, a payment against it, a credit note, a challan and a quotation. */
async function books(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const fan = await a.post<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm (edit)', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingDate: D });
  const bulb = await a.post<{ id: string; name: string }>('/items', { name: 'LED bulb 9W (edit)', sale: '95', purchase: '62', gstRate: 18, openingQty: '200', openingDate: D });
  const verma = await a.post<{ id: string; name: string }>('/parties', { name: 'Verma Traders (edit)', openingBalance: '1000', openingDate: D });
  const ln = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
  const inv = await a.post<{ id: string; number: string }>('/sales', { date: D, dueDate: D, partyId: verma.id, lines: [ln(fan, '3', '1890'), ln(bulb, '10', '95')] });
  const pay = await a.post<{ id: string; number: string }>('/receipts', { partyId: verma.id, date: D, amount: '2000', mode: 'Cash', ref: '', allocations: [{ to: inv.id, amount: '2000' }] });
  const cn = await a.post<{ id: string; number: string }>('/credit-notes', { partyId: verma.id, date: D, reason: 'Damaged goods', settle: 'adjust', refundMode: 'Cash', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '1', price: '1890', gstRate: '18' }] });
  const dc = await a.post<{ id: string; number: string }>('/challans', { partyId: verma.id, cashName: '', cashPhone: '', date: D, lines: [{ itemId: bulb.id, qty: '5' }], transport: 'Self', vehicle: '', note: '' });
  const qt = await a.post<{ id: string; number: string }>('/sales', { kind: 'quotation', date: D, partyId: verma.id, lines: [ln(fan, '2', '1890')] });
  const look = async () => ({ fan: (await a.get<{ stock: string }>(`/items/${fan.id}`)).stock, balance: (await a.get<{ balance: string }>(`/parties/${verma.id}`)).balance });
  return { a, inv, pay, cn, dc, qt, look };
}

/** Opens a row's menu with its ⋮ button, closes it with Esc, then opens it again by right-click. */
async function bothWays(page: Page, rows: string, menu: string, no: string) {
  const row = page.locator(rows).filter({ has: page.locator(`[data-slm="${no}"]`) });
  await row.locator('[data-slm]').click();
  await expect(page.locator(menu)).toBeVisible();
  await expect(page.locator(`${menu} .cmh b`)).toHaveText(no);
  await expect(page.locator(`${menu} button`).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  const b = (await row.locator('td').first().boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + 10, { button: 'right' });
  await expect(page.locator(menu)).toBeVisible();
  await expect(row).toHaveClass(/ctxon/);
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  // keyboard: focus the ⋮ button, Enter opens the menu, arrows move
  await row.locator('[data-slm]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(menu)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`${menu} button:not([disabled])`).nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
}

/** Types the passcode in the box and presses its button. */
async function passcode(page: Page, code: string) {
  await page.locator('#pcm input').first().fill(code);
  await page.keyboard.press('Enter');
}

test('every sales-side list opens the same actions menu from ⋮ and by right-click; right-click on empty space opens nothing', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/sales');
  await bothWays(page, '#slRows tr', '#slCtx', b.inv.number);
  await page.goto(APP + '/delivery-challans');
  await bothWays(page, '#dcRows tr', '#dcCtx', b.dc.number);
  await page.goto(APP + '/credit-notes');
  await bothWays(page, '#cnRows tr', '#cnCtx', b.cn.number);
  await page.goto(APP + '/payments-received');
  await bothWays(page, '#rcRows tr', '#rcCtx', b.pay.number);
  await page.goto(APP + '/quotations');
  await page.click('#qSaved');
  await bothWays(page, '#qlRows tr', '#qlCtx', b.qt.number);
  await page.keyboard.press('Escape');

  // right-click on empty space: no app menu, and the browser's own menu is stopped; in a text box it is kept
  await page.goto(APP + '/payments-received');
  await page.locator('#rcRows tr').first().waitFor();
  const stopped = (sel: string) => page.evaluate((s) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector(s)!.dispatchEvent(e); return e.defaultPrevented; }, sel);
  await page.mouse.click(900, 700, { button: 'right' });
  await expect(page.locator('.ctxm:not([hidden])')).toHaveCount(0);
  expect(await stopped('.pthd')).toBe(true);
  expect(await stopped('#rcRows td')).toBe(true);
  expect(await stopped('.sb, nav, aside')).toBe(true);
  expect(await stopped('#rcQ')).toBe(false);
});

test('Edit a payment, a credit note and a challan with the passcode: a wrong one is refused; balance and stock follow', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  const b = await books(request, who);
  await b.a.post('/settings/passcode/on', { passcode: PASS });
  const start = await b.look();
  await signInAs(page, who);

  // payment received: ₹2,000 → ₹2,500, the customer owes ₹500 less
  await page.goto(APP + '/payments-received');
  await page.locator(`[data-slm="${b.pay.number}"]`).click();
  await page.click('#rcCtx [data-sla="edit"]');
  await expect(page.locator('#rcT')).toHaveText('Edit payment');
  await expect(page.locator('#rcNo')).toHaveText(b.pay.number);
  await expect(page.locator('#rcAmt')).toHaveValue('2000');
  await page.fill('#rcAmt', '2500');
  await page.click('#rcSave');
  await passcode(page, '1111');
  await expect(page.locator('#pcm')).toContainText('Wrong passcode. 4 tries left.');
  expect((await b.look()).balance).toBe(start.balance);
  await passcode(page, PASS);
  await expect(page.locator('#rcm')).toBeHidden();
  await expect(page.locator(`#rcRows tr[data-rcno="${b.pay.number}"]`)).toContainText('2,500.00');
  const afterPay = await b.look();
  expect(Number(afterPay.balance)).toBe(Number(start.balance) - 500);

  // credit note: 1 fan back → 2 fans back; stock +1, the customer owes ₹1,890 less
  await page.goto(APP + '/credit-notes');
  const cnRow = page.locator(`#cnRows tr[data-cnno="${b.cn.number}"]`);
  const box = (await cnRow.locator('td').first().boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 10, { button: 'right' });
  await page.click('#cnCtx [data-sla="edit"]');
  await expect(page.locator('#cnT')).toHaveText('Edit credit note');
  await expect(page.locator('#cnRowsI [data-cnq]').first()).toHaveValue('1');
  await page.locator('#cnRowsI [data-cnq]').first().fill('2');
  await page.click('#cnSave');
  await passcode(page, PASS);
  await expect(page.locator('#cnm')).toBeHidden();
  await expect(cnRow).toContainText('3,780.00');
  const afterCn = await b.look();
  expect(Number(afterCn.fan)).toBe(Number(start.fan) + 1);
  expect(Number(afterCn.balance)).toBe(Number(afterPay.balance) - 1890);

  // challan: 5 bulbs → 7; stock and the balance don't move
  await page.goto(APP + '/delivery-challans');
  await page.locator(`[data-slm="${b.dc.number}"]`).click();
  await page.click('#dcCtx [data-sla="edit"]');
  await expect(page.locator('#dcT')).toHaveText('Edit delivery challan');
  await page.locator('#dcRowsI [data-dcq]').first().fill('7');
  await page.click('#dcSave');
  await passcode(page, PASS);
  await expect(page.locator('#dcm')).toBeHidden();
  await expect(page.locator(`#dcRows tr[data-dcno="${b.dc.number}"]`)).toContainText('7');
  expect(await b.look()).toEqual(afterCn);
});

test('with the passcode off an edit saves straight away; a cancelled document’s Edit is off with the reason', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  const b = await books(request, who);
  await b.a.post(`/sales/${b.dc.id}/cancel`, {});
  await signInAs(page, who);
  await page.goto(APP + '/payments-received');
  await page.locator(`[data-slm="${b.pay.number}"]`).click();
  await page.click('#rcCtx [data-sla="edit"]');
  await expect(page.locator('#rcAmt')).toHaveValue('2000');
  await page.fill('#rcAmt', '1500');
  await page.click('#rcSave');
  await expect(page.locator('#rcm')).toBeHidden();
  await expect(page.locator('#pcm')).toBeHidden();
  await expect(page.locator(`#rcRows tr[data-rcno="${b.pay.number}"]`)).toContainText('1,500.00');
  await page.goto(APP + '/delivery-challans');
  await page.locator(`[data-slm="${b.dc.number}"]`).click();
  await expect(page.locator('#dcCtx [data-sla="edit"]')).toBeDisabled();
  await expect(page.locator('#dcCtx [data-sla="edit"]')).toHaveAttribute('title', 'Cancelled document');
  await page.keyboard.press('Escape');

  // an invoice opened for editing shows its number read-only; a new one can still be typed
  await page.goto(APP + `/sales/new?edit=${b.inv.id}`);
  await expect(page.locator('#siNo')).toHaveValue(b.inv.number);
  await expect(page.locator('#siNo')).toHaveAttribute('readonly', '');
  await page.locator('#siNo').press('End');
  await page.keyboard.type('9');
  await expect(page.locator('#siNo')).toHaveValue(b.inv.number);
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#siNo')).not.toHaveAttribute('readonly', '');
});
