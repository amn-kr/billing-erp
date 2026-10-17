/** Expense flows against the real API, in a shop of their own (the bank fixture imported). */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
// (this shop hides the ₹ sign: Settings › General)

test('add an expense with Alt+E, save & new keeps the category, edit it, then cancel it', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/expenses');
  await page.waitForSelector('#exRows tr[data-exk]');
  await page.keyboard.press('Alt+E');
  await expect(page.locator('#xpm')).toBeVisible();
  await expect(page.locator('#xpNo')).toHaveText('EXP-0006');
  await page.click('#xpSave');
  await expect(page.locator('#xpErr')).toHaveText('Choose a category.');
  await page.selectOption('#xpCat', 'Tea & refreshments');
  await page.click('#xpSave');
  await expect(page.locator('#xpErr')).toHaveText('Enter the amount spent.');
  await page.fill('#xpLines [data-f="name"]', 'Tea & snacks');
  await page.fill('#xpLines [data-f="qty"]', '4');
  await page.fill('#xpLines [data-f="rate"]', '80');
  await expect(page.locator('#xpLines [data-f="amt"]')).toHaveValue('320');
  await page.fill('#xpPayee', 'Sharma Tea Stall');
  await page.click('#xpSaveNew');
  await expect(page.locator('#toast')).toHaveText('Expense saved successfully');
  // the window stays open for the next one, same category
  await expect(page.locator('#xpCat')).toHaveValue('Tea & refreshments');
  await expect(page.locator('#xpNo')).toHaveText('EXP-0007');
  await page.click('#xpCancel');
  await expect(page.locator('#exRows tr').first()).toContainText('Sharma Tea Stall');
  await expect(page.locator('#exSum')).toContainText('Entries7');

  // editing: paid by UPI from the bank instead
  await page.locator('#exRows tr[data-exk="EX:EXP-0006"] td').first().click();
  await expect(page.locator('#xpT')).toHaveText('Edit expense');
  await page.selectOption('#xpMode', 'UPI');
  await expect(page.locator('#xpAcct option:checked')).toHaveText('HDFC Bank');
  await page.click('#xpSave');
  await expect(page.locator('#toast')).toHaveText('Expense saved successfully');
  await page.goto(APP + '/bank-accounts');
  await expect(page.locator('#bkRows tr').first()).toContainText('Expense · Tea & refreshments');

  // cancelling puts the money back
  await page.goto(APP + '/expenses');
  await page.locator('#exRows tr[data-exk="EX:EXP-0006"] td').first().click();
  await page.click('#xpDel');
  await expect(page.locator('#slmT')).toHaveText('Cancel EXP-0006?');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toHaveText('EXP-0006 cancelled');
  await expect(page.locator('#exRows tr[data-exk="EX:EXP-0006"]')).toHaveCount(0);
});

test('a new category from the expense window comes back chosen; renaming fixes every entry', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'bank-shop'));
  await page.goto(APP + '/expenses');
  await page.waitForSelector('#exRows tr[data-exk]');
  await page.click('#exNew');
  await page.selectOption('#xpCat', '__new');
  await expect(page.locator('#xcm')).toBeVisible();
  await page.fill('#xcNew', 'Staff welfare');
  await page.press('#xcNew', 'Enter');
  await expect(page.locator('#xpm')).toBeVisible();
  await expect(page.locator('#xpCat')).toHaveValue('Staff welfare');
  await page.fill('#xpLines [data-f="amt"]', '1200');
  await page.click('#xpSave');
  await expect(page.locator('#toast')).toHaveText('Expense saved successfully');

  await page.click('#exCats');
  const row = page.locator('#xcList .xcrow', { has: page.locator('input[value="Staff welfare"]') });
  await expect(row.locator('small')).toHaveText('1 · 1,200');
  await row.locator('input').fill('Staff tea & welfare');
  await row.locator('input').press('Enter');
  await expect(page.locator('#toast')).toHaveText('Renamed to Staff tea & welfare');
  await page.click('#xcDone');
  await expect(page.locator('#exRows tr[data-exk="EX:EXP-0006"]')).toContainText('Staff tea & welfare');
  // the cash and bank book's own categories keep their names
  await page.click('#exCats');
  await expect(page.locator('#xcList input[value="Bank charges"]')).toHaveAttribute('readonly', '');
});
