/**
 * The public Privacy policy and Terms of service pages open without signing in, say who runs the app and
 * how to reach them, say they are not legal advice, and are linked from the sign-in page (the home page).
 */
import { expect, test } from '@playwright/test';
import { OLD_APP } from '../../../packages/shared/src/brand';
import { APP, newPage } from './setup';

// Playwright's app runs in test mode: it shows the old name, like the prototype (vite.config.ts)
const NAME = OLD_APP.name;

test('Privacy policy: open to everyone, honest about Google Drive, not legal advice', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/privacy.html');
  await expect(page).toHaveTitle(`Privacy policy — ${NAME}`);
  await expect(page.locator('article h2')).toHaveText('Privacy policy');
  await expect(page.locator('#notAdvice')).toHaveText(`This page is general information about how ${NAME} handles your information, written in plain words. It is not legal advice.`);
  await expect(page.locator('#operator')).toHaveText('Aman Kumar');
  await expect(page.locator('#contact')).toHaveAttribute('href', 'mailto:amanxbkj@gmail.com');
  const text = await page.locator('article').innerText();
  expect(text).toContain('files this app creates');
  expect(text).toContain('The app cannot see, open or change any other file in your Google Drive.');
  expect(text).toContain('We keep it encrypted (AES-256) on our server.');
  expect(text).toContain('including the Limited Use requirements');
  await page.click('main > p a[href="/terms.html"]');
  await expect(page.locator('article h2')).toHaveText('Terms of service');
});

test('Terms of service: open to everyone, who runs the app, the courts, not legal advice', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/terms.html');
  await expect(page).toHaveTitle(`Terms of service — ${NAME}`);
  await expect(page.locator('#notAdvice')).toHaveText(`This page is general information about the terms for using ${NAME}, written in plain words. It is not legal advice.`);
  await expect(page.locator('#operator')).toHaveText('Aman Kumar');
  await expect(page.locator('#city')).toHaveText('Bikramganj');
  await expect(page.locator('#contact')).toHaveText('amanxbkj@gmail.com');
  await page.click('article a[href="/privacy.html"]');
  await expect(page.locator('article h2')).toHaveText('Privacy policy');
  // the logo leads to the sign-in page (the home page)
  await page.click('a.brand');
  await expect(page).toHaveURL(APP + '/login');
});

test('the sign-in page links to both pages', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/login');
  await expect(page.locator('#legal')).toHaveText('Privacy policy · Terms of service');
  await page.click('#legal a[href="/privacy.html"]');
  await expect(page).toHaveURL(APP + '/privacy.html');
  await page.goBack();
  await page.click('#legal a[href="/terms.html"]');
  await expect(page).toHaveURL(APP + '/terms.html');
});
