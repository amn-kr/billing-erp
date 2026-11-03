/**
 * Settings › Items (owner's request, 3 Nov 2026): one page for every item switch. Coming soon rows can't be
 * ticked; unticking asks first and keeps the data; staff don't see the page; the old Features address opens it.
 */
import { expect, test } from '@playwright/test';
import { addStaff } from './staff-reset.data';
import { batchShop, ITEM } from './batch.data';
import { APP, freshShop, newPage, openItemSettings, signInAs, untick } from './setup';

test('the four tabs: real boxes work, Coming soon rows can’t be ticked, locked boxes stay locked', async ({ browser, request }) => {
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openItemSettings(page);
  await expect(page.locator('#setH')).toHaveText('Items');
  await expect(page.locator('#itTabs button')).toHaveText(['Item settings', 'Price & units', 'Batch & serial tracking', 'Custom fields']);

  // what every shop starts with
  for (const id of ['f_category', 'f_brand', 'f_series', 'f_location']) await expect(page.locator('#' + id)).toBeChecked();
  await expect(page.locator('#sItemPrefix')).toBeVisible();
  const soon = page.locator('#cItemSet .tgl:has(.st.q)');
  await expect(soon).toHaveCount(5);
  for (const box of await soon.locator('input').all()) await expect(box).toBeDisabled();

  await page.click('[data-ittab="1"]');
  await expect(page.locator('#f_mrp')).not.toBeChecked();
  await expect(page.locator('#f_pack_loose')).not.toBeChecked();
  await expect(page.locator('#f_unit')).toBeDisabled();
  await expect(page.locator('#f_unit')).toBeChecked();
  await expect(page.locator('#f_default_unit')).toBeDisabled();
  await expect(page.locator('#f_default_unit')).toBeChecked();
  await expect(page.locator('#dfUnit')).toHaveValue('PCS');
  await expect(page.locator('#cPlSet .tgl')).not.toHaveCount(0);
  await expect(page.locator('#cPriceUnit .tgl:has(.st.q)')).toHaveCount(7);

  // a date ticks Batch No. and locks it; it comes free when both dates are off
  await page.click('[data-ittab="2"]');
  await page.click('#f_exp_date');
  await expect(page.locator('#f_batch_no')).toBeChecked();
  await expect(page.locator('#f_batch_no')).toBeDisabled();
  await expect(page.locator('#toast')).toHaveText('Exp Date turned on, with Batch No.');
  await expect(page.locator('#cBatch .tgl:has(.st.q) input[type="checkbox"]')).toHaveCount(3);
  await untick(page, 'f_exp_date');
  await expect(page.locator('#f_batch_no')).toBeEnabled();
  await expect(page.locator('[data-box="f_batch_no"] small')).toContainText('selling uses the oldest batch first');

  await page.click('[data-ittab="3"]');
  await expect(page.locator('#itCustom')).toBeDisabled();
  await expect(page.locator('#cCustom .st.q')).toHaveText('Coming soon');

  // "Keep it on" changes nothing; Brand takes Series with it; Series brings Brand back; it stays after a reload
  await page.click('[data-ittab="0"]');
  await page.click('#f_brand');
  await expect(page.locator('#cfmT')).toHaveText('Turn off Brand?');
  await expect(page.locator('#cfm p')).toContainText('Series turns off with it');
  await page.click('#cfmNo');
  await expect(page.locator('#f_brand')).toBeChecked();
  await untick(page, 'f_brand');
  await expect(page.locator('#f_series')).not.toBeChecked();
  await page.reload();
  await page.click('#subnav button:has-text("Items")');
  await expect(page.locator('#f_brand')).not.toBeChecked();
  await page.click('#f_series');
  await expect(page.locator('#f_brand')).toBeChecked();
  await expect(page.locator('#toast')).toHaveText('Series turned on, with Brand');
});

test('Category, Brand, Series and Location off: gone from the item screens, back with their data', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  const tok = await page.evaluate(async () => (await (await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })).json()).accessToken as string);
  const post = (data: object) => request.post(APP + '/api/items', { data, headers: { Authorization: `Bearer ${tok}` } });
  expect((await post({ name: 'Ceiling fan', kind: 'goods', unit: 'PCS', gstRate: 18, category: 'Fans', brand: 'Bajaj', location: 'Rack A1' })).ok()).toBe(true);
  expect((await post({ name: 'Switch · Havells Coral', group: 'Switch', kind: 'goods', unit: 'PCS', gstRate: 18, brand: 'Havells', series: 'Coral' })).ok()).toBe(true);

  // on: search finds the location, the card shows it
  await page.goto(APP + '/items');
  await page.fill('#itQ', 'rack a1');
  await page.click('.ptr:has-text("Ceiling fan")');
  await expect(page.locator('.ptmeta')).toContainText('Rack A1');
  await expect(page.locator('.ptmeta')).toContainText('Fans');
  await expect(page.locator('#itBrand')).toBeVisible();
  await expect(page.locator('#itBrands')).toBeVisible();

  await openItemSettings(page);
  await untick(page, 'f_brand');
  await untick(page, 'f_category');
  await untick(page, 'f_location');

  await page.goto(APP + '/items');
  await expect(page.locator('#itBrand')).toHaveCount(0);
  await expect(page.locator('#itBrands')).toHaveCount(0);
  await expect(page.locator('#itTot')).not.toContainText('brands');
  await expect(page.locator('#itQ')).toHaveAttribute('placeholder', 'Search name, code or HSN');
  await page.fill('#itQ', 'rack a1');
  await expect(page.locator('.ptr:has-text("Ceiling fan")')).toHaveCount(0);
  await page.fill('#itQ', '');
  await page.click('.ptr:has-text("Ceiling fan")');
  await expect(page.locator('.ptmeta')).not.toContainText('Rack A1');
  await expect(page.locator('.ptmeta')).not.toContainText('Fans');
  await expect(page.locator('.ptt .brc')).toHaveCount(0);

  // the form hides the boxes, and saving keeps what the item has
  await page.click('#itEdit');
  await expect(page.locator('#aiCat')).toHaveCount(0);
  await expect(page.locator('#aiBrandSel')).toHaveCount(0);
  await page.click('[data-aitab="stock"]');
  await expect(page.locator('[data-f="loc"]')).toHaveCount(0);
  await page.click('#aiSave');
  await expect(page.locator('#ai')).toBeHidden();

  // a new item can't be a variant
  await page.click('button:has-text("Add item")');
  await expect(page.locator('#aiVarSw')).toHaveCount(0);
  await page.click('#aiClose');

  // an old link to Brands & Series goes back to Items
  await page.goto(APP + '/items/brands');
  await expect(page).toHaveURL(APP + '/items');

  // Bulk active, Bulk update and the sale grid
  await page.goto(APP + '/items/bulk-active');
  await expect(page.locator('#baBrand')).toHaveCount(0);
  await expect(page.locator('#baCat')).toHaveCount(0);
  await page.goto(APP + '/sales/new');
  await page.waitForSelector('#siHead');
  await expect(page.locator('#siHead .hib')).toHaveCount(0);
  await expect(page.locator('#siHead .his')).toHaveCount(0);

  // back on: everything is still there
  await openItemSettings(page);
  await page.click('#f_series');
  await expect(page.locator('#f_brand')).toBeChecked();
  await page.click('#f_category');
  await expect(page.locator('#f_category')).toBeChecked();
  await page.click('#f_location');
  await expect(page.locator('#f_location')).toBeChecked();
  await page.goto(APP + '/items');
  await page.click('.ptr:has-text("Ceiling fan")');
  await expect(page.locator('.ptmeta')).toContainText('Rack A1');
  await expect(page.locator('.ptmeta')).toContainText('Fans');
  await expect(page.locator('.ptt .brc')).toHaveText('Bajaj');
});

test('labels, date formats and the default unit show on the item card, the Add item window and the printed invoice', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, invoice: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openItemSettings(page, 2);
  await page.fill('#lb_batch', 'Lot');
  await page.press('#lb_batch', 'Enter');
  await expect(page.locator('#toast')).toHaveText('Label changed to Lot');
  await page.fill('#lb_exp', 'Best before');
  await page.press('#lb_exp', 'Enter');
  await expect(page.locator('#toast')).toHaveText('Label changed to Best before');
  await page.selectOption('#fmt_expFormat', 'mm/yy');
  await expect(page.locator('#toast')).toHaveText('Date format changed to mm/yy');
  await page.click('[data-ittab="1"]');
  await page.selectOption('#dfUnit', 'BOX');
  await expect(page.locator('#toast')).toHaveText('New items will start with BOX');

  await page.goto(APP + '/items');
  await page.click(`.ptr:has-text("${ITEM}")`);
  await page.waitForSelector('#itBatchRows');
  await expect(page.locator('#itBatches th').nth(0)).toHaveText('Lot');
  await expect(page.locator('#itBatches th').nth(2)).toHaveText('Best before');
  // the expiry in its new format; Mfg has its own format and stays as it was
  await expect(page.locator('#itBatchRows tr[data-batch="A123"]')).toContainText('03/40');
  await expect(page.locator('#itBatchRows tr[data-batch="A123"]')).toContainText('Jan 2026');

  await page.click('button:has-text("Add item")');
  await expect(page.locator('#aiUnit')).toContainText('BOX');
  await page.click('#aiClose');

  await page.goto(APP + '/sales');
  await page.click('tr:has-text("Raju Stores")');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
  await expect(page.locator('#ipvSheet [data-pbatch]')).toHaveText('Lot A123 × 2 (Best before 03/40), No batch × 1');
  await page.keyboard.press('Escape');

  // a cleared label goes back to the usual word
  await openItemSettings(page, 2);
  await page.fill('#lb_batch', '');
  await page.press('#lb_batch', 'Enter');
  await expect(page.locator('#toast')).toHaveText('Label back to Batch no.');
  await expect(page.locator('#lb_batch')).toHaveValue('Batch no.');
});

test('with Exp Date off the item card and Item Batch Report have no expiry, and the Expiry Report is gone', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openItemSettings(page, 2);
  await untick(page, 'f_exp_date');
  await page.goto(APP + '/items');
  await page.click(`.ptr:has-text("${ITEM}")`);
  await page.waitForSelector('#itBatchRows');
  await expect(page.locator('#itBatches thead')).not.toContainText('Expiry');
  await expect(page.locator('#itBatches')).toContainText('oldest first');
  await page.goto(APP + '/reports?r=batch');
  await expect(page.locator('#rpBxF')).toHaveCount(0);
  await expect(page.locator('#rpMain')).not.toContainText('Expiry');
  await page.goto(APP + '/reports?r=expiry');
  await expect(page.locator('#rpMain')).toContainText('This report is being built');
});

test('staff don’t see the Items row or page, and the old Features address opens Items for the owner only', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  const manager = await addStaff(owner, 'Mohan Lal');
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/settings/features');
  await expect(page.locator('#setH')).toHaveText('Items');
  await expect(page).toHaveURL(APP + '/settings');
  await expect(page.locator('#subnav button:has-text("Features")')).toHaveCount(0);

  // the same browser tab, with the owner's page left open: the next person doesn't get it
  await page.click('#avBtn');
  await page.click('#miOut');
  await page.click('#soYes');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', manager.email);
  await page.fill('#aPass', manager.password);
  await page.click('#aGo');
  await page.waitForSelector('#app');
  await page.click('aside a:has-text("Settings")');
  await page.waitForSelector('#subnav');
  await expect(page.locator('#subnav button:has-text("Items")')).toBeHidden();
  await expect(page.locator('#itTabs')).toHaveCount(0);
  await page.goto(APP + '/settings/features');
  await expect(page.locator('#setH')).toHaveText('Taxes & GST');

  // and the server refuses, whatever the screen shows
  const status = await page.evaluate(async () => {
    const tok = (await (await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })).json()).accessToken as string;
    const put = (url: string, body: object) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) }).then((r) => r.status);
    return [await put('/api/settings/features', { enabled: ['mrp'] }), await put('/api/settings/item-options', { labels: {} })];
  });
  expect(status).toEqual([403, 403]);
});

test('Excel import: Rack / shelf is saved; a file made before it still loads; with Brand off the template leaves its columns out', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const { default: ExcelJS } = await import('exceljs');
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  const headsOf = async (file: string) => { const b = new ExcelJS.Workbook(); await b.xlsx.readFile(file); return (b.getWorksheet('Products')!.getRow(1).values as unknown[]).slice(1); };
  const template = async (to: string) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click('#imTpl')]); await d.saveAs(to); };
  const cells = () => page.$$eval('#imGrid input, #imGrid select, #imGrid td', (x) => x.map((e) => (e as HTMLInputElement).value ?? e.textContent).join('|'));
  const heads = ['Product type', 'Product name', 'Brand name', 'Series / range name', 'Brand code', 'Opening stock', 'At price', 'As of date', 'Base unit', 'Sale price', 'Stock alert', 'Location', 'Category', 'GST %', 'HSN'];
  const write = async (to: string, h: string[], row: (string | number)[]) => { const b = new ExcelJS.Workbook(); const s = b.addWorksheet('Products'); s.addRow(h); s.addRow(row); await b.xlsx.writeFile(to); };

  await page.goto(APP + '/items/import');
  const full = info.outputPath('full.xlsx');
  await template(full);
  expect(await headsOf(full)).toEqual([...heads, 'Rack / shelf']);

  // an older file, without the new column
  const old = info.outputPath('old.xlsx');
  await write(old, heads, ['Single Range', 'Old file fan', 'Bajaj', '', '', '', '', '', 'PCS', 100, '', '', 'Fans', 18, '']);
  await page.setInputFiles('#imFile', old);
  await expect.poll(cells).toContain('Old file fan');

  // with the column
  await page.goto(APP + '/items/import');
  const rack = info.outputPath('rack.xlsx');
  await write(rack, [...heads, 'Rack / shelf'], ['Single Range', 'Shelf fan', 'Bajaj', '', '', '', '', '', 'PCS', 100, '', '', 'Fans', 18, '', 'Rack B2']);
  await page.setInputFiles('#imFile', rack);
  await expect.poll(cells).toContain('Rack B2');

  // Brand off: its columns are left out of the template, and a file with them still loads
  await openItemSettings(page);
  await untick(page, 'f_brand');
  await page.goto(APP + '/items/import');
  const noBrand = info.outputPath('nobrand.xlsx');
  await template(noBrand);
  expect(await headsOf(noBrand)).toEqual(['Product type', 'Product name', 'Brand code', 'Opening stock', 'At price', 'As of date', 'Base unit', 'Sale price', 'Stock alert', 'Location', 'Category', 'GST %', 'HSN', 'Rack / shelf']);
  await page.setInputFiles('#imFile', rack);
  await expect.poll(cells).toContain('Shelf fan');
  expect(await cells()).not.toContain('Bajaj');
});
