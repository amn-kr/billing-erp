/**
 * Expenses vs the prototype, both showing the same books (bank-shop.backup.json: four
 * expenses and a new category made in the prototype's own windows, plus cash-book entries).
 */
import { test, type Page } from '@playwright/test';
import { sameShot } from './shots';
import { APP, BANK, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Expenses: list, by category, edit and add windows, categories', async ({ browser }) => {
      test.setTimeout(150_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto, 'bank-shop');
      await openPrototypeView(proto, 'exp');
      await signInAs(app, BANK);
      await app.goto(APP + '/expenses');
      await app.waitForSelector('#exRows tr[data-exk]');
      await sameShot(`exp-${width}`, proto, app, '#vExp');

      // a category picked in the side list
      await both(proto, app, (p) => p.click('#exCatList [data-excat="Rent"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`exp-rent-${width}`, proto, app, '#vExp');
      await both(proto, app, (p) => p.click('#exCatList [data-excat="all"]'));

      // editing an expense with two lines
      await both(proto, app, (p) => p.click('#exRows tr[data-exk="EX:EXP-0004"] td:first-child'));
      await app.waitForSelector('#xpm:not([hidden]) #xpLines tr[data-xl="1"]');
      // deliberate difference: expenses are cancelled, never deleted
      await proto.evaluate(() => { document.getElementById('xpDel')!.textContent = 'Cancel expense'; });
      await sameShot(`exp-edit-${width}`, proto, app, '#xpm .mdl');
      await both(proto, app, (p) => p.click('#xpCancel'));

      // a new expense: a mistake, then two lines with GST
      await both(proto, app, (p) => p.click('#exNew'));
      await app.waitForSelector('#xpm:not([hidden]) #xpNo:not(:empty)');
      await both(proto, app, (p) => p.click('#xpSave'));
      await sameShot(`exp-new-error-${width}`, proto, app, '#xpm .mdl');
      await both(proto, app, async (p) => {
        await p.selectOption('#xpCat', 'Repairs');
        await p.fill('#xpLines tr[data-xl="0"] [data-f="name"]', 'Inverter battery');
        await p.fill('#xpLines tr[data-xl="0"] [data-f="rate"]', '5900');
        await p.selectOption('#xpLines tr[data-xl="0"] [data-f="gst"]', '18');
        await p.click('#xpAddL');
        await p.fill('#xpLines tr[data-xl="1"] [data-f="name"]', 'Fitting');
        await p.fill('#xpLines tr[data-xl="1"] [data-f="amt"]', '300');
        await p.click('#xpNote');
      });
      await sameShot(`exp-new-${width}`, proto, app, '#xpm .mdl');
      await both(proto, app, (p) => p.click('#xpCancel'));
      // the prototype asks before throwing away a typed form; so does the rebuild
      await both(proto, app, async (p) => { if (await p.locator('#dcf:not([hidden])').count()) await p.click('#dcfYes'); });

      await both(proto, app, (p) => p.click('#exCats'));
      await sameShot(`exp-cats-${width}`, proto, app, '#xcm .mdl');
    });
  });
}
