/**
 * Settings › Transactions: new (the prototype has no such page), so compared with its owner-approved
 * pictures (e2e/approved/) at 1280, 1366 and 1920 px — the header switches, the prefix list and the
 * Sale prefixes window with a locked (used) prefix, the active one and an unused one.
 */
import { test } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Transactions settings: header switches, prefix list and the Sale prefixes window', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      await signInAs(app, await freshShop(request, 'sales-shop'));
      await app.goto(APP + '/settings');
      await app.click('#subnav button:has-text("Transactions")');
      await app.waitForSelector('#pxTable tbody tr');
      await hideHeader(app);
      // the 'added' message comes and goes on a timer; the pictures are of the page under it
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.mouse.move(0, 0);
      await approvedShot(`txn-header-${width}`, app, '#cTxHead');
      await app.click('[data-px="invoice"] button');
      await app.waitForSelector('#pxBody tr');
      await app.fill('#pxNew', 'JE/INV/');
      await app.click('#pxForm button[type=submit]');
      await app.waitForSelector('#pxBody [data-prefix="JE/INV/"]');
      await app.fill('#pxNew', 'JE/27/');
      await app.uncheck('#pxActive');
      await app.click('#pxForm button[type=submit]');
      await app.waitForSelector('#pxBody [data-prefix="JE/27/"]');
      await app.fill('#pxNew', 'JE/28/');
      await app.mouse.move(0, 0);
      await approvedShot(`txn-prefixes-window-${width}`, app, '#px .mdl');
      await app.click('#pxClose');
      await approvedShot(`txn-prefixes-${width}`, app, '#cTxPre');
    });
  });
}
