/**
 * Items › ⋮ › Bulk update items against the real API: edit cells in place (Enter moves down, Esc
 * undoes), switch tabs and keep the changes, the chip's counts, a heading filter, the tax slab for
 * the ticked items, cells checked before anything is sent, the question, the passcode (a wrong one
 * is refused), and the new values on the Items page. Made-up passcodes only.
 */
import { expect, test, type Page } from '@playwright/test';
import { bulkShop, signedApi } from './bulk.data';
import { APP, newPage, signInAs } from './setup';

const PASS = '4826';
const row = (page: Page, name: string) => page.locator('#buGrid tbody tr').filter({ has: page.locator('td.eglead', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const cell = (page: Page, name: string, col: string) => row(page, name).locator(`td[data-col="${col}"]`).locator('input, select');

test('Bulk update items: edit, switch tabs, check, passcode, and the new values on the Items page', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1366);
  const who = await bulkShop(request);
  const api = await signedApi(request, who);
  await signInAs(page, who);

  // in through the Items page's ⋮ menu
  await page.goto(APP + '/items');
  await page.click('#itMoreBtn');
  await expect(page.locator('#itMorePop button')).toContainText(['Import products', 'Update prices in bulk', 'Bulk update items']);
  await page.click('#itBulkMenu');
  await expect(page).toHaveURL(APP + '/items/bulk-update');
  await expect(page.locator('#vBulk h1')).toHaveText('Bulk Update Items');
  await expect(page.locator('#buTabs label')).toHaveText(['Pricing', 'Item Information']);
  await expect(page.locator('#buGrid thead th')).toContainText(['#', 'Item name', 'Category', 'Purchase price', 'Sale price', 'Tax slab']);
  await expect(page.locator('#buGrid tbody tr')).toHaveCount(12);
  await expect(page.locator('#buChip')).toHaveText('Pricing - 0 Updates, Item Information - 0 Updates');
  await expect(cell(page, 'LED bulb 9W', 'sale')).toHaveValue('95.00');

  // Esc puts back what the cell held; typing the same amount again is not a change
  await cell(page, 'LED bulb 9W', 'sale').fill('500');
  await cell(page, 'LED bulb 9W', 'sale').press('Escape');
  await expect(cell(page, 'LED bulb 9W', 'sale')).toHaveValue('95.00');
  await cell(page, 'LED bulb 9W', 'sale').fill('95');
  await expect(page.locator('#buChip')).toHaveText('Pricing - 0 Updates, Item Information - 0 Updates');

  // a real change; Enter goes to the same column one row down
  await cell(page, 'LED bulb 9W', 'sale').fill('105.50');
  await cell(page, 'LED bulb 9W', 'sale').press('Enter');
  // the list is newest first: the Table fan was added just before the LED bulb
  await expect(cell(page, 'Table fan 400mm', 'sale')).toBeFocused();
  await cell(page, 'Table fan 400mm', 'sale').press('Shift+Enter');
  await expect(cell(page, 'LED bulb 9W', 'sale')).toBeFocused();
  await expect(page.locator('#buChip')).toHaveText('Pricing - 1 Update, Item Information - 0 Updates');

  // the item name heading filter
  await page.click('[data-thf="bu-lead"]');
  await page.fill('#buFxV', 'wire');
  await page.click('#buFxOk');
  await expect(page.locator('#buGrid tbody tr')).toHaveCount(2);
  expect((await page.locator('#buGrid tbody td.eglead').allTextContents()).sort()).toEqual(['Wire 1.5 sq mm', 'Wire 2.5 sq mm']);

  // tax slab for the ticked items (one of them has no tax)
  await row(page, 'Wire 1.5 sq mm').locator('td.egck input').check();
  await row(page, 'Wire 2.5 sq mm').locator('td.egck input').check();
  await expect(page.locator('#buSel')).toContainText('2 items selected (No Tax : 1)');
  await page.selectOption('#buTax', '5');
  await expect(cell(page, 'Wire 1.5 sq mm', 'gstRate')).toHaveValue('5');
  await expect(cell(page, 'Wire 2.5 sq mm', 'gstRate')).toHaveValue('5');
  await expect(page.locator('#buSel')).toContainText('2 items selected (No Tax : 0)');
  await expect(page.locator('#buChip')).toHaveText('Pricing - 3 Updates, Item Information - 0 Updates');
  await page.click('[data-thf="bu-lead"]');
  await page.click('#buFxClr');
  await expect(page.locator('#buGrid tbody tr')).toHaveCount(12);

  // Item Information: an item code already used is marked, and nothing is sent
  await page.check('[data-bt="info"]');
  await expect(page.locator('#buGrid thead th')).toContainText(['Item name', 'Category', 'Item code']);
  await cell(page, 'Switch 6A', 'code').fill('lb9');
  await expect(page.locator('#buChip')).toHaveText('Pricing - 3 Updates, Item Information - 1 Update');
  let sent = 0;
  page.on('request', (r) => { if (r.url().includes('/api/items/bulk-update')) sent++; });
  await page.click('#buGo');
  await expect(page.locator('#buErr')).toHaveText('1 cell needs fixing before Update: Switch 6A. They are marked in red.');
  await expect(row(page, 'Switch 6A').locator('td[data-col="code"]')).toHaveClass(/bad/);
  await expect(row(page, 'Switch 6A').locator('td[data-col="code"] .egm.bad')).toHaveText('This item code is already used.');
  await expect(page.locator('#buConfirm')).toHaveCount(0);
  await cell(page, 'Switch 6A', 'code').fill('SW-6A');
  await expect(page.locator('#buErr')).toHaveCount(0);

  // changes on the other tab are kept
  await page.check('[data-bt="pricing"]');
  await expect(cell(page, 'LED bulb 9W', 'sale')).toHaveValue('105.50');

  // the question, then the passcode (on for this shop): a wrong one is refused
  await api.post('/settings/passcode/on', { passcode: PASS });
  await page.click('#buGo');
  await expect(page.locator('#bucT')).toHaveText('Update 4 items?');
  await expect(page.locator('#bucD')).toHaveText('3 items pricing, 1 item information will change.');
  await page.click('#bucGo');
  await page.waitForSelector('#pcm .mdl');
  await page.fill('#pcPin', '0000');
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  expect(sent).toBe(1);
  await page.fill('#pcPin', PASS);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText('4 items updated');
  await expect(page.locator('#buChip')).toHaveText('Pricing - 0 Updates, Item Information - 0 Updates');
  await expect(cell(page, 'LED bulb 9W', 'sale')).toHaveValue('105.50');
  await expect(row(page, 'LED bulb 9W').locator('.egm')).toHaveCount(0);

  // saved: checked by field through the API, and on the Items page
  const items = await api.get<{ name: string; code: string; sale: string; gstRate: string }[]>('/items');
  const by = (n: string) => items.find((i) => i.name === n)!;
  expect([by('LED bulb 9W').sale, by('Switch 6A').code, by('Wire 1.5 sq mm').gstRate, by('Wire 2.5 sq mm').gstRate, by('Ceiling fan 1200mm').sale]).toEqual(['105.50', 'SW-6A', '5.00', '5.00', '1890.00']);
  await page.click('#buBack');
  await expect(page).toHaveURL(APP + '/items');
  await page.locator('#itList [data-iid]', { hasText: 'LED bulb 9W' }).click();
  await expect(page.locator('#itHead .itfig')).toContainText('Sale price105.50');
  await page.locator('#itList [data-iid]', { hasText: 'Switch 6A' }).click();
  await expect(page.locator('#itHead .ptmeta .mono')).toHaveText('SW-6A');
});

test('Bulk update items: leaving with changes asks first', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await bulkShop(request);
  await signInAs(page, who);
  await page.goto(APP + '/items/bulk-update');
  await cell(page, 'Door bell', 'purchase').fill('130');
  await page.click('#buBack');
  await expect(page.locator('#dcfT')).toHaveText('Discard this bulk update?');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(APP + '/items/bulk-update');
  await expect(cell(page, 'Door bell', 'purchase')).toHaveValue('130');
});
