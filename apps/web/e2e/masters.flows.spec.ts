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
