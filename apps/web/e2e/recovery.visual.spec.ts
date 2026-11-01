/**
 * Settings › General › Recovery codes and "Use a recovery code" on the sign-in card: new (owner's request,
 * 1 Nov 2026), so compared with owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px. The codes,
 * the date and the email change every run, so they are shown as fixed example texts before the pictures.
 */
import { test, type Page } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const CODES = ['P779-YQ33', 'ZWJ2-WAFE', 'U8F7-KEFT', 'R73A-42XJ', 'S6K9-QFS8', 'K53E-EYNN', '3Y9Z-HRJR', 'ZCM9-83HY', '99D2-5JER', 'E6RZ-JDPJ'];

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Recovery codes card, password, the codes, the card after; Use a recovery code', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        try { await approvedShot(name, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const owner = await freshShop(request);
      const app = await newPage(browser, width);
      await signInAs(app, owner);
      await app.goto(APP + '/settings');
      await app.click('#subnav [data-settab="gen"]');
      await app.waitForSelector('#rcMake:not([disabled])');
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.mouse.move(0, 0);
      await pic(app, `rc-card-${width}`, '#rcCard');

      await app.click('#rcMake');
      await app.fill('#rcPw', 'not my password');
      await app.locator('#slm:not([hidden]) #slmOk').click();
      await app.waitForSelector('#rcErr:not(:empty)');
      await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await app.mouse.move(0, 0);
      await pic(app, `rc-ask-${width}`, '#slm:not([hidden]) .mdl');

      await app.fill('#rcPw', owner.password);
      await app.locator('#slm:not([hidden]) #slmOk').click();
      await app.waitForSelector('#rcList');
      await app.evaluate((codes) => {
        document.querySelectorAll('#rcList > span').forEach((s, i) => { s.lastChild!.textContent = codes[i]!; });
        (document.activeElement as HTMLElement | null)?.blur();
      }, CODES);
      await app.mouse.move(0, 0);
      await pic(app, `rc-codes-${width}`, '#slm:not([hidden]) .mdl');

      await app.locator('#slm:not([hidden]) #slmCancel').click();
      await app.waitForFunction(() => /10 of 10 left/.test(document.getElementById('rcState')?.textContent ?? ''));
      await app.evaluate(() => { document.getElementById('rcState')!.textContent = '10 of 10 left · made on 1 Nov 2026.'; });
      await app.mouse.move(0, 0);
      await pic(app, `rc-card-made-${width}`, '#rcCard');

      const out = await newPage(browser, width);
      await out.goto(APP + '/login');
      await out.click('#aForgot');
      await out.waitForSelector('#vRec:not([hidden])');
      await out.fill('#rEmail', 'pooja@verma.example.com');
      await out.fill('#rCode', 'AAAA-AAAA');
      await out.fill('#rNew', 'my new password 1');
      await out.fill('#rNew2', 'my new password 1');
      await out.click('#rGo');
      await out.waitForSelector('#rErr:not(:empty)');
      await out.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); return document.fonts.ready; });
      await out.mouse.move(0, 0);
      await pic(out, `rc-signin-${width}`, '#box');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
