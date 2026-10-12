/**
 * Settings › General › Backup & restore (real-time backup): new, so compared with its owner-approved
 * pictures (e2e/approved/, approved 12 Oct 2026) at 1280, 1366 and 1920 px — each place working, a place
 * failing for 23 minutes with the red banner, retrying, first time, Safari/Firefox, space low with the
 * amber banner, and the Test restore / Restore windows.
 */
import { test, type Page } from '@playwright/test';
import { BKP, fakeBackup } from './backup.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

const openCard = async (app: Page) => {
  await app.goto(APP + '/settings');
  await app.click('#subnav [data-settab="gen"]');
  await app.waitForSelector('#bkpDest input:checked, #bkpDest input:not(:disabled)');
  await hideHeader(app);
  await app.mouse.move(0, 0);
};

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Backup & restore: places, failing, first time, Safari, space low, test restore and restore windows', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const app = await newPage(browser, width);
      await app.addInitScript(() => { if (sessionStorage.getItem('nofs')) delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker; });
      const fake = await fakeBackup(app, BKP.drive);
      await signInAs(app, await freshShop(request));
      const card = async (name: string, status: object) => {
        fake.set(status);
        await openCard(app);
        await approvedShot(`bkp-${name}-${width}`, app, '#bkpCard');
      };
      await card('drive', BKP.drive);
      await card('computer', BKP.computer);
      await card('both', BKP.both);
      await card('drive-red', BKP.driveRed);
      await approvedShot(`bkp-banner-red-${width}`, app, '#bkpBar');
      await card('retrying', BKP.retrying);
      await card('first-time', BKP.firstTime);
      await card('space-low', BKP.spaceLow);
      await approvedShot(`bkp-banner-space-${width}`, app, '#spaceBar');
      // Safari and Firefox can't save into a folder: a Download backup button instead
      await app.evaluate(() => sessionStorage.setItem('nofs', '1'));
      await card('safari', BKP.both);
      await app.evaluate(() => sessionStorage.removeItem('nofs'));
      // the windows
      fake.set(BKP.drive);
      await openCard(app);
      await app.click('#bkpTest');
      await app.waitForSelector('#trm:not([hidden]) #trmOk');
      await approvedShot(`bkp-test-${width}`, app, '#trm .mdl');
      await app.click('#trmDoneBtn');
      await app.click('#bkpRestoreLive');
      await app.waitForSelector('#trm:not([hidden]) #trmUnderstand');
      await app.check('#trmUnderstand');
      await approvedShot(`bkp-restore-${width}`, app, '#trm .mdl');
      await app.click('#trmGo');
      await app.waitForSelector('#trmDone');
      await approvedShot(`bkp-restored-${width}`, app, '#trm .mdl');
    });
  });
}
