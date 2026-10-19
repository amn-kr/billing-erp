/**
 * Items › Bulk update items is new (the prototype has no such screen, and its Items ⋮ menu has no
 * "Bulk update items"), so it is compared with its owner-approved pictures (e2e/approved/) at 1280,
 * 1366 and 1920 px: the Items ⋮ menu with the new entry, the Pricing tab with changes and two ticked
 * items, the Item Information tab, a cell marked before Update, and the question before saving.
 */
import { test } from '@playwright/test';
import { bulkShop } from './bulk.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Bulk update items: ⋮ menu, Pricing and Item Information tabs, a marked cell, the question', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const row = (name: string) => app.locator('#buGrid tbody tr').filter({ has: app.locator('td.eglead', { hasText: name }) });
      const who = await bulkShop(request);
      await signInAs(app, who);
      await hideHeader(app);
      // the "… set for 2 items" message comes and goes on its own
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });

      await app.goto(APP + '/items');
      await app.waitForSelector('#itList [data-iid]');
      await app.click('#itMoreBtn');
      await look();
      await approvedShot(`bulk-menu-${width}`, app, '#itMorePop');

      await app.click('#itBulkMenu');
      await app.waitForSelector('#buGrid tbody tr');
      await row('LED bulb 9W').locator('td[data-col="sale"] input').fill('105.50');
      await row('Door bell').locator('td[data-col="category"] select').selectOption('Lighting');
      await row('Wire 1.5 sq mm').locator('td.egck input').check();
      await row('Wire 2.5 sq mm').locator('td.egck input').check();
      await app.locator('#buQ').focus();
      await look();
      await approvedShot(`bulk-pricing-${width}`, app, '#vBulk');

      await app.check('[data-bt="info"]');
      await row('Switch 6A').locator('td[data-col="code"] input').fill('SW-6A');
      await app.locator('#buQ').focus();
      await look();
      await approvedShot(`bulk-info-${width}`, app, '#vBulk');

      await row('Socket 16A').locator('td[data-col="code"] input').fill('lb9');
      await app.click('#buGo');
      await app.waitForSelector('#buErr');
      await app.locator('#buQ').focus();
      await look();
      await approvedShot(`bulk-error-${width}`, app, '#vBulk');

      await row('Socket 16A').locator('td[data-col="code"] input').fill('SK-16A');
      await app.click('#buGo');
      await app.waitForSelector('#buConfirm .mdl');
      await look();
      await approvedShot(`bulk-confirm-${width}`, app, '#buConfirm .mdl');
    });
  });
}
