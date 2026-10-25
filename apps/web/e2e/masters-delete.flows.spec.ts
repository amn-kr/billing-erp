/**
 * Edit, Delete and Inactive for items and parties (owner, Oct 2026), against the real API. The pencil opens
 * the Add item / Add party window filled in; Delete is on the left of its footer. A never-used one is
 * deleted after the "Delete …?" box; a used one gets the "Can’t delete …" box, whose Make inactive moves it
 * under "Show inactive" at the bottom of the list, where Make active brings it back. No passcode.
 */
import { expect, test, type Page } from '@playwright/test';
import { shop } from './masters-delete.data';
import { APP, newPage, signInAs } from './setup';

const box = (page: Page) => page.locator('#slm');
const listed = (page: Page, list: string, name: string) => page.locator(`${list} .ptr:not([data-inactive])`, { hasText: name });

test('items: Edit item saves the changes; a never-used item is deleted; a used one is made inactive and active again', async ({ browser, request }) => {
  const who = await shop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/items');

  // Edit item: the Add item window, filled in, with Delete instead of Save & new
  await listed(page, '#itList', 'LED bulb 9W').click();
  await page.click('#itEdit');
  await expect(page.locator('#aiT')).toHaveText('Edit item');
  await expect(page.locator('#aiName')).toHaveValue('LED bulb 9W');
  await expect(page.locator('#aiCode')).toHaveValue('LB09');
  await expect(page.locator('#aiSale')).toHaveValue('95');
  await expect(page.locator('#aiSaveNew')).toHaveCount(0);
  await expect(page.locator('#aiVar')).toBeDisabled();
  await expect(page.locator('#aiSvc')).toBeDisabled();
  await page.click('#ai [data-aitab="stock"]');
  await expect(page.locator('#ai [data-f="oq"]')).toHaveValue('40');
  await expect(page.locator('#ai [data-f="oq"]')).toBeDisabled();
  await page.fill('#aiName', 'LED bulb 9 W');
  await page.click('#ai [data-aitab="price"]');
  await page.fill('#aiSale', '99');
  await page.click('#aiSave');
  await expect(page.locator('#ai')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('LED bulb 9 W saved');
  await expect(page.locator('#itHead h2')).toHaveText('LED bulb 9 W');
  await expect(page.locator('#itHead .itfl')).toContainText('99.00');

  // never used (opening stock only): the Delete box, then gone; "Keep it" first keeps it
  await page.click('#itEdit');
  await page.click('#aiDel');
  await expect(page.locator('#ai')).toBeHidden();
  await expect(page.locator('#slmT')).toHaveText('Delete LED bulb 9 W?');
  await expect(page.locator('#slmBody')).toHaveText('This removes the item and its opening stock of 40 PCS for good. It isn’t used in any transaction.');
  await page.click('#slmCancel');
  await expect(box(page)).toBeHidden();
  await expect(listed(page, '#itList', 'LED bulb 9 W')).toHaveCount(1);
  await page.click('#itEdit');
  await page.click('#aiDel');
  await page.click('#slmOk');
  await expect(box(page)).toBeHidden();
  await expect(page.locator('#toast')).toContainText('LED bulb 9 W deleted');
  await expect(listed(page, '#itList', 'LED bulb 9 W')).toHaveCount(0);
  await expect(page.locator('#itemInactive')).toHaveCount(0); // deleted is not inactive

  // used: the Can't delete box offers Make inactive
  await listed(page, '#itList', 'Ceiling fan 1200mm').click();
  await page.click('#itEdit');
  await page.click('#aiDel');
  await expect(page.locator('#slmT')).toHaveText('Can’t delete Ceiling fan 1200mm');
  await expect(page.locator('#slmBody')).toHaveText('Ceiling fan 1200mm is used in 2 sale invoices, so it can’t be deleted. You can make it inactive instead: it is hidden from lists and new bills, and stays on old ones.');
  await expect(page.locator('#slmOk')).toHaveText('Make inactive');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toContainText('Ceiling fan 1200mm is now inactive');
  await expect(listed(page, '#itList', 'Ceiling fan 1200mm')).toHaveCount(0);
  await expect(page.locator('[data-inactive]')).toHaveCount(0);
  await page.click('#itemInactive');
  await expect(page.locator('#itemInactive')).toHaveText('Hide inactive');
  const row = page.locator('[data-inactive]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.ptn')).toHaveText('Ceiling fan 1200mm Inactive');
  await row.locator('[data-mkactive]').click();
  await expect(page.locator('#toast')).toContainText('Ceiling fan 1200mm is active again');
  await expect(listed(page, '#itList', 'Ceiling fan 1200mm')).toHaveCount(1);
  await expect(page.locator('#itemInactive')).toHaveCount(0);

  // a sale can no longer pick a deleted item
  const found = await (await request.get(APP + '/api/items?q=LED', { headers: { Authorization: `Bearer ${(await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken}` } })).json();
  expect(found).toEqual([]);
});

test('parties: Edit party saves the changes; a never-used party is deleted; a used one is made inactive and active again', async ({ browser, request }) => {
  const who = await shop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/parties');

  await listed(page, '#ptList', 'Mehta Electricals').click();
  await page.click('#ptEdit');
  await expect(page.locator('#apT')).toHaveText('Edit party');
  await expect(page.locator('#apName')).toHaveValue('Mehta Electricals');
  await expect(page.locator('#ap [data-f="phone"]')).toHaveValue('9845011122');
  await expect(page.locator('#apSaveNew')).toHaveCount(0);
  await page.fill('#ap [data-f="phone"]', '9845099999');
  await page.click('#apSave');
  await expect(page.locator('#ap')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Mehta Electricals saved');
  await expect(page.locator('#ptHead .ptmeta')).toContainText('98450 99999');

  // used: Can't delete → Make inactive → Show inactive → Make active
  await page.click('#ptEdit');
  await page.click('#apDel');
  await expect(page.locator('#slmT')).toHaveText('Can’t delete Mehta Electricals');
  await expect(page.locator('#slmBody')).toHaveText('Mehta Electricals is used in 2 sale invoices, so it can’t be deleted. You can make it inactive instead: it is hidden from lists and new bills, and stays on old ones.');
  await page.click('#slmOk');
  await expect(listed(page, '#ptList', 'Mehta Electricals')).toHaveCount(0);
  await page.click('#partyInactive');
  await expect(page.locator('[data-inactive]')).toHaveCount(1);
  await page.locator('[data-mkactive]').click();
  await expect(listed(page, '#ptList', 'Mehta Electricals')).toHaveCount(1);

  // the opening balance can't go below what was already received against it: the message is under the amount
  await listed(page, '#ptList', 'Patel Kirana').click();
  await page.click('#ptEdit');
  await page.click('#ap [data-aptab="cred"]');
  await expect(page.locator('#ap [data-f="ob"]')).toHaveValue('1000');
  await page.fill('#ap [data-f="ob"]', '300');
  await page.click('#apSave');
  await expect(page.locator('#ap')).toBeVisible();
  // (the ₹ shows when Settings › show currency symbol is on, as everywhere on screen)
  await expect(page.locator('#ap .aperr')).toHaveText(/^₹?400 was already received against the opening balance\. The opening balance can’t be less than that\. Edit or delete that payment first\.$/);
  await page.fill('#ap [data-f="ob"]', '400');
  await page.click('#apSave');
  await expect(page.locator('#ap')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Patel Kirana saved');

  // never used, with an opening balance: the Delete box says the balance goes too
  await listed(page, '#ptList', 'Masum Raza').click();
  await page.click('#ptEdit');
  await page.click('#apDel');
  await expect(page.locator('#slmT')).toHaveText('Delete Masum Raza?');
  await expect(page.locator('#slmBody')).toHaveText('This removes the party and its opening balance of 1,000 for good. It isn’t used in any transaction.');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toContainText('Masum Raza deleted');
  await expect(listed(page, '#ptList', 'Masum Raza')).toHaveCount(0);
  await expect(page.locator('#partyInactive')).toHaveCount(0);
});
