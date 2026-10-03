/** Phase 2 flows against the real API. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
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

test('add items (with opening stock, service, brands/sizes) and adjust stock', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/items');
  await page.click('#vItems .pthd .btn.p');
  await page.fill('#aiName', 'LED bulb 9W');
  await page.selectOption('#aiUnit', 'PCS');
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
  await page.click('#adjCancel');

  // an item in several brands
  await page.click('#vItems .pthd .btn.p');
  await page.fill('#aiName', 'Modular switch 6A');
  await page.click('#aiVar');
  await page.locator('#aiNewBrandName').waitFor({ state: 'hidden' });
  await page.selectOption('#ai [data-vr="0"][data-k="brand"]', '__new');
  await page.fill('#aiNewBrandName', 'Havells');
  await page.click('#aiNewBrandAdd');
  await page.selectOption('#ai [data-vr="0"][data-k="brand"]', 'Havells');
  await page.fill('#ai [data-vr="0"][data-k="series"]', 'Coral');
  await page.fill('#ai [data-vr="0"][data-k="sale"]', '44');
  await page.selectOption('#ai [data-vr="1"][data-k="brand"]', '__new');
  await page.fill('#aiNewBrandName', 'Legrand');
  await page.click('#aiNewBrandAdd');
  await page.selectOption('#ai [data-vr="1"][data-k="brand"]', 'Legrand');
  await page.fill('#ai [data-vr="1"][data-k="series"]', 'Myrius');
  await page.fill('#ai [data-vr="1"][data-k="sale"]', '58');
  await page.click('#aiSave');
  await expect(page.locator('#toast')).toHaveText('Modular switch 6A added with 2 brands / sizes');
  await expect(page.locator('#itHead h2')).toHaveText('Modular switch 6A');
  await expect(page.locator('#itHead .vtab tbody tr')).toHaveCount(2);
  await expect(page.locator('#itList .grh .brc')).toHaveText('2 brands');

  // a service
  await page.click('#vItems .pthd .btn.p');
  await page.click('#aiSvc');
  await page.fill('#aiName', 'Fan installation');
  await page.fill('#aiSale', '350');
  await page.click('#aiSave');
  await expect(page.locator('#itKind')).toHaveText('Services');
  await expect(page.locator('#itHead h2')).toHaveText('Fan installation');
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
