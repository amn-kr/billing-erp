/** Phase 3 purchase flows against the real API, in a shop of their own (the purchase fixture imported). */
import { expect, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

async function open(browser: Parameters<typeof newPage>[0], request: Parameters<typeof freshShop>[0], path: string, ready: string) {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'purchase-shop'));
  await page.goto(APP + path);
  await page.waitForSelector(ready);
  return page;
}
const pick = async (page: Page, sel: string, text: string) => { await page.fill(sel, text); await page.waitForTimeout(150); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); };
// (this shop hides the ₹ sign: Settings › General)

test('a purchase bill: last rates from the supplier, a new rate updates the item, part paid, stock added', async ({ browser, request }) => {
  const page = await open(browser, request, '/purchase-bills', '#puRows tr[data-bno]');
  await page.click('#vPur [data-pnew="bill"]');
  await expect(page.locator('#peNo')).toHaveValue('PB-0003');
  await pick(page, '#peParty', 'Kanpur');
  await expect(page.locator('#peParty_ .sipi')).toContainText('30-day credit');
  await expect(page.locator('#peDue')).toHaveValue('2026-10-31');
  await pick(page, '#peRows tr[data-ln="0"] .pe-item', 'LED bulb');
  await expect(page.locator('#peRows tr[data-ln="0"] small')).toHaveText('Stock 324 PCS → 325');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '10');
  // the rate box shows this supplier's last rates; one click uses a rate
  await page.click('#peRows tr[data-ln="0"] [data-pf="rate"]');
  await expect(page.locator('#phPop .phh')).toContainText('Purchase rates · last 2');
  await expect(page.locator('#phPop tbody tr')).toHaveCount(2);
  await page.click('#phPop tr[data-phuse="0"]');
  await expect(page.locator('#phPop')).toHaveCount(0);
  await page.fill('#peRows tr[data-ln="0"] [data-pf="rate"]', '60');
  await expect(page.locator('#peTot')).toContainText('Update purchase price in Items (1 change)');
  await expect(page.locator('#peTot .pechl')).toContainText('LED bulb 9W: 58.00 → 60.00');
  // 10 × 60 = 600 + GST 12% = 672
  await expect(page.locator('#peTot .tt b')).toHaveText('672.00');
  await page.click('#pePayBtn');
  await page.locator('#pePayC [data-pk="amt"]').fill('500');
  await page.selectOption('#pePayC [data-pk="mode"]', 'UPI');
  await page.click('[data-paydone="pe"]');
  await expect(page.locator('#pePayBtnTx')).toContainText('Inv Dues172.00');
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText('PB-0003 saved · stock added · 1 purchase price updated');
  await expect(page).toHaveURL(/\/purchase-bills$/);
  const row = page.locator('#puRows tr[data-bno="PB-0003"]');
  await expect(row).toContainText('672.00');
  await expect(row.locator('td').nth(5)).toHaveText('500.00');
  await expect(row.locator('.stt')).toHaveText('Partly paid');
  // the bill shows its payment
  await row.locator('td').first().click();
  await expect(page.locator('#pvm .pvpay')).toContainText('PO-0003 · UPI · 500.00');
  await page.keyboard.press('Escape');
  await page.goto(APP + '/payments-made');
  await expect(page.locator('#pxRows tr').first()).toContainText('PO-0003');
});

test('mistakes are caught before saving, and leaving with something entered asks first', async ({ browser, request }) => {
  const page = await open(browser, request, '/purchase-bills', '#puRows tr[data-bno]');
  await page.keyboard.press('Alt+P');
  await expect(page).toHaveURL(/\/purchases\/new\?kind=bill/);
  await page.waitForSelector('#peNo[value="PB-0003"]');
  await page.click('#peSave');
  await expect(page.locator('#peErr')).toHaveText('Choose the supplier.');
  await pick(page, '#peParty', 'Kanpur');
  await page.click('#peSave');
  await expect(page.locator('#peErr')).toHaveText('Add at least one item.');
  await page.fill('#peRows tr[data-ln="0"] .pe-item', 'Mystery cable');
  await page.keyboard.press('Escape');
  await page.click('#peSave');
  await expect(page.locator('#peErr')).toHaveText('“Mystery cable” isn’t in your items. Pick it from the list or add it as a new item.');
  await page.click('#peBack');
  await expect(page.locator('#dcfT')).toHaveText('Discard this purchase bill?');
  await page.click('#dcfYes');
  await expect(page).toHaveURL(/\/purchase-bills$/);
  await expect(page.locator('#puRows tr[data-bno]')).toHaveCount(2);
});

test('a purchase order becomes a bill; another open order is cancelled with two clicks', async ({ browser, request }) => {
  const page = await open(browser, request, '/purchase-orders', '#poRows tr[data-pono]');
  // a new order changes no stock
  await page.click('#vPos [data-pnew="po"]');
  await expect(page.locator('#peTitle')).toHaveText('Purchase order');
  await pick(page, '#peParty', 'Kanpur');
  await pick(page, '#peRows tr[data-ln="0"] .pe-item', 'Copper wire');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '5');
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText('ORD-0003 saved · sent to Kanpur Cables Pvt Ltd');
  await expect(page.locator('#poSum')).toContainText('Open orders2');

  await page.click('#poRows [data-poconv="ORD-0002"]');
  await expect(page.locator('#toast')).toHaveText('Lines copied from ORD-0002. Check rates and quantities received.');
  await expect(page.locator('#peRows tr[data-ln="0"] .pe-item')).toHaveValue('MCB 32A double pole');
  await expect(page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]')).toHaveValue('20');
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText(/^PB-0003 saved · stock added/);
  await page.goto(APP + '/purchase-orders');
  const conv = page.locator('#poRows tr[data-pono="ORD-0002"]');
  await expect(conv.locator('.stt')).toHaveText('Received');
  await expect(conv).toContainText('PB-0003');

  const c = page.locator('#poRows [data-pocancel="ORD-0003"]');
  await c.click();
  await expect(c).toHaveText('Click again to cancel');
  await c.click();
  await expect(page.locator('#toast')).toHaveText('ORD-0003 cancelled');
  await expect(page.locator('#poRows tr[data-pono="ORD-0003"] .stt')).toHaveText('Cancelled');
});

test('paying a bill from its row, and returning goods against it', async ({ browser, request }) => {
  const page = await open(browser, request, '/purchase-bills', '#puRows tr[data-bno]');
  await page.click('#puRows [data-paybill="PB-0002"]');
  await expect(page.locator('#pyAmt')).toHaveValue('3248');
  await expect(page.locator('#pyBills input[data-pya="PB-0002"]')).toHaveValue('3248');
  await page.fill('#pyRef', 'NEFT 5521');
  await page.click('#pySave');
  await expect(page.locator('#toast')).toHaveText('PO-0003 · 3,248.00 paid to Kanpur Cables Pvt Ltd');
  await expect(page.locator('#puRows tr[data-bno="PB-0002"] .stt')).toHaveText('Paid');

  await page.locator('#puRows tr[data-bno="PB-0001"] td').first().click();
  await page.click('#pvm [data-dnfor="PB-0001"]');
  await expect(page.locator('#peTitle')).toHaveText('Debit note');
  await expect(page.locator('#peAgainst option:checked')).toContainText('PB-0001');
  await expect(page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]')).toHaveValue('1');
  await page.click('#peSave');
  await expect(page.locator('#toast')).toHaveText('DN-0002 saved · stock reduced');
  await expect(page).toHaveURL(/\/debit-notes$/);
  await expect(page.locator('#dnRows tr[data-dnno="DN-0002"]')).toContainText('PB-0001');
});
