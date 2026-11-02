/** Item Batch Report (Features › batch_expiry, owner's request, 1 Nov 2026): filters, a row opens its item, nothing with the feature off. */
import { expect, test, type Page } from '@playwright/test';
import { ITEM, batchShop } from './batch.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const rows = (page: Page) => page.locator('#rpMain tbody tr').evaluateAll((r) => r.map((x) => (x as HTMLTableRowElement).cells[1]!.textContent));

test('the report, its filters, a row opening the item, and the feature turned off', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/reports?r=batch');
  await page.waitForSelector('#rpBxF');
  expect(await rows(page)).toEqual(['X100', 'A123', 'B456', 'No batch']);
  await expect(page.locator('#rpMain tfoot')).toContainText('9');
  await expect(page.locator('#rpMain .psk')).toContainText('Stock value');

  await page.click('[data-bxf="expired"]');
  expect(await rows(page)).toEqual(['X100']);
  await page.click('[data-bxf="30"]');
  await expect(page.locator('#rpMain')).toContainText('No batches match.');
  await page.click('[data-bxf="all"]');
  await expect(page.locator('#rpMain tbody tr')).toHaveCount(4);

  // the frame's buttons work here as on the other reports
  const xls = page.waitForEvent('download');
  await page.click('#rpXls');
  expect((await xls).suggestedFilename()).toBe('Item-Batch-Report.xlsx');
  const pdf = page.waitForEvent('download');
  await page.click('#rpPdf');
  expect((await pdf).suggestedFilename()).toContain('Item-Batch-Report');

  await page.click('#rpMain tbody tr >> nth=1');
  await page.waitForURL(/\/items/);
  await page.waitForSelector('#itBatches');
  await expect(page.locator('#itHead')).toContainText(ITEM);

  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="features"]');
  await page.click('#f_batch_expiry');
  await page.click('#cfmYes');
  await expect(page.locator('#f_batch_expiry')).not.toBeChecked();
  await page.goto(APP + '/reports?r=batch');
  await expect(page.locator('#rpMain .rpsoon')).toContainText('This report is being built');
  await expect(page.locator('#rpBxF')).toHaveCount(0);
});
