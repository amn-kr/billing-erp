/**
 * Bank account chosen on a payment: with two banks, UPI / bank transfer / card show "Received in" /
 * "Paid from" (the default bank picked); the money lands in that bank's book. With one bank the
 * screens stay as they were. (The bank fixture: HDFC Bank, the default, and State Bank of India.)
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
// (this shop hides the ₹ sign: Settings › General)

const SBI = 'State Bank of India';
const pick = async (page: Page, sel: string, text: string) => { await page.fill(sel, text); await page.waitForTimeout(150); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); };
const choose = async (page: Page, sel: string, text: string) => {
  const v = await page.locator(`${sel} option`, { hasText: text }).first().getAttribute('value');
  await page.selectOption(sel, v!);
};
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

/** A bank's balance on its card and the rows of its book (Banking › Bank accounts). */
async function bank(page: Page, name: string) {
  await page.goto(APP + '/bank-accounts');
  await page.waitForSelector('#bkCards .bkc');
  await page.locator('#bkCards .bkc', { hasText: name }).click();
  await expect(page.locator('#bkCards .bkc.on')).toContainText(name);
  await page.waitForSelector('#bkRows tr');
  return { balance: num((await page.locator('#bkCards .bkc.on .bkb').textContent())!), rows: page.locator('#bkRows tr') };
}

async function shop(browser: Parameters<typeof newPage>[0], request: Parameters<typeof freshShop>[0], fixture = 'bank-shop') {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, fixture));
  return page;
}

test('payment in by UPI into State Bank of India: its book and balance go up, HDFC stays', async ({ browser, request }) => {
  const page = await shop(browser, request);
  const sbi0 = (await bank(page, SBI)).balance;
  const hdfc0 = (await bank(page, 'HDFC Bank')).balance;
  await page.goto(APP + '/payments-received');
  await page.click('#rcNew');
  await choose(page, '#rcParty', 'Mehta Electricals');
  // the customer's dues fill in the amount first; then the amount is typed
  await page.waitForSelector('#rcBills input[data-rca]');
  await expect(page.locator('#rcAmt')).not.toHaveValue('');
  await page.fill('#rcAmt', '1234');
  await page.locator('#rcAmt').dispatchEvent('input');
  await page.selectOption('#rcModeI', 'UPI');
  // the default bank is picked; cash and cheque have no bank to pick
  await expect(page.locator('#rcAcct option:checked')).toHaveText('HDFC Bank');
  await page.selectOption('#rcModeI', 'Cash');
  await expect(page.locator('#rcAcct')).toHaveCount(0);
  await page.selectOption('#rcModeI', 'Cheque');
  await expect(page.locator('#rcAcct')).toHaveCount(0);
  await page.selectOption('#rcModeI', 'UPI');
  await expect(page.locator('label[for="rcAcct"]')).toContainText('Received in');
  await choose(page, '#rcAcct', SBI);
  await page.fill('#rcRef', 'UPI 4411');
  await expect(page.locator('#rcAmt')).toHaveValue('1234');
  const no = (await page.locator('#rcNo').textContent())!;
  await page.click('#rcSave');
  await expect(page.locator('#rcm')).toBeHidden();

  const s = await bank(page, SBI);
  expect(s.balance).toBeCloseTo(sbi0 + 1234, 2);
  await expect(s.rows.filter({ hasText: no })).toContainText('1,234.00');
  expect((await bank(page, 'HDFC Bank')).balance).toBeCloseTo(hdfc0, 2);

  // editing it shows the bank, and moving it to HDFC moves the money
  await page.goto(APP + '/payments-received');
  await page.locator(`[data-slm="${no}"]`).click();
  await page.click('#rcCtx [data-sla="edit"]');
  await expect(page.locator('#rcT')).toHaveText('Edit payment');
  await expect(page.locator('#rcAcct option:checked')).toHaveText(SBI);
  await choose(page, '#rcAcct', 'HDFC Bank');
  await page.click('#rcSave');
  await expect(page.locator('#rcm')).toBeHidden();
  expect((await bank(page, SBI)).balance).toBeCloseTo(sbi0, 2);
  expect((await bank(page, 'HDFC Bank')).balance).toBeCloseTo(hdfc0 + 1234, 2);
});

test('payment out by bank transfer from State Bank of India', async ({ browser, request }) => {
  const page = await shop(browser, request);
  const sbi0 = (await bank(page, SBI)).balance;
  await page.goto(APP + '/payments-made');
  await page.click('#pxNew');
  await choose(page, '#pySup', 'Kanpur Cables');
  await page.fill('#pyAmt', '700');
  await page.locator('#pyAmt').dispatchEvent('input');
  await page.selectOption('#pyMode', 'Bank transfer');
  await expect(page.locator('label[for="pyAcct"]')).toContainText('Paid from');
  await choose(page, '#pyAcct', SBI);
  const no = (await page.locator('#pyNo').textContent())!;
  await page.click('#pySave');
  await expect(page.locator('#toast')).toHaveText('Payment Out saved successfully');
  const s = await bank(page, SBI);
  expect(s.balance).toBeCloseTo(sbi0 - 700, 2);
  await expect(s.rows.filter({ hasText: no })).toContainText('700.00');
});

test('a sale invoice paid part by UPI into SBI and part by card into HDFC', async ({ browser, request }) => {
  const page = await shop(browser, request);
  const sbi0 = (await bank(page, SBI)).balance;
  const hdfc0 = (await bank(page, 'HDFC Bank')).balance;
  await page.goto(APP + '/sales/new');
  await pick(page, '#siParty', 'Mehta');
  await page.locator('#qeItem').fill('LED bulb');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill('10');
  await page.locator('#qeQty').press('Control+Enter');
  await page.click('#siPayBtn');
  const amt = page.locator('#siPayC [data-pay="0"] [data-pk="amt"]');
  await amt.fill('100');
  await amt.dispatchEvent('input');
  // UPI is the first payment type: the bank line shows under it, the default bank picked
  await expect(page.locator('#siPayC [data-payacct="0"] [data-pk="acct"] option:checked')).toHaveText('Received in HDFC Bank');
  await choose(page, '#siPayC [data-payacct="0"] [data-pk="acct"]', SBI);
  await page.click('[data-payadd="si"]');
  await page.selectOption('#siPayC [data-pay="1"] [data-pk="mode"]', 'Card');
  const amt2 = page.locator('#siPayC [data-pay="1"] [data-pk="amt"]');
  await amt2.fill('50');
  await amt2.dispatchEvent('input');
  await expect(page.locator('#siPayC [data-payacct="1"] [data-pk="acct"] option:checked')).toHaveText('Received in HDFC Bank');
  // the bank line stays inside the payment window at 1366 px (no sideways scroll)
  const pop = await page.locator('#siPayPop').boundingBox();
  const sel = await page.locator('#siPayC [data-payacct="0"] [data-pk="acct"]').boundingBox();
  expect(sel!.x + sel!.width).toBeLessThanOrEqual(pop!.x + pop!.width);
  await page.click('[data-paydone="si"]');
  const no = await page.locator('#siNo').inputValue();
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toHaveText('Invoice saved successfully');
  await page.keyboard.press('Escape');

  expect((await bank(page, SBI)).balance).toBeCloseTo(sbi0 + 100, 2);
  expect((await bank(page, 'HDFC Bank')).balance).toBeCloseTo(hdfc0 + 50, 2);
  // the money taken on the invoice is a receipt (PI-…) in each bank's book
  await expect((await bank(page, SBI)).rows.filter({ hasText: 'Mehta Electricals' }).filter({ hasText: '100.00' })).toHaveCount(1);
  await expect((await bank(page, 'HDFC Bank')).rows.filter({ hasText: 'Mehta Electricals' }).filter({ hasText: '50.00' })).toHaveCount(1);
  void no;
});

test('a purchase bill paid by UPI from SBI', async ({ browser, request }) => {
  const page = await shop(browser, request);
  const sbi0 = (await bank(page, SBI)).balance;
  await page.goto(APP + '/purchases/new?kind=bill');
  await pick(page, '#peParty', 'Kanpur');
  await pick(page, '#peRows tr[data-ln="0"] .pe-item', 'LED bulb');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '10');
  await page.click('#pePayBtn');
  await page.locator('#pePayC [data-pk="amt"]').fill('300');
  await page.selectOption('#pePayC [data-pk="mode"]', 'UPI');
  await expect(page.locator('#pePayC [data-payacct="0"] [data-pk="acct"] option:checked')).toHaveText('Paid from HDFC Bank');
  await choose(page, '#pePayC [data-payacct="0"] [data-pk="acct"]', SBI);
  // cash: no bank line
  await page.click('[data-payadd="pe"]');
  await page.selectOption('#pePayC [data-pay="1"] [data-pk="mode"]', 'Cash');
  await expect(page.locator('#pePayC [data-payacct="1"]')).toHaveCount(0);
  await page.click('#pePayC [data-payrm="1"]');
  await page.click('[data-paydone="pe"]');
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText('Purchase Bill saved successfully');
  expect((await bank(page, SBI)).balance).toBeCloseTo(sbi0 - 300, 2);
});

test('with only one bank account the payment screens look as before (no bank drop-down)', async ({ browser, request }) => {
  const page = await shop(browser, request, 'purchase-shop');
  await page.goto(APP + '/bank-accounts');
  await page.click('#bkAdd');
  await page.fill('#bamName', 'ICICI Bank');
  await page.click('#bamSave');
  await expect(page.locator('#bkCards .bkc', { hasText: 'ICICI Bank' })).toHaveCount(1);
  await page.goto(APP + '/payments-received');
  await page.click('#rcNew');
  await page.selectOption('#rcModeI', 'UPI');
  await expect(page.locator('#rcAcct')).toHaveCount(0);
  await page.goto(APP + '/payments-made');
  await page.click('#pxNew');
  await page.selectOption('#pyMode', 'Bank transfer');
  await expect(page.locator('#pyAcct')).toHaveCount(0);
  await page.goto(APP + '/purchases/new?kind=bill');
  await page.click('#pePayBtn');
  await page.selectOption('#pePayC [data-pk="mode"]', 'UPI');
  await expect(page.locator('#pePayC [data-payacct]')).toHaveCount(0);
});

/** Signed-in API calls for the shop (to make a walk-in sale quickly). */
async function api(request: APIRequestContext, who: { email: string; password: string }) {
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

test('a walk-in invoice whose UPI payment is ticked in Reconciliation can’t be cancelled until it is unticked', async ({ browser, request }) => {
  const who = await freshShop(request, 'bank-shop');
  const a = await api(request, who);
  const sbi = (await a.get<{ id: string; name: string }[]>('/banking/accounts')).find((x) => x.name === SBI)!;
  const bulb = (await a.get<{ id: string; name: string }[]>('/items')).find((x) => x.name.startsWith('LED bulb'))!;
  const inv = await a.post<{ id: string; number: string; total: string }>('/sales', {
    mode: 'cash', cashName: 'Counter customer', date: '2026-10-01', lines: [{ itemId: bulb.id, name: bulb.name, qty: '1', price: '95', discPct: '0', gstRate: '12' }],
    payments: [{ mode: 'UPI', amount: '95', ref: 'UPI 5501', accountId: sbi.id }],
  });
  const page = await newPage(browser, 1366);
  await signInAs(page, who);

  // tick the sale's money on the SBI statement
  await page.goto(APP + '/reconciliation');
  await page.waitForSelector('#bkrRows');
  await page.selectOption('#bkrAcct', sbi.id);
  await expect(page.locator('#bkrRows tr', { hasText: 'Quarterly interest' })).toHaveCount(1);
  await page.fill('#bkrAsOf', '2026-10-01');
  await expect(page.locator('#bkrAsOf')).toHaveValue('2026-10-01');
  const row = page.locator('#bkrRows tr', { hasText: 'Counter customer' });
  await row.locator('.bkrcb').check();
  await expect(row.locator('.bkrcb')).toBeChecked();
  await page.waitForTimeout(400);

  // cancelling the invoice is refused with the plain message; it stays live
  const cancel = async () => {
    await page.goto(APP + '/sales');
    const r = page.locator(`#slRows tr[data-sno="${inv.number}"]`);
    const b = (await r.boundingBox())!;
    await page.mouse.click(b.x + 200, b.y + 10, { button: 'right' });
    await page.click('#slCtx [data-sla="cancel"]');
    await page.click('#slmOk');
    return r;
  };
  let r = await cancel();
  await expect(page.locator('#toast')).toContainText('This entry is ticked in Reconciliation for State Bank of India. Untick it there first, then change it.');
  await expect(r).not.toContainText('Cancelled');
  expect((await bank(page, SBI)).balance).toBeGreaterThan(0);
  await expect((await bank(page, SBI)).rows.filter({ hasText: 'Counter customer' })).toHaveCount(1);

  // unticked, it cancels and the money goes back out of SBI
  await page.goto(APP + '/reconciliation');
  await page.waitForSelector('#bkrRows');
  await page.selectOption('#bkrAcct', sbi.id);
  await expect(page.locator('#bkrRows tr', { hasText: 'Quarterly interest' })).toHaveCount(1);
  await page.fill('#bkrAsOf', '2026-10-01');
  await expect(page.locator('#bkrAsOf')).toHaveValue('2026-10-01');
  await row.locator('.bkrcb').uncheck();
  await expect(row.locator('.bkrcb')).not.toBeChecked();
  await page.waitForTimeout(400);
  const sbi0 = (await bank(page, SBI)).balance;
  r = await cancel();
  await expect(page.locator('#toast')).toHaveText(`${inv.number} cancelled`);
  await expect(r).toContainText('Cancelled');
  expect((await bank(page, SBI)).balance).toBeCloseTo(sbi0 - Number(inv.total), 2);
});
