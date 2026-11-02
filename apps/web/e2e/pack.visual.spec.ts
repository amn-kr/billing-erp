/** Pack and loose: new (owner's request, 2 Nov 2026), so compared with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. */
import { test, type Page } from '@playwright/test';
import { CUSTOMER, ITEM, SUPPLIER, packShop } from './batch.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Pack and loose: item setup, refused, sale line, Choose batch, printed line, purchase row, item card, credit note', async ({ browser, request }) => {
      test.setTimeout(150_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        await p.mouse.move(0, 0);
        try { await approvedShot(`pack-${name}-${width}`, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const noToast = (p: Page) => p.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      const owner = await freshShop(request);
      await packShop(owner, { invoice: true });
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
      await app.fill('#qeQty', '1');
      await app.keyboard.press('Control+Enter');
      await app.waitForSelector('[data-bxl="0"]');
      await app.mouse.click(5, 700);
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'sale-line', '#siRows');
      await app.click('[data-bxl="0"]');
      await app.waitForSelector('#bxPickRows tr');
      await pic(app, 'picker', '#bxPick .mdl');
      await app.keyboard.press('Escape');
      await app.click('#siChgBtn');
      await app.click('#siChgDone');
      await app.click('#siSave');
      await app.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
      await pic(app, 'print-line', '#ipvSheet tr:has([data-pbatch])');
      await app.click('#ipvClose');

      await app.goto(`${APP}/purchases/new?kind=bill`);
      await app.waitForSelector('#peRows');
      await noToast(app);
      await app.fill('#peParty', SUPPLIER);
      await app.click(OPTION(SUPPLIER));
      await app.fill('#peRows .pe-item', ITEM);
      await app.click(OPTION(ITEM));
      await app.fill('[data-bf="batchNo"]', 'C789');
      await app.fill('[data-bf="mfg"]', '06/26');
      await app.fill('[data-bf="expiry"]', '02/40');
      await app.fill('[data-bf="mrp"]', '125');
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pic(app, 'purchase', '#peRows');

      await app.goto(APP + '/items');
      await app.click(`#itList button:has-text("${ITEM}")`);
      await app.waitForSelector('#itBatchRows');
      await hideHeader(app);
      await noToast(app);
      await pic(app, 'card', '#itHead');
      await pic(app, 'batches', '#itBatches');

      await app.click('#itEdit');
      await app.click('#aiUnit');
      await app.waitForSelector('#aiUnits:not([hidden])');
      await app.fill('#aiUSize', '15');
      await app.click('#aiUSave');
      await app.waitForSelector('#aiUnits [role=alert]:has-text("stock history")');
      await pic(app, 'refused', '#aiUnits .mdl');
      // after the refusal: GitHub's machine leaves this window faded when it has only just opened
      await app.fill('#aiUSize', '10');
      await app.click('#aiUnitsT');
      await pic(app, 'units', '#aiUnits .mdl');
      await app.click('#aiUnits button[aria-label="Close"]');
      await app.click('#aiClose');

      await app.goto(APP + '/credit-notes');
      await app.click('#cnNew');
      await noToast(app);
      const party = (await app.$$eval('#cnParty option', (o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent ?? '']))).find((x) => x[1]!.includes(CUSTOMER))!;
      await app.selectOption('#cnParty', party[0]!);
      await app.locator('#cnInvs input[type=checkbox]').last().click();
      await app.locator('[data-cnq]').first().fill('5');
      await app.locator('#cnRowsI [data-cnq]').first().blur();
      await pic(app, 'credit', '#cnRowsI');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
