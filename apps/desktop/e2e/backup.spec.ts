/**
 * The Windows app, step 6a: backups in single-PC mode. The shop chooses a pen drive or folder once;
 * backups go there on their own (and wait while the pen drive is out); the recovery key is printed; and
 * on another computer (a second app folder with its own database) the books come back from the files
 * with that key: the restore drill.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch } from './launch';
import { bill, LOCAL, newShop } from './shop';

const NOWHERE = 'http://localhost:5999';

/** Windows' folder picker answers with `folder` (the test machine has nobody to click it) */
const pickFolder = (app: ElectronApplication, folder: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
  }, folder);

async function openBackupCard(win: Page) {
  await win.evaluate(() => { history.pushState({}, '', '/settings'); dispatchEvent(new PopStateEvent('popstate')); });
  await win.click('#subnav [data-settab="gen"]');
  await win.waitForSelector('#bkpDest input:not(:disabled)');
}

test('pen drive backups, the printed recovery key, and the books back on another computer', async () => {
  const pen = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-pen-'));
  const printed = path.join(os.tmpdir(), `billing-key-${process.pid}.pdf`);

  // ── this computer: a shop with two bills, backed up to the "pen drive"
  const a = await launch(NOWHERE, { ...LOCAL, BILLING_PRINT_KEY_TO: printed });
  let key = '';
  try {
    await newShop(a.win);
    expect(await bill(a.win, 2)).toEqual(['INV-0001', 'INV-0002']);
    await openBackupCard(a.win);
    await a.win.click('#bkpDest input[value="local"]');
    await expect(a.win.locator('#bkpLocal')).toContainText('Choose a folder on a pen drive');
    await pickFolder(a.app, pen);
    await a.win.click('#bkpLocalPick');
    await expect(a.win.locator('#bkpLocal')).toContainText(`Folder “${pen}”`);
    await a.win.click('#bkpLocalNow');
    await expect(a.win.locator('#bkpLocal .st.g')).toHaveText('Working', { timeout: 30_000 });
    const [dir] = fs.readdirSync(pen);
    expect(dir).toMatch(/ Backup - BE-\d+$/);
    expect(fs.readdirSync(path.join(pen, dir!)).some((n) => /^full-.*\.berp$/.test(n))).toBe(true);

    // the recovery key: not printed yet, then printed (here: saved as a PDF)
    await expect(a.win.locator('#bkpKeyTxt')).toContainText('Not printed yet');
    await a.win.click('#bkpKeyShow');
    key = (await a.win.locator('#bkpKey').innerText()).trim();
    expect(key).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    await a.win.click('#bkpKeyPrint');
    await expect(a.win.locator('#bkpKeyTxt')).toContainText('Printed', { timeout: 15_000 });
    expect(fs.statSync(printed).size).toBeGreaterThan(1000);

    // the pen drive is pulled out: the app waits quietly (no red line), and says so in the card
    fs.renameSync(pen, pen + '-out');
    await a.win.reload();
    await a.win.click('#subnav [data-settab="gen"]');
    await a.win.waitForSelector('#bkpLocal');
    await expect(a.win.locator('#bkpLocalWait')).toContainText('Plug in the pen drive', { timeout: 30_000 });
    await expect(a.win.locator('#bkpBar')).toHaveCount(0);
    fs.renameSync(pen + '-out', pen);
  } finally {
    await a.app.close();
  }

  // ── another computer: its own app folder and database, a new owner and a throwaway shop
  const b = await launch(NOWHERE, LOCAL);
  try {
    const other = { email: 'new-pc@local-shop.example.com', password: 'new computer password 1' };
    await newShop(b.win, other, 'Temporary');
    await openBackupCard(b.win);
    await b.win.click('#bkpFilesGo');
    await pickFolder(b.app, pen);
    await b.win.click('#frmFolder');
    await expect(b.win.locator('#frmFolderTxt')).toHaveText(pen);
    // a wrong key is refused plainly
    await b.win.fill('#frmKey', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await b.win.click('#frmCheck');
    await expect(b.win.locator('#frmErr')).toContainText('recovery key does not open');
    // the printed key, typed in small letters
    await b.win.fill('#frmKey', key.toLowerCase());
    await b.win.click('#frmCheck');
    await expect(b.win.locator('#frmOk')).toBeVisible({ timeout: 30_000 });
    await expect(b.win.locator('#frm .rcv')).toContainText('Invoices2');
    await b.win.check('#frmUnderstand');
    await b.win.click('#frmGo');
    await expect(b.win.locator('#frmDone')).toContainText('Local Traders', { timeout: 60_000 });
    await b.win.click('#frmOpen');
    await expect(b.win.locator('#orgBtn')).toContainText('Local Traders');
    // the restored books carry on numbering where the first computer stopped
    const next = await b.win.evaluate(async () => {
      const { accessToken } = await (await fetch('/api/auth/refresh', { method: 'POST' })).json();
      return (await (await fetch('/api/sales/next-number?kind=invoice', { headers: { authorization: `Bearer ${accessToken}` } })).json()).number;
    });
    expect(next).toBe('INV-0003');
  } finally {
    await b.app.close();
  }
});
