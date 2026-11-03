/**
 * Settings › Items: reworked at the owner's request (3 Nov 2026; the prototype has no such page), so compared
 * with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px.
 */
import { test, type Page } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, openItemSettings, signInAs, untick } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Settings › Items: all four tabs, Batch No. only, the confirm step, and item screens with boxes off', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(name, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const app = await newPage(browser, width);
      await signInAs(app, await freshShop(request));
      await openItemSettings(app);
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await pic(app, `itemset-tab1-${width}`, '#vSet');
      await app.click('[data-ittab="1"]');
      await app.waitForSelector('#cPlSet .tgl');
      await pic(app, `itemset-tab2-${width}`, '#vSet');
      await app.click('[data-ittab="2"]');
      await pic(app, `itemset-batch-off-${width}`, '#vSet');
      await app.click('#f_exp_date');
      await app.waitForSelector('#f_batch_no:checked');
      await pic(app, `itemset-batch-exp-${width}`, '#vSet');
      await app.click('#f_mfg_date');
      await app.waitForSelector('#f_mfg_date:checked');
      await pic(app, `itemset-batch-all-${width}`, '#vSet');
      await app.click('[data-ittab="3"]');
      await pic(app, `itemset-tab4-${width}`, '#vSet');
      await app.click('[data-ittab="0"]');
      await app.click('#f_brand');
      await app.waitForSelector('#cfm:not([hidden])');
      await pic(app, `itemset-confirm-${width}`, '#cfm .mdl');
      await app.click('#cfmNo');

      await untick(app, 'f_brand');
      await untick(app, 'f_category');
      await untick(app, 'f_location');
      await pic(app, `itemset-off-${width}`, '#cItemSet');
      await app.goto(APP + '/items');
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.click('button:has-text("Add item")');
      await app.waitForSelector('#ai:not([hidden]) #aiName');
      await pic(app, `itemset-additem-off-${width}`, '#ai .mdl');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
