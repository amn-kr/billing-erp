/**
 * The access token is renewed every 15 minutes. That used to draw the whole app again: another empty
 * bill tab, the last message shown again, open windows (Add item) closed. Also the save messages:
 * short and green, red with the reason when a save fails, every message at the top centre.
 */
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const GREEN = 'rgb(16, 185, 129)'; // the prototype's --green (#10b981)
const RED = 'rgb(239, 68, 68)'; // the prototype's --red (#ef4444)
const toast = (page: Page) => page.locator('#toast');
const tabs = (page: Page) => page.locator('#siTabs .bttab');

/** The next API call (the 20 s backup check) is answered 401 (an expired token), so the app renews it, exactly as after 15 minutes. */
async function renewToken(page: Page): Promise<void> {
  let armed = true;
  let old = '';
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    if (armed && r.method() === 'GET' && !new URL(r.url()).pathname.startsWith('/api/auth/')) {
      armed = false;
      old = (await r.allHeaders()).authorization ?? '';
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Please sign in.' }) });
    }
    return route.fallback();
  });
  // the next call is the backup check, every 20 s (as on the owner's screen when the token runs out)
  const renewed = page.waitForResponse((r) => r.url().endsWith('/api/auth/refresh') && r.ok(), { timeout: 25_000 });
  const fresh = ((await (await renewed).json()) as { accessToken: string }).accessToken;
  expect(old, 'the app really got a different token').not.toBe(`Bearer ${fresh}`);
  await page.unroute('**/api/**');
  await page.waitForTimeout(1000); // the retried call, and any drawing it causes
}

/** Marks the app frame and counts every message shown from now on (also on a new #toast element). */
async function watch(page: Page): Promise<void> {
  await expect(toast(page)).not.toHaveClass(/\bon\b/, { timeout: 6000 });
  await page.evaluate(() => {
    const w = window as unknown as { e2eToasts: number };
    w.e2eToasts = 0;
    document.getElementById('app')!.dataset.e2e = 'same';
    let was = false;
    new MutationObserver(() => {
      const on = !!document.getElementById('toast')?.classList.contains('on');
      if (on && !was) w.e2eToasts++;
      was = on;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}
const unchanged = async (page: Page) => {
  await expect(page.locator('#app')).toHaveAttribute('data-e2e', 'same'); // not drawn again from scratch
  expect(await page.evaluate(() => (window as unknown as { e2eToasts: number }).e2eToasts), 'no message shown again').toBe(0);
};

async function fillBill(page: Page) {
  // a short pause for the list to open, as proto-flows' pick() does
  await page.fill('#siParty', 'Mehta');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#siParty')).toHaveValue('Mehta Electricals');
  await page.locator('#qeItem').fill('LED bulb');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('#qeQty').fill('2');
  await page.locator('#qeQty').press('Control+Enter');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/LED bulb/);
}
async function saveBill(page: Page) {
  await page.click('#siSave');
  if (await page.locator('#siChgPop:not([hidden])').count()) await page.click('#siChgDone');
}

/** Where and how the message is drawn, once it has finished sliding in. */
async function looks(page: Page) {
  await expect(toast(page)).toHaveClass(/\bon\b/);
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const t = document.getElementById('toast')!;
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const probe = document.createElement('div');
    probe.style.background = 'var(--t1)';
    document.body.append(probe);
    const black = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const x = r.left + r.width / 2;
    return { centre: x - innerWidth / 2, top: r.top, bg: cs.backgroundColor, black, pe: cs.pointerEvents, z: cs.zIndex, under: document.elementFromPoint(x, r.top + r.height / 2) !== t };
  });
}
async function atTopCentre(page: Page, bg: 'green' | 'red' | 'black') {
  const l = await looks(page);
  expect(Math.abs(l.centre)).toBeLessThanOrEqual(1);
  expect(l.top).toBe(28);
  expect(l.pe).toBe('none');
  expect(l.under, 'clicks go through to what is under the message').toBe(true);
  expect(l.z).toBe('120');
  expect(l.bg).toBe(bg === 'green' ? GREEN : bg === 'red' ? RED : l.black);
}

test('a renewed token keeps the typed bill, opens no new tab and shows no old message', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  // a saved invoice leaves its message behind, as on the owner's screen
  await page.goto(APP + '/sales/new?n=1');
  await fillBill(page);
  await saveBill(page);
  await expect(toast(page)).toHaveText('Invoice saved successfully');
  await expect(page).toHaveURL(/\/sales$/);
  // the saved invoice opens in its preview first (as in sales.flows)
  await expect(page.locator('#ipv:not([hidden]) .mdl')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ipv')).toBeHidden();
  // a new bill with something typed
  await page.click('#vSales .pthd .btn.p');
  await expect(page).toHaveURL(/\/sales\/new/);
  await fillBill(page);
  await expect(tabs(page)).toHaveCount(1);
  await watch(page);
  await renewToken(page);
  await unchanged(page);
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#siParty')).toHaveValue('Mehta Electricals');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="name"]')).toHaveValue(/LED bulb/);
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="qty"]')).toHaveValue('2');
});

test('a renewed token keeps the Add item window open with what was typed', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  await page.goto(APP + '/items');
  await page.locator('#vItems [data-soon="New item"]').first().click();
  await expect(page.locator('#ai')).toBeVisible();
  await page.fill('#aiName', 'Ceiling fan 1200 mm');
  await watch(page);
  await renewToken(page);
  await unchanged(page);
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#aiName')).toHaveValue('Ceiling fan 1200 mm');
});

test('invoice and quotation saves: short green message at the top centre', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  // invoice
  await page.goto(APP + '/sales/new?n=1');
  await fillBill(page);
  await saveBill(page);
  await expect(toast(page)).toHaveText('Invoice saved successfully');
  await atTopCentre(page, 'green');
  await page.keyboard.press('Escape');
  // quotation
  await page.goto(APP + '/sales/new?quote=1');
  await fillBill(page);
  await saveBill(page);
  await expect(toast(page)).toHaveText('Quotation saved successfully');
  await atTopCentre(page, 'green');
});

test('Payment In: a mistake is red with the reason and stays 4 seconds; then saved in green', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  // first a mistake (shown inside the window as before, and now also in red)
  await page.goto(APP + '/payments-received');
  await page.click('#rcNew');
  const v = await page.locator('#rcParty option', { hasText: 'Mehta Electricals' }).first().getAttribute('value');
  await page.selectOption('#rcParty', v!);
  await page.fill('#rcAmt', '100');
  await page.locator('#rcAmt').dispatchEvent('input');
  await page.selectOption('#rcModeI', 'Cheque');
  await page.click('#rcSave');
  await expect(page.locator('#rcErr')).toHaveText('Enter the cheque number.');
  await expect(toast(page)).toHaveText('Enter the cheque number.');
  await atTopCentre(page, 'red');
  // red stays about 4 seconds (black and green 2.2 s)
  await page.waitForTimeout(2500);
  await expect(toast(page)).toHaveClass(/\bon\b/);
  await page.selectOption('#rcModeI', 'Cash');
  await page.click('#rcSave');
  await expect(toast(page)).toHaveText('Payment In saved successfully');
  await atTopCentre(page, 'green');
});

test('a save the server refuses is red with its words; any other message stays black', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));
  // a save the server refuses: its own words, in red, and in the editor as before
  await page.goto(APP + '/sales/new?n=1');
  await fillBill(page);
  await page.route('**/api/sales', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Final rate can’t be more than 100.00 for “LED bulb 9W”.' }) }) : r.fallback()));
  await saveBill(page);
  await expect(page.locator('#siErr')).toHaveText('Final rate can’t be more than 100.00 for “LED bulb 9W”.');
  await expect(toast(page)).toHaveText('Final rate can’t be more than 100.00 for “LED bulb 9W”.');
  await atTopCentre(page, 'red');
  await page.unroute('**/api/sales');

  // any other message keeps its words and its black
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.click('#setPal .po[data-p="navy"]');
  await expect(toast(page)).toHaveText('Navy & gold applied');
  await atTopCentre(page, 'black');
});

for (const width of [1280, 1366, 1920]) {
  test(`${width}px the message sits at the top centre on a screen, the sale editor and the purchase editor, and lets clicks through`, async ({ browser, request }) => {
    const page = await newPage(browser, width);
    await signInAs(page, await freshShop(request, 'sales-shop'));
    await page.goto(APP + '/settings');
    await page.click('#subnav [data-settab="gen"]');
    await page.click('#setPal .po[data-p="navy"]');
    await atTopCentre(page, 'black');
    // the full-screen editors: an empty bill can't be saved, so the reason shows in red
    await page.goto(APP + '/sales/new?n=1');
    await page.waitForSelector('#siSave');
    await saveBill(page);
    await expect(toast(page)).toHaveText('Choose who this bill is for. For a counter sale, switch to Cash.');
    await atTopCentre(page, 'red');
    await page.goto(APP + '/purchases/new?kind=bill&n=1');
    await page.waitForSelector('#peSave');
    await page.click('#peSave');
    await expect(toast(page)).toHaveText('Choose the supplier.');
    await atTopCentre(page, 'red');
    // the Save button still takes a click while the message shows
    await page.click('#peSave', { timeout: 2000 });
  });
}

test('switching business shows the other shop’s data; signing out goes to the sign-in page', async ({ browser, request }) => {
  const who = await freshShop(request, 'sales-shop');
  // a second, empty shop for the same person
  const api = await playwrightRequest.newContext();
  try {
    const tok = ((await (await api.post(APP + '/api/auth/login', { data: who })).json()) as { accessToken: string }).accessToken;
    const r = await api.post(APP + '/api/businesses', { headers: { Authorization: `Bearer ${tok}` }, data: { name: 'Sharma Lights', owner: 'Ravi Gupta', state: '09', gstin: '' } });
    expect(r.ok(), await r.text()).toBe(true);
  } finally {
    await api.dispose();
  }
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  const parties = async () => {
    await page.goto(APP + '/parties');
    await page.waitForSelector('#ptHead');
  };
  const goTo = async (name: string) => {
    await page.click('#orgBtn');
    await page.locator('#orgPop button', { hasText: name }).click();
    await expect(page).toHaveURL(APP + '/');
    await expect(page.locator('#orgPop button.cur b')).toHaveText(name);
  };
  if ((await page.locator('#orgPop button.cur b').textContent()) !== 'Sharma Lights') await goTo('Sharma Lights');
  await parties();
  await expect(page.locator('#ptHead .ptempty b')).toHaveText('Add your first party');
  const fixtureShop = (await page.locator('#orgPop button:not(.cur) b').allTextContents()).find((n) => n !== 'Sharma Lights')!;
  await goTo(fixtureShop);
  await parties();
  await expect(page.getByText('Mehta Electricals').first()).toBeVisible();
  await goTo('Sharma Lights');
  await parties();
  await expect(page.locator('#ptHead .ptempty b')).toHaveText('Add your first party');
  await expect(page.getByText('Mehta Electricals')).toHaveCount(0);

  await page.click('#avBtn');
  await page.click('#miOut');
  await page.click('#soYes');
  await expect(page).toHaveURL(/\/login/);
  await page.waitForSelector('#vAuth:not([hidden])');
});
