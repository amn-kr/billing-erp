/** Phase 2 flows against the real API. */
import { expect, test } from '@playwright/test';
import { APP, newPage, signInAs } from './setup';

let n = 0;
/** A brand-new shop for tests that change data, so the screenshot shop stays as imported. */
async function freshShop(request: import('@playwright/test').APIRequestContext) {
  const who = { email: `masters.${Date.now().toString(36)}.${++n}@flows.example.com`, password: 'flows password 1' };
  const reg = await request.post(APP + '/api/auth/register', { data: { ...who, name: 'Pooja Verma' } });
  const token = (await reg.json()).accessToken;
  await request.post(APP + '/api/businesses', { headers: { Authorization: `Bearer ${token}` }, data: { name: 'Verma Traders', owner: 'Pooja Verma', state: '09', gstin: '09AAGFG2231M1ZQ' } });
  return who;
}

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
