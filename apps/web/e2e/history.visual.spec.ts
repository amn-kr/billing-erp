/**
 * "View history" is new (the prototype's sales menu has the item, but no window for edits), so its
 * window and a row menu with the new item are compared with owner-approved pictures (e2e/approved/)
 * at 1280, 1366 and 1920 px. The menu is the Purchase bills one (the Sales menu already had
 * "View history" and is still compared with the prototype itself in sales.visual.spec.ts).
 */
import { test, type Page } from '@playwright/test';
import { books } from './history.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

/** The edit times are the server's real clock and the person is the test shop's owner: shown fixed so the pictures stay the same every day. */
const fixTimes = (p: Page) => p.evaluate(() => document.querySelectorAll('#ehList .dgterms b').forEach((b) => { b.textContent = '01/10/2026, 10:30 am'; }));

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('View history: the row menu with the new item, and the Edit History window', async ({ browser, request }) => {
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const who = await freshShop(request);
      const b = await books(request, who);
      await signInAs(app, who);

      await app.goto(APP + '/purchase-bills');
      await app.locator('#puRows tr').filter({ has: app.locator(`[data-slm="${b.bill.number}"]`) }).locator('[data-slm]').click();
      await app.waitForSelector('#puCtx:not([hidden])');
      await look();
      await approvedShot(`history-menu-${width}`, app, '#puCtx');
      await app.keyboard.press('Escape');

      // the window's rounded corners would show the top bar behind it (checked on its own)
      await app.goto(APP + '/sales');
      await app.locator('#slRows tr').filter({ has: app.locator(`[data-slm="${b.inv.number}"]`) }).locator('[data-slm]').click();
      await app.click('#slCtx [data-sla="hist"]');
      await app.waitForSelector('#ehList .dgterms');
      await hideHeader(app);
      await fixTimes(app);
      await look();
      await approvedShot(`history-popup-${width}`, app, '#slm .mdl');
    });
  });
}
