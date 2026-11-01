/**
 * Recovery codes (owner's request, 1 Nov 2026): Settings › General › Recovery codes makes ten one-time codes
 * after the password; on the sign-in page "Forgot password?" → "Use a recovery code" takes the email, one
 * code and a new password and signs the person in.
 */
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const openCard = async (page: Page) => {
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.waitForSelector('#rcMake:not([disabled])');
};
/** the window on screen (Settings › General also has the Team card's own, hidden one) */
const win = (page: Page, sel: string) => page.locator(`#slm:not([hidden]) ${sel}`);
const loginStatus = async (who: { email: string; password: string }) => {
  const api = await playwrightRequest.newContext();
  try { return (await api.post(APP + '/api/auth/login', { data: who })).status(); } finally { await api.dispose(); }
};

test('make recovery codes, then use one on the sign-in page to choose a new password', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openCard(page);
  await expect(page.locator('#rcWarn')).toHaveText('Not set up');
  await expect(page.locator('#rcState')).toHaveText('Not made yet. Make them now and keep them somewhere safe.');

  // the password first; a wrong one makes nothing
  await page.click('#rcMake');
  await expect(win(page, '#slmT')).toHaveText('Make recovery codes');
  await page.fill('#rcPw', 'not my password');
  await win(page, '#slmOk').click();
  await expect(page.locator('#rcErr')).toHaveText('Your password is wrong.');
  await page.fill('#rcPw', owner.password);
  await win(page, '#slmOk').click();

  // ten codes, shown once
  await expect(win(page, '#slmT')).toHaveText('Your recovery codes');
  const codes = await page.locator('#rcList > span').evaluateAll((s) => s.map((x) => x.lastChild!.textContent!));
  expect(codes).toHaveLength(10);
  for (const c of codes) expect(c).toMatch(CODE_RE);
  await expect(win(page, '#slmCancel')).toHaveText('Done');
  await win(page, '#slmCancel').click();
  await expect(page.locator('#rcList')).toHaveCount(0);
  await expect(page.locator('#rcState')).toContainText('10 of 10 left');
  await expect(page.locator('#rcWarn')).toHaveCount(0);
  await expect(page.locator('#rcMake')).toHaveText('Make new codes');

  // signed out, the password forgotten: Forgot password? → Use a recovery code (the email carried over)
  const out = await newPage(browser, 1366);
  await out.goto(APP + '/login');
  await out.fill('#aEmail', owner.email);
  await out.click('#aForgot');
  await expect(out.locator('#vRec')).toBeVisible();
  await expect(out.locator('#rEmail')).toHaveValue(owner.email);
  await out.fill('#rCode', 'AAAA-AAAA');
  await out.fill('#rNew', 'my new password 1');
  await out.fill('#rNew2', 'my new password 1');
  await out.click('#rGo');
  await expect(out.locator('#rErr')).toHaveText('That email and recovery code don’t match.');
  await out.fill('#rNew2', 'something else 1');
  await out.fill('#rCode', codes[2]!);
  await out.click('#rGo');
  await expect(out.locator('#rErr')).toHaveText('The two passwords don’t match.');
  await out.fill('#rNew2', 'my new password 1');
  // small letters without the dash are fine
  await out.fill('#rCode', codes[2]!.toLowerCase().replace('-', ''));
  await out.click('#rGo');
  await out.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(out.locator('.av').first()).toBeVisible();

  expect(await loginStatus(owner)).toBe(401);
  expect(await loginStatus({ email: owner.email, password: 'my new password 1' })).toBe(200);
  await openCard(out);
  await expect(out.locator('#rcState')).toContainText('9 of 10 left');

  // the used code doesn't work again
  const again = await newPage(browser, 1366);
  await again.goto(APP + '/login');
  await again.click('#aForgot');
  await again.fill('#rEmail', owner.email);
  await again.fill('#rCode', codes[2]!);
  await again.fill('#rNew', 'third password 1');
  await again.fill('#rNew2', 'third password 1');
  await again.click('#rGo');
  await expect(again.locator('#rErr')).toHaveText('That email and recovery code don’t match.');
  await again.click('#rBack');
  await expect(again.locator('#vAuth')).toBeVisible();
});

test('"Make new codes" asks first and stops the old ones', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await openCard(page);
  await page.click('#rcMake');
  await page.fill('#rcPw', owner.password);
  await win(page, '#slmOk').click();
  await expect(win(page, '#slmT')).toHaveText('Your recovery codes');
  const first = await page.locator('#rcList > span').evaluateAll((s) => s.map((x) => x.lastChild!.textContent!));
  await win(page, '#slmCancel').click();

  await page.click('#rcMake');
  await expect(win(page, '#slmT')).toHaveText('Make new recovery codes?');
  await expect(win(page, '#slmSub')).toContainText('Your old codes stop working.');
  await expect(page.locator('#rcPw')).toHaveValue('');
  await page.fill('#rcPw', owner.password);
  await win(page, '#slmOk').click();
  await expect(win(page, '#slmT')).toHaveText('Your recovery codes');
  const second = await page.locator('#rcList > span').evaluateAll((s) => s.map((x) => x.lastChild!.textContent!));
  expect(first).toHaveLength(10);
  expect(second).toHaveLength(10);
  expect(second.some((c) => first.includes(c))).toBe(false);

  const api = await playwrightRequest.newContext();
  try {
    expect((await api.post(APP + '/api/auth/recover', { data: { email: owner.email, code: first[0], password: 'my new password 1' } })).status()).toBe(400);
    expect((await api.post(APP + '/api/auth/recover', { data: { email: owner.email, code: second[0], password: 'my new password 1' } })).status()).toBe(200);
  } finally {
    await api.dispose();
  }
});
