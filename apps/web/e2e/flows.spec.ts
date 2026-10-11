/** Phase 1 flows: sign-in, shop setup, staff joining, sign-out, and the app frame's behaviour. */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, OWNER, newPage, signIn } from './setup';

let n = 0;
const email = (tag: string) => `${tag}.${Date.now().toString(36)}.${++n}@flows.example.com`;

async function apiLogin(request: APIRequestContext, e: string, p: string): Promise<string> {
  const r = await request.post(APP + '/api/auth/login', { data: { email: e, password: p } });
  expect(r.ok()).toBe(true);
  return (await r.json()).accessToken;
}

async function createAccount(page: Page, who: { name: string; email: string; password: string }) {
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.click('[data-mode="up"]');
  await page.fill('#aName', who.name);
  await page.fill('#aEmail', who.email);
  await page.fill('#aPass', who.password);
  await page.click('#aGo');
}

test('wrong password shows the website’s message', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', OWNER.email);
  await page.fill('#aPass', 'not my password');
  await page.click('#aGo');
  await expect(page.locator('#aErr')).toHaveText('Email or password is wrong.');
});

test('a new person creates an account, sets up a shop and lands in the app', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  const who = { name: 'Ravi Gupta', email: email('ravi'), password: 'ravi password 1' };
  await createAccount(page, who);
  await expect(page.locator('#vShop')).toBeVisible();
  await expect(page.locator('#sOwner')).toHaveValue('Ravi Gupta');
  await expect(page.locator('#trialNote')).toHaveText('Free for 14 days. No card needed.');
  // mistakes are explained in the website's words
  await page.fill('#sName', 'Gupta Electricals & Hardware');
  await page.selectOption('#sState', '27');
  await page.fill('#sGst', '09abcps4821k1z6');
  await page.click('#sGo');
  await expect(page.locator('#sErr')).toHaveText('GSTIN starts with 09 — choose that state.');
  await page.selectOption('#sState', '09');
  await page.fill('#sCity', 'Lucknow');
  await page.click('#sGo');
  await page.waitForSelector('#app');
  await expect(page.locator('#orgName')).toHaveText('Gupta Electricals');
  await expect(page.locator('#vDash .hero h1')).toHaveText('Good afternoon, Ravi');
  await expect(page.locator('html')).toHaveAttribute('data-gst', 'on');
  await page.click('#avBtn');
  await expect(page.locator('#avPop .avh b')).toHaveText('Ravi Gupta');
  await expect(page.locator('#avPop .avh .st')).toHaveText(/^Owner · BE-\d+$/);
  await expect(page.locator('#miLicSub')).toHaveText(/^Free trial · \d+ days left$/);
});

test('signing in again keeps you signed in after a reload; signing out asks first', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signIn(page);
  await page.reload();
  await page.waitForSelector('#app');
  await expect(page.locator('#orgName')).toHaveText('Sharma Electricals');
  await page.click('#avBtn');
  await page.click('#miOut');
  await expect(page.locator('#so')).toBeVisible();
  await page.click('#soNo');
  await expect(page.locator('#so')).toBeHidden();
  await page.click('#avBtn');
  await page.click('#miOut');
  await page.click('#soYes');
  await page.waitForSelector('#vAuth:not([hidden])');
  // the session is really gone
  await page.goto(APP + '/');
  await page.waitForSelector('#vAuth:not([hidden])');
});

test('staff invited by the owner join from the sign-in page', async ({ browser, request }) => {
  const token = await apiLogin(request, OWNER.email, OWNER.password);
  const staff = { name: 'Pooja', email: email('pooja'), password: 'pooja password 1' };
  const inv = await request.post(APP + '/api/members/invites', { headers: { Authorization: `Bearer ${token}` }, data: { email: staff.email, role: 'billing_staff' } });
  expect(inv.status()).toBe(201);
  const page = await newPage(browser, 1366);
  await createAccount(page, staff);
  await expect(page.locator('#vJoin')).toBeVisible();
  await expect(page.locator('#jShop')).toHaveText('Sharma Electricals & Hardware');
  await expect(page.locator('#jName')).toHaveValue('Pooja');
  await page.click('#jGo');
  await page.waitForSelector('#app');
  await expect(page.locator('#orgName')).toHaveText('Sharma Electricals');
  await page.click('#avBtn');
  await expect(page.locator('#avPop .avh .st')).toHaveText('Billing staff · BE-1012');

  // the owner removes Pooja: her next visit goes to the sign-in page with a note
  const members = await (await request.get(APP + '/api/members', { headers: { Authorization: `Bearer ${token}` } })).json();
  const m = members.members.find((x: { email: string }) => x.email === staff.email);
  expect((await request.post(APP + `/api/members/${m.id}/remove`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(204);
  await page.reload();
  await page.waitForSelector('#vAuth:not([hidden])');
});

test('Open the demo shop', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.click('text=Open the demo shop');
  await page.waitForSelector('#app');
  await expect(page.locator('#orgName')).toHaveText('Sharma Electricals');
});

test('sidebar groups, collapse and colours are remembered', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signIn(page);
  const sales = page.locator('.grp[data-g="Sales"]');
  const items = page.locator('.grp[data-g="Items & stock"]');
  await expect(sales).toHaveClass(/open/);
  await items.locator('> .ni').click();
  await expect(items).toHaveClass(/open/);
  await expect(sales).not.toHaveClass(/open/);
  await expect(items.locator('> .ni')).toHaveAttribute('aria-expanded', 'true');
  await page.click('#miniBtn');
  await expect(page.locator('#app')).toHaveClass(/mini/);
  await expect(page.locator('#miniBtn')).toHaveAttribute('aria-label', 'Expand menu');
  await page.reload();
  await page.waitForSelector('#app');
  await expect(page.locator('#app')).toHaveClass(/mini/);
  // collapsed: hovering a group shows its flyout
  await page.click('#miniBtn');
  await expect(page.locator('.grp[data-g="Items & stock"]')).toHaveClass(/open/);
  // colours: chosen in Settings › General (owner moved them there from the top bar) and kept after a reload
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.click('#setPal .po[data-p="navy"]');
  await expect(page.locator('#toast')).toHaveText('Navy & gold applied');
  await expect(page.locator('html')).toHaveAttribute('data-pal', 'navy');
  await page.reload();
  await page.waitForSelector('#app');
  await expect(page.locator('html')).toHaveAttribute('data-pal', 'navy');
});

test('screens not rebuilt yet say so, like the prototype', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signIn(page);
  await page.click('.grp[data-g="GST"] > .ni');
  await page.click('.grp[data-g="GST"] a:has-text("GSTR-1")');
  await expect(page.locator('#toast')).toHaveText('GSTR-1 screen is coming next');
  await expect(page.locator('#toast')).toHaveClass(/on/);
  await page.fill('#q', 'INV-0412');
  await page.press('#q', 'Enter');
  await expect(page.locator('#toast')).toHaveText('Search for “INV-0412” comes with the Sales screen');
});

test('notifications show the trial and GST due dates', async ({ browser }) => {
  const page = await newPage(browser, 1366);
  await signIn(page);
  await expect(page.locator('#bellCnt')).toHaveText('2');
  await page.click('#bellBtn');
  await expect(page.locator('#bellPop .bni.sub')).toContainText('Free trial: 7 days left. All features are open until 8 Oct 2026.');
  await expect(page.locator('#bellPop')).toContainText('GSTR-1 due on 11 Nov');
  await page.keyboard.press('Escape');
  await expect(page.locator('#bellPop')).toBeHidden();
});
