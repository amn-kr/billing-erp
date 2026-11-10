/**
 * Direct printing (Phase 6, step 3). The printer is chosen per PC (Settings › Print & invoice ›
 * Printer on this PC) and saved in this PC's app folder, not in the shop's settings. Print buttons
 * then go straight to it with the paper the document asks for (A4 / A5, portrait / landscape).
 * Only the app's own pages may ask (checked on every request).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { paperOf, pickPrinter, readChoice, type PrinterInfo } from './paper';

export type PrintResult = { ok: true; printer: string } | { ok: false; reason: 'none' | 'missing' | 'failed'; message?: string };

const file = () => path.join(app.getPath('userData'), 'printing.json');

function loadChoice(): string | null {
  try {
    return readChoice(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    return null;
  }
}

function saveChoice(name: string | null) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ printer: name }, null, 2));
}

async function printers(e: IpcMainInvokeEvent): Promise<PrinterInfo[]> {
  const list = await e.sender.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name }));
}

export function startPrinting(ownPage: (url: string | undefined) => boolean): void {
  const allowed = (e: IpcMainInvokeEvent) => {
    if (!ownPage(e.senderFrame?.url)) throw new Error('Not allowed');
  };

  ipcMain.handle('printing:list', async (e) => {
    allowed(e);
    return { printers: await printers(e), chosen: loadChoice() };
  });

  ipcMain.handle('printing:choose', (e, name: unknown) => {
    allowed(e);
    const n = name === null ? null : readChoice({ printer: name });
    if (name !== null && n === null) throw new Error('Not a printer name');
    saveChoice(n);
    return { chosen: n };
  });

  ipcMain.handle('printing:print', async (e, page: unknown): Promise<PrintResult> => {
    allowed(e);
    const pick = pickPrinter(loadChoice(), await printers(e));
    if (!pick.ok) return { ok: false, reason: pick.reason };
    const { pageSize, landscape } = paperOf(page);
    return new Promise((done) => {
      e.sender.print(
        { silent: true, deviceName: pick.name, printBackground: true, pageSize, landscape, margins: { marginType: 'none' } },
        (ok, why) => done(ok ? { ok: true, printer: pick.name } : { ok: false, reason: 'failed', message: why || 'The printer did not take the page.' }),
      );
    });
  });
}
