/**
 * Items › item details: the "Purchase rate of stock left" table is new (the prototype has none), so the
 * item card is compared with its owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px:
 * several rates, first rates sold out, a sold-out rate in the middle, no stock, many rates, and the whole page.
 */
import { test, type Page } from '@playwright/test';
import { RATE_ITEMS, rateItems } from './item-rates.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const open = async (app: Page, name: string) => {
  await app.locator('#itList .ptr', { hasText: name }).click();
  await app.waitForFunction((n) => document.querySelector('#itHead h2')?.textContent === n && !!document.getElementById('itRates'), name);
  await app.mouse.move(0, 0);
  await app.waitForTimeout(200);
};

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Item rate table: several rates, first rates sold out, a zero in the middle, no stock, many rates, whole page', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const who = await freshShop(request);
      await rateItems(request, who);
      await signInAs(app, who);
      await app.goto(APP + '/items');
      await app.waitForSelector('#itList .ptr');
      await hideHeader(app);

      await open(app, RATE_ITEMS.several);
      await approvedShot(`itrates-several-${width}`, app, '#itHead');
      await approvedShot(`itrates-page-${width}`, app, '#app');
      await open(app, RATE_ITEMS.firstZero);
      await approvedShot(`itrates-firstzero-${width}`, app, '#itHead');
      await open(app, RATE_ITEMS.midZero);
      await approvedShot(`itrates-midzero-${width}`, app, '#itHead');
      await open(app, RATE_ITEMS.none);
      await approvedShot(`itrates-none-${width}`, app, '#itHead');
      await open(app, RATE_ITEMS.many);
      await approvedShot(`itrates-many-${width}`, app, '#itHead');
    });
  });
}
