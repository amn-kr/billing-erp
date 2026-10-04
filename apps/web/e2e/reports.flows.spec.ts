/** Reports: links between reports and documents, and the files they make (commission test shop). */
import { expect, test } from '@playwright/test';
import { APP, COMMISSION, newPage, signInAs } from './setup';

test('statement from the Parties page; its rows open the invoice and the receipt; P&L opens a statement', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, COMMISSION);
  await page.goto(APP + '/parties');
  await page.locator('#ptList [data-pid]', { hasText: 'Raju Electrician' }).first().click();
  await page.click('#ptStmtBtn');
  await expect(page).toHaveURL(/\/reports\?r=pstmt$/);
  await expect(page.locator('#rpMain .pscard b').first()).toHaveText('Raju Electrician');
  await expect(page.locator('#nav [data-rsec="party"]')).toHaveClass(/on/);
  // a sale opens its preview on the Sales page, a receipt its window on Payments received
  await page.locator('#rpMain tr[data-pst="Sale"]').first().click();
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.locator('#ipv:not([hidden]) .mdl')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.locator('#rpMain tr[data-pst="Payment-In"]').first().click();
  await expect(page).toHaveURL(/\/payments-received$/);
  await expect(page.locator('#slm:not([hidden]) #slmT')).toContainText('PI-');

  await page.goto(APP + '/reports?r=ppl');
  await page.locator('#rpMain tr[data-rpk]', { hasText: 'Mehta Electricals' }).click();
  await expect(page).toHaveURL(/r=pstmt/);
  await expect(page.locator('#rpMain .pscard b').first()).toHaveText('Mehta Electricals');
  // the report list can be hidden, and stays hidden
  await page.click('#rpTg');
  await expect(page.locator('.rpw')).toHaveClass(/rpfull/);
  await page.reload();
  await expect(page.locator('.rpw')).toHaveClass(/rpfull/);
});

test('expense report rows open the expense; Excel and PDF files are made', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, COMMISSION);
  await page.goto(APP + '/reports?r=expl');
  const first = page.locator('#rpMain tr[data-rpk^="EX:"]').first();
  const no = (await first.locator('td').nth(1).textContent())!;
  const xls = page.waitForEvent('download');
  await page.click('#rpXls');
  expect((await xls).suggestedFilename()).toBe('Expense.xlsx');
  const pdf = page.waitForEvent('download');
  await page.click('#rpPdf');
  expect((await pdf).suggestedFilename()).toBe('Expense.pdf');
  await page.click('#rpPrint');
  await expect(page.locator('#ipv:not([hidden]) #ipvSheet')).toContainText('EXPENSE');
  await page.keyboard.press('Escape');
  await first.click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.locator('#xpm')).toBeVisible();
  await expect(page.locator('#xpNo')).toHaveText(no);
});

test('a statement as Excel and on WhatsApp', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, COMMISSION);
  await page.goto(APP + '/reports?r=pstmt');
  await page.waitForSelector('#rpMain .pscard');
  const xls = page.waitForEvent('download');
  await page.click('#psXls');
  expect((await xls).suggestedFilename()).toBe('Statement-Mehta-Electricals.xlsx');
  // WhatsApp is not reachable from the test machine: answer for it and read the message it was sent
  await page.context().route('https://wa.me/**', (r) => r.fulfill({ body: 'ok' }));
  const pop = page.waitForEvent('popup');
  await page.click('#psWa');
  expect(decodeURIComponent((await pop).url())).toContain('Your account statement');
});
