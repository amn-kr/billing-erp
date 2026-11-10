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
  let pdf = '';
  for (let i = 0; i < 60 && !pdf; i++) {
    if (fs.existsSync(out) && fs.statSync(out).size > 0) pdf = fs.readFileSync(out, 'latin1');
    else await new Promise((r) => setTimeout(r, 500));
  }
  if (!pdf) throw new Error(`Nothing was printed to ${out}`);
  const box = pdf.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
  if (!box) throw new Error('The printed file has no page size');
  const [w, h] = [Number(box[1]), Number(box[2])];
  // A5 landscape = 595 × 420 points
  if (Math.abs(w - 595) > 3 || Math.abs(h - 420) > 3) throw new Error(`Printed on ${w} × ${h} points, expected A5 landscape (595 × 420)`);
  console.log(`OK  printed silently on "${printer}", A5 landscape (${w} × ${h} points)`);
  await app.close();
}
