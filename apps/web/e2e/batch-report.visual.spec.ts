/** Item Batch Report: new, so compared with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. Dates are far from today. */
import { test, type Page } from '@playwright/test';
import { batchShop } from './batch.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Item Batch Report: all, and expired', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(`batch-${name}-${width}`, p, '#rpMain'); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const owner = await freshShop(request);
      await batchShop(owner);
      const app = await newPage(browser, width);
      await signInAs(app, owner);
      await app.goto(APP + '/reports?r=batch');
      await app.waitForSelector('#rpBxF');
      await hideHeader(app);
      await pic(app, 'report');
      await app.click('[data-bxf="expired"]');
      await pic(app, 'report-expired');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
