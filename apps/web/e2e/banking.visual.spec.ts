/**
 * Banking & cash vs the prototype, both showing the same books
 * (packages/importer/fixtures/bank-shop.backup.json: the purchase shop plus two bank
 * accounts, a cash deposit, a transfer, bank charges, interest and cash taken out,
 * all made through the prototype's own windows).
 */
import { test, type Page } from '@playwright/test';
import { sameShot } from './shots';
import { APP, BANK, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

async function pages(browser: Parameters<typeof newPage>[0], width: number, view: string, path: string, ready: string) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'bank-shop');
  await openPrototypeView(proto, view);
  await signInAs(app, BANK);
  await app.goto(APP + path);
  await app.waitForSelector(ready);
  return { proto, app };
}
const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Bank accounts: cards, bank book, second bank, edit account, transfer money', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width, 'bks', '/bank-accounts', '#bkRows tr[data-bke]');
      await sameShot(`bks-${width}`, proto, app, '#vBks');
      await both(proto, app, (p) => p.click('#bkCards .bkc:nth-child(2)'));
      await app.waitForSelector('#bkHd h2:has-text("State Bank of India")');
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`bks-sbi-${width}`, proto, app, '#vBks');
      await both(proto, app, (p) => p.click('#bkHd [data-bkedit]'));
      await sameShot(`bks-edit-${width}`, proto, app, '#bam .mdl');
      await both(proto, app, (p) => p.keyboard.press('Escape'));
      await both(proto, app, (p) => p.click('#bkMove'));
      await sameShot(`bks-move-${width}`, proto, app, '#bmm .mdl');
      await both(proto, app, (p) => p.click('#bmmSave'));
      await sameShot(`bks-move-error-${width}`, proto, app, '#bmm .mdl');
    });

    test('Cash in hand: cash book, this month, add / take out, count cash', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width, 'cash', '/cash-in-hand', '#caRows tr[data-bke]');
      await sameShot(`cash-${width}`, proto, app, '#vCash');
      await both(proto, app, (p) => p.click('#caPer [data-per="oct"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`cash-oct-${width}`, proto, app, '#vCash');
      await both(proto, app, (p) => p.click('#caMove'));
      await sameShot(`cash-move-${width}`, proto, app, '#bmm .mdl');
      await both(proto, app, (p) => p.keyboard.press('Escape'));
      await both(proto, app, (p) => p.click('#caCount'));
      await both(proto, app, (p) => p.fill('#ccAmt', '5000'));
      await sameShot(`cash-count-${width}`, proto, app, '#slm .mdl');
    });
  });
}
