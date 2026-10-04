/**
 * Phase 3 sales screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/sales-shop.backup.json: invoices, a payment, a
 * return, challans and a quotation made through the prototype's own screens).
 */
import { test, type Page } from '@playwright/test';
import { sameShot } from './shots';
import { APP, SALES, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

async function pages(browser: Parameters<typeof newPage>[0], width: number, view: string, path: string, ready: string) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'sales-shop');
  await openPrototypeView(proto, view);
  await signInAs(app, SALES);
  await app.goto(APP + path);
  await app.waitForSelector(ready);
  return { proto, app };
}
const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Sales invoices: list, actions menu, preview, cancelled invoice, filters', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await sameShot(`sales-${width}`, proto, app, '#vSales');

      // right-click actions on a partly paid invoice
      const menu = (no: string) => both(proto, app, async (p) => { const b = await p.locator(`#slRows tr[data-sno="${no}"]`).boundingBox(); await p.mouse.click(b!.x + 200, b!.y + 10, { button: 'right' }); });
      await menu('INV-0101');
      // deliberate difference: invoices are never deleted, so "Delete" is greyed out with a reason
      await proto.evaluate(() => { const b = document.querySelector<HTMLButtonElement>('#slCtx [data-sla="del"]')!; b.disabled = true; b.title = 'Invoices are never deleted — cancel instead'; });
      await sameShot(`sales-menu-${width}`, proto, app, '#slCtx');
      await both(proto, app, (p) => p.keyboard.press('Escape'));

      // the invoice preview (discount, transport, round off)
      await menu('INV-0103');
      await both(proto, app, (p) => p.click('#slCtx [data-sla="prev"]'));
      await app.waitForSelector('#ipv:not([hidden]) .ivh');
      await sameShot(`sales-preview-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));

      // a cancelled invoice
      await menu('INV-0104');
      await both(proto, app, (p) => p.click('#slCtx [data-sla="prev"]'));
      await app.waitForSelector('#ipv:not([hidden]) .ivcan');
      await sameShot(`sales-cancelled-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));

      // status filter in the column head, then "Paid" applied
      await both(proto, app, (p) => p.click('[data-thf="slSt"]'));
      await sameShot(`sales-filter-${width}`, proto, app, '#thfPop');
      await both(proto, app, (p) => p.click('#thfPop [data-thv="paid"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`sales-paid-${width}`, proto, app, '#vSales');
    });

    test('Payments received and the Receive payment window', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'pin', '/payments-received', '#rcRows tr[data-rcno]');
      await sameShot(`receipts-${width}`, proto, app, '#vPin');
      // a customer with an unpaid invoice and an opening balance: dues filled oldest first
      await both(proto, app, (p) => p.click('#rcNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#rcParty option', { hasText: 'Raju Electrician' }).getAttribute('value'); await p.selectOption('#rcParty', id!); });
      await app.waitForSelector('#rcBills input[data-rca]');
      await both(proto, app, (p) => p.locator('#rcRef').click());
      await sameShot(`receive-${width}`, proto, app, '#rcm .mdl');
      // a mistake shows the prototype's message
      await both(proto, app, async (p) => { await p.selectOption('#rcModeI', 'Cheque'); await p.click('#rcSave'); });
      await sameShot(`receive-error-${width}`, proto, app, '#rcm .mdl');
    });

    test('Credit notes and New credit note', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'cns', '/credit-notes', '#cnRows tr[data-cnno]');
      await sameShot(`creditnotes-${width}`, proto, app, '#vCns');
      await both(proto, app, (p) => p.click('#cnRows tr[data-cnno="CN-0001"]'));
      await sameShot(`creditnote-view-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, (p) => p.click('#slmCancel'));
      // a customer with two invoices: tick the first, return one coil
      await both(proto, app, (p) => p.click('#cnNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#cnParty option', { hasText: 'Mehta Electricals' }).getAttribute('value'); await p.selectOption('#cnParty', id!); });
      await both(proto, app, (p) => p.click('#cnInvs [data-cninv="INV-0101"]'));
      await app.waitForSelector('#cnRowsI [data-cnq]');
      await both(proto, app, async (p) => { await p.fill('#cnRowsI tr[data-cnk="0"] [data-cnq]', '1'); await p.locator('#cnRowsI tr[data-cnk="0"] [data-cnq]').dispatchEvent('input'); });
      await both(proto, app, (p) => p.locator('#cnDate').click());
      await sameShot(`creditnote-new-${width}`, proto, app, '#cnm .mdl');
    });

    test('Delivery challans: list, print view, New delivery challan', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'dcs', '/delivery-challans', '#dcRows tr[data-dcno]');
      await sameShot(`challans-${width}`, proto, app, '#vDcs');
      await both(proto, app, (p) => p.click('#dcRows [data-dcprint="DC-0001"]'));
      await app.waitForSelector('#ipv:not([hidden]) .dch');
      await sameShot(`challan-print-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));
      await both(proto, app, (p) => p.click('#dcNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#dcParty option', { hasText: 'Raju Electrician' }).getAttribute('value'); await p.selectOption('#dcParty', id!); });
      await both(proto, app, async (p) => { await p.fill('#dcAddI', 'LED bulb 9W'); await p.locator('#dcAddI').dispatchEvent('change'); });
      await app.waitForSelector('#dcRowsI [data-dcq]');
      await both(proto, app, (p) => p.locator('#dcTr').click());
      await sameShot(`challan-new-${width}`, proto, app, '#dcm .mdl');
    });
  });
}
