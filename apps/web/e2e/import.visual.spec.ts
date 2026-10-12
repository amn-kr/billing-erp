/**
 * Items › Import products is new (the prototype has no such screen), so it is compared with its
 * owner-approved pictures (e2e/approved/) at 1280, 1366 and 1920 px: the start page, the checking
 * screen (all rows, scrolled to the last rows, errors only), a row before and after it is corrected, the question before
 * Final import, and the summary.
 */
import { test } from '@playwright/test';
import { fillTemplate, importShop } from './import.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Import products: start, checking screen, errors, a corrected row, Final import question, summary', async ({ browser, request }, info) => {
      test.setTimeout(120_000);
      const app = await newPage(browser, width);
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      const who = await freshShop(request);
      await importShop(request, who);
      await signInAs(app, who);
      await app.goto(APP + '/items/import');
      await app.waitForSelector('#imStart');
      await hideHeader(app);
      // the "Template downloaded" / "… imported" messages come and go on their own
      await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await look();
      await approvedShot(`import-start-${width}`, app, '#vImport');

      const tpl = info.outputPath('template.xlsx');
      const [d] = await Promise.all([app.waitForEvent('download'), app.click('#imTpl')]);
      await d.saveAs(tpl);
      const sample = info.outputPath('Import products sample.xlsx');
      await fillTemplate(tpl, sample);
      await app.setInputFiles('#imFile', sample);
      await app.waitForSelector('#imGrid tr[data-row="24"]');
      await look();
      await approvedShot(`import-check-${width}`, app, '#vImport');
      // scrolled to the last rows: the title, tabs, search and heading row stay where they are
      await app.locator('#imGrid .tw').evaluate((e) => { e.scrollTop = e.scrollHeight; });
      await approvedShot(`import-scrolled-${width}`, app, '#vImport');
      await app.locator('#imGrid .tw').evaluate((e) => { e.scrollTop = 0; });
      await app.click('[data-imf="error"]');
      await look();
      await approvedShot(`import-errors-${width}`, app, '#vImport');
      await app.click('[data-imf="all"]');

      // row 19: the unit DOZEN is not one of the shop's units; picking PCS makes the row OK
      await app.fill('#imQ', 'ONLOAD');
      await app.locator('#imGrid .tw').evaluate((e) => { e.scrollLeft = 700; });
      await look();
      await approvedShot(`import-edit-before-${width}`, app, '#vImport');
      await app.selectOption('tr[data-row="19"] td[data-col="unit"] select', 'PCS');
      await app.waitForSelector('tr[data-row="19"] [data-st="ok"]');
      await app.locator('tr[data-row="19"] td[data-col="unit"] select').blur();
      await look();
      await approvedShot(`import-edit-after-${width}`, app, '#vImport');
      await app.fill('#imQ', '');

      await app.check('#imSkip');
      await app.click('#imGo');
      await app.waitForSelector('#imConfirm .mdl');
      await look();
      await approvedShot(`import-confirm-${width}`, app, '#imConfirm .mdl');
      await app.click('#imcGo');
      await app.waitForSelector('#imDone');
      await look();
      await approvedShot(`import-summary-${width}`, app, '#vImport');
    });
  });
}
