/**
 * The normal build (test mode off) shows the name from packages/shared/src/brand.ts: on the sign-in page, in the
 * page titles, in the sidebar and on the Privacy policy and Terms pages. The other tests run in test mode
 * (the old app's name, like the prototype), so this one uses its own server (playwright.config.ts).
 */
import { expect, test } from '@playwright/test';
import { BRAND } from '../../../packages/shared/src/brand';
import { newPage, OWNER } from './setup';

const BUILD = 'http://localhost:5175';
const letter = BRAND.name.charAt(0).toUpperCase();

test('the normal build shows the name from the brand file', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(BUILD + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await expect(page).toHaveTitle(`${BRAND.name} — sign in`);
  await expect(page.locator('#appName')).toHaveText(BRAND.name);
  await expect(page.locator('#appLogo')).toHaveText(letter);

  await page.fill('#aEmail', OWNER.email);
  await page.fill('#aPass', OWNER.password);
  await page.click('#aGo');
  await page.waitForSelector('#app');
  await expect(page.locator('.sbh b')).toHaveText(BRAND.name);
  await expect(page.locator('.sbh .logo')).toHaveText(letter);
  await expect(page).toHaveTitle(`${BRAND.name} – Dashboard`);

  for (const [file, title] of [['privacy.html', 'Privacy policy'], ['terms.html', 'Terms of service']]) {
    await page.goto(`${BUILD}/${file}`);
    await expect(page).toHaveTitle(`${title} — ${BRAND.name}`);
    await expect(page.locator('a.brand')).toHaveText(letter + BRAND.name);
    expect(await page.content()).not.toContain('{{');
  }
});
