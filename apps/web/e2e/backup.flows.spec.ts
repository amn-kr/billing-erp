/**
 * Settings › General › Backup & restore: choosing where backups go (real server), the red banner after
 * 15 minutes of failing, test restore before restore, and the Download backup button for Safari/Firefox.
 * Google Drive and the folder on this computer are connected in later steps, so their working states
 * come from a filled-in server answer (backup.data.ts).
 */
import { expect, test } from '@playwright/test';
import { BKP, fakeBackup } from './backup.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const openCard = async (page: import('@playwright/test').Page) => {
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="gen"]');
  await page.waitForSelector('#bkpDest input:not(:disabled)');
};

test('the owner chooses where backups go; places not connected yet say so', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await openCard(page);
  await expect(page.locator('#bkpDest input:checked')).toHaveCount(0);
  await expect(page.locator('#bkpOff')).toHaveCount(0);
  await expect(page.locator('#bkpCloud')).toHaveCount(0);
  await page.click('#bkpDest input[value="drive"]');
  await expect(page.locator('#toast')).toHaveText('Backups go to Google Drive');
  await expect(page.locator('#bkpDrive')).toContainText('Not connected yet');
  await expect(page.locator('#bkpLocal')).toHaveCount(0);
  await page.click('#bkpDriveGo');
  await expect(page.locator('#toast')).toHaveText('Connecting Google Drive comes in the next update.');
  await page.click('#bkpDest input[value="both"]');
  await expect(page.locator('#toast')).toHaveText('Backups go to Google Drive and this computer');
  await expect(page.locator('#bkpLocalPick')).toBeVisible();
  // nothing to restore from before the first full copy
  await expect(page.locator('#bkpTest')).toBeDisabled();
  await expect(page.locator('#bkpRestoreLive')).toBeDisabled();
  await expect(page.locator('#bkpSnapTxt')).toContainText('The first full copy is made as soon as a place is connected.');
  // kept on the server
  await page.reload();
  await page.click('#subnav [data-settab="gen"]');
  await expect(page.locator('#bkpDest input[value="both"]')).toBeChecked();
  await expect(page.locator('#bkpDest label.on')).toHaveText(/Both/);
});

test('a red banner on every screen after 15 minutes of failing, leading to the backup settings', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const fake = await fakeBackup(page, BKP.failingFor(14));
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/parties');
  await page.waitForSelector('#app');
  await expect(page.locator('#bkpBar')).toHaveCount(0);
  fake.set(BKP.failingFor(16));
  await page.reload();
  await expect(page.locator('#bkpBar')).toContainText('Backup to Google Drive has not worked for 16 minutes.');
  await expect(page.locator('#bkpBar')).toContainText('Can’t reach Google Drive.');
  await page.click('#bkpBar .lnk2');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('#subnav [data-settab="gen"], #subnav button.on')).toContainText('General');
  await expect(page.locator('#bkpDrive .st.r')).toHaveText('Not working');
  await expect(page.locator('#bkpDrive')).toContainText('3 changes waiting');
  // under 15 minutes: "Trying again", no banner
  fake.set(BKP.retrying);
  await page.reload();
  await page.click('#subnav [data-settab="gen"]');
  await expect(page.locator('#bkpDrive .st.a')).toHaveText('Trying again');
  await expect(page.locator('#bkpBar')).toHaveCount(0);
  // space nearly gone: an amber line on every screen
  fake.set(BKP.spaceLow);
  await page.goto(APP + '/parties');
  await expect(page.locator('#spaceBar')).toContainText('441 MB of 500 MB used');
});

test('restore always checks the backup first and needs “I understand”', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const fake = await fakeBackup(page, BKP.drive);
  await signInAs(page, await freshShop(request));
  await openCard(page);
  await expect(page.locator('#bkpDrive')).toContainText('Last backup 40 seconds ago.');
  await page.click('#bkpTest');
  await expect(page.locator('#trmT')).toHaveText('Test restore');
  await expect(page.locator('#trmOk')).toHaveText('The backup opened and checked out. Your books were not touched.');
  // (₹ shows only with Settings › Show currency symbol on, which is off in a new shop)
  await expect(page.locator('#trmBody .rcv')).toContainText('Sales total this year48,72,310.00');
  await expect(page.locator('#trmGo')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#trm')).toBeHidden();
  await page.click('#bkpRestoreLive');
  await expect(page.locator('#trmT')).toHaveText('Restore from backup');
  await expect(page.locator('#trmGo')).toBeDisabled();
  await page.check('#trmUnderstand');
  await page.click('#trmGo');
  await expect(page.locator('#trmDone')).toContainText('Restored into new books: Verma Traders (BE-1099)');
  expect(fake.restoreBody()).toEqual({ from: 'drive', confirm: true });
  await page.click('#trmStay');
  await expect(page.locator('#trm')).toBeHidden();
});

test('Safari and Firefox get a Download backup button instead of folder access', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await page.addInitScript(() => { delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker; });
  await fakeBackup(page, BKP.computer);
  await signInAs(page, await freshShop(request));
  await openCard(page);
  await expect(page.locator('#bkpLocal')).toContainText('This browser can’t save backups into a folder by itself.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkpLocalDl')]);
  expect(dl.suggestedFilename()).toMatch(/^Verma-Traders-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
});
