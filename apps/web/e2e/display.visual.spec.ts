/**
 * Compact (and Compact + Large text): owner-approved pictures of the main screens (owner's request, 31 Oct 2026).
 * Comfortable + Normal is the prototype's look and is covered by every other picture test. Each test signs in to
 * a shop of its own (the sales books), so the display choice never reaches the shared test accounts.
 */
import { request as playwrightRequest, test, type Browser, type Page } from '@playwright/test';
import { BKP, fakeBackup } from './backup.data';
import { approvedShot } from './shots';
import { APP, WIDTHS, freshShop, newPage, settle, signInAs } from './setup';

/** a fresh sales shop whose owner has chosen this display, signed in at this width */
async function shopWith(browser: Browser, width: number, display: { density: string; textSize: string }): Promise<Page> {
  const api = await playwrightRequest.newContext();
  const who = await freshShop(api, 'sales-shop');
  const login = await api.post(APP + '/api/auth/login', { data: who });
  const r = await api.patch(APP + '/api/me/display', { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` }, data: display });
  if (!r.ok()) throw new Error(`saving the display failed: ${r.status()} ${await r.text()}`);
  await api.dispose();
  const page = await newPage(browser, width);
  // Settings › General shows the backup card: a fixed answer, as in the set-gen picture (the space used
  // is the test database's real size, which changes with what other tests stored)
  await fakeBackup(page, BKP.none);
  await signInAs(page, who);
  return page;
}
const open = async (page: Page, path: string, ready: string) => {
  await page.goto(APP + path);
  await page.waitForSelector(ready);
  await settle(page);
};

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Compact: top bar, Sales invoices, the sale editor, Items, a report and Settings › General', async ({ browser }) => {
      const page = await shopWith(browser, width, { density: 'compact', textSize: 'normal' });
      await open(page, '/sales', '#slRows tr[data-sno]');
      await approvedShot(`compact-topbar-${width}`, page, 'header.top');
      await approvedShot(`compact-sales-${width}`, page, '#vSales');
      await open(page, '/items', '#vItems');
      await approvedShot(`compact-items-${width}`, page, '#vItems');
      await open(page, '/reports', '[data-rp="ppl"]');
      await page.click('[data-rp="ppl"]');
      await page.waitForSelector('#vRep table');
      await settle(page);
      await approvedShot(`compact-report-${width}`, page, '#vRep');
      await open(page, '/settings', '[data-settab="gen"]');
      await page.click('[data-settab="gen"]');
      await page.waitForSelector('#setDen');
      await page.waitForSelector('#tmList small');
      // the test owner's email changes every run: a fixed example in the picture
      await page.evaluate(() => { document.querySelector('#tmList small')!.textContent = 'ravi@gupta.example.com · you'; });
      await settle(page);
      await approvedShot(`compact-settings-${width}`, page, '#vSet');
      await open(page, '/sales/new', '#vNewInv .dgt');
      await approvedShot(`compact-editor-${width}`, page, '#vNewInv');
    });

    test('Compact + Large text: Sales invoices', async ({ browser }) => {
      const page = await shopWith(browser, width, { density: 'compact', textSize: 'large' });
      await open(page, '/sales', '#slRows tr[data-sno]');
      await approvedShot(`compact-large-sales-${width}`, page, '#vSales');
    });
  });
}
