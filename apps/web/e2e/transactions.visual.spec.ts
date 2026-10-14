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
      // every picture is checked even when an earlier one differs, so one run shows them all
      const bad: string[] = [];
      const pic = async (name: string, sel: string) => {
        try { await approvedShot(name, app, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      await signInAs(app, await freshShop(request, 'sales-shop'));
      await app.goto(APP + '/settings');
      await app.click('#subnav button:has-text("Transactions")');
      await app.waitForSelector('#pxTable tbody tr');
      await hideHeader(app);
      // the 'added' message comes and goes on a timer; the pictures are of the page under it
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.mouse.move(0, 0);
      await pic(`txn-header-${width}`, '#cTxHead');
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
      await pic(`txn-prefixes-window-${width}`, '#px .mdl');
      await app.click('#pxClose');
      await pic(`txn-prefixes-${width}`, '#cTxPre');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
