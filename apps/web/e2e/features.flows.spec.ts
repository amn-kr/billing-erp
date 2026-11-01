/**
 * Settings › Features (owner's request, 1 Nov 2026): the owner ticks what the shop uses. Ticking Medical ticks
 * and locks the other two; unticking asks first and keeps the data; staff don't see the page at all.
 */
import { expect, test, type Page } from '@playwright/test';
import { addStaff } from './staff-reset.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const openPage = async (page: Page) => {
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="features"]');
  await page.waitForSelector('#cFeat');
};
const state = async (page: Page) => [await page.isChecked('#f_batch_expiry'), await page.isChecked('#f_mrp_pack'), await page.isChecked('#f_medical')];

test('ticking Medical ticks and locks the other two; they come free when Medical is unticked', async ({ browser, request }) => {
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openPage(page);
  expect(await state(page)).toEqual([false, false, false]);

  await page.click('#f_medical');
  await expect(page.locator('#f_batch_expiry')).toBeChecked();
  await expect(page.locator('#f_mrp_pack')).toBeChecked();
  await expect(page.locator('#f_batch_expiry')).toBeDisabled();
  await expect(page.locator('#f_mrp_pack')).toBeDisabled();
  await expect(page.locator('#toast')).toHaveText('Medical turned on, with Batch and expiry and MRP and pack/loose');
  await expect(page.locator('[data-feature="batch_expiry"] .st')).toHaveText('Needed by Medical');
  await expect(page.locator('[data-feature="mrp_pack"] small')).toContainText('Untick Medical first to change it.');

  // kept after a reload
  await page.reload();
  await page.click('#subnav [data-settab="features"]');
  await page.waitForSelector('#f_medical:checked');
  expect(await state(page)).toEqual([true, true, true]);

  // unticking asks first; "Keep it on" changes nothing
  await page.click('#f_medical');
  await expect(page.locator('#cfmT')).toHaveText('Turn off Medical?');
  await expect(page.locator('#cfm p')).toContainText('Your data stays');
  await expect(page.locator('#cfm p')).toContainText('Batch and expiry and MRP and pack/loose stay on.');
  await page.click('#cfmNo');
  await expect(page.locator('#cfm')).toBeHidden();
  expect(await state(page)).toEqual([true, true, true]);

  await page.click('#f_medical');
  await page.click('#cfmYes');
  await expect(page.locator('#f_medical')).not.toBeChecked();
  await expect(page.locator('#f_batch_expiry')).toBeEnabled();
  await expect(page.locator('[data-feature="batch_expiry"] .st')).toHaveCount(0);
  expect(await state(page)).toEqual([true, true, false]);

  // now each one goes on its own
  await page.click('#f_batch_expiry');
  await expect(page.locator('#cfmT')).toHaveText('Turn off Batch and expiry?');
  await page.click('#cfmYes');
  await expect(page.locator('#f_batch_expiry')).not.toBeChecked();
  expect(await state(page)).toEqual([false, true, false]);
});

test('staff see no Features row or page, and the server refuses them', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  const manager = await addStaff(owner, 'Mohan Lal');
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openPage(page);

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
  await expect(page.locator('#subnav button:has-text("Features")')).toHaveCount(0);
  await expect(page.locator('#cFeat')).toHaveCount(0);

  // and the server refuses, whatever the screen shows
  const status = await page.evaluate(async () => {
    const tok = (await (await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })).json()).accessToken as string;
    return (await fetch('/api/settings/features', { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ enabled: ['mrp_pack'] }) })).status;
  });
  expect(status).toBe(403);
});
