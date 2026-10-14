/**
 * Settings › Transactions › Enable Passcode for transaction edit/delete, against the real API.
 * Asked after editing (on Save) and when cancelling; never for new documents. Made-up passcodes only.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
const NEW = '913570';
type Who = { email: string; password: string };

async function token(request: APIRequestContext, who: Who) {
  return (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
}
async function turnOn(request: APIRequestContext, who: Who) {
  const r = await request.post(APP + '/api/settings/passcode/on', { headers: { Authorization: `Bearer ${await token(request, who)}` }, data: { passcode: PASS } });
  expect(r.status()).toBe(200);
}
const openTxn = async (page: Page) => {
  await page.goto(APP + '/settings');
  await page.click('#subnav button:has-text("Transactions")');
  await expect(page.locator('#tPass')).toBeEnabled();
};
const box = (page: Page) => page.locator('#pcm:not([hidden])');
async function enter(page: Page, passcode: string) {
  await page.fill('#pcPin', passcode);
  await page.click('#pcGo');
}
async function saveSale(page: Page) {
  await page.click('#siSave');
  await page.locator('#siChgDone').click({ timeout: 2000 }).catch(() => undefined);
}

test('turn on, then an edited invoice saves only with the right passcode; cancelling asks too', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'sales-shop');
  await signInAs(page, who);
  await openTxn(page);
  await expect(page.locator('#tPass')).not.toBeChecked();
  await expect(page.locator('#tPassChange')).toHaveCount(0);
  await page.click('#cTxLock .tgs');
  await expect(page.locator('#pcT')).toHaveText('Set a passcode');
  await page.fill('#pcPin', '12');
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('Enter 4 to 6 digits.');
  await page.fill('#pcPin', PASS);
  await page.fill('#pcPin2', '4827');
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('The two passcodes don’t match.');
  await page.fill('#pcPin2', PASS);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText('Passcode saved and turned on');
  await expect(page.locator('#tPass')).toBeChecked();
  await expect(page.locator('#tPassChange')).toBeVisible();

  // a saved invoice opens and changes without the passcode; Save asks for it
  const sales = (await (await request.get(APP + '/api/sales', { headers: { Authorization: `Bearer ${await token(request, who)}` } })).json()) as { id: string; number: string; cancelled: boolean }[];
  const inv = sales.find((s) => !s.cancelled)!;
  await page.goto(APP + `/sales/new?edit=${inv.id}`);
  await saveSale(page);
  await expect(box(page)).toBeVisible();
  await expect(page.locator('#pcT')).toHaveText('Passcode needed');
  await expect(page.locator('#pcSub')).toHaveText(`Enter the passcode to save your changes to ${inv.number}.`);
  await enter(page, '0000');
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await expect(page.locator('#pcPin')).toHaveValue('');
  await enter(page, PASS);
  await expect(box(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText(`${inv.number} saved`);

  // asked every time: editing again asks again; closing the box keeps the bill unsaved and open
  await page.goto(APP + `/sales/new?edit=${inv.id}`);
  await saveSale(page);
  await expect(box(page)).toBeVisible();
  await page.click('#pcCancel');
  await expect(box(page)).toHaveCount(0);
  await expect(page.locator('#siSave')).toBeVisible();

  // cancelling from the list: "Keep invoice" leaves it; the passcode cancels it
  const cancelRow = async () => {
    await page.goto(APP + '/sales');
    const row = page.locator(`#slRows tr[data-sno="${inv.number}"]`);
    await row.waitFor();
    const b = (await row.boundingBox())!;
    await page.mouse.click(b.x + 200, b.y + 10, { button: 'right' });
    await page.click('#slCtx [data-sla="cancel"]');
    await page.click('#slmOk');
    await expect(page.locator('#pcT')).toHaveText(`Cancel ${inv.number}?`);
    return row;
  };
  let row = await cancelRow();
  await page.click('#pcCancel');
  await expect(page.locator('#pcCancel')).toHaveCount(0);
  await expect(row).not.toContainText('Cancelled');
  await page.keyboard.press('Escape');
  row = await cancelRow();
  await expect(page.locator('#pcCancel')).toHaveText('Keep invoice');
  await enter(page, PASS);
  await expect(page.locator('#toast')).toHaveText(`${inv.number} cancelled`);
  await expect(row).toContainText('Cancelled');
});

test('Change Passcode asks for the current one; turning off needs the new one; then nothing is asked', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'bank-shop');
  await turnOn(request, who);
  await signInAs(page, who);
  await openTxn(page);
  await page.click('#tPassChange');
  await expect(page.locator('#pcT')).toHaveText('Enter current passcode');
  await enter(page, '0000');
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await enter(page, PASS);
  await expect(page.locator('#pcT')).toHaveText('Set a new passcode');
  await page.fill('#pcPin', NEW);
  await page.fill('#pcPin2', NEW);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText('New passcode saved');

  // an expense: edit and cancel ask for the (new) passcode
  await page.goto(APP + '/expenses');
  const first = page.locator('#exRows tr[data-exk^="EX:"]').first();
  const no = (await first.getAttribute('data-exk'))!.slice(3);
  await first.locator('td').first().click();
  await expect(page.locator('#xpT')).toHaveText('Edit expense');
  await page.click('#xpSave');
  await expect(page.locator('#pcSub')).toHaveText(`Enter the passcode to save your changes to ${no}.`);
  await enter(page, PASS);
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await enter(page, NEW);
  await expect(page.locator('#toast')).toContainText(`${no} saved`);
  await page.locator(`#exRows tr[data-exk="EX:${no}"] td`).first().click();
  await page.click('#xpDel');
  await page.click('#slmOk');
  await expect(page.locator('#pcT')).toHaveText(`Cancel ${no}?`);
  await enter(page, NEW);
  await expect(page.locator('#toast')).toHaveText(`${no} cancelled`);

  // a cleared cheque: undo asks for it
  await page.goto(APP + '/cheques');
  await page.selectOption('#cqSt', 'all');
  await page.click('#cqRows [data-cqundo]');
  await expect(page.locator('#pcT')).toHaveText(/^Undo /);
  await enter(page, NEW);
  await expect(page.locator('#toast')).toHaveText(/is pending again$/);

  // turning off needs the passcode; afterwards an edit saves straight away
  await openTxn(page);
  await page.click('#cTxLock .tgs');
  await expect(page.locator('#pcT')).toHaveText('Turn off the passcode?');
  await enter(page, NEW);
  await expect(page.locator('#toast')).toHaveText('Passcode turned off');
  await expect(page.locator('#tPass')).not.toBeChecked();
  await page.goto(APP + '/expenses');
  await page.locator('#exRows tr[data-exk^="EX:"] td').first().click();
  await page.click('#xpSave');
  await expect(page.locator('#toast')).toContainText('saved');
  await expect(box(page)).toHaveCount(0);
});

test('Forgot passcode: the owner sets a new one with the account password; a purchase order cancel then uses it', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request, 'purchase-shop');
  await turnOn(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/purchase-orders');
  const c = page.locator('#poRows [data-pocancel]').first();
  const no = (await c.getAttribute('data-pocancel'))!;
  await c.click();
  await c.click();
  await expect(page.locator('#pcT')).toHaveText(`Cancel ${no}?`);
  await page.click('#pcForgot');
  await expect(page.locator('#pcT')).toHaveText('Forgot passcode');
  await page.fill('#pcPw', 'not my password');
  await page.fill('#pcPin', NEW);
  await page.fill('#pcPin2', NEW);
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('Wrong password. 4 tries left.');
  await page.fill('#pcPw', who.password);
  await page.fill('#pcPin', NEW);
  await page.fill('#pcPin2', NEW);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText('New passcode saved. Enter it to continue');
  // back in the cancel box: the old passcode no longer works, the new one does
  await expect(page.locator('#pcT')).toHaveText(`Cancel ${no}?`);
  await enter(page, PASS);
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await enter(page, NEW);
  await expect(page.locator('#toast')).toHaveText(`${no} cancelled`);
  await expect(page.locator(`#poRows tr[data-pono="${no}"] .stt`)).toHaveText('Cancelled');
});
