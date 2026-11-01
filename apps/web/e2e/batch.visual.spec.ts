/**
 * Batch and expiry, part 1a: new (owner's request, 1 Nov 2026; the prototype has no such screens), so compared with
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. The dates are far from today, or filled in, so
 * the pictures don't change with the calendar.
 */
import { test, type Page } from '@playwright/test';
import { ITEM, SUPPLIER, batchShop } from './batch.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Batch and expiry: item card, edit batch, Add item, Adjust stock, purchase bill and debit note', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(`batch-${name}-${width}`, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const noToast = (p: Page) => p.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      const owner = await freshShop(request);
      await batchShop(owner);
      const app = await newPage(browser, width);
      await signInAs(app, owner);
      const openItem = async () => {
        await app.goto(APP + '/items');
        await app.click(`#itList button:has-text("${ITEM}")`);
        await app.waitForSelector('#itBatchRows');
        await hideHeader(app);
        await noToast(app);
      };

      await openItem();
      await pic(app, 'card', '#itBatches');
      await app.click('[data-batchedit="A123"]');
      await app.waitForSelector('#bxEdit:not([hidden])');
      await pic(app, 'edit', '#bxEdit .mdl');
      await app.keyboard.press('Escape');

      await app.click('button:has-text("Adjust stock")');
      await app.waitForSelector('#adj:not([hidden])');
      await app.fill('#adjDate', '2026-10-01');
      await pic(app, 'adjust-add', '#adj .mdl');
      await app.click('[data-am="reduce"]');
      await app.waitForSelector('#bxAdj option:has-text("A123")', { state: 'attached' });
      await pic(app, 'adjust-reduce', '#adj .mdl');
      await app.keyboard.press('Escape');

      await app.goto(APP + '/items');
      await hideHeader(app);
      await app.click('button:has-text("Add item")');
      await app.click('.aptabs button:has-text("Stock")');
      await app.click('#aiTrack .tgs');
      await app.waitForSelector('[data-f="ob"]');
      await pic(app, 'additem', '.appane:not([hidden])');

      for (const kind of ['bill', 'debit_note']) {
        await app.goto(`${APP}/purchases/new?kind=${kind}`);
        await app.waitForSelector('#peRows');
        await noToast(app);
        await app.fill('#peParty', SUPPLIER);
        await app.click(OPTION(SUPPLIER));
        await app.fill('#peRows .pe-item', ITEM);
        await app.click(OPTION(ITEM));
        if (kind === 'bill') {
          await app.fill('[data-bf="batchNo"]', 'C789');
          await app.fill('[data-bf="mfg"]', '06/26');
          await app.fill('[data-bf="expiry"]', '02/40');
        } else await app.waitForSelector('[data-bf="batchId"] option:has-text("A123")', { state: 'attached' });
        await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await pic(app, kind === 'bill' ? 'purchase' : 'debit', '#peRows');
      }
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
