/** Commission flows against the real API, in a shop of their own (the commission fixture imported). */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
// (this shop hides the ₹ sign: Settings › General)

test('pay commission in cash, then adjust the rest against his bills; add an electrician', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'commission-shop'));
  await page.goto(APP + '/commission');
  await page.waitForSelector('#cmRows tr[data-cme]');
  await expect(page.locator('#cmSum')).toContainText('Payable now4');
  await page.click('#cmRows [data-cmpay]');
  await page.selectOption('#cpM', 'Cash');
  await page.fill('#cpA', '2');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('2.00 commission paid to Sunil Electrician');
  await expect(page.locator('#cmRows tr').first().locator('td').nth(7)).toHaveText('1.96');

  await page.click('#cmRows [data-cmpay]');
  await expect(page.locator('#cpM')).toHaveValue('Adjust');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('1.96 commission adjusted in Sunil Electrician’s account');
  await expect(page.locator('#cmRows [data-cmpay]')).toBeDisabled();
  await expect(page.locator('#cmRows .cmpb')).toContainText('Owes you 898.04');

  // the cash payout is in the cash book
  await page.goto(APP + '/cash-in-hand');
  await expect(page.locator('#caRows tr').first()).toContainText('Commission paid');

  await page.goto(APP + '/commission');
  await page.click('#cmAdd');
  await page.fill('#elN', 'Imran Electricals');
  await page.fill('#elP', '97211');
  await page.click('#slmOk');
  await expect(page.locator('#elErr')).toHaveText('Mobile should be 10 digits.');
  await page.fill('#elP', '9721144556');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('Imran Electricals saved');
  await expect(page.locator('#cmRows')).toContainText('Imran Electricals');
});
