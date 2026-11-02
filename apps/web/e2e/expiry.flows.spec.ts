/**
 * Expiry monitoring (Features › batch_expiry, owner's request, 2 Nov 2026): the alert on Home, the report's filters, returning a
 * batch to its supplier, writing off expired stock, what each batch sold, exports, who can do what, and nothing with the feature off.
 */
import { expect, test, type Page } from '@playwright/test';
import { SUPPLIER, expiryShop } from './batch.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const rows = (page: Page) => page.locator('#rpMain tr[data-rpk]');
const row = (page: Page, no: string) => page.locator('#rpMain tr[data-rpk]', { hasText: no });
const kpi = (page: Page, label: string) => page.locator('#rpMain .psk > div', { hasText: label }).locator('b');
const report = async (page: Page) => { await page.goto(APP + '/reports?r=expiry'); await page.waitForSelector('#rpExF'); };

test('Home’s alert opens the report; the filters and supplier list narrow it; the figures add up', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/');
  const card = page.locator('[data-view="exp-stock"]');
  await expect(card).toContainText('1 batch expired');
  await expect(card).toContainText('3 within 90 days');
  await expect(card).toContainText('1,558');
  await card.click();
  await page.waitForSelector('#rpExF');
  await expect(page.locator('.pttot')).toHaveText('41 reports');
  await expect(rows(page)).toHaveCount(4);
  await expect(row(page, 'C101')).toContainText('Ram Pharma');
  await expect(row(page, 'C101')).toContainText('4 STRIP');
  await expect(row(page, 'C101')).toContainText('Expired');
  await expect(row(page, 'O1')).toHaveCount(0);
  await expect(kpi(page, 'Expired')).toHaveText('88.00');
  await expect(kpi(page, 'In 30 days')).toHaveText('270.00');
  await expect(kpi(page, 'In 90 days')).toHaveText('1,470.00');
  await expect(page.locator('#rpMain tfoot')).toContainText('1,558.00');
  for (const [k, n] of [['expired', 1], ['30', 1], ['60', 2], ['90', 3], ['all', 4]] as const) {
    await page.click(`[data-exf="${k}"]`);
    await expect(rows(page)).toHaveCount(n);
  }
  await page.selectOption('#rpExSup', { label: 'Sun Distributors' });
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'S12')).toBeVisible();
  await expect(kpi(page, 'Expired')).toHaveText('0.00');
  // a row opens its item
  await row(page, 'S12').click();
  await page.waitForURL(/\/items/);
  await expect(page.locator('#itHead')).toContainText('Benadryl syrup');
});

test('Return to supplier fills a debit note in; saved, the batch leaves the report', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await report(page);
  await row(page, 'A77').locator('[data-slm]').click();
  // not expired: it can go back, but not be written off
  await expect(page.locator('#exCtx [data-sla="off"]')).toHaveCount(0);
  await page.click('#exCtx [data-sla="ret"]');
  await page.waitForSelector('#peRows');
  await expect(page.locator('#peParty')).toHaveValue(SUPPLIER);
  await expect(page.locator('#peRows [data-pf="qty"]').first()).toHaveValue('3');
  await expect(page.locator('#peRows [data-pf="unit"]').first()).toHaveValue('STRIP');
  await expect(page.locator('#peRows [data-pf="rate"]').first()).toHaveValue('90');
  await expect(page.locator('#peReason')).toHaveValue('Expired goods');
  await expect(page.locator('#peAgainst')).not.toHaveValue('');
  await expect(page.locator('[data-bf="batchId"] option:checked')).toContainText('A77');
  await page.click('#peSave');
  await page.waitForURL(/debit-notes/);
  await report(page);
  await expect(row(page, 'A77')).toHaveCount(0);
  await expect(kpi(page, 'In 30 days')).toHaveText('0.00');
});

test('Part of a pack goes back loose at the loose rate', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  // 5 tablets of Crocin gone: 35 left is no whole number of strips
  await report(page);
  await row(page, 'C101').locator('[data-slm]').click();
  await page.click('#exCtx [data-sla="off"]');
  await page.fill('#adjQty', '5');
  await page.click('#adjForm button[type=submit]');
  await expect(page.locator('#adjForm')).toBeHidden();
  await expect(row(page, 'C101')).toContainText('3 STRIP 5 TAB');
  await row(page, 'C101').locator('[data-slm]').click();
  await page.click('#exCtx [data-sla="ret"]');
  await page.waitForSelector('#peRows');
  await expect(page.locator('#peRows [data-pf="qty"]').first()).toHaveValue('35');
  await expect(page.locator('#peRows [data-pf="unit"]').first()).toHaveValue('TAB');
  await expect(page.locator('#peRows [data-pf="rate"]').first()).toHaveValue('2.2');
});

test('Write off fills an adjustment in, with no empty Item box; the value shows as written off; only expired batches offer it', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await report(page);
  await row(page, 'C101').locator('[data-slm]').click();
  await page.click('#exCtx [data-sla="off"]');
  await expect(page.locator('#adjItem')).toHaveCount(0);
  await expect(page.locator('[data-am="reduce"]')).toHaveClass(/on/);
  await expect(page.locator('#adjQty')).toHaveValue('40');
  await expect(page.locator('#adjPrice')).toHaveValue('2.2');
  await expect(page.locator('#adjWhy')).toHaveValue('Expired');
  await expect(page.locator('#bxAdj option:checked')).toContainText('C101');
  await page.click('#adjForm button[type=submit]');
  await expect(page.locator('#adjForm')).toBeHidden();
  await expect(row(page, 'C101')).toHaveCount(0);
  await expect(kpi(page, 'Written off this year')).toHaveText('88.00');
  await expect(kpi(page, 'Expired')).toHaveText('0.00');
  // the alert follows
  await page.goto(APP + '/');
  await expect(page.locator('[data-view="exp-stock"]')).toContainText('0 batches expired');
});

test('Batch Wise Sales And Profit: each batch’s figures; the item filter; a period with nothing', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/reports?r=batchsale');
  await page.waitForSelector('#rpBsItem');
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'C101')).toContainText('2 STRIP');
  await expect(row(page, 'C101')).toContainText('44.00');
  await expect(row(page, 'C101')).toContainText('16.00');
  await expect(row(page, 'C101')).toContainText('26.7%');
  await expect(page.locator('#rpMain tfoot')).toContainText('180.00');
  await expect(kpi(page, 'Profit')).toHaveText('46.00');
  await page.selectOption('#rpBsItem', { label: 'Azithral 500' });
  await expect(rows(page)).toHaveCount(1);
  await expect(kpi(page, 'Margin')).toHaveText('25.0%');
  await page.selectOption('#rpPer', 'custom');
  await page.fill('#rpFrom', '2026-09-01');
  await page.fill('#rpTo', '2026-09-30');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#rpMain')).toContainText('No batches sold in this period.');
});

test('Excel downloads, and Print leaves the ⋮ column out', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await report(page);
  const dl = page.waitForEvent('download');
  await page.locator('#rpMain .psa button', { hasText: 'Excel' }).click();
  expect((await dl).suggestedFilename()).toBe('Expiry-Report.xlsx');
  await page.locator('#rpPrint').click();
  await expect(page.locator('#ipv thead th')).toHaveText(['Item', 'Batch', 'Expiry', '', 'Supplier', 'In stock', 'Value']);
});

test('Feature off: no alert, 39 reports, the address falls back, no Expired goods reason', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await expiryShop(owner, { features: [] });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/');
  await page.waitForSelector('#stats');
  await expect(page.locator('[data-view="exp-stock"]')).toHaveCount(0);
  await page.goto(APP + '/reports?r=expiry');
  await page.waitForSelector('#rpList');
  await expect(page.locator('.pttot')).toHaveText('39 reports');
  await expect(page.locator('#rpExF')).toHaveCount(0);
  await expect(page.locator('#rpList')).not.toContainText('Expiry Report');
  await expect(page.locator('#rpList')).not.toContainText('Batch Wise');
  await page.goto(APP + '/purchases/new?kind=debit_note');
  await page.waitForSelector('#peReason');
  await expect(page.locator('#peReason option', { hasText: 'Expired goods' })).toHaveCount(0);
});
