/** Cheque and reconciliation flows against the real API, in a shop of their own (the bank fixture imported). */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
// (this shop hides the ₹ sign: Settings › General)

test('a supplier cheque cleared leaves the bank; a customer cheque bounced goes back on their account', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/cheques');
  await page.waitForSelector('#cqSum');
  await page.click('#cqDir [data-dir="out"]');
  await page.click('#cqRows [data-cqok]');
  await expect(page.locator('#bcmAcctL')).toContainText('Paid from');
  await page.click('#bcmSave');
  await expect(page.locator('#toast')).toHaveText('004890 · 10,000.00 paid from HDFC Bank');
  await expect(page.locator('#cqRows')).toContainText('No pending cheques');
  await page.goto(APP + '/bank-accounts');
  await expect(page.locator('#bkRows tr').first()).toContainText('Cheque cleared');
  await expect(page.locator('#bkCards .bkc.on .bkb')).toHaveText('73,696.00');

  // Mehta's deposited cheque: undo, then it bounces with bank charges
  await page.goto(APP + '/cheques');
  await page.selectOption('#cqSt', 'all');
  await page.click('#cqRows [data-cqundo]');
  await expect(page.locator('#toast')).toHaveText('004512 is pending again');
  await page.click('#cqRows [data-cqbn]');
  await page.fill('#bcmChg', '250');
  await page.fill('#bcmNote', 'Insufficient funds');
  await page.click('#bcmSave');
  await expect(page.locator('#toast')).toHaveText('004512 marked bounced · 5,000.00 back on Mehta Electricals’s account');
  await expect(page.locator('#cqRows tr').first()).toContainText('01/10/2026 · Insufficient funds');
  await expect(page.locator('#cqSum')).toContainText('Bounced · 1');
});

test('reconciliation: ticks and the statement balance are kept after a reload', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/reconciliation');
  await page.waitForSelector('#bkrRows .bkrcb');
  await expect(page.locator('#bkrMsg')).toHaveText('Enter the closing balance from your bank statement to start.');
  await page.fill('#bkrStmt', '78696');
  await page.click('#bkrAll');
  await expect(page.locator('#bkrMsg')).toContainText('Reconciled. Your books match the HDFC Bank statement up to 30/09/2026.');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#bkrRows .bkrcb');
  await expect(page.locator('#bkrStmt')).toHaveValue('78696');
  await expect(page.locator('#bkrSum .bkok')).toBeVisible();
  // one entry not on the statement
  await page.locator('#bkrRows .bkrcb').first().uncheck();
  await expect(page.locator('#bkrMsg')).toContainText('354.00 less in the bank than ticked.');
});
