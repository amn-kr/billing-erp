/**
 * Items › Bulk active / inactive is new (the prototype has no such screen), so it is compared with
 * its owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px: the table with two ticked
 * items, the question before making them inactive (with how many still have stock), and the message
 * when a name clash stops Make active. The Items ⋮ menu with the new entry is in bulk-menu-*.
 */
import { test } from '@playwright/test';
import { bulkActiveShop } from './bulk-active.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Bulk active / inactive: the table with ticks, the question, a name clash', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const tick = (name: string) => app.locator('#baGrid tbody tr[data-row]').filter({ has: app.locator('td.eglead', { hasText: name }) }).locator('td.egck input').check();
      const who = await bulkActiveShop(request);
      await signInAs(app, who);
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });

      await app.goto(APP + '/items/bulk-active');
      await app.waitForSelector('#baGrid tbody tr[data-row]');
      await tick('LED bulb 9W');
      await tick('HAVELLS CORAL');
      await look();
      await approvedShot(`bulkact-table-${width}`, app, '#vBulkAct');

      await app.click('#baInactive');
      await app.waitForSelector('#baConfirm .mdl');
      await look();
      await approvedShot(`bulkact-confirm-${width}`, app, '#baConfirm .mdl');
      await app.click('#bacCancel');

      await app.click('#baShow [data-show="all"]');
      // the old Door bell: the only inactive row (an active item has its name)
      await app.locator('#baGrid tbody tr[data-row]').filter({ has: app.locator('.egtail', { hasText: 'Inactive' }) }).locator('td.egck input').check();
      await app.click('#baActive');
      await app.click('#bacGo');
      await app.waitForSelector('#baErr');
      await look();
      await approvedShot(`bulkact-clash-${width}`, app, '#vBulkAct');
    });
  });
}
