/**
 * The Windows app, step 3: direct printing (A4 / A5). The printer is chosen per PC in Settings › Print &
 * invoice › Printer on this PC; Print buttons then go straight to it with the shop's paper and
 * orientation. Windows' printers are stood in for here (the test machine has none): the app's
 * webContents.getPrintersAsync and webContents.print are replaced, and every print is recorded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP, freshShop, savePrint, signInAs } from '../../web/e2e/setup';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'dist', 'main.cjs');

interface Printed { deviceName?: string; silent?: boolean; pageSize?: unknown; landscape?: boolean; title: string; clone: string }

async function launch(): Promise<{ app: ElectronApplication; win: Page; profile: string }> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-print-'));
  const app = await electron.launch({ args: [MAIN], env: { ...process.env, BILLING_APP_URL: APP, BILLING_PROFILE_DIR: profile, BILLING_TEST: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1366, height: 768 });
  return { app, win, profile };
}

/** Stand-in printers: these names, and every print recorded (with what was in the print area at that moment). */
async function fakePrinters(app: ElectronApplication, names: string[]) {
  await app.evaluate(({ webContents }, names) => {
    const g = globalThis as unknown as { printed: unknown[] };
    g.printed ??= [];
    for (const wc of webContents.getAllWebContents()) {
      wc.getPrintersAsync = async () => names.map((name) => ({ name, displayName: name, description: '', options: {} })) as unknown as Electron.PrinterInfo[];
      wc.print = ((opts: Electron.WebContentsPrintOptions, done?: (ok: boolean, why: string) => void) => {
        void wc.executeJavaScript(`document.querySelector('body > .prclone')?.innerText ?? ''`).then((clone: string) => {
          g.printed.push({ ...opts, title: wc.getTitle(), clone });
          done?.(true, '');
        });
      }) as typeof wc.print;
    }
  }, names);
}
const printed = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { printed?: Printed[] }).printed ?? []);

async function openPrintSettings(page: Page) {
  await page.goto(APP + '/settings');
  await page.click('#subnav button:has-text("Print & invoice")');
  await page.waitForSelector('#pv #pvPaper .ppage');
}
async function previewInvoice(page: Page, no: string) {
  await page.goto(APP + '/sales');
  const row = page.locator(`#slRows tr[data-sno="${no}"]`);
  await row.waitFor();
  const b = await row.boundingBox();
  await page.mouse.click(b!.x + 200, b!.y + 10, { button: 'right' });
  await page.click('#slCtx [data-sla="prev"]');
  await page.waitForSelector('#ipv:not([hidden]) #ipvSheet .ppage');
}
/** count the print windows the page opens (window.print), without opening one */
const watchPrintWindow = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { printWindows: number };
  w.printWindows = 0;
  window.print = () => { w.printWindows += 1; };
});
const printWindows = (page: Page) => page.evaluate(() => (window as unknown as { printWindows: number }).printWindows);

test('Print goes straight to the printer chosen on this PC, on the shop’s paper', async ({ request }) => {
  const who = await freshShop(request, 'sales-shop');
  await savePrint(who, { paper: 'A5', landscape: true });
  const { app, win, profile } = await launch();
  try {
    await fakePrinters(app, ['Counter Laser', 'Office Inkjet']);
    await signInAs(win, who);

    // the card is there (Windows app only), with Windows' printers; nothing chosen yet
    await openPrintSettings(win);
    const pick = win.locator('#cPrDevice #pDevice');
    await expect(win.locator('#cPrDevice')).toContainText('Printer on this PC');
    await expect(pick.locator('option')).toHaveText(['Ask every time (open the print window)', 'Counter Laser', 'Office Inkjet']);
    await expect(pick).toHaveValue('');

    await pick.selectOption('Counter Laser');
    await expect(win.locator('#toast')).toContainText('Print buttons now print on Counter Laser');
    // saved on this PC (the app's folder), not in the shop's settings
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(profile, 'printing.json'), 'utf8'))).toEqual({ printer: 'Counter Laser' });

    // Print: no print window; the invoice (only) goes to Counter Laser on A5 landscape
    await previewInvoice(win, 'INV-0101');
    await watchPrintWindow(win);
    await win.click('#ipvPrint');
    await expect(win.locator('#toast')).toContainText('Printed on Counter Laser');
    const [p] = await printed(app);
    expect(p).toMatchObject({ deviceName: 'Counter Laser', silent: true, pageSize: 'A5', landscape: true, title: 'Tax Invoice INV-0101' });
    expect(p!.clone).toContain('INV-0101');
    expect(await printWindows(win)).toBe(0);
    // the print area is tidied away afterwards
    await expect(win.locator('body > .prclone')).toHaveCount(0);

    // the choice is kept when the app is opened again
    await openPrintSettings(win);
    await expect(win.locator('#pDevice')).toHaveValue('Counter Laser');
  } finally {
    await app.close();
  }
});

test('no printer chosen, or the chosen one unplugged: the print window opens as before', async ({ request }) => {
  const who = await freshShop(request, 'sales-shop');
  const { app, win, profile } = await launch();
  try {
    await fakePrinters(app, ['Counter Laser']);
    await signInAs(win, who);

    // nothing chosen: the usual print window
    await previewInvoice(win, 'INV-0101');
    await watchPrintWindow(win);
    await win.click('#ipvPrint');
    await expect.poll(() => printWindows(win)).toBe(1);
    expect(await printed(app)).toEqual([]);

    // a printer chosen earlier that is no longer connected: said so, and the print window opens
    fs.writeFileSync(path.join(profile, 'printing.json'), JSON.stringify({ printer: 'Old Epson' }));
    await previewInvoice(win, 'INV-0101');
    await watchPrintWindow(win);
    await win.click('#ipvPrint');
    await expect(win.locator('#toast')).toContainText('isn’t connected');
    await expect.poll(() => printWindows(win)).toBe(1);
    expect(await printed(app)).toEqual([]);

    // Settings shows it as not connected
    await openPrintSettings(win);
    await expect(win.locator('#pDevice')).toHaveValue('Old Epson');
    await expect(win.locator('#pDevice option:checked')).toHaveText('Old Epson (not connected)');
  } finally {
    await app.close();
  }
});

test('only the app’s own pages get printing (not the “Not connected” page)', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-print-'));
  const app = await electron.launch({ args: [MAIN], env: { ...process.env, BILLING_APP_URL: 'http://localhost:5999', BILLING_PROFILE_DIR: profile, BILLING_TEST: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('#offline');
    expect(await win.evaluate(() => typeof (window as unknown as { billingDesktop?: unknown }).billingDesktop)).toBe('undefined');
  } finally {
    await app.close();
  }
});
