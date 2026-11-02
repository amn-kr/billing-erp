/** Expiry monitoring: new (owner's request, 2 Nov 2026), so compared with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. */
import { test, type Page } from '@playwright/test';
import { expiryShop } from './batch.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Expiry monitoring: Home alert, Expiry Report, row menu, write-off, debit note, Batch Wise Sales And Profit', async ({ browser, request }) => {
      test.setTimeout(150_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(`expiry-${name}-${width}`, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const noToast = (p: Page) => p.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      const owner = await freshShop(request);
      await expiryShop(owner);
      const app = await newPage(browser, width);
      await signInAs(app, owner);

      await app.goto(APP + '/');
      await app.waitForSelector('[data-view="exp-stock"]');
      await noToast(app);
      await pic(app, 'home', '[data-view="exp-stock"]');

      await app.goto(APP + '/reports?r=expiry');
      await app.waitForSelector('#rpExF');
      await hideHeader(app);
      await noToast(app);
      await pic(app, 'report', '#rpMain');
      await app.locator('#rpMain tr[data-rpk]', { hasText: 'C101' }).locator('[data-slm]').click();
      await app.waitForSelector('#exCtx:not([hidden])');
      await pic(app, 'menu', '#exCtx');
      await app.click('#exCtx [data-sla="off"]');
      await app.waitForSelector('#adjForm');
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'writeoff', '#adjForm');
      await app.keyboard.press('Escape');

      await app.goto(APP + '/reports?r=expiry');
      await app.waitForSelector('#rpExF');
      await app.locator('#rpMain tr[data-rpk]', { hasText: 'A77' }).locator('[data-slm]').click();
      await app.click('#exCtx [data-sla="ret"]');
      await app.waitForSelector('#peRows [data-pf="unit"]');
      await noToast(app);
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'debit', '#peRows');

      await app.goto(APP + '/reports?r=batchsale');
      await app.waitForSelector('#rpBsItem');
      await hideHeader(app);
      await pic(app, 'sales', '#rpMain');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
