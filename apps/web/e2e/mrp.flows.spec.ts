/**
 * MRP (Features › mrp_pack, owner's request, 2 Nov 2026): MRP on the sale line, purchase row and item card; a rate above
 * it asks first; expired stock and a rate above MRP each ask; nothing at all with the feature off.
 */
import { expect, test, type Page } from '@playwright/test';
import { CUSTOMER, ITEM, SUPPLIER, batchShop } from './batch.data';
import { APP, freshShop, newPage, signInAs, openItemSettings, untick } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;
const newSale = async (page: Page) => {
  await page.goto(APP + '/sales/new');
  await page.waitForSelector('#qeItem');
  await page.fill('#siParty', CUSTOMER);
  await page.click(OPTION(CUSTOMER));
  await expect(page.locator('#qeItem')).toBeFocused();
};
const rapid = async (page: Page, qty: string) => {
  await page.locator('#qeItem').pressSequentially('Paracetamol');
  await page.waitForSelector(OPTION(ITEM));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#qeQty')).toBeFocused();
  await page.fill('#qeQty', qty);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#qeItem')).toBeFocused();
  await page.mouse.click(5, 700);
};
const charges = async (page: Page) => { await page.click('#siChgBtn'); await page.click('#siChgDone'); };

test('a rate above MRP shows on the line and asks on saving; it prints with the batch', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, mrp: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '2');
  // No batch first, at the item's MRP 100, alongside A123's 120: the lowest counts
  const line = page.locator('[data-bxl="0"]');
  await expect(line).toContainText('A123');
  await expect(line).toContainText('MRP 100.00, rate is above it');
  await expect(page.locator('#siRows tr[data-ln="0"] td.frc')).toHaveAttribute('data-mrpbad', '1');

  await charges(page);
  await page.click('#siSave');
  await expect(page.locator('#mxAsk')).toBeVisible();
  await expect(page.locator('#mxAsk p')).toContainText('selling at 150.00 per PCS, MRP is 100.00');
  await page.click('#mxNo');
  await expect(page.locator('#mxAsk')).toBeHidden();
  await page.click('#siSave');
  await page.click('#mxYes');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
  await expect(page.locator('#ipvSheet [data-pbatch]')).toContainText('MRP 120.00');
});

test('expired stock and a rate above MRP each ask, one after the other', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, mrp: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '1');
  await page.click('[data-bxl="0"]');
  await page.waitForSelector('#bxPickRows tr');
  await expect(page.locator('#bxPickRows tr[data-batch="A123"] td').nth(3)).toHaveText('120.00');
  for (const no of ['No batch', 'A123', 'B456']) await page.fill(`#bxPickRows tr[data-batch="${no}"] input`, '');
  await page.fill('#bxPickRows tr[data-batch="X100"] input', '1');
  await page.click('#bxDone');
  await charges(page);
  await page.click('#siSave');
  await expect(page.locator('#bxExpired')).toBeVisible();
  await page.click('#bxExpYes');
  await expect(page.locator('#mxAsk')).toBeVisible();
  await page.click('#mxYes');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
});

test('the purchase row takes the MRP, the card shows and edits it; MRP shows whatever the Show MRP switch says', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: false, mrp: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(`${APP}/purchases/new?kind=bill`);
  await page.waitForSelector('#peRows');
  await page.fill('#peParty', SUPPLIER);
  await page.click(OPTION(SUPPLIER));
  await page.fill('#peRows .pe-item', ITEM);
  await page.click(OPTION(ITEM));
  await expect(page.locator('[data-bf="mrp"]')).toHaveValue('100');
  await page.fill('[data-bf="batchNo"]', 'C789');
  await page.fill('[data-bf="mrp"]', '130');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="rate"]', '50');
  await page.click('button:has-text("Save")');
  await page.waitForURL(/purchase-bills/);

  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itBatchRows tr[data-batch="C789"]')).toContainText('130.00');
  await page.click('[data-batchedit="C789"]');
  await expect(page.locator('#bxMrp')).toHaveValue('130.00');
  await page.fill('#bxMrp', '140');
  await page.click('#bxSave');
  await expect(page.locator('#itBatchRows tr[data-batch="C789"]')).toContainText('140.00');

  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await expect(page.locator('#sMrp')).toBeChecked();
  await expect(page.locator('#sMrp')).toBeDisabled();
  await expect(page.locator('body')).not.toHaveClass(/nomrp/);
  await page.goto(APP + '/reports?r=batch');
  await expect(page.locator('#rpMain thead')).toContainText('MRP');
});

test('with the feature off the sale, purchase, card and report show no new MRP, and nothing asks', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, mrp: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openItemSettings(page, 1);
  await untick(page, 'f_mrp');

  await newSale(page);
  await rapid(page, '1');
  await expect(page.locator('[data-mrp]')).toHaveCount(0);
  await page.click('[data-bxl="0"]');
  await expect(page.locator('#bxPick thead')).not.toContainText('MRP');
  await page.keyboard.press('Escape');
  await charges(page);
  await page.click('#siSave');
  await page.waitForSelector('#ipv:not([hidden])');
  await expect(page.locator('#mxAsk')).toBeHidden();
  await page.click('#ipvClose');

  await page.goto(`${APP}/purchases/new?kind=bill`);
  await page.waitForSelector('#peRows');
  await page.fill('#peParty', SUPPLIER);
  await page.click(OPTION(SUPPLIER));
  await page.fill('#peRows .pe-item', ITEM);
  await page.click(OPTION(ITEM));
  await page.waitForSelector('[data-bf="batchNo"]');
  await expect(page.locator('[data-bf="mrp"]')).toHaveCount(0);

  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itBatches thead')).not.toContainText('MRP');
  await page.goto(APP + '/reports?r=batch');
  await expect(page.locator('#rpMain thead')).not.toContainText('MRP');
  await expect(page.locator('body')).toHaveClass(/nomrp/);
});
