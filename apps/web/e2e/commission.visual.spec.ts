/**
 * Electrician commission vs the prototype, both showing the same books
 * (commission-shop.backup.json: an electrician, two referred bills, a return, two payouts).
 */
import { test, type Page } from '@playwright/test';
import { sameShot } from './shots';
import { APP, COMMISSION, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Commission: page, electrician details, pay, edit, rules', async ({ browser }) => {
      test.setTimeout(150_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto, 'commission-shop');
      await openPrototypeView(proto, 'com');
      await signInAs(app, COMMISSION);
      await app.goto(APP + '/commission');
      await app.waitForSelector('#cmRows tr[data-cme]');
      await sameShot(`com-${width}`, proto, app, '#vCom');

      await both(proto, app, (p) => p.click('#cmRows tr[data-cme] td:nth-child(2)'));
      await sameShot(`com-view-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, (p) => p.click('#slmCancel'));

      await both(proto, app, (p) => p.click('#cmRows [data-cmpay]'));
      await sameShot(`com-pay-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, async (p) => { await p.fill('#cpA', '50'); await p.click('#slmOk'); });
      await sameShot(`com-pay-error-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, (p) => p.click('#slmCancel'));

      await both(proto, app, (p) => p.click('#cmRows [data-cmedit]'));
      await sameShot(`com-edit-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, (p) => p.click('#slmCancel'));

      await both(proto, app, (p) => p.click('#cmRules'));
      await app.waitForSelector('#slm:not([hidden]) .cmr');
      await sameShot(`com-rules-${width}`, proto, app, '#slm .mdl');
    });
  });
}
