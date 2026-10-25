/**
 * Settings › General › Team (the prototype website's team card) with the owner-approved Reset password
 * steps, and "Choose a new password" on the sign-in card: new, so compared with owner-approved pictures
 * (e2e/approved/) at 1280, 1366 and 1920 px. Emails and the temporary password change every run, so
 * they are shown as fixed example texts before the pictures.
 */
import { test, type Page } from '@playwright/test';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';
import { addStaff, inviteOnly } from './staff-reset.data';

const TEMP = 'K7MP-4XQ2-9RTD';
/** fixed example emails in the Members list (in the order of the rows) */
async function sameTexts(page: Page) {
  await page.evaluate(() => {
    const fixed = ['pooja@verma.example.com · you', 'ramesh@example.com', 'pooja@singh.example.com'];
    document.querySelectorAll('#tmList > div small').forEach((s, i) => { if (fixed[i]) s.textContent = fixed[i]!; });
    document.querySelectorAll('#tmList > div').forEach((r) => { const b = r.querySelector('b'); if (b && b.textContent!.includes('@')) b.textContent = 'suresh@example.com'; });
  });
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Team card, Reset password, temporary password, Choose a new password', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const bad: string[] = [];
      const pic = async (p: Page, name: string, sel: string) => {
        try { await approvedShot(name, p, sel); } catch (e) { bad.push((e as Error).message.split('\n')[0]!); }
      };
      const owner = await freshShop(request);
      const ramesh = await addStaff(owner, 'Ramesh Yadav');
      await addStaff(owner, 'Pooja Singh', { ownShop: 'Singh Traders' });
      await inviteOnly(owner, 'suresh');

      const app = await newPage(browser, width);
      await signInAs(app, owner);
      await app.goto(APP + '/settings');
      await app.click('#subnav [data-settab="gen"]');
      await app.waitForSelector('#tmList b');
      await hideHeader(app);
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await sameTexts(app);
      await app.mouse.move(0, 0);
      await pic(app, `team-card-${width}`, '#tmCard');

      await app.locator('[data-tmrp]:not([disabled])').click();
      await app.waitForSelector('#slm:not([hidden])');
      await app.mouse.move(0, 0);
      await pic(app, `team-reset-${width}`, '#slm .mdl');
      await app.click('#slmOk');
      await app.waitForSelector('#tmTemp');
      const temp = await app.inputValue('#tmTemp');
      await app.evaluate((t) => {
        const i = document.getElementById('tmTemp') as HTMLInputElement;
        i.value = t;
        i.blur();
        window.getSelection()?.removeAllRanges();
        const h = document.querySelector('#slmBody .hint');
        if (h) h.textContent = 'It works until 27 Oct, 2:30 pm. When Ramesh Yadav signs in with it, they choose their own password.';
      }, TEMP);
      await app.mouse.move(0, 0);
      await pic(app, `team-temp-password-${width}`, '#slm .mdl');

      const staff = await newPage(browser, width);
      await staff.goto(APP + '/login');
      await staff.fill('#aEmail', ramesh.email);
      await staff.fill('#aPass', temp);
      await staff.click('#aGo');
      await staff.waitForSelector('#vPass:not([hidden])');
      await staff.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); return document.fonts.ready; });
      await staff.mouse.move(0, 0);
      await pic(staff, `choose-password-${width}`, '#box');
      if (bad.length) throw new Error(bad.join('\n'));
    });
  });
}
