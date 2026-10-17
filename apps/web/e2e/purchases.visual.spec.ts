/**
 * Phase 3 purchase screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/purchase-shop.backup.json: two bills, two orders,
 * two payments made and a debit note, made through the prototype's own screens).
 *
 * The entry windows are full screen (owner's change: no sidebar or top bar), so pictures of the
 * editor and of the pop-ups over it are compared with owner-approved pictures (e2e/approved/).
 */
import { test, type Page } from '@playwright/test';
import { approvedShot, sameShot } from './shots';
import { APP, PURCHASES, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

async function pages(browser: Parameters<typeof newPage>[0], width: number, view: string, path: string, ready: string) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'purchase-shop');
  await fixDebitNote(proto);
  await openPrototypeView(proto, view);
  await signInAs(app, PURCHASES);
  await app.goto(APP + path);
  await app.waitForSelector(ready);
  return { proto, app };
}
const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };

/**
 * Deliberate difference (prototype bug): when the old app reloads its books it replays the
 * debit note before the bill it was made against, so DN-0001 (₹325 against PB-0001) stops
 * reducing that bill and shows as unused credit. Right after saving, the old app showed it
 * set against PB-0001, which is what the rebuild keeps. Put the prototype back in that state.
 * The same replay also enters some saved sales twice in an item's stock history (MCB 32A
 * shows −2 in stock instead of −1), so repeated entries are dropped.
 */
async function fixDebitNote(proto: Page) {
  await proto.evaluate(() => {
    // the prototype's books are script-level constants, reachable only by name
    // eslint-disable-next-line no-eval
    const g = <T,>(name: string) => (0, eval)(name) as T;
    const docs = g<{ no: string; party: string }[]>('PDOCS');
    const p = g<(id: string) => { tx: { type: string; no: string; bal: number }[] }>('partyById')(docs.find((d) => d.no === 'DN-0001')!.party);
    const b = p.tx.find((t) => t.type === 'Purchase' && t.no === 'PB-0001')!;
    const n = p.tx.find((t) => t.type === 'Debit note' && t.no === 'DN-0001')!;
    b.bal = Math.round((b.bal - n.bal) * 100) / 100;
    n.bal = 0;
    for (const it of g<{ tx: { type: string; ref: string; qty: number }[] }[]>('IT')) {
      const seen = new Set<string>();
      it.tx = it.tx.filter((t) => { const k = `${t.type}|${t.ref}|${t.qty}`; if (seen.has(k)) return false; seen.add(k); return true; });
    }
  });
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Purchase bills: list, status filter, bill view, Record payment window', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'pur', '/purchase-bills', '#puRows tr[data-bno]');
      await sameShot(`pur-${width}`, proto, app, '#vPur');

      await both(proto, app, (p) => p.click('[data-thf="puSt"]'));
      await sameShot(`pur-filter-${width}`, proto, app, '#thfPop');
      await both(proto, app, (p) => p.click('#thfPop [data-thv="open"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`pur-unpaid-${width}`, proto, app, '#vPur');

      // a bill with payments and a debit note
      await both(proto, app, (p) => p.click('#puRows tr[data-bno="PB-0001"] td:first-child'));
      await app.waitForSelector('#pvm:not([hidden]) .pvh');
      await sameShot(`pur-view-${width}`, proto, app, '#pvm .mdl');
      await both(proto, app, (p) => p.click('#pvClose'));

      // Pay on a bill: its balance filled in
      await both(proto, app, (p) => p.click('#puRows [data-paybill="PB-0002"]'));
      await app.waitForSelector('#pyBills input[data-pya]');
      await both(proto, app, (p) => p.locator('#pyRef').click());
      await sameShot(`pur-pay-${width}`, proto, app, '#ppm .mdl');
      // a mistake shows the prototype's message
      await both(proto, app, async (p) => { await p.selectOption('#pyMode', 'Cheque'); await p.click('#pySave'); });
      // the rebuild also shows the reason as a red message at the top (owner-approved); the prototype doesn't
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await sameShot(`pur-pay-error-${width}`, proto, app, '#ppm .mdl');
    });

    test('Purchase orders, Payments made and Debit notes', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width, 'pos', '/purchase-orders', '#poRows tr[data-pono]');
      await sameShot(`pos-${width}`, proto, app, '#vPos');
      await both(proto, app, (p) => p.click('#poRows tr[data-pono="ORD-0002"] td:first-child'));
      await app.waitForSelector('#pvm:not([hidden]) .pvh');
      await sameShot(`pos-view-${width}`, proto, app, '#pvm .mdl');
      await both(proto, app, (p) => p.click('#pvClose'));

      await openPrototypeView(proto, 'pmade');
      await app.goto(APP + '/payments-made');
      await app.waitForSelector('#pxRows tr td.mono');
      await sameShot(`pmade-${width}`, proto, app, '#vPmade');
      // Record payment with no supplier chosen yet
      await both(proto, app, (p) => p.click('#pxNew'));
      await app.waitForSelector('#ppm:not([hidden]) #pyNo:not(:empty)');
      await sameShot(`pmade-new-${width}`, proto, app, '#ppm .mdl');
      await both(proto, app, (p) => p.keyboard.press('Escape'));

      await openPrototypeView(proto, 'dns');
      await app.goto(APP + '/debit-notes');
      await app.waitForSelector('#dnRows tr[data-dnno]');
      await sameShot(`dns-${width}`, proto, app, '#vDns');
      await both(proto, app, (p) => p.click('#dnRows tr[data-dnno="DN-0001"] td:first-child'));
      await app.waitForSelector('#pvm:not([hidden]) .pvh');
      await sameShot(`dns-view-${width}`, proto, app, '#pvm .mdl');
    });
  
    test('Purchase editor: new bill, supplier and item chosen, payment made, order, debit note', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width, 'pur', '/purchase-bills', '#puRows tr[data-bno]');
      await both(proto, app, (p) => p.click('#vPur [data-pnew="bill"]'));
      await app.waitForSelector('#vPEd #peNo[value="PB-0003"]');
      // the supplier list opens on the empty supplier box
      await app.waitForSelector('#peParty_ .cbl:not([hidden]) .cbo');
      await approvedShot(`ped-new-${width}`, app, '#vPEd');

      const pick = async (p: Page, sel: string, text: string) => { await p.fill(sel, text); await p.waitForTimeout(150); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); };
      await both(proto, app, (p) => pick(p, '#peParty', 'Kanpur'));
      await both(proto, app, (p) => pick(p, '#peRows tr[data-ln="0"] .pe-item', 'MCB'));
      await both(proto, app, async (p) => { await p.fill('#peRows tr[data-ln="0"] [data-pf="qty"]', '12'); await p.locator('#peRef').click(); await p.keyboard.type('KC/2301'); });
      await approvedShot(`ped-filled-${width}`, app, '#vPEd');

      await both(proto, app, (p) => p.click('#pePayBtn'));
      await both(proto, app, (p) => p.locator('#pePayPop [data-pk="amt"]').fill('2000'));
      await sameShot(`ped-pay-${width}`, proto, app, '#pePayPop');
      await both(proto, app, (p) => p.click('#pePayPop [data-paydone="pe"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await approvedShot(`ped-paid-${width}`, app, '#vPEd .sift');

      // a purchase order and a debit note (supplier and item chosen)
      for (const [kind, view, path] of [['po', 'pos', '/purchases/new?kind=order'], ['dn', 'dns', '/purchases/new?kind=debit_note']] as const) {
        await openPrototypeView(proto, view);
        await proto.evaluate((k) => (0, eval)('openPDoc')(k), kind);
        await app.goto(APP + path);
        await app.waitForSelector('#vPEd #peNo:not([value=""])');
        await both(proto, app, (p) => pick(p, '#peParty', 'Kanpur'));
        await both(proto, app, (p) => pick(p, '#peRows tr[data-ln="0"] .pe-item', 'MCB'));
        await both(proto, app, (p) => p.locator('#peRows tr[data-ln="0"] [data-pf="rate"]').click());
        await approvedShot(`ped-${kind}-${width}`, app, '#vPEd');
      }
    });
  });
}
