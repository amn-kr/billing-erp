/**
 * Parties › Import Parties is new (the prototype has no such screens), so it is compared with its
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px: the choice page, the Excel
 * preview with the prepared file (OK, rejected and duplicate rows), and Bulk entry with pasted rows
 * and red cells.
 */
import { test } from '@playwright/test';
import { partyShop, pasted, writePartyFile } from './party-import.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Import Parties: choice page, Excel preview, Bulk entry with red cells', async ({ browser, request }, info) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const who = await freshShop(request);
      await partyShop(request, who);
      await signInAs(app, who);
      await app.goto(APP + '/parties/import');
      await app.waitForSelector('#piBulk');
      await hideHeader(app);
      // the "… pasted" messages come and go on their own
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await look();
      await approvedShot(`pimport-choice-${width}`, app, '#vPImport');

      await app.click('#piExcel button');
      await app.waitForSelector('#pxStart');
      const file = info.outputPath('parties.xlsx');
      await writePartyFile(file);
      await app.setInputFiles('#pxFile', file);
      await app.waitForSelector('#pxGrid tr[data-row="9"]');
      await look();
      await approvedShot(`pimport-excel-${width}`, app, '#vPExcel');

      await app.click('#piBack');
      await app.click('#dcfYes');
      await app.click('#piBulk button');
      await app.waitForSelector('#pbGrid tbody tr[data-row]');
      await app.locator('#pbGrid tbody tr[data-row]').first().locator('td[data-col="name"] input').click();
      await app.evaluate((t) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, pasted(true));
      await app.waitForSelector('#pbProblems');
      // no blinking text cursor in the picture
      await app.locator('#pbGrid input').first().blur();
      await look();
      await approvedShot(`pimport-bulk-${width}`, app, '#vPBulk');
    });
  });
}
