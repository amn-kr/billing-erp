/**
 * Batch and expiry, part 1a (Features › batch_expiry, owner's request, 1 Nov 2026): the item switch, a purchase bill's
 * batch row, the item card's Stock by batch, adjustments, and everything hidden with the feature off.
 */
import { expect, test, type Page } from '@playwright/test';
import { ITEM, SUPPLIER, batchShop } from './batch.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;
const startDoc = async (page: Page, kind: string) => {
  await page.goto(`${APP}/purchases/new?kind=${kind}`);
  await page.waitForSelector('#peRows');
  await page.fill('#peParty', SUPPLIER);
  await page.click(OPTION(SUPPLIER));
  await page.fill('#peRows .pe-item', ITEM);
  await page.click(OPTION(ITEM));
};
const openItem = async (page: Page) => {
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
};
const rows = (page: Page) => page.locator('#itBatchRows tr').evaluateAll((r) => r.map((x) => [(x as HTMLElement).dataset.batch, (x as HTMLTableRowElement).cells[4]!.textContent]));

test('a purchase bill asks for the batch of a tracked item; the item card shows the stock by batch', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: false });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);

  await startDoc(page, 'bill');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '6');
  await page.fill('#peRows tr[data-ln="0"] [data-pf="rate"]', '11');
  // Enter moves through the batch row too, then on to the next item
  await page.focus('#peRows tr[data-ln="0"] [data-pf="damt"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#peRows tr[data-ln="0"] [data-pf="gst"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-bf="batchNo"]')).toBeFocused();

  // no batch no.: said clearly, nothing saved
  await page.click('button:has-text("Save")');
  await expect(page.locator('#toast')).toContainText(`Enter the batch no. for “${ITEM}”.`);
  await expect(page.locator('[data-bf="batchNo"]')).toBeFocused();

  await page.fill('[data-bf="batchNo"]', 'C789');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-bf="mfg"]')).toBeFocused();
  await page.keyboard.type('06/26');
  await page.keyboard.press('Enter');
  await page.keyboard.type('13/40');
  await expect(page.locator('[data-bxmsg]')).toHaveText('Type the expiry like 03/27');
  await page.fill('[data-bf="expiry"]', '02/40');
  await expect(page.locator('[data-bxmsg]')).toHaveText('Expires 29 Feb 2040');
  await page.click('button:has-text("Save")');
  await page.waitForURL(/purchase-bills/);

  await openItem(page);
  await page.waitForSelector('#itBatchRows');
  expect(await rows(page)).toEqual([['No batch', '1'], ['C789', '6']]);
  await expect(page.locator('#itBatches tfoot')).toContainText('7');

  // Edit corrects the dates
  await page.click('[data-batchedit="C789"]');
  await expect(page.locator('#bxExp')).toHaveValue('02/40');
  await page.fill('#bxExp', 'soon');
  await page.click('#bxSave');
  await expect(page.locator('#bxErr')).toContainText('isn’t a date');
  await page.fill('#bxExp', '03/40');
  await page.click('#bxSave');
  await expect(page.locator('#itBatchRows tr[data-batch="C789"]')).toContainText('Mar 2040');
});

test('debit notes and adjustments name the batch', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);

  await openItem(page);
  await page.waitForSelector('#itBatchRows');
  expect(await rows(page)).toEqual([['X100', '1'], ['No batch', '1'], ['A123', '3'], ['B456', '4']]);
  await expect(page.locator('#itBatchRows tr[data-batch="X100"] .st')).toHaveText('Expired');

  // write off the expired batch
  await page.click('button:has-text("Adjust stock")');
  await page.click('[data-am="reduce"]');
  await page.waitForSelector('#bxAdj option:has-text("X100")', { state: 'attached' });
  await page.selectOption('#bxAdj', { label: 'X100 · Exp Jan 2020 · 1 in stock' });
  await page.fill('#adjQty', '2');
  await page.click('#adj button:has-text("Save adjustment")');
  await expect(page.locator('#adjErr')).toContainText('Only 1 PCS in that batch');
  await page.fill('#adjQty', '1');
  await page.selectOption('#adjWhy', 'Expired');
  await page.click('#adj button:has-text("Save adjustment")');
  await expect(page.locator('#adj')).toBeHidden();
  await expect.poll(() => rows(page)).toEqual([['No batch', '1'], ['A123', '3'], ['B456', '4']]);

  // add into a new batch
  await page.click('button:has-text("Adjust stock")');
  await page.fill('#bxAdjNo', 'D111');
  await page.fill('#bxAdjExp', '01/42');
  await page.fill('#adjQty', '2');
  await page.click('#adj button:has-text("Save adjustment")');
  await expect(page.locator('#adj')).toBeHidden();
  await expect.poll(() => rows(page)).toEqual([['No batch', '1'], ['A123', '3'], ['B456', '4'], ['D111', '2']]);

  // a debit note picks its batch
  await startDoc(page, 'debit_note');
  await page.waitForSelector('[data-bf="batchId"] option:has-text("B456")', { state: 'attached' });
  await page.selectOption('[data-bf="batchId"]', { label: 'B456 · Exp Aug 2041 · 4 in stock' });
  await page.fill('#peRows tr[data-ln="0"] [data-pf="rate"]', '15');
  await page.click('button:has-text("Save")');
  await page.waitForURL(/debit-notes/);
  await openItem(page);
  await page.waitForSelector('#itBatchRows');
  expect(await rows(page)).toEqual([['No batch', '1'], ['A123', '3'], ['B456', '3'], ['D111', '2']]);
});

test('with the feature off nothing shows, and ticking it again brings it all back', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);

  // Add item has the switch only with the feature on
  await page.goto(APP + '/items');
  await page.click('button:has-text("Add item")');
  await page.click('.aptabs button:has-text("Stock")');
  await expect(page.locator('#aiTrack')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="features"]');
  await page.click('#f_batch_expiry');
  await page.click('#cfmYes');
  await expect(page.locator('#f_batch_expiry')).not.toBeChecked();

  await openItem(page);
  await expect(page.locator('#itHead')).toContainText(ITEM);
  await expect(page.locator('#itBatches')).toHaveCount(0);
  await page.click('button:has-text("Adjust stock")');
  await page.click('[data-am="reduce"]');
  await expect(page.locator('#bxAdj')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await startDoc(page, 'bill');
  await expect(page.locator('#peRows tr[data-ln="0"] [data-pf="qty"]')).toBeVisible();
  await expect(page.locator('[data-bf]')).toHaveCount(0);
  await page.goto(APP + '/items');
  await page.click('button:has-text("Add item")');
  await page.click('.aptabs button:has-text("Stock")');
  await expect(page.locator('#aiTrack')).toHaveCount(0);

  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="features"]');
  await page.click('#f_batch_expiry');
  await expect(page.locator('#f_batch_expiry')).toBeChecked();
  await openItem(page);
  await page.waitForSelector('#itBatchRows');
  expect(await rows(page)).toEqual([['X100', '1'], ['No batch', '1'], ['A123', '3'], ['B456', '4']]);
});
