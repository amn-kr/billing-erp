/** Settings › Transactions: header switches and prefixes, against the real API. */
import { expect, test } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

test('prefixes: add one, used ones are locked, switch back, delete an unused one', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/settings');
  await page.click('#subnav button:has-text("Transactions")');
  await expect(page.locator('#setH')).toHaveText('Transactions');
  await expect(page.locator('#pxBiz')).not.toBeEmpty();
  await expect(page.locator('[data-px="invoice"] td').nth(2)).toHaveText('INV-0107');
  await page.click('[data-px="invoice"] button');
  const used = page.locator('#pxBody [data-prefix="INV-"]');
  await expect(used).toContainText('Used in 6 documents');
  await expect(used.locator('[aria-label^="Edit"], [aria-label^="Delete"]')).toHaveCount(0);
  // a prefix that could repeat INV- numbers is refused before saving
  await page.fill('#pxNew', 'INV-2');
  await expect(page.locator('#pxMsg')).toHaveText('INV-2 could make the same numbers as INV-. Choose a different prefix.');
  await page.fill('#pxNew', 'JE/INV/');
  await expect(page.locator('#pxMsg')).toContainText('Next sale number will be JE/INV/0001');
  await page.click('#pxForm button[type=submit]');
  await expect(page.locator('#toast')).toHaveText('JE/INV/ added and active');
  await expect(page.locator('#pxBody [data-prefix="JE/INV/"]')).toContainText('Active');
  await expect(used).toContainText('Not in use');
  // an unused prefix can be deleted once it is not active
  await page.click('#pxBody [data-prefix="INV-"] button:has-text("Make active")');
  await expect(page.locator('#toast')).toHaveText('New sales now use INV-');
  await page.click('#pxBody [data-prefix="JE/INV/"] [aria-label="Delete JE/INV/"]');
  await expect(page.locator('#pxBody [data-prefix="JE/INV/"]')).toHaveCount(0);
  await page.click('#pxClose');
  await expect(page.locator('[data-px="invoice"] td').nth(2)).toHaveText('INV-0107');
});

test('header switches: cash by default and the hidden number on a new sale', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/settings');
  await page.click('#subnav button:has-text("Transactions")');
  await expect(page.locator('#tInvNo')).toBeChecked();
  const saved = () => page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH');
  await Promise.all([saved(), page.click('#tCash')]);
  await Promise.all([saved(), page.click('#tInvNo')]);
  await expect(page.locator('#tInvNo')).not.toBeChecked();
  await page.goto(APP + '/sales/new');
  await expect(page.locator('#siMode [role="switch"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#siNo')).toHaveCount(0);
  await expect(page.locator('#siDate')).toBeVisible();
});
