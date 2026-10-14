/**
 * Settings › Transactions › transaction passcode: new (the prototype has no such screen; its box is
 * the prototype's price PIN dialog), so compared with owner-approved pictures (e2e/approved/) at
 * 1280, 1366 and 1920 px — the card off and on, Set a passcode, the box after a wrong try, Forgot passcode.
 */
import { test } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Transaction passcode: card, set, wrong try and forgot', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      // every picture is checked even when an earlier one differs, so one run shows them all
      const bad: string[] = [];
      const pic = async (name: string, sel: string) => {
        try { await approvedShot(name, app, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const who = await freshShop(request, 'sales-shop');
      await signInAs(app, who);
      await app.goto(APP + '/settings');
      await app.click('#subnav button:has-text("Transactions")');
      await app.waitForSelector('#tPass:not([disabled])');
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await app.mouse.move(0, 0);
      await pic(`txn-passcode-off-${width}`, '#cTxLock');
      await app.click('#cTxLock .tgs');
      await app.waitForSelector('#pcm:not([hidden]) #pcPin2');
      await app.mouse.move(0, 0);
      await pic(`txn-passcode-set-${width}`, '#pcm .mdl');
      await app.fill('#pcPin', '4826');
      await app.fill('#pcPin2', '4826');
      await app.click('#pcGo');
      await app.waitForSelector('#tPassChange');
      await app.mouse.move(0, 0);
      await pic(`txn-passcode-on-${width}`, '#cTxLock');
      // turning off: a wrong try shows the message under the passcode
      await app.click('#cTxLock .tgs');
      await app.waitForSelector('#pcT:has-text("Turn off")');
      await app.fill('#pcPin', '0000');
      await app.click('#pcGo');
      await app.waitForSelector('#pcErr:has-text("Wrong passcode")');
      await app.waitForTimeout(600); // the shake is over
      await app.mouse.move(0, 0);
      await pic(`txn-passcode-wrong-${width}`, '#pcm .mdl');
      await app.click('#pcForgot');
      await app.waitForSelector('#pcPw');
      await app.mouse.move(0, 0);
      await pic(`txn-passcode-forgot-${width}`, '#pcm .mdl');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
