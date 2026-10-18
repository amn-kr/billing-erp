/** Phase 2 flows against the real API. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { brandItems } from './brands.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/importer/fixtures');

test('add a party from the Parties screen; it is saved and selected', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/parties');
  await expect(page.locator('#ptHead .ptempty b')).toHaveText('Add your first party');
  await page.click('#vParties .pthd .btn.p');
  await page.fill('#apName', 'Sharma Lights');
  await page.fill('#ap [data-f="phone"]', '9415000111');
  await page.selectOption('#apGroup', 'Contractors');
  await page.click('#ap [data-aptab="cred"]');
  await page.fill('#ap [data-f="ob"]', '2,500');
  await page.click('#apSave');
  await expect(page.locator('#toast')).toHaveText('Sharma Lights added to parties · opening balance 2,500 to receive');
  await expect(page.locator('#ptList .ptr.on .ptn')).toContainText('Sharma Lights');
  await expect(page.locator('#ptHead h2')).toHaveText('Sharma Lights');
  await expect(page.locator('#ptTx tr td').first()).toHaveText('Opening balance');
  // the same name again is refused in plain words
  await page.click('#vParties .pthd .btn.p');
  await page.fill('#apName', 'sharma lights');
  await page.click('#apSave');
  await expect(page.locator('#ap .aperr')).toHaveText('A party with this name already exists.');
  await page.keyboard.press('Escape');
  // search
  await page.fill('#ptQ', '94150001');
  await expect(page.locator('#ptList .ptr')).toHaveCount(1);
});

/** Picks a row of a searchable drop-down (components/SearchSelect) by opening its list. */
async function pickRow(page: Page, sel: string, name: string | RegExp) {
  await page.click(sel);
  await page.locator(`${sel}L`).getByRole('option', { name, exact: typeof name === 'string' }).click();
}

test('add items (with opening stock, service, brands/sizes) and adjust stock', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/items');
  await page.click('#vItems .pthd .btn.p');
  // opens on Product and Single; a single item has no series field
  await expect(page.locator('#aiTypeSw .on')).toHaveText('Product');
  await expect(page.locator('#aiVarSw .on')).toHaveText('Single');
  await expect(page.locator('#aiSeries')).toHaveCount(0);
  await page.fill('#aiName', 'LED bulb 9W');
  // unit: the Select unit window
  await page.click('#aiUnit');
  await expect(page.locator('#aiUnits')).toBeVisible();
  await page.selectOption('#aiUBase', 'PCS');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnits')).toBeHidden();
  await expect(page.locator('#aiUnit')).toHaveText('PCS');
  // Assign code: the shop's prefix (JE) and the first free number
  await page.click('#aiGen');
  await expect(page.locator('#aiCode')).toHaveValue('JE001');
  // a new category and a new brand from their popups; each is selected after Create
  await pickRow(page, '#aiCat', '+ Add category');
  await expect(page.locator('#aiAdd_cat')).toBeVisible();
  await expect(page.locator('#aiAdd_catN')).toHaveAttribute('placeholder', 'e.g., Grocery');
  await page.fill('#aiAdd_catN', 'Lighting');
  await page.click('#aiAdd_catGo');
  await expect(page.locator('#aiAdd_cat')).toBeHidden();
  await expect(page.locator('#aiCat')).toHaveValue('Lighting');
  await pickRow(page, '#aiBrandSel', '+ Add new brand');
  await page.fill('#aiAdd_brandN', 'Philips');
  await page.click('#aiAdd_brandGo');
  await expect(page.locator('#aiBrandSel')).toHaveValue('Philips');
  await page.fill('#aiSale', '95');
  await page.fill('#aiPurch', '62');
  await expect(page.locator('#aiMargin')).toHaveText('Margin per unit: 33.00 (53%)');
  await page.click('#ai [data-aitab="stock"]');
  await page.fill('#ai [data-f="oq"]', '200');
  await page.fill('#ai [data-f="min"]', '50');
  await page.click('#aiSave');
  await expect(page.locator('#toast')).toHaveText('LED bulb 9W added with 200 PCS in stock');
  await expect(page.locator('#itHead h2')).toHaveText('LED bulb 9W');
  await expect(page.locator('#itTx tr').first()).toContainText('Opening stock');

  // reduce below the minimum: low stock
  await page.click('#itAdj');
  await page.click('#adjSeg [data-am="reduce"]');
  await page.fill('#adjQty', '160');
  await expect(page.locator('#adjAfter')).toHaveText('Stock after: 40 PCS');
  await page.click('#adj button[type="submit"]');
  await expect(page.locator('#toast')).toHaveText('Stock reduced by 160 PCS');
  await expect(page.locator('#itTot')).toContainText('Low stock 1');
  await expect(page.locator('#itTx tr').first()).toContainText('ADJ-0001');
  await page.click('#itAdj');
  await page.click('#adjSeg [data-am="reduce"]');
  await page.fill('#adjQty', '41');
  await page.click('#adj button[type="submit"]');
  await expect(page.locator('#adjErr')).toHaveText('You only have 40 PCS in stock.');
  // something was typed, so Cancel asks first; Esc keeps editing, Discard closes
  await page.click('#adjCancel');
  await expect(page.locator('#dcfT')).toHaveText('Discard this stock adjustment?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dcf')).toBeHidden();
  await expect(page.locator('#adjQty')).toHaveValue('41');
  await page.click('#adjCancel');
  await page.click('#dcfYes');
  await expect(page.locator('#adj')).toBeHidden();

  // an item in several brands / sizes: one variant per save under a parent item
  await page.click('#vItems .pthd .btn.p');
  await page.click('#aiVar');
  await expect(page.locator('#aiVarSw .on')).toHaveText('Variant');
  // a new parent item from its popup
  await pickRow(page, '#aiName', '+ Add new parent item');
  await expect(page.locator('#aiAdd_group')).toBeVisible();
  await page.fill('#aiAdd_groupN', 'Copper wire 1.5 sq mm');
  await page.click('#aiAdd_groupGo');
  await expect(page.locator('#aiName')).toHaveValue('Copper wire 1.5 sq mm');
  await pickRow(page, '#aiBrandSel', '+ Add new brand');
  await page.fill('#aiAdd_brandN', 'Havells');
  await page.click('#aiAdd_brandGo');
  await expect(page.locator('#aiBrandSel')).toHaveValue('Havells');
  // a new brand has no series yet: typing one that isn't there, Enter opens "Add series" with it
  await page.fill('#aiSeries', 'FR Red');
  await expect(page.locator('#aiSeriesL')).toContainText('No match');
  await page.keyboard.press('Enter');
  await expect(page.locator('#aiAdd_seriesN')).toHaveValue('FR Red');
  await page.click('#aiAdd_seriesGo');
  await expect(page.locator('#toast')).toHaveText('Series “FR Red” added to Havells');
  await expect(page.locator('#aiSeries')).toHaveValue('FR Red');
  // Select unit: base unit named from the unit popup, a secondary unit and its rate
  await page.click('#aiUnit');
  await page.selectOption('#aiUBase', '__new');
  await expect(page.locator('#aiAdd_unit')).toBeVisible();
  await page.fill('#aiAdd_unitN', 'Coil');
  await page.fill('#aiAdd_unitS', 'COIL');
  await page.click('#aiAdd_unitGo');
  await expect(page.locator('#aiAdd_unit')).toBeHidden();
  await expect(page.locator('#aiUBase')).toHaveValue('COIL');
  await page.selectOption('#aiUSec', 'MTR');
  await page.fill('#aiURate', '90');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnit')).toHaveText('COIL · 1 COIL = 90 MTR');
  await page.fill('#aiSale', '1650');
  await page.click('#aiSaveNew');
  await expect(page.locator('#toast')).toHaveText('Copper wire 1.5 sq mm · Havells FR Red added');
  // Save & new keeps the parent item and brand
  await expect(page.locator('#aiName')).toHaveValue('Copper wire 1.5 sq mm');
  await expect(page.locator('#aiBrandSel')).toHaveValue('Havells');
  await expect(page.locator('#aiSeries')).toHaveValue('');
  // a series this parent item already has with this brand can be chosen (any capitals), but is flagged at once and Save refuses it
  await page.fill('#aiSeries', 'fr red');
  await expect(page.locator('#aiSeriesL [role="option"]').first()).toHaveText('FR Redalready added');
  await page.keyboard.press('Enter');
  await expect(page.locator('#aiSeries')).toHaveValue('FR Red');
  await expect(page.locator('#aiSeriesDup')).toHaveText('Copper wire 1.5 sq mm Havells FR Red is already added. Open that item');
  await page.fill('#aiSale', '1650');
  await page.click('#aiSave');
  await expect(page.locator('#aiSeriesDup')).toContainText('Copper wire 1.5 sq mm Havells FR Red is already added.');
  await expect(page.locator('#ai')).toBeVisible();
  // a new series instead
  await page.fill('#aiSeries', 'FR Black');
  await page.keyboard.press('Enter');
  await page.click('#aiAdd_seriesGo');
  await expect(page.locator('#aiSeriesDup')).toHaveCount(0);
  await page.click('#aiSave');
  await expect(page.locator('#toast')).toHaveText('Copper wire 1.5 sq mm · Havells FR Black added');
  await expect(page.locator('#itHead h2')).toHaveText('Copper wire 1.5 sq mm');
  await expect(page.locator('#itHead .vtab tbody tr')).toHaveCount(2);
  // the rate used is offered again in the Select unit window
  await page.click('#vItems .pthd .btn.p');
  await page.click('#aiUnit');
  await page.selectOption('#aiUBase', 'COIL');
  await page.selectOption('#aiUSec', 'MTR');
  await expect(page.locator('#aiUnits .cb2').nth(1)).toHaveText('1 COIL = 90 MTR');
  await page.keyboard.press('Escape');
  await expect(page.locator('#aiUnits')).toBeHidden();
  await page.click('#aiClose');

  // a service
  await page.click('#vItems .pthd .btn.p');
  await page.click('#aiSvc');
  // a service has no Single / Variant choice
  await expect(page.locator('#aiVarSw')).toHaveCount(0);
  await page.fill('#aiName', 'Fan installation');
  await page.fill('#aiSale', '350');
  await page.click('#aiSave');
  await expect(page.locator('#itKind')).toHaveText('Services');
  await expect(page.locator('#itHead h2')).toHaveText('Fan installation');
});

test('Add item › Variant: parent by typing, only the brand’s series, add a series, Save & new; Brands & Series shows it', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  // 6A-10A 1WAY SWITCH in HAVELLS CORAL / PEARLZ and NORWOOD CLASSIC, and LED 12W (HAVELLS, single)
  await brandItems(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/items');
  await page.click('#vItems .pthd .btn.p');
  await page.click('#aiVar');
  // Parent item: type to filter, Enter picks the first match
  await page.fill('#aiName', '1way');
  await expect(page.locator('#aiNameL [role="option"]')).toHaveText(['6A-10A 1WAY SWITCH', '+ Add new parent item “1way”']);
  await page.keyboard.press('Enter');
  await expect(page.locator('#aiName')).toHaveValue('6A-10A 1WAY SWITCH');
  // Series waits for a brand
  await expect(page.locator('#aiSeries')).toBeDisabled();
  await expect(page.locator('#aiSeries')).toHaveAttribute('placeholder', 'Choose a brand first');
  // Brand by typing; then the series list has only that brand's series, the ones this item has are "already added"
  await page.fill('#aiBrandSel', 'hav');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('#aiBrandSel')).toHaveValue('HAVELLS');
  await page.click('#aiSeries');
  await expect(page.locator('#aiSeriesL [role="option"]')).toHaveText(['CORALalready added', 'PEARLZalready added', '+ Add series']);
  // Esc closes only the list, not Add item
  await page.keyboard.press('Escape');
  await expect(page.locator('#aiSeriesL')).toBeHidden();
  await expect(page.locator('#ai')).toBeVisible();
  // + Add series: saved on the brand and chosen
  await page.click('#aiSeries');
  await page.locator('#aiSeriesL').getByRole('option', { name: '+ Add series', exact: true }).click();
  await expect(page.locator('#aiAdd_seriesT')).toHaveText('Add series to HAVELLS');
  await page.fill('#aiAdd_seriesN', 'Allure');
  await page.click('#aiAdd_seriesGo');
  await expect(page.locator('#toast')).toHaveText('Series “Allure” added to HAVELLS');
  await expect(page.locator('#aiSeries')).toHaveValue('Allure');
  await page.fill('#aiSale', '55');
  await page.click('#aiSaveNew');
  await expect(page.locator('#toast')).toHaveText('6A-10A 1WAY SWITCH · HAVELLS Allure added');
  // Save & new keeps the parent item and brand, clears the series; Allure is now "already added"
  await expect(page.locator('#aiName')).toHaveValue('6A-10A 1WAY SWITCH');
  await expect(page.locator('#aiBrandSel')).toHaveValue('HAVELLS');
  await expect(page.locator('#aiSeries')).toHaveValue('');
  await expect(page.locator('#aiName')).toBeFocused();
  await page.click('#aiSeries');
  await expect(page.locator('#aiSeriesL [role="option"]')).toHaveText(['Allurealready added', 'CORALalready added', 'PEARLZalready added', '+ Add series']);
  await page.keyboard.press('Escape');
  // another parent item: the same brand's series can all be chosen; changing the brand clears the series
  await page.fill('#aiName', 'Switch plate');
  await page.keyboard.press('Enter');
  await page.fill('#aiAdd_groupN', 'Switch plate');
  await page.click('#aiAdd_groupGo');
  await page.click('#aiSeries');
  await page.locator('#aiSeriesL').getByRole('option', { name: 'CORAL', exact: true }).click();
  await expect(page.locator('#aiSeries')).toHaveValue('CORAL');
  await page.click('#aiBrandSel');
  await page.locator('#aiBrandSelL').getByRole('option', { name: 'NORWOOD', exact: true }).click();
  await expect(page.locator('#aiSeries')).toHaveValue('');
  await page.click('#aiSeries');
  await expect(page.locator('#aiSeriesL [role="option"]')).toHaveText(['CLASSIC', '+ Add series']);
  await page.keyboard.press('Escape');

  // an "already added" series can be chosen: flagged at once, Save makes no second item, "Open that item" opens it
  await page.fill('#aiName', '1way');
  await page.keyboard.press('Enter');
  await page.fill('#aiBrandSel', 'havells');
  await page.keyboard.press('Enter');
  await page.click('#aiSeries');
  await page.locator('#aiSeriesL').getByRole('option', { name: 'Allure already added' }).click();
  await expect(page.locator('#aiSeriesDup')).toHaveText('6A-10A 1WAY SWITCH HAVELLS Allure is already added. Open that item');
  await page.fill('#aiSale', '60');
  await page.click('#aiSave');
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#aiSeriesDup')).toContainText('is already added.');
  await page.click('#aiOpenDup');
  await expect(page.locator('#ai')).toBeHidden();
  await expect(page.locator('#itHead h2')).toHaveText('HAVELLS Allure');
  // still one Allure: the parent item has its four variants (CORAL, PEARLZ, NORWOOD CLASSIC, Allure)
  await page.click('#itHead [data-gback]');
  await expect(page.locator('#itHead .vtab tbody tr')).toHaveCount(4);

  // Brands & Series lists the series added from Add item
  await page.goto(APP + '/items/brands');
  await page.click('[data-bst="series"]');
  await expect(page.locator('#bsRows tr', { hasText: 'Allure' }).locator('td').nth(1)).toHaveText('HAVELLS');
});

test('import upload: the old app’s backup is checked, then imported into empty books', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.setInputFiles('#bkpFile', path.join(FIXTURES, 'fresh-shop.backup.json'));
  await expect(page.locator('#rsm')).toBeVisible();
  await expect(page.locator('#rsmSub')).toHaveText('From file · fresh-shop.backup.json');
  await expect(page.locator('#rsmBody .rcv')).toContainText('Gupta Electricals & Hardware');
  await expect(page.locator('#rsmCheck')).toContainText('Ready: 4 parties and 4 items.');
  await expect(page.locator('#rsmGo')).toBeDisabled();
  await page.click('#rsmOk');
  // the safety copy of the current books downloads first
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rsmGo')]);
  expect(dl.suggestedFilename()).toMatch(/^Verma-Traders-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  await expect(page.locator('#toast')).toContainText('4 parties and 4 items came in.');
  await page.goto(APP + '/parties');
  await expect(page.locator('#ptList .ptr')).toHaveCount(4);
  // a second import is refused in plain words (it would enter everything twice)
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.setInputFiles('#bkpFile', path.join(FIXTURES, 'fresh-shop.backup.json'));
  await expect(page.locator('#rsmErr')).toContainText('already has parties or items');
  await page.click('#rsmCancel');
  // a file that isn't a backup
  await page.setInputFiles('#bkpFile', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('#toast')).toHaveText('This file isn’t a backup from this app.');
});

test('download backup gives this shop’s books; start fresh keeps the old books', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'fresh-shop'));
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkpDlBtn')]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(data).toMatchObject({ app: 'billing-erp-cloud', biz: 'Gupta Electricals & Hardware', counts: { parties: 4, items: 4 } });
  await expect(page.locator('#bkpLastTxt')).toContainText('Last downloaded on this device');
  // start fresh with the item list
  await page.click('#bzFreshBtn');
  await page.fill('#bzfName', 'Gupta Traders');
  await page.click('#bzfKeep');
  await expect(page.locator('#bzmGo')).toBeDisabled();
  await page.click('#bzfOk');
  await page.click('#bzmGo');
  await expect(page.locator('#toast')).toHaveText('Fresh books started for Gupta Traders. Add your parties and items to begin.');
  await page.goto(APP + '/items');
  await expect(page.locator('#itList .ptr')).toHaveCount(3); // goods only (the service is on the Services list)
  await page.goto(APP + '/parties');
  await expect(page.locator('#ptHead .ptempty b')).toHaveText('Add your first party');
  // the old books are still there, in the shop menu
  await page.click('#orgBtn');
  await expect(page.locator('#orgPop')).toContainText('Gupta Electricals & Hardware');
});
