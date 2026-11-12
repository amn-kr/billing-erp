/**
 * Bring my online books to this PC (Phase 6, step 7b): on the PC, an online email says plainly that it isn't
 * on this computer and offers to bring the books down; online, a moved shop shows a view-only line on every
 * screen and refuses changes.
 */
import { expect, test } from '@playwright/test';
import { onThisPc, typeOnlineAccount } from './bring.data';
import { APP, freshShop, newPage, signInAs } from './setup';

test('on the PC: an online account is not here → bring the books down, or create an account', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  const sent = await onThisPc(page);
  await typeOnlineAccount(page, APP);
  await expect(page.locator('#aNotHere')).toContainText('There’s no account with this email on this computer yet. Your online account is separate.');
  await expect(page.locator('#aErr')).toHaveText('');
  // Create account: the same form, as a new account on this PC
  await page.click('#aUp');
  await expect(page.locator('#authT')).toHaveText('Create your account');
  await expect(page.locator('#aNotHere')).toHaveCount(0);
  await page.click('[data-mode="in"]');
  await page.click('#aGo');
  // Bring my online books: the email and password come along
  await page.click('#aBring');
  await expect(page.locator('#vBring h2')).toHaveText('Bring your online books to this PC');
  await expect(page.locator('#bEmail')).toHaveValue('pooja.verma@gmail.com');
  await page.click('#bFind');
  expect(sent.shops).toEqual({ email: 'pooja.verma@gmail.com', password: 'online password 1' });
  // one shop can come (chosen already); the one already on a PC can't
  await expect(page.locator('[data-shop="BE-1042"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-shop="BE-1043"]')).toBeDisabled();
  await expect(page.locator('[data-shop="BE-1043"]')).toContainText('on a PC since 3 Nov 2026');
  await expect(page.locator('#bNote')).toContainText('Online, this shop then becomes view-only');
  await page.click('#bGo');
  expect(sent.bring).toEqual({ email: 'pooja.verma@gmail.com', password: 'online password 1', businessId: '7d1c4a52-2f0e-4c8e-9a51-3b6f2a1d9e01', confirm: true });
  await expect(page.locator('#bDone h2')).toHaveText('Your books are on this PC');
  await expect(page.locator('#bDone')).toContainText('Verma Traders (BE-1001) is now on this computer, with the same counts as online: 214 invoices, 38 parties, 126 items, 41 purchase bills, 97 payments.');
});

test('in a browser the sign-in message is unchanged (nothing about this PC)', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', 'nobody.here@example.com');
  await page.fill('#aPass', 'whatever 1');
  await page.click('#aGo');
  await expect(page.locator('#aErr')).toHaveText('Email or password is wrong.');
  await expect(page.locator('#aNotHere')).toHaveCount(0);
});

test('online, a shop moved to a PC shows a view-only line and refuses changes', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const { accessToken } = await (await request.post(APP + '/api/auth/login', { data: who })).json();
  const me = await (await request.get(APP + '/api/me', { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  const marked = await request.post(APP + '/api/cloud/moved-to-pc', { headers: { Authorization: `Bearer ${accessToken}` }, data: { businessId: me.business.id, pcCode: 'BE-1001' } });
  expect(marked.ok()).toBe(true);
  await signInAs(page, who);
  await expect(page.locator('#movedBar')).toContainText(/These books were moved to a PC on \d{1,2} \w{3} \d{4}\. You can look and print here; billing happens on that PC\./);
  await page.goto(APP + '/parties');
  await expect(page.locator('#movedBar')).toBeVisible();
  const r = await request.post(APP + '/api/parties', { headers: { Authorization: `Bearer ${accessToken}` }, data: { name: 'Someone new' } });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('moved_to_pc');
});
