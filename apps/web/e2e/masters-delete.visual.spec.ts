/**
 * Edit item / Edit party, the "Can’t delete …" box and "Show inactive" are new (the prototype's pencils
 * only say "coming soon"), so they are compared with owner-approved pictures (e2e/approved/) at 1280, 1366
 * and 1920 px. The windows themselves are the prototype's Add item / Add party and slModal.
 */
import { test, type Page } from '@playwright/test';
import { shop } from './masters-delete.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, newPage, signInAs } from './setup';

const look = async (p: Page) => { await p.mouse.move(0, 0); await p.waitForTimeout(200); };
/** the toast after Make inactive fades on its own; it is not part of these pictures */
const noToast = (p: Page) => p.evaluate(() => document.getElementById('toast')?.remove());

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Edit item, the can’t-delete box and the inactive items', async ({ browser, request }) => {
      const app = await newPage(browser, width);
      await signInAs(app, await shop(request));
      await app.goto(APP + '/items');
      await app.locator('#itList .ptr', { hasText: 'Ceiling fan 1200mm' }).click();
      await app.click('#itEdit');
      await app.waitForSelector('#ai:not([hidden])');
      await hideHeader(app);
      await look(app);
      await approvedShot(`masters-edit-item-${width}`, app, '#ai .mdl');

      await app.click('#aiDel');
      await app.waitForSelector('#slm:not([hidden]) #slmOk:has-text("Make inactive")');
      await look(app);
      await approvedShot(`masters-cant-delete-${width}`, app, '#slm .mdl');

      await app.click('#slmOk');
      await app.click('#itemInactive');
      await app.waitForSelector('[data-inactive]');
      await noToast(app);
      await look(app);
      await approvedShot(`masters-inactive-items-${width}`, app, '#vItems .ptl');
    });

    test('Edit party and the inactive parties', async ({ browser, request }) => {
      const app = await newPage(browser, width);
      await signInAs(app, await shop(request));
      await app.goto(APP + '/parties');
      await app.locator('#ptList .ptr', { hasText: 'Mehta Electricals' }).click();
      await app.click('#ptEdit');
      await app.waitForSelector('#ap:not([hidden])');
      await hideHeader(app);
      await look(app);
      await approvedShot(`masters-edit-party-${width}`, app, '#ap .mdl');

      await app.click('#apDel');
      await app.click('#slmOk');
      await app.click('#partyInactive');
      await app.waitForSelector('[data-inactive]');
      await noToast(app);
      await look(app);
      await approvedShot(`masters-inactive-parties-${width}`, app, '#vParties .ptl');
    });
  });
}
