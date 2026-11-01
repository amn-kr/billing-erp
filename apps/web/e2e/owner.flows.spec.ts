/**
 * The software owner's panel (owner's request, 1 Nov 2026): one-time setup on the sign-in page, the owner signs
 * in on the shared page and lands on /owner, Suspend stops a shop signing in (with the paused message),
 * Reactivate lets it back, a shop user can't open /owner, and signing out of the panel closes it.
 */
import { expect, test } from '@playwright/test';
import { APP, PANEL, freshShop, newPage, panelAccount, signInPanel } from './setup';

test('owner setup page: closed after the first account; wrong code refused', async ({ browser, request }) => {
  const page = await newPage(browser, 1280);
  const open = (await (await request.get(APP + '/api/owner/setup')).json()) as { open: boolean };
  await page.goto(APP + '/login?setup');
  if (open.open) {
    await page.waitForSelector('#fOwnerSetup');
    await page.fill('#osCode', 'not-the-setup-code');
    await page.fill('#osName', PANEL.name);
    await page.fill('#osEmail', PANEL.email);
    await page.fill('#osPass', 'short');
    await page.fill('#osPass2', 'short');
    await page.click('#osGo');
    await expect(page.locator('#osErr')).toHaveText('Use at least 12 characters for the password.');
    await page.fill('#osPass', PANEL.password);
    await page.fill('#osPass2', PANEL.password);
    await page.click('#osGo');
    await expect(page.locator('#osErr')).toHaveText('The setup code is wrong.');
    await page.fill('#osCode', PANEL.code);
    await page.click('#osGo');
    await expect(page.locator('#vSetup h2')).toHaveText('Owner account created');
    await page.click('#osDone');
    await page.waitForSelector('#vAuth:not([hidden])');
    await page.goto(APP + '/login?setup');
  } else {
    await panelAccount(request);
  }
  await expect(page.locator('#vSetup h2')).toHaveText('Setup is closed');
});

test('suspend, paused sign-in, reactivate; shop users can’t open /owner; sign out', async ({ browser, request }) => {
  test.setTimeout(120_000);
  await panelAccount(request);
  const shop = await freshShop(request);

  const p = await newPage(browser, 1280);
  await signInPanel(p);
  expect(new URL(p.url()).pathname).toBe('/owner');
  await expect(p.locator('.me b')).toHaveText(PANEL.name);
  await p.fill('#q', shop.email);
  await expect(p.locator('#rows tr[data-id]')).toHaveCount(1);
  const row = p.locator('#rows tr[data-id]');
  await expect(row).toContainText('Trial ·');
  await row.click();
  await expect(p.locator('#drw h2')).toHaveText('Verma Traders');
  await p.click('#susp');
  await expect(p.locator('#unsusp')).toBeVisible();
  await expect(p.locator('#toast')).toContainText('suspended. They can’t sign in until you reactivate.');
  await p.keyboard.press('Escape');
  await expect(p.locator('#ov')).toBeHidden();
  await expect(row).toContainText('Suspended');

  // the shop's owner, in another browser: refused with the paused message
  const s = await newPage(browser, 1280);
  await s.goto(APP + '/login');
  await s.waitForSelector('#vAuth:not([hidden])');
  await s.fill('#aEmail', shop.email);
  await s.fill('#aPass', shop.password);
  await s.click('#aGo');
  await expect(s.locator('#aErr')).toHaveText('This shop’s account is paused. Please contact support.');

  // reactivate: the shop opens again
  await row.click();
  await p.click('#unsusp');
  await expect(p.locator('#susp')).toBeVisible();
  await s.click('#aGo');
  await s.waitForSelector('#app');

  // a shop user typing /owner goes back to the sign-in page, which sends them to their shop
  await s.goto(APP + '/owner');
  await s.waitForSelector('#app');
  expect(new URL(s.url()).pathname).toBe('/');

  // sign out of the panel: /owner asks for the sign-in again
  await p.keyboard.press('Escape');
  await p.click('#signOut');
  await p.waitForSelector('#vAuth:not([hidden])');
  await p.goto(APP + '/owner');
  await p.waitForSelector('#vAuth:not([hidden])');
  expect(new URL(p.url()).pathname).toBe('/login');
});

test('a wrong password for the owner shows the usual words', async ({ browser, request }) => {
  await panelAccount(request);
  const p = await newPage(browser, 1280);
  await p.goto(APP + '/login');
  await p.waitForSelector('#vAuth:not([hidden])');
  await p.fill('#aEmail', PANEL.email);
  await p.fill('#aPass', 'not the owner password');
  await p.click('#aGo');
  await expect(p.locator('#aErr')).toHaveText('Email or password is wrong.');
  expect(new URL(p.url()).pathname).toBe('/login');
});
