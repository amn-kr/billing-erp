/**
 * The Windows app, step 6a: backups in single-PC mode. The shop chooses a pen drive or folder once;
 * backups go there on their own (and wait while the pen drive is out); the recovery key is printed; and
 * on another computer (a second app folder with its own database) the books come back from the files
 * with that key: the restore drill. Step 6b: the same with Google Drive (a pretend Google).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch } from './launch';
import { bill, LOCAL, newShop } from './shop';
import { createRequire } from 'node:module';
import type * as FakeGoogleModule from '../../api/test/fake-google';

const NOWHERE = 'http://localhost:5999';
// the API tests' pretend Google (apps/api is a CommonJS package, so it is loaded with require)
const { startFakeGoogle } = createRequire(import.meta.url)('../../api/test/fake-google.ts') as typeof FakeGoogleModule;

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

/** "Connect Google Drive": the app hands Google's sign-in to the web browser; here the test is that browser */
async function connectDrive(app: ElectronApplication, win: Page) {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened?: string };
    delete g.opened;
    shell.openExternal = (async (u: string) => { g.opened = u; }) as typeof shell.openExternal;
  });
  await win.click('#bkpDriveGo');
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened?: string }).opened ?? '')).toContain('/o/oauth2/v2/auth');
  // the app's window did not go to Google: Google never runs inside the app
  expect(new URL(win.url()).hostname).toBe('127.0.0.1');
  const google = new URL(await app.evaluate(() => (globalThis as unknown as { opened: string }).opened));
  const back = google.searchParams.get('redirect_uri')!;
  // Google sends the web browser back to the app's own server on this computer, at its bare address
  expect(back).toBe(`${new URL(win.url()).origin}/`);
  const page = await (await fetch(`${back}?state=${encodeURIComponent(google.searchParams.get('state')!)}&code=good-code&scope=x`)).text();
  expect(page).toContain('Google Drive is connected');
  // back in the app: it sees the new state by itself
  await win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(win.locator('#bkpDrive')).toContainText('owner@gmail.com', { timeout: 30_000 });
}

test('Google Drive backups from this computer, and the books back on another computer from Drive', async () => {
  const fake = await startFakeGoogle();
  const GOOGLE = { ...LOCAL, BILLING_GOOGLE_CLIENT_ID: 'test-client', BILLING_GOOGLE_CLIENT_SECRET: 'test-secret', BILLING_GOOGLE_URL: fake.base };
  let key = '';
  try {
    // ── this computer: two bills, backed up to Google Drive
    const a = await launch(NOWHERE, GOOGLE);
    try {
      await newShop(a.win);
      expect(await bill(a.win, 2)).toEqual(['INV-0001', 'INV-0002']);
      await openBackupCard(a.win);
      await a.win.click('#bkpDest input[value="drive"]');
      await connectDrive(a.app, a.win);
      await a.win.click('#bkpDriveNow');
      await expect(a.win.locator('#bkpDrive .st.g')).toHaveText('Working', { timeout: 30_000 });
      expect([...fake.g.files.values()].some((f) => f.name.startsWith('full-'))).toBe(true);
      await a.win.click('#bkpKeyShow');
      key = (await a.win.locator('#bkpKey').innerText()).trim();
    } finally {
      await a.app.close();
    }

    // ── another computer: a throwaway shop, the same Google account, the printed key
    const b = await launch(NOWHERE, GOOGLE);
    try {
      await newShop(b.win, { email: 'drive-pc@local-shop.example.com', password: 'new computer password 2' }, 'Temporary');
      await openBackupCard(b.win);
      await b.win.click('#bkpDest input[value="drive"]');
      await connectDrive(b.app, b.win);
      await b.win.click('#bkpFilesGo');
      await b.win.click('#frmFrom input[value="drive"]');
      await expect(b.win.locator('#frmFrom')).toContainText('Connected: owner@gmail.com');
      await b.win.fill('#frmKey', key);
      await b.win.click('#frmCheck');
      await expect(b.win.locator('#frmOk')).toBeVisible({ timeout: 30_000 });
      await expect(b.win.locator('#frm .rcv')).toContainText('Invoices2');
      await b.win.check('#frmUnderstand');
      await b.win.click('#frmGo');
      await expect(b.win.locator('#frmDone')).toContainText('Local Traders', { timeout: 60_000 });
      await b.win.click('#frmOpen');
      await expect(b.win.locator('#orgBtn')).toContainText('Local Traders');
      const next = await b.win.evaluate(async () => {
        const { accessToken } = await (await fetch('/api/auth/refresh', { method: 'POST' })).json();
        return (await (await fetch('/api/sales/next-number?kind=invoice', { headers: { authorization: `Bearer ${accessToken}` } })).json()).number;
      });
      expect(next).toBe('INV-0003');
    } finally {
      await b.app.close();
    }
  } finally {
    await fake.close();
  }
});
