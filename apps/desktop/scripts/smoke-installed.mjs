// After the installer has run (CI, Windows): opens the INSTALLED app and checks that it starts, that its
// own "Not connected" page is inside it, that it reaches the live app, and (PRINT_TEST_PRINTER and
// PRINT_TEST_FILE set) that it prints silently to a real Windows printer on A5 landscape.
//   node scripts/smoke-installed.mjs "<path to the installed .exe>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) throw new Error(`Installed app not found: ${exe}`);

async function open(env) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-smoke-'));
  const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, BILLING_PROFILE_DIR: profile, BILLING_NO_UPDATES: '1', ...env }, timeout: 60_000 });
  return { app, win: await app.firstWindow() };
}

// 1. nothing to reach: the app's own "Not connected" page
{
  const { app, win } = await open({ BILLING_APP_URL: 'http://localhost:5999' });
  await win.waitForSelector('#offline', { timeout: 30_000 });
  console.log('OK  starts, and shows "Not connected" when the app cannot be reached');
  await app.close();
}

// 2. the live app (the free server may need up to a minute to wake)
{
  const { app, win } = await open({});
  await win.waitForSelector('#vAuth:not([hidden]), #app', { timeout: 120_000 });
  console.log(`OK  opens the live app: ${win.url()} (${await win.title()})`);
  await app.close();
}

// 3. a real Windows printer (CI: "Microsoft Print to PDF" writing to a file): silent, named printer, A5 landscape,
//    exactly as Print does (printing.ts)
const printer = process.env.PRINT_TEST_PRINTER;
const out = process.env.PRINT_TEST_FILE;
if (printer && out) {
  const { app, win } = await open({ BILLING_APP_URL: 'http://localhost:5999' });
  await win.waitForSelector('#offline');
  const listed = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync()).map((p) => p.name));
  if (!listed.includes(printer)) throw new Error(`Windows does not list ${printer}: ${listed.join(', ')}`);
  const result = await app.evaluate(({ BrowserWindow }, deviceName) => new Promise((done) => {
    BrowserWindow.getAllWindows()[0].webContents.print(
      { silent: true, deviceName, printBackground: true, pageSize: 'A5', landscape: true, margins: { marginType: 'none' } },
      (ok, why) => done({ ok, why }),
    );
  }), printer);
  if (!result.ok) throw new Error(`Printing failed: ${result.why}`);
  // the printer writes the file a moment after taking the job
  let size = 0;
  for (let i = 0; i < 60; i++) {
    size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    if (size > 0) { await new Promise((r) => setTimeout(r, 1000)); if (fs.statSync(out).size === size) break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!size) throw new Error(`Nothing was printed to ${out}`);
  // read the page size with a real PDF reader (the file is compressed)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(out)) }).promise;
  const [x0, y0, x1, y1] = (await doc.getPage(1)).view;
  const [w, h] = [Math.round(x1 - x0), Math.round(y1 - y0)];
  // A5 landscape = 595 × 420 points
  if (Math.abs(w - 595) > 3 || Math.abs(h - 420) > 3) throw new Error(`Printed on ${w} × ${h} points, expected A5 landscape (595 × 420)`);
  console.log(`OK  printed silently on "${printer}", A5 landscape (${w} × ${h} points)`);
  await app.close();
}
