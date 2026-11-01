/**
 * Batch and expiry, part 1b: new (owner's request, 1 Nov 2026; the prototype has no such screens), so compared with
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. The dates are far from today, or fixed.
 */
import { test, type Page } from '@playwright/test';
import { CUSTOMER, ITEM, batchShop } from './batch.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Batch and expiry on sales: the line, Choose batch, Sell expired stock, printed invoice, credit note', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(`batch-${name}-${width}`, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const noToast = (p: Page) => p.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      const owner = await freshShop(request);
      await batchShop(owner, { bills: true, invoice: true });
      const app = await newPage(browser, width);
      await signInAs(app, owner);

      await app.goto(APP + '/sales/new');
      await app.waitForSelector('#qeItem');
      await noToast(app);
      await hideHeader(app);
      await app.fill('#siParty', CUSTOMER);
      await app.click(OPTION(CUSTOMER));
      await app.locator('#qeItem').pressSequentially('Paracetamol');
      await app.waitForSelector(OPTION(ITEM));
      await app.keyboard.press('ArrowDown');
      await app.keyboard.press('Enter');
      await app.fill('#qeQty', '3');
      await app.keyboard.press('Control+Enter');
      await app.waitForSelector('[data-bxl="0"]');
      await app.mouse.click(5, 700);
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'sale-line', '#siRows');

      await app.click('[data-bxl="0"]');
      await app.waitForSelector('#bxPickRows tr');
      await pic(app, 'picker', '#bxPick .mdl');
      for (const no of ['A123', 'B456']) await app.fill(`#bxPickRows tr[data-batch="${no}"] input`, '');
      await app.fill('#bxPickRows tr[data-batch="B456"] input', '2');
      await app.fill('#bxPickRows tr[data-batch="X100"] input', '1');
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'picker-expired', '#bxPick .mdl');
      await app.click('#bxDone');
      await app.click('#siChgBtn');
      await app.click('#siChgDone');
      await app.click('#siSave');
      await app.waitForSelector('#bxExpired:not([hidden])');
      await pic(app, 'expired-ask', '#bxExpired .mdl');
      await app.click('#bxExpNo');

      await app.goto(APP + '/sales');
      await noToast(app);
      await app.click('tr:has-text("Raju Stores")');
      await app.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
      await pic(app, 'print-line', '#ipvSheet tr:has([data-pbatch])');
      await app.click('#ipvClose');

      await app.goto(APP + '/credit-notes');
      await noToast(app);
      await app.click('button:has-text("New credit note")');
      await app.waitForSelector('#cnm:not([hidden])');
      await app.locator('#cnParty').selectOption({ label: CUSTOMER });
      await app.click('#cnInvs input');
      await app.waitForSelector('[data-cnbatch]');
      await pic(app, 'credit-line', '#cnm tr[data-cnk="0"]');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
