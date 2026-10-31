/**
 * Settings › General › Team › Reset password (owner's request, 25 Oct 2026): the owner gives a staff
 * member a temporary password, shown once; the staff member signs in with it and must choose a new
 * password before anything else. Accounts used in another shop can't be reset from here.
 */
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';
import { addStaff, inviteOnly, STAFF_PASSWORD, TEMP_RE } from './staff-reset.data';

const openTeam = async (page: Page) => {
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.waitForSelector('#tmList b');
};
const row = (page: Page, name: string) => page.locator('#tmList > div', { has: page.locator(`b:text-is("${name}")`) });
const loginStatus = async (who: { email: string; password: string }) => {
  const api = await playwrightRequest.newContext();
  try { return (await api.post(APP + '/api/auth/login', { data: who })).status(); } finally { await api.dispose(); }
};

test('owner resets a staff password; the staff member chooses a new one before anything else', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  const ramesh = await addStaff(owner, 'Ramesh Yadav');
  await addStaff(owner, 'Pooja Singh', { ownShop: 'Singh Traders' });
  const invited = await inviteOnly(owner, 'suresh');

  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openTeam(page);
  // the prototype's Team card: owner first, staff, the waiting invite
  await expect(row(page, 'Pooja Verma').locator('.st')).toHaveText('Owner');
  await expect(row(page, 'Ramesh Yadav').locator('.st')).toHaveText('Staff');
  await expect(page.locator('#tmList > div', { hasText: invited })).toContainText('invited · not joined yet');
  // the owner has no Reset password or Remove on their own row; Pooja also uses her account in her own shop
  await expect(row(page, 'Pooja Verma').locator('button')).toHaveCount(0);
  await expect(row(page, 'Pooja Singh').locator('[data-tmrp]')).toBeDisabled();
  await expect(row(page, 'Pooja Singh').locator('[data-tmrp]')).toHaveAttribute('title', /another shop/);

  // Keep it: nothing changes
  await row(page, 'Ramesh Yadav').locator('[data-tmrp]').click();
  await expect(page.locator('#slmT')).toHaveText('Reset Ramesh Yadav’s password?');
  await page.click('#slmCancel');
  await expect(page.locator('#slm')).toBeHidden();
  expect(await loginStatus(ramesh)).toBe(200);

  // Reset: the temporary password, shown once
  await row(page, 'Ramesh Yadav').locator('[data-tmrp]').click();
  await page.click('#slmOk');
  await expect(page.locator('#slmT')).toHaveText('Temporary password for Ramesh Yadav');
  const temp = await page.inputValue('#tmTemp');
  expect(temp).toMatch(TEMP_RE);
  await expect(page.locator('#slmCancel')).toHaveText('Done');
  await page.click('#slmCancel');
  await expect(page.locator('#slm')).toBeHidden();
  await expect(page.locator('#tmTemp')).toHaveCount(0);
  expect(await loginStatus(ramesh)).toBe(401);

  // Ramesh signs in with it: "Choose a new password", the temporary one isn't asked again
  const staff = await newPage(browser, 1366);
  await staff.goto(APP + '/login');
  await staff.fill('#aEmail', ramesh.email);
  await staff.fill('#aPass', temp);
  await staff.click('#aGo');
  await staff.waitForSelector('#vPass:not([hidden])');
  await expect(staff.locator('#pCur')).toBeHidden();
  await staff.fill('#pNew', 'short');
  await staff.fill('#pNew2', 'short');
  await staff.click('#pGo');
  await expect(staff.locator('#pErr')).toHaveText('Use at least 8 characters for the password.');
  await staff.fill('#pNew', 'ramesh new password');
  await staff.fill('#pNew2', 'ramesh new passwrod');
  await staff.click('#pGo');
  await expect(staff.locator('#pErr')).toHaveText('The two passwords don’t match.');

  // opening the app instead goes back to the same step (the server refuses everything else anyway)
  await staff.goto(APP + '/');
  await staff.waitForSelector('#vPass:not([hidden])');
  await expect(staff).toHaveURL(/\/login/);
  // after a page load the temporary password is asked for
  await expect(staff.locator('#pCur')).toBeVisible();
  await staff.fill('#pCur', 'WRONG-WRON-WRON');
  await staff.fill('#pNew', 'ramesh new password');
  await staff.fill('#pNew2', 'ramesh new password');
  await staff.click('#pGo');
  await expect(staff.locator('#pErr')).toHaveText('The current password is wrong.');
  await staff.fill('#pCur', temp);
  await staff.click('#pGo');
  await staff.waitForSelector('#app');
  await expect(staff.locator('#orgName')).toHaveText('Verma Traders');

  expect(await loginStatus({ email: ramesh.email, password: temp })).toBe(401);
  expect(await loginStatus({ email: ramesh.email, password: STAFF_PASSWORD })).toBe(401);
  expect(await loginStatus({ email: ramesh.email, password: 'ramesh new password' })).toBe(200);
});

test('Team card: invite, cancel the invite, remove a member (as in the prototype)', async ({ browser, request }) => {
  const owner = await freshShop(request);
  const ramesh = await addStaff(owner, 'Ramesh Yadav');
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openTeam(page);
  await page.click('#tmInvite');
  await expect(page.locator('#tmErr')).toHaveText('Enter a valid email address.');
  await page.fill('#tmEmail', owner.email);
  await page.click('#tmInvite');
  await expect(page.locator('#tmErr')).toHaveText('That’s your own email.');
  await page.fill('#tmEmail', 'new.staff@team.example.com');
  await page.click('#tmInvite');
  await expect(page.locator('#toast')).toContainText('Invite sent to new.staff@team.example.com');
  const inv = page.locator('#tmList > div', { hasText: 'new.staff@team.example.com' });
  await expect(inv).toContainText('invited · not joined yet');
  await inv.locator('[data-tmcx]').click();
  await expect(page.locator('#toast')).toContainText('Invite cancelled');
  await expect(inv).toHaveCount(0);

  await row(page, 'Ramesh Yadav').locator('[data-tmrm]').click();
  await expect(page.locator('#slmT')).toHaveText('Remove Ramesh Yadav?');
  await page.click('#slmOk');
  await expect(page.locator('#toast')).toContainText('Ramesh Yadav removed');
  await expect(row(page, 'Ramesh Yadav')).toHaveCount(0);
  // he can still sign in, but no longer opens this shop's books
  expect(await loginStatus(ramesh)).toBe(200);
});

test('staff who are not the owner see the team without the owner’s buttons', async ({ browser, request }) => {
  const owner = await freshShop(request);
  const manager = await addStaff(owner, 'Ramesh Yadav');
  const page = await newPage(browser, 1366);
  await signInAs(page, manager);
  await openTeam(page);
  await expect(page.locator('#tmEmail')).toHaveCount(0);
  await expect(page.locator('[data-tmrp], [data-tmrm], [data-tmcx]')).toHaveCount(0);
  await expect(row(page, 'Ramesh Yadav').locator('small')).toContainText('· you');
});
