/**
 * Settings › Features: new (owner's request, 1 Nov 2026; the prototype has no such page), so compared with
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px.
 */
import { test, type Page } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Features: all off, Medical on with the other two locked, the confirm step', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        try { await approvedShot(name, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const app = await newPage(browser, width);
      await signInAs(app, await freshShop(request));
      await app.goto(APP + '/settings');
      await app.click('#subnav [data-settab="features"]');
      await app.waitForSelector('#cFeat');
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.mouse.move(0, 0);
      await pic(app, `features-off-${width}`, '#vSet');

      await app.click('#f_medical');
      await app.waitForSelector('#f_batch_expiry:checked:disabled');
      await app.waitForSelector('#f_medical:not([disabled])');
      await app.mouse.move(0, 0);
      await pic(app, `features-medical-${width}`, '#vSet');

      await app.click('#f_medical');
      await app.waitForSelector('#cfm:not([hidden])');
      await app.mouse.move(0, 0);
      await pic(app, `features-confirm-${width}`, '#cfm .mdl');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
