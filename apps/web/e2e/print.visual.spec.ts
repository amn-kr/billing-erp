/**
 * Settings › Print & invoice and the boxed invoice (owner's sample bill) have no
 * prototype screen to compare with, so they are compared with owner-approved
 * pictures (e2e/approved/). The Simple layout is still compared with the prototype
 * in sales.visual.spec.ts.
 */
import { test } from '@playwright/test';
import { approvedShot } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Print & invoice settings, its two dialogs, Thermal, and the boxed invoice', async ({ browser, request }) => {
      const page = await newPage(browser, width);
      await signInAs(page, await freshShop(request, 'sales-shop'));
      await page.goto(APP + '/settings');
      await page.click('#subnav button:has-text("Print & invoice")');
      await page.waitForSelector('#pv #pvPaper .ppage');
      await approvedShot(`print-settings-${width}`, page, '#vSet');

      await page.click('#pColsBtn');
      await page.waitForSelector('#ictm');
      await approvedShot(`print-columns-${width}`, page, '#ictm .mdl');
      await page.click('#ictm button[aria-label="Close"]');

      await page.click('#pNamesBtn');
      await page.waitForSelector('#tnm');
      await approvedShot(`print-names-${width}`, page, '#tnm .mdl');
      await page.click('#tnm button:has-text("Cancel")');

      await page.click('#prTabs button:has-text("Thermal printer")');
      await approvedShot(`print-thermal-${width}`, page, '#vSet');

      // the Sales preview window with the default (boxed) layout
      await page.goto(APP + '/sales');
      const row = page.locator('#slRows tr[data-sno="INV-0103"]');
      await row.waitFor();
      const b = await row.boundingBox();
      await page.mouse.click(b!.x + 200, b!.y + 10, { button: 'right' });
      await page.click('#slCtx [data-sla="prev"]');
      await page.waitForSelector('#ipv:not([hidden]) #ipvSheet .ivx');
      await approvedShot(`print-invoice-${width}`, page, '#ipv .mdl');
    });
  });
}
