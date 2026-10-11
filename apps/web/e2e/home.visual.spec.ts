/**
 * Home vs the prototype: a brand-new shop (every tile at zero) and a shop with books
 * (commission-shop.backup.json: sales, returns, purchases, payments, expenses, a cheque, low stock).
 */
import { test, type Page } from '@playwright/test';
import { hideHeader, sameShot } from './shots';
import { APP, COMMISSION, WIDTHS, newPage, openPrototypeView, prototypeFresh, prototypeWithBackup, signIn, signInAs } from './setup';

/**
 * Deliberate differences (see STATUS.md), put into the prototype before comparing:
 * - a cancelled invoice does not count in Top selling items (the prototype keeps its sale);
 * - a bill paid later shows how it was paid (INV-0109: "Commission adjust"; INV-0103: "Cash",
 *   the extra cash taken on INV-0105), not the payment choice left in the bill editor ("UPI").
 */
const fixHome = (p: Page) => p.evaluate(() => {
  // eslint-disable-next-line no-eval
  for (const it of (0, eval)('IT') as { tx: { type: string; ref: string }[] }[]) {
    const gone = new Set(it.tx.filter((t) => t.type === 'Sale cancelled').map((t) => t.ref));
    for (const t of it.tx) if (t.type === 'Sale' && gone.has(t.ref)) t.type = 'Sale (cancelled)';
  }
  // eslint-disable-next-line no-eval
  const V = (0, eval)('INVS') as { no: string; payMode: string }[];
  V.find((v) => v.no === 'INV-0109')!.payMode = 'Commission adjust';
  V.find((v) => v.no === 'INV-0103')!.payMode = 'Cash';
});

/**
 * The prototype's reload enters some saved sales twice in an item's stock history (see
 * purchases.visual.spec.ts); drop the repeats so stock and top sellers are as right after saving.
 */
const dedupe = (p: Page) => p.evaluate(() => {
  // eslint-disable-next-line no-eval
  for (const it of (0, eval)('IT') as { tx: { type: string; ref: string; qty: number }[] }[]) {
    const seen = new Set<string>();
    it.tx = it.tx.filter((t) => { const k = `${t.type}|${t.ref}|${t.qty}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }
});

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Home with books: tiles, recent invoices, ageing, top items, cash & bank, GST, low stock', async ({ browser }) => {
      test.setTimeout(120_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto, 'commission-shop');
      await dedupe(proto);
      await fixHome(proto);
      await openPrototypeView(proto, 'dash');
      await signInAs(app, COMMISSION);
      await app.waitForSelector('#vDash #stats .stat');
      // the page is taller than the window, so its picture would include the top bar (changed by the owner; checked on its own)
      await hideHeader(proto, app);
      await sameShot(`home-${width}`, proto, app, '#vDash');
    });

    test('Home of a brand-new shop', async ({ browser }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeFresh(proto);
      await openPrototypeView(proto, 'dash');
      await signIn(app);
      await app.waitForSelector('#vDash #stats .stat');
      // the page is taller than the window, so its picture would include the top bar (changed by the owner; checked on its own)
      await hideHeader(proto, app);
      await sameShot(`home-fresh-${width}`, proto, app, '#vDash');
    });
  });
}
