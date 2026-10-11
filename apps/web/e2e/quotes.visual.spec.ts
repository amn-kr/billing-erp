/**
 * Quotation page without sample brands (owner's change): a new shop sees an empty state that leads to
 * Brands & Series; a shop with its own brands, series and items sees only those. Neither look is in the
 * prototype, so they are compared with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px.
 */
import { test } from '@playwright/test';
import { approvedShot } from './shots';
import { quoteBrands } from './quotes.data';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Quotation: new shop without brands, then its own brands, series and items', async ({ browser, request }) => {
      const app = await newPage(browser, width);
      const who = await freshShop(request);
      await signInAs(app, who);
      await app.goto(APP + '/quotations');
      await app.waitForSelector('#qEmpty');
      await app.mouse.move(0, 0);
      await approvedShot(`quo-empty-${width}`, app, '#vQuo');

      await quoteBrands(request, who);
      await app.goto(APP + '/quotations');
      await app.waitForSelector('#qBody [data-qq]');
      await app.getByLabel('Quantity of Modular socket 6A').fill('10');
      await app.click('#qNo');
      await app.mouse.move(0, 0);
      await approvedShot(`quo-own-${width}`, app, '#vQuo');
    });
  });
}
