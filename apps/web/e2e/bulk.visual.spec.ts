/**
 * Items › Bulk update items is new (the prototype has no such screen, and its Items ⋮ menu has no
 * "Bulk update items"), so it is compared with its owner-approved pictures (e2e/approved/) at 1280,
 * 1366 and 1920 px: the Items ⋮ menu with the new entry; the table with changes ("was …" lines), two
 * ticked items and a category filter on; a cell marked red after Update; and the question before saving.
 */
import { test } from '@playwright/test';
import { bulkShop } from './bulk.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Bulk update items: ⋮ menu, the table with changes and a filter, a red cell, the question', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const cell = (name: string, col: string) => app.locator('#buGrid tbody tr[data-row]').filter({ has: app.locator('td.eglead', { hasText: name }) }).locator(`td[data-col="${col}"]`).locator('input, select');
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
      await app.waitForSelector('#buGrid tbody tr[data-row]');
      await cell('Door bell', 'description').click();
      await app.keyboard.type('Two-tone chime');
      await cell('Door bell', 'category').selectOption('Accessories');
      await cell('Switch 6A', 'code').click();
      await app.keyboard.type('SW-6A');
      await app.locator('#buGrid tbody tr[data-row]').filter({ has: app.locator('td.eglead', { hasText: 'Wire 1.5 sq mm' }) }).locator('td.egck input').check();
      await app.locator('#buGrid tbody tr[data-row]').filter({ has: app.locator('td.eglead', { hasText: 'Wire 2.5 sq mm' }) }).locator('td.egck input').check();
      await app.selectOption('#buTax', '5');
      await app.locator('#buQ').focus();
      await look();
      await approvedShot(`bulk-table-${width}`, app, '#vBulk');

      // a code another item has: red, with its reason inside the cell; Update goes to it
      await cell('Socket 16A', 'code').click();
      await app.keyboard.type('lb9');
      await app.click('#buGo');
      await app.waitForSelector('#buErr');
      await look();
      await approvedShot(`bulk-error-${width}`, app, '#vBulk');

      await app.keyboard.type('SK-16A');
      await app.click('#buGo');
      await app.waitForSelector('#buConfirm .mdl');
      await look();
      await approvedShot(`bulk-confirm-${width}`, app, '#buConfirm .mdl');
    });
  });
}
