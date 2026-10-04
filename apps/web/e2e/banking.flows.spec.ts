/** Banking & cash flows against the real API, in a shop of their own (the bank fixture imported). */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
// (this shop hides the ₹ sign: Settings › General)

test('deposit cash, transfer between banks, cancel an entry; balances follow', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/cash-in-hand');
  await page.waitForSelector('#caRows tr[data-bke]');
  await expect(page.locator('#caSum')).toContainText('Cash in hand now1,080');
  // more cash than there is cannot be deposited
  await page.click('#caDep');
  await page.fill('#bmmAmt', '9000');
  await page.click('#bmmSave');
  await expect(page.locator('#bmmErr')).toHaveText('Only 1,080.00 cash in hand.');
  await page.fill('#bmmAmt', '1000');
  await page.fill('#bmmRef', 'Slip 2290');
  await page.click('#bmmSave');
  await expect(page.locator('#toast')).toHaveText('BT-0006 saved · 1,000.00 Cash in hand → HDFC Bank');
  await expect(page.locator('#caSum')).toContainText('Cash in hand now80');

  await page.goto(APP + '/bank-accounts');
  await page.waitForSelector('#bkRows tr[data-bke]');
  await expect(page.locator('#bkCards .bkc.on .bkb')).toHaveText('84,696.00');
  await page.click('#bkMove');
  await page.fill('#bmmAmt', '6000');
  await page.click('#bmmSave');
  await expect(page.locator('#toast')).toHaveText('BT-0007 saved · 6,000.00 HDFC Bank → State Bank of India');
  await expect(page.locator('#bkTot')).toHaveText('2 accounts · total 1,50,108');
  // the transfer opens from the book and is cancelled, never deleted
  await page.locator('#bkRows tr', { hasText: 'BT-0007' }).click();
  await expect(page.locator('#slmT')).toHaveText('Transfer · BT-0007');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('BT-0007 cancelled');
  await expect(page.locator('#bkRows tr', { hasText: 'BT-0007' })).toHaveCount(0);
  await expect(page.locator('#bkCards .bkc.on .bkb')).toHaveText('84,696.00');
});

test('add a bank account and make it the UPI default; count cash records the difference', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/bank-accounts');
  await page.waitForSelector('#bkRows tr[data-bke]');
  await page.click('#bkAdd');
  await page.click('#bamSave');
  await expect(page.locator('#bamErr')).toHaveText('Enter the bank name.');
  await page.fill('#bamName', 'ICICI Bank');
  await page.fill('#bamIfsc', 'ICIC12');
  await page.click('#bamSave');
  await expect(page.locator('#bamErr')).toHaveText('IFSC looks wrong — it is 11 characters like HDFC0001234.');
  await page.fill('#bamIfsc', 'ICIC0004411');
  await page.fill('#bamNo', '004401556677');
  await page.fill('#bamOpen', '20000');
  await page.check('#bamDef');
  await page.click('#bamSave');
  await expect(page.locator('#toast')).toHaveText('ICICI Bank added');
  await expect(page.locator('#bkHd h2')).toContainText('ICICI Bank');
  await expect(page.locator('#bkCards .bkc', { hasText: 'ICICI Bank' }).locator('.bkdef')).toHaveText('UPI default');
  await expect(page.locator('#bkCards .bkc', { hasText: 'HDFC Bank' }).locator('.bkdef')).toHaveCount(0);
  // an account with entries cannot be deleted
  await page.click('#bkCards .bkc:has-text("HDFC Bank")');
  await page.click('#bkHd [data-bkedit]');
  await expect(page.locator('#bamDel')).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto(APP + '/cash-in-hand');
  await page.waitForSelector('#caRows tr[data-bke]');
  await page.click('#caCount');
  await page.fill('#ccAmt', '1010');
  await expect(page.locator('#ccH')).toHaveText('Short 70.00 — saved as a cash adjustment.');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('Cash short 70.00 recorded');
  await expect(page.locator('#caRows tr', { hasText: 'Cash short on count' })).toContainText('70.00');
  await expect(page.locator('#caSum')).toContainText('Cash in hand now1,010');
});
