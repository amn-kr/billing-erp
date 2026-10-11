/**
 * Items › Brands & Series is new (the prototype has no such screen), so it is compared with its
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px.
 */
import { test, type Page } from '@playwright/test';
import { brandItems } from './brands.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

/** "Last updated" is the server's real clock; show a fixed date so the pictures stay the same every day. */
const fixDates = (p: Page) => p.evaluate(() => document.querySelectorAll('#bsRows tr[data-bid] td:nth-child(6)').forEach((td) => { td.textContent = '01/10/2026'; }));

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Brands & Series: both tabs, actions, add and change windows, empty', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };

      // a new shop: nothing yet
      const who = await freshShop(request);
      await signInAs(app, who);
      await app.goto(APP + '/items/brands');
      await app.waitForSelector('#bsEmpty');
      await look();
      await approvedShot(`brands-empty-${width}`, app, '#vBrands');

      await brandItems(request, who);
      await app.goto(APP + '/items');
      await app.click('#itBrands');
      await app.waitForSelector('#bsRows tr[data-bid]');
      await fixDates(app);
      await look();
      await approvedShot(`brands-${width}`, app, '#vBrands');
      await app.locator('#bsRows tr', { hasText: 'HAVELLS' }).locator('[data-bmenu]').click();
      await app.waitForSelector('#bsMenu:not([hidden])');
      await look();
      await approvedShot(`brands-menu-${width}`, app, '#bsMenu');
      await app.click('#bsTot');

      // the windows' rounded corners would show the top bar behind them (changed by the owner; checked on its own)
      await hideHeader(app);
      await app.click('#bsAddBrand');
      await app.fill('#bsfName', 'Legrand');
      await app.fill('#bsfNotes', 'Delhi dealer');
      await look();
      await approvedShot(`brands-add-${width}`, app, '#bsm .mdl');
      await app.click('#bsCancel');

      await app.click('[data-bst="series"]');
      await app.waitForSelector('#bsBrand');
      await look();
      await approvedShot(`series-${width}`, app, '#vBrands');
      await app.click('#bsAddSeries');
      await app.selectOption('#bsfBrand', { label: 'NORWOOD' });
      await app.fill('#bsfName', 'Zenia');
      await app.fill('#bsfSize', '6A-10A');
      await look();
      await approvedShot(`series-add-${width}`, app, '#bsm .mdl');
      await app.click('#bsCancel');
      await app.locator('#bsRows tr', { hasText: 'CLASSIC' }).locator('[data-smenu]').click();
      await app.click('#bsMenu [data-sma="brand"]');
      await app.selectOption('#bsfBrand', { label: 'HAVELLS' });
      await look();
      await approvedShot(`series-move-${width}`, app, '#bsm .mdl');
    });
  });
}
