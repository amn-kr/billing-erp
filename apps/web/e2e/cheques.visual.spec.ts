/**
 * Cheques and Reconciliation vs the prototype, both showing the same books
 * (bank-shop.backup.json: a cheque received and deposited, a cheque issued still pending).
 */
import { test, type Page } from '@playwright/test';
import { sameShot } from './shots';
import { APP, BANK, WIDTHS, freshShop, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };
async function pages(browser: Parameters<typeof newPage>[0], width: number, view: string, path: string, ready: string, who = BANK) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'bank-shop');
  await openPrototypeView(proto, view);
  await signInAs(app, who);
  await app.goto(APP + path);
  await app.waitForSelector(ready);
  return { proto, app };
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Cheques: received, all, issued, deposited and bounced windows', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width, 'chq', '/cheques', '#cqSum');
      await sameShot(`chq-${width}`, proto, app, '#vChq');
      await both(proto, app, (p) => p.selectOption('#cqSt', 'all'));
      await sameShot(`chq-all-${width}`, proto, app, '#vChq');
      await both(proto, app, async (p) => { await p.click('#cqDir [data-dir="out"]'); await p.selectOption('#cqSt', 'pending'); await p.mouse.move(0, 0); });
      await sameShot(`chq-out-${width}`, proto, app, '#vChq');
      await both(proto, app, (p) => p.click('#cqRows [data-cqok]'));
      await sameShot(`chq-clear-${width}`, proto, app, '#bcm .mdl');
      await both(proto, app, (p) => p.click('#bcmCancel'));
      await both(proto, app, (p) => p.click('#cqRows [data-cqbn]'));
      await sameShot(`chq-bounce-${width}`, proto, app, '#bcm .mdl');
    });

    test('Reconciliation: start, statement balance, ticks, reconciled', async ({ browser, request }) => {
      test.setTimeout(120_000);
      // ticks are saved, so this test has a shop of its own
      const { proto, app } = await pages(browser, width, 'rec', '/reconciliation', '#bkrRows tr', await freshShop(request, 'bank-shop'));
      // deliberate difference: the prototype pre-ticks entries up to 25 Sep 2026 and fills in a demo
      // statement balance; the rebuild starts with nothing ticked. Start the prototype the same way.
      await proto.evaluate(() => { (document.getElementById('bkrNone') as HTMLButtonElement).click(); const i = document.getElementById('bkrStmt') as HTMLInputElement; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`rec-${width}`, proto, app, '#vRec');
      await both(proto, app, async (p) => { await p.fill('#bkrStmt', '97000'); await p.locator('#bkrRows .bkrcb').nth(4).check(); await p.locator('#bkrRows .bkrcb').nth(5).check(); await p.locator('#bkrRows .bkrcb').nth(6).check(); await p.mouse.move(0, 0); });
      await sameShot(`rec-ticked-${width}`, proto, app, '#vRec');
      await both(proto, app, async (p) => { await p.fill('#bkrStmt', '78696'); await p.click('#bkrAll'); await p.mouse.move(0, 0); });
      await sameShot(`rec-done-${width}`, proto, app, '#vRec');
    });
  });
}
