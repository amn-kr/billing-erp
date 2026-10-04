/** Phase 3 sales flows against the real API, in a shop of their own (the sales fixture imported). */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

test('a credit sale made in the invoice editor is saved, previewed, and opens again from its row', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/sales');
  await page.waitForSelector('#slRows tr[data-sno]');
  await page.click('#vSales .pthd .btn.p');
  await expect(page).toHaveURL(/\/sales\/new/);
  const no = await page.locator('#siNo').inputValue();

  await page.fill('#siParty', 'Mehta');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeItem').fill('LED bulb');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill('10');
  await page.locator('#qeQty').press('Control+Enter');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/LED bulb/);

  // a part payment by UPI
  await page.click('#siPayBtn');
  await page.locator('#siPayC [data-pk="amt"]').fill('100');
  await page.locator('#siPayC [data-pk="amt"]').dispatchEvent('input');
  await page.click('[data-paydone="si"]');

  await page.click('#siSave');
  // first save asks to check discount & charges, as in the prototype
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  // (this shop hides the ₹ sign: Settings › General)
  await expect(page.locator('#toast')).toHaveText(`${no} saved · 870.00 · 770.00 due`);
  await expect(page).toHaveURL(/\/sales$/);
  // the saved invoice opens in the preview straight away
  await expect(page.locator('#ipv:not([hidden]) .mdl')).toContainText(no);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ipv')).toBeHidden();

  // a plain click on its row opens the preview again
  const row = page.locator(`#slRows tr[data-sno="${no}"]`);
  await expect(row).toContainText('Mehta Electricals');
  await row.click();
  await expect(page.locator('#ipv:not([hidden]) .mdl')).toContainText(no);
});

test('the home screen’s New invoice button opens the invoice editor', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.click('#heroActs button.p');
  await expect(page).toHaveURL(/\/sales\/new/);
  await expect(page.locator('#vNewInv #siRows tr[data-ln]')).toHaveCount(1);
});

/* ---------- several open bills (tabs): the owner's four rules ---------- */
type P = import('@playwright/test').Page;
const tabs = (page: P) => page.locator('#siTabs .bttab');
async function openEditor(page: P, request: import('@playwright/test').APIRequestContext) {
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#vNewInv #siRows tr[data-ln]')).toHaveCount(1);
}
async function fill(page: P, party: string, item: string, qty: string) {
  await page.fill('#siParty', party);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeItem').fill(item);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill(qty);
  await page.locator('#qeQty').press('Control+Enter');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(new RegExp(item));
}
async function newTab(page: P, n: number) {
  await page.click('#siTabNew');
  await expect(tabs(page)).toHaveCount(n);
  await expect(page.locator('#siParty')).toHaveValue('');
}
const closeTab = (page: P, label: string) => page.locator('#siTabs .bttab', { hasText: label }).locator('.sitx').click();

test('bill tabs, rule 1: closing the last tab just closes it — no new bill, no number used', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await openEditor(page, request);
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siNo')).toHaveValue('INV-0107');
  await closeTab(page, 'New bill');
  // an empty bill closes without a question, and the editor goes away
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.locator('#dcf')).toBeHidden();
  await expect(page.locator('#vNewInv')).toHaveCount(0);
  await expect(page.locator('#slRows tr[data-sno="INV-0107"]')).toHaveCount(0);
  // the next bill still gets the same number: nothing was used up
  await page.click('#vSales .pthd .btn.p');
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siNo')).toHaveValue('INV-0107');
});

test('bill tabs, rule 2: closing a tab never changes or overwrites another open bill', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await openEditor(page, request);
  await fill(page, 'Mehta', 'LED bulb', '10');
  await newTab(page, 2);
  await fill(page, 'Raju', 'Copper wire', '3');
  await newTab(page, 3);
  // close the Raju bill while the third (empty) bill is showing
  await closeTab(page, 'Raju Electrician');
  await page.click('#dcfYes');
  await expect(tabs(page)).toHaveCount(2);
  // close the showing (empty) bill: the Mehta bill is shown, exactly as it was
  await closeTab(page, 'New bill');
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siTabs .bttab.on')).toContainText('Mehta Electricals');
  await expect(page.locator('#siParty')).toHaveValue('Mehta Electricals');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/LED bulb/);
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="qty"]')).toHaveValue('10');
  await expect(page.locator('#siRows tr[data-ln]')).toHaveCount(2); // the item and the empty row
});

test('bill tabs, rule 3: a sale number is used only when the bill is saved', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await openEditor(page, request);
  await fill(page, 'Mehta', 'LED bulb', '10');
  await newTab(page, 2);
  await fill(page, 'Raju', 'Copper wire', '1');
  // both unsaved bills show the next number; neither has taken it
  await expect(page.locator('#siNo')).toHaveValue('INV-0107');
  await page.locator('#siTabs .bttab', { hasText: 'Mehta' }).locator('.sitb').click();
  await expect(page.locator('#siParty')).toHaveValue('Mehta Electricals');
  await expect(page.locator('#siNo')).toHaveValue('INV-0107');
  // save the second bill first: it gets INV-0107, the Mehta bill moves on to INV-0108
  await page.locator('#siTabs .bttab', { hasText: 'Raju' }).locator('.sitb').click();
  await expect(page.locator('#siParty')).toHaveValue('Raju Electrician');
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toContainText('INV-0107 saved');
  // other bills are still open, so the saved one is shown over the editor
  await expect(page.locator('#ipv:not([hidden]) .mdl')).toContainText('INV-0107');
  await page.keyboard.press('Escape');
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siTabs .bttab.on')).toContainText('Mehta Electricals');
  await expect(page.locator('#siNo')).toHaveValue('INV-0108');
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
  await expect(page.locator('#toast')).toContainText('INV-0108 saved');
  await expect(page).toHaveURL(/\/sales$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#slRows tr[data-sno="INV-0107"]')).toContainText('Raju Electrician');
  await expect(page.locator('#slRows tr[data-sno="INV-0108"]')).toContainText('Mehta Electricals');
});

test('bill tabs, rule 4: closing a tab with unsaved changes asks “Discard this bill?” first', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await openEditor(page, request);
  await fill(page, 'Mehta', 'LED bulb', '10');
  await newTab(page, 2);
  await closeTab(page, 'Mehta Electricals');
  await expect(page.locator('#dcf')).toBeVisible();
  await expect(page.locator('#dcfT')).toHaveText('Discard this bill?');
  // keep editing: nothing is closed
  await page.click('#dcfNo');
  await expect(tabs(page)).toHaveCount(2);
  await closeTab(page, 'Mehta Electricals');
  await page.click('#dcfYes');
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siTabs .bttab')).toContainText('New bill');
});

test('bill tabs: “New invoice” from the side menu while in the editor opens another bill (or the empty one)', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await openEditor(page, request);
  await fill(page, 'Mehta', 'LED bulb', '10');
  await page.keyboard.press('Alt+s');
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator('#siTabs .bttab.on')).toContainText('New bill');
  // again: the empty bill is already open, so it is reused
  await page.keyboard.press('Alt+s');
  await expect(tabs(page)).toHaveCount(2);
});

test('Quick sale (Alt+N): a walk-in cash sale is saved as an invoice, and its number is used only then', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/sales');
  await page.waitForSelector('#slRows tr[data-sno]');
  await page.keyboard.press('Alt+n');
  await expect(page.locator('#qsNo')).toHaveText('INV-0107');
  // closing without saving uses nothing up
  await page.click('#qsClose');
  await page.click('#qsBtn');
  await expect(page.locator('#qsNo')).toHaveText('INV-0107');
  await page.fill('#qsParty', 'Sunil');
  await page.locator('#qsRows .qs-item').first().fill('LED');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qsRows .qsq').first().fill('2');
  await page.click('#qsPay [data-qspay="UPI"]');
  await page.click('#qsSave');
  await expect(page.locator('#toast')).toHaveText('INV-0107 saved · 190.00 · UPI');
  await expect(page.locator('#qsm')).toHaveCount(0);
  await expect(page.locator('#slRows tr[data-sno="INV-0107"]')).toContainText('Sunil');
});
