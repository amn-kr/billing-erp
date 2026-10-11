/**
 * Reports vs the prototype, both showing the same books (commission-shop.backup.json: customers,
 * a supplier, invoices, returns, purchases, payments, expenses, a cheque and electrician commission).
 */
import { test, type Page } from '@playwright/test';
import { hideHeader, sameShot } from './shots';
import { APP, COMMISSION, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };
/** Same scroll position on both before a picture of a long report. */
const top = (a: Page, b: Page) => both(a, b, (p) => p.evaluate(() => document.getElementById('rpMain')!.scrollIntoView({ block: 'start' })));
/**
 * The prototype's statement shows "NaN" for the rate and amount of purchase bill lines (they keep
 * "rate", not "price"); the rebuild shows the real figures. Give the prototype's lines the same
 * figures before comparing (a deliberate difference, see STATUS.md).
 */
const fixPurchaseLines = (p: Page) => p.evaluate(() => {
  const D = (0, eval)('PDOCS') as { lines?: { rate?: number; price?: number; qty: number; disc?: number; gst?: number; amt?: number }[] }[];
  for (const d of D) for (const l of d.lines ?? []) { l.price = +(l.rate ?? 0); l.amt = Math.round((+l.qty || 0) * l.price * (1 - (+(l.disc ?? 0)) / 100) * (1 + (+(l.gst ?? 0)) / 100) * 100) / 100; }
});

async function pages(browser: Parameters<typeof newPage>[0], width: number) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'commission-shop');
  await openPrototypeView(proto, 'rep');
  await signInAs(app, COMMISSION);
  await app.goto(APP + '/reports');
  await app.waitForSelector('#rpMain .rpsoon');
  return { proto, app };
}
/** Opens a report from the list on both and waits for the rebuild's figures. */
async function open(proto: Page, app: Page, key: string, ready: string) {
  await both(proto, app, (p) => p.click(`#rpList [data-rp="${key}"]`));
  await app.waitForSelector(ready);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Reports: catalogue, a report still being built, search', async ({ browser }) => {
      const { proto, app } = await pages(browser, width);
      await sameShot(`rep-${width}`, proto, app, '#vRep');
      await both(proto, app, async (p) => { await p.fill('#rpQ', 'expense'); await p.locator('#rpQ').dispatchEvent('input'); });
      await sameShot(`rep-search-${width}`, proto, app, '#vRep .rpl');
    });

    test('Party Statement: default party, items shown, a supplier, custom period', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width);
      await fixPurchaseLines(proto);
      await open(proto, app, 'pstmt', '#rpMain .pscard');
      // the statement is taller than the window, so its pictures would include the top bar (changed by the owner; checked on its own)
      await hideHeader(proto, app);
      await sameShot(`rep-pstmt-${width}`, proto, app, '#rpMain');
      await both(proto, app, (p) => p.check('#psDet'));
      await app.waitForSelector('#rpMain tr.psit');
      await sameShot(`rep-pstmt-items-${width}`, proto, app, '#rpMain');
      await both(proto, app, async (p) => { const v = await p.locator('#psParty option', { hasText: 'Kanpur' }).getAttribute('value'); await p.selectOption('#psParty', v!); });
      await app.waitForSelector('#rpMain .pscard b:has-text("Kanpur")');
      await top(proto, app);
      await sameShot(`rep-pstmt-supplier-${width}`, proto, app, '#rpMain');
      await both(proto, app, async (p) => { const v = await p.locator('#psParty option', { hasText: 'Mehta' }).getAttribute('value'); await p.selectOption('#psParty', v!); await p.selectOption('#psPer', 'month'); });
      await app.waitForSelector('#rpMain .pscard b:has-text("Mehta")');
      await top(proto, app);
      await sameShot(`rep-pstmt-month-${width}`, proto, app, '#rpMain');
    });

    test('Party wise P&L, All parties, Party report by item', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width);
      await open(proto, app, 'ppl', '#rpMain .rpt');
      await sameShot(`rep-ppl-${width}`, proto, app, '#rpMain');
      await open(proto, app, 'allp', '#rpMain .rpt tbody tr[data-rpk]');
      await sameShot(`rep-allp-${width}`, proto, app, '#rpMain');
      await both(proto, app, (p) => p.selectOption('#rpAb', 'rec'));
      await sameShot(`rep-allp-rec-${width}`, proto, app, '#rpMain');
      await open(proto, app, 'pitem', '#rpMain .rpt');
      await sameShot(`rep-pitem-${width}`, proto, app, '#rpMain');
    });

    test('Sale purchase by party and by party group', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width);
      await open(proto, app, 'spp', '#rpMain .rpt tbody tr[data-rpk]');
      await sameShot(`rep-spp-${width}`, proto, app, '#rpMain');
      await open(proto, app, 'spg', '#rpMain .rpt tbody tr[data-rpk]');
      await sameShot(`rep-spg-${width}`, proto, app, '#rpMain');
    });

    test('Expense reports: list, filtered by category, by category, by item', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width);
      await open(proto, app, 'expl', '#rpMain .rpt tbody tr[data-rpk]');
      await sameShot(`rep-expl-${width}`, proto, app, '#rpMain');
      await open(proto, app, 'expc', '#rpMain .rpt tbody tr[data-rpk]');
      await sameShot(`rep-expc-${width}`, proto, app, '#rpMain');
      // a category opens its entries in the Expense report
      await both(proto, app, (p) => p.click('#rpMain .rpt tbody tr[data-rpk]'));
      await app.waitForSelector('#rpMain #rpXc');
      await sameShot(`rep-expl-cat-${width}`, proto, app, '#rpMain');
      await open(proto, app, 'expi', '#rpMain .rpt tbody tr');
      await sameShot(`rep-expi-${width}`, proto, app, '#rpMain');
    });
  });
}
