/**
 * Items › ⋮ › Bulk active / inactive against the real API: only products (one row per variant),
 * opens on Active; search, brand, category and the Active / Inactive / All switch; the heading tick
 * box ticks the rows of the filter only; the question (with how many still have stock), Cancel
 * changes nothing; Make inactive hides the items from the Items list and new bills and lists them
 * under Show inactive; a name clash on Make active changes nothing and names the item; items already
 * in that state are counted, not changed. No passcode.
 */
import { expect, test, type Page } from '@playwright/test';
import { bulkActiveShop } from './bulk-active.data';
import { signedApi } from './bulk.data';
import { APP, newPage, signInAs } from './setup';

const rows = (page: Page) => page.locator('#baGrid tbody tr[data-row]');
const names = (page: Page) => rows(page).locator('td.eglead').allTextContents();
const row = (page: Page, name: string) => rows(page).filter({ has: page.locator('td.eglead', { hasText: name }) });
const show = (page: Page, k: 'active' | 'inactive' | 'all') => page.click(`#baShow [data-show="${k}"]`);
const tickAll = (page: Page) => page.locator('#baGrid thead input[type=checkbox]').check();

test('Bulk active / inactive: filters, ticks, the question, make inactive and active again', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const who = await bulkActiveShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/items');
  await page.click('#itMoreBtn');
  await page.click('#itBulkActMenu');
  await expect(page).toHaveURL(APP + '/items/bulk-active');

  // products only, newest first, opens on Active
  await expect(page.locator('#baShow [data-show="active"]')).toHaveClass('on');
  expect(await names(page)).toEqual(['Door bell', '6A-10A 1WAY SWITCH · NORWOOD CLASSIC', '6A-10A 1WAY SWITCH · HAVELLS CORAL', 'Insulation tape', 'Wire 1.5 sq mm', 'LED batten 20W', 'LED bulb 9W', 'Table fan 400mm', 'Ceiling fan 1200mm']);
  await expect(page.locator('#baTot')).toHaveText('9 active items1 inactive');
  // a variant shows its brand and series; stock with its unit
  const coral = row(page, 'HAVELLS CORAL');
  await expect(coral.locator('td[data-col="brand"] input')).toHaveValue('HAVELLS');
  await expect(coral.locator('td[data-col="series"] input')).toHaveValue('CORAL');
  await expect(coral.locator('td[data-col="stock"] input')).toHaveValue('120 PCS');
  await expect(coral.locator('td[data-col="stock"] input')).toHaveAttribute('readonly', '');
  await expect(coral.locator('.egtail')).toHaveText('Active');

  // search, brand and category
  await page.fill('#baQ', 'wire');
  expect(await names(page)).toEqual(['Wire 1.5 sq mm']);
  await page.fill('#baQ', '');
  await page.selectOption('#baBrand', 'PHILIPS');
  expect(await names(page)).toEqual(['LED batten 20W', 'LED bulb 9W']);
  // the heading tick box ticks only the rows of the filter; ticks stay when the filter changes
  await tickAll(page);
  await expect(page.locator('#baChip')).toHaveText('2 items selected');
  await page.selectOption('#baBrand', '');
  await page.selectOption('#baCat', 'Fans');
  expect(await names(page)).toEqual(['Table fan 400mm', 'Ceiling fan 1200mm']);
  await tickAll(page);
  await expect(page.locator('#baChip')).toHaveText('4 items selected');
  await page.selectOption('#baCat', '');

  // the question: Cancel changes nothing
  await page.click('#baInactive');
  await expect(page.locator('#bacT')).toHaveText('Make 4 items inactive?');
  await expect(page.locator('#bacStock')).toHaveText('2 of them still have stock.');
  await page.click('#bacCancel');
  await expect(page.locator('#baConfirm')).toHaveCount(0);
  expect(await names(page)).toHaveLength(9);

  await page.click('#baInactive');
  await page.click('#bacGo');
  await expect(page.locator('#toast')).toContainText('4 items made inactive');
  await expect(page.locator('#baChip')).toHaveText('0 items selected');
  expect(await names(page)).toEqual(['Door bell', '6A-10A 1WAY SWITCH · NORWOOD CLASSIC', '6A-10A 1WAY SWITCH · HAVELLS CORAL', 'Insulation tape', 'Wire 1.5 sq mm']);
  await show(page, 'inactive');
  expect(await names(page)).toEqual(['Door bell', 'LED batten 20W', 'LED bulb 9W', 'Table fan 400mm', 'Ceiling fan 1200mm']);
  await expect(rows(page).locator('.egtail')).toHaveText(Array(5).fill('Inactive'));

  // hidden from new bills (they pick from the active items) …
  const a = await signedApi(request, who);
  expect(await a.get<unknown[]>('/items?q=LED')).toEqual([]);
  // … and from the Items list, under Show inactive instead
  await page.click('#baBack');
  await expect(page.locator('#itList .ptr:not([data-inactive])', { hasText: 'LED bulb 9W' })).toHaveCount(0);
  await expect(page.locator('#itemInactive')).toHaveText('Show inactive (5)');
  await page.goBack();

  // Make active with a name clash: nothing changes, the message names the item
  await show(page, 'inactive');
  await tickAll(page);
  await page.click('#baActive');
  await expect(page.locator('#bacT')).toHaveText('Make 5 items active?');
  await expect(page.locator('#bacStock')).toHaveCount(0);
  await page.click('#bacGo');
  await expect(page.locator('#baErr')).toHaveText('Door bell: An item with this name or code already exists. Rename one of them first. Nothing was changed.');
  expect(await names(page)).toHaveLength(5);

  await row(page, 'Door bell').locator('td.egck input').uncheck();
  await page.click('#baActive');
  await page.click('#bacGo');
  await expect(page.locator('#toast')).toContainText('4 items made active');
  await expect(page.locator('#baErr')).toHaveCount(0);
  expect(await names(page)).toEqual(['Door bell']);

  // already active: counted, not changed
  await show(page, 'all');
  await row(page, 'Ceiling fan 1200mm').locator('td.egck input').check();
  await page.click('#baActive');
  await page.click('#bacGo');
  await expect(page.locator('#toast')).toContainText('Nothing to change: 1 item was already active');
});

test('Bulk active / inactive: no passcode, even when it is on', async ({ browser, request }) => {
  const who = await bulkActiveShop(request);
  const a = await signedApi(request, who);
  await a.post('/settings/passcode/on', { passcode: '4826' });
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/items/bulk-active');
  await row(page, 'Insulation tape').locator('td.egck input').check();
  await page.click('#baInactive');
  await page.click('#bacGo');
  await expect(page.locator('#toast')).toContainText('1 item made inactive');
});
