/** Items › Import products against the real API: template, wrong files, checks, editing, Discard question, error rows, Final import. */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fillTemplate, importShop } from './import.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const download = async (page: Page, click: () => Promise<unknown>, to: string) => {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]);
  await d.saveAs(to);
  return d.suggestedFilename();
};
const readBook = async (file: string) => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
};
const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

test('Import products: template, checks, editing, Discard question, error rows and Final import', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  await importShop(request, who);
  await signInAs(page, who);

  // two ways in: the Products top bar and the ⋯ menu
  await page.goto(APP + '/items');
  await page.click('#itMoreBtn');
  await page.click('#itImportMenu');
  await expect(page).toHaveURL(APP + '/items/import');
  await page.goto(APP + '/items');
  await page.click('#vItems .pthd #itImport');
  await expect(page).toHaveURL(APP + '/items/import');

  // the template: columns in the owner's order, drop-down lists of the shop's own lists, Notes and Samples
  const tpl = info.outputPath('template.xlsx');
  expect(await download(page, () => page.click('#imTpl'), tpl)).toBe('Import products template.xlsx');
  const wb = await readBook(tpl);
  expect(wb.worksheets.map((w) => `${w.name}:${w.state}`)).toEqual(['Products:visible', 'Lists:veryHidden', 'Notes:visible', 'Samples:visible']);
  const head = (wb.getWorksheet('Products')!.getRow(1).values as unknown[]).slice(1).map(cellText);
  expect(head).toEqual(['Product type', 'Product name', 'Brand name', 'Series / range name', 'Brand code', 'Opening stock', 'At price', 'As of date', 'Base unit', 'Sale price', 'Stock alert', 'Location', 'Category', 'GST %', 'HSN']);
  const lists = wb.getWorksheet('Lists')!;
  const col = (c: number) => { const out: string[] = []; lists.getColumn(c).eachCell((x, r) => { if (r > 1 && cellText(x.value)) out.push(cellText(x.value)); }); return out; };
  expect(col(1)).toContain('PCS');
  expect(col(2)).toEqual(['Main shop', 'Back godown']);
  expect(col(4)).toEqual(expect.arrayContaining(['5', '18', '28']));
  const dv = (wb.getWorksheet('Products') as unknown as { dataValidations: { model: Record<string, { formulae: string[] }> } }).dataValidations.model;
  // lists on Product type, Base unit, Location, Category and GST %, for rows 2 to 5,001 (read back cell by cell)
  expect(Object.keys(dv).length).toBe(5 * 5000);
  for (const c of ['A', 'I', 'L', 'M', 'N']) expect([`${c}2`, `${c}5001`].map((k) => !!dv[k]), c).toEqual([true, true]);
  expect([dv['B2'], dv['A5002']]).toEqual([undefined, undefined]);
  expect(dv['A2']!.formulae).toEqual(['"Single Range,Multi Range"']);
  expect(dv['L2']!.formulae).toEqual(['Lists!$B$2:$B$3']);
  const samples = wb.getWorksheet('Samples')!;
  expect([2, 3, 4].map((r) => cellText(samples.getRow(r).getCell(1).value))).toEqual(['Single Range', 'Single Range', 'Multi Range']);
  // one Single Range sample has no brand: it is optional there
  expect([2, 3, 4].map((r) => cellText(samples.getRow(r).getCell(3).value))).toEqual(['Indotech', '', 'Havells']);
  const notes = wb.getWorksheet('Notes')!;
  const noteRow = (first: string) => { let out: string[] = []; notes.eachRow((r) => { if (cellText(r.getCell(1).value) === first) out = [2, 3].map((c) => cellText(r.getCell(c).value)); }); return out; };
  expect(noteRow('Brand name')).toEqual(['Multi Range', 'Required for Multi Range. Optional for Single Range (blank = no brand). A brand that is not in Brands & Series yet is created on import.']);
  expect(noteRow('Single Range')[0]).toBe('One item. Its product name must be new. Brand is optional (leave it blank for no brand); a series needs a brand.');
  expect(cellText(wb.getWorksheet('Notes')!.getRow(1).getCell(1).value)).toBe('Import products — how to fill the Products sheet');

  // files that are not the template are refused before anything is shown
  const bad = info.outputPath('bad.xlsx');
  { const { default: ExcelJS } = await import('exceljs'); const b = new ExcelJS.Workbook(); b.addWorksheet('Sheet1').addRow(['Item', 'Brand']); await b.xlsx.writeFile(bad); }
  await page.setInputFiles('#imFile', bad);
  await expect(page.locator('#imFileErr')).toHaveText('This is not the import template: column A should be “Product type”, not “Item”. Download the template and copy your rows into it.');
  await page.setInputFiles('#imFile', { name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from('Product type,Product name\n') });
  await expect(page.locator('#imFileErr')).toHaveText('Choose an Excel file (.xlsx) made from the template. Other files cannot be imported.');
  await page.setInputFiles('#imFile', tpl);
  await expect(page.locator('#imFileErr')).toHaveText('The Products sheet has no rows. Fill in your products under the headings and upload it again.');
  const big = info.outputPath('big.xlsx');
  await fillTemplate(tpl, big, Array.from({ length: 5001 }, (_, i) => ['Single Range', `Item ${i}`, 'Bajaj', '', `C${i}`]));
  await page.setInputFiles('#imFile', big);
  await expect(page.locator('#imFileErr')).toHaveText('This file has more than 5,000 products. Split it into smaller files of up to 5,000 rows.');

  // the owner's sample: every row checked and marked; nothing saved yet
  const sample = info.outputPath('sample.xlsx');
  await fillTemplate(tpl, sample);
  await page.setInputFiles('#imFile', sample);
  await expect(page.locator('#imTot')).toHaveText('sample.xlsx23 rows');
  await expect(page.locator('#imTabs button')).toHaveText(['All23', 'Errors16', 'Warnings4', 'OK3']);
  await expect(page.locator('#imCount')).toHaveText('Fix 16 rows with errors, or tick “Skip error rows”.');
  await expect(page.locator('#imGo')).toBeDisabled();
  await expect(page.locator('#imNew')).toHaveText('Will be created on import: 1 parent item, 2 brands, 2 series, 1 category.');
  const status = (line: number) => page.locator(`tr[data-row="${line}"] [data-st]`);
  const marks = (line: number, col: string) => page.locator(`tr[data-row="${line}"] td[data-col="${col}"] .egm`);
  await expect(status(2)).toHaveText('OK');
  await expect(status(4)).toHaveText('Warning');
  await expect(marks(4, 'series')).toHaveText(['New series “Fabio” for Havells will be created.']);
  await expect(marks(7, 'name')).toHaveText(['An item called “BAJAJ BAHAR HS 225M E/F” already exists.']);
  await expect(marks(8, 'name')).toHaveText(['This product name is also in row 9 of the uploaded file.']);
  await expect(marks(10, 'code')).toHaveText(['Brand code AHCSXXW061 is already used by “Modular switch 6A · Havells Coral”.']);
  await expect(marks(11, 'series')).toHaveText(['Havells Coral is already in Modular switch 6A (item “Modular switch 6A · Havells Coral”).']);
  // Single Range: the brand is optional (row 13 has none)
  await expect(marks(13, 'brand')).toHaveCount(0);
  await expect(status(13)).toHaveText('OK');
  // the brand code is optional: a blank one is not marked (rows 3 and 13)
  await expect(marks(13, 'code')).toHaveCount(0);
  await expect(marks(3, 'code')).toHaveCount(0);
  await expect(marks(15, 'date')).toHaveText(['“31-02-2026” is not a date. Type it like 01-04-2026.']);
  await expect(marks(16, 'date')).toHaveText(['01 Jan 2027', 'The date 01-01-2027 is in the future.']);
  await expect(marks(17, 'rate')).toHaveText(['Enter the rate of the opening stock (0 if it cost nothing).']);
  await expect(marks(19, 'unit')).toHaveText(['Unit “DOZEN” is not in your units. Choose one from the list.']);
  await expect(marks(20, 'godown')).toHaveText(['There is no godown called “Shop 2”. Choose one from the list.']);
  await expect(marks(24, 'type')).toHaveText(['“Double Range” is not a product type. Choose Single Range or Multi Range.']);
  // the date as it was understood
  await expect(marks(5, 'date')).toHaveText(['15 Sep 2026']);
  await expect(marks(6, 'date')).toHaveText(['15 Sep 2026']);
  await expect(page.locator(`tr[data-row="19"] [data-where]`)).toHaveText('Check: Base unit');

  // the screen keeps still: the table fits the window and its rows scroll inside it, under the heading row
  const layout = () => page.evaluate(() => {
    const tw = document.querySelector('#imGrid .tw')!, r = tw.getBoundingClientRect();
    return {
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1, scrollY,
      tableOnScreen: r.bottom <= innerHeight, rowsScroll: tw.scrollHeight > tw.clientHeight,
      headAtTop: Math.round(tw.querySelector('thead th')!.getBoundingClientRect().top - r.top), tabsTop: Math.round(document.querySelector('#imTabs')!.getBoundingClientRect().top),
    };
  });
  const before = await layout();
  expect(before).toMatchObject({ pageScrolls: false, scrollY: 0, tableOnScreen: true, rowsScroll: true, headAtTop: 0 });
  await page.mouse.move(900, 600);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => page.locator('#imGrid .tw').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await layout()).toEqual({ ...before, headAtTop: 0 });
  await page.locator('#imGrid .tw').evaluate((e) => { e.scrollTop = 0; });

  // filters and search
  await page.click('[data-imf="ok"]');
  await expect(page.locator('#imGrid tbody tr')).toHaveCount(3);
  await page.click('[data-imf="warning"]');
  await expect(page.locator('#imGrid tbody tr [data-st]')).toHaveText(['Warning', 'Warning', 'Warning', 'Warning']);
  await page.click('[data-imf="all"]');
  await page.fill('#imQ', 'kelino');
  await expect(page.locator('#imGrid tbody tr')).toHaveCount(4);
  await page.fill('#imQ', '');

  // an edited row is checked again straight away
  await page.selectOption('tr[data-row="19"] td[data-col="unit"] select', 'PCS');
  await expect(status(19)).toHaveText('OK');
  await expect(page.locator('#imTabs button')).toHaveText(['All23', 'Errors15', 'Warnings4', 'OK4']);
  await page.fill('tr[data-row="17"] td[data-col="rate"] input', '107');
  await expect(status(17)).toHaveText('Warning');
  await expect(page.locator('#imTabs button')).toHaveText(['All23', 'Errors14', 'Warnings5', 'OK4']);

  // leaving asks first; Keep editing stays with the rows
  await page.click('#imBack');
  await expect(page.locator('#dcfT')).toHaveText('Discard this import?');
  await page.click('#dcfNo');
  await expect(page).toHaveURL(APP + '/items/import');
  await expect(status(19)).toHaveText('OK');

  // the error rows as a file: the template + a Problem column
  const errs = info.outputPath('errors.xlsx');
  expect(await download(page, () => page.click('#imErrDl'), errs)).toBe('Import products - error rows.xlsx');
  const ew = (await readBook(errs)).getWorksheet('Products')!;
  expect(cellText(ew.getRow(1).getCell(16).value)).toBe('Problem');
  // two rows were corrected above: 14 left, under the heading
  expect(ew.actualRowCount).toBe(15);
  expect(cellText(ew.getRow(2).getCell(2).value)).toBe('LED batten 20W');
  expect(cellText(ew.getRow(2).getCell(16).value)).toBe('Brand code: This brand code is also in row 12 of the uploaded file.');

  // Final import: skip the error rows, confirm, summary
  await page.check('#imSkip');
  await expect(page.locator('#imCount')).toHaveText('9 products will be imported, 14 skipped.');
  await page.click('#imGo');
  await expect(page.locator('#imConfirm li')).toHaveText([
    '9 products will be added, 9 with opening stock.',
    'New: 1 parent item, 3 brands, 2 series, 1 category.',
    '14 rows with errors will be skipped.',
    'Items are never deleted, only made inactive. Check the rows before you import.',
  ]);
  await page.click('#imcGo');
  await expect(page.locator('#imDone > ul > li')).toHaveText([
    '9 products created, 9 with opening stock.',
    'New parent items: LED batten 20W',
    'New brands: Philips, G2, Kelino',
    'New series: Havells Fabio, Philips Astra Line',
    'New categories: Solar',
    '14 rows skipped because of errors:',
  ]);
  await expect(page.locator('#imSkipped tbody tr td:first-child')).toHaveText(['5', '7', '8', '9', '10', '11', '12', '14', '15', '16', '18', '20', '23', '24']);
  // after the import, leaving does not ask
  await page.click('#imToItems');
  await expect(page).toHaveURL(APP + '/items');

  // the items are there, with their opening stock in the right godown and the rate table
  await expect(page.locator('#itList .ptr', { hasText: 'SOLAR STREET LIGHT 30W' })).toHaveCount(1);
  const r = await request.post(APP + '/api/auth/login', { data: who });
  const headers = { Authorization: `Bearer ${(await r.json()).accessToken}` };
  const list = (await (await request.get(APP + '/api/items', { headers })).json()) as { id: string; code: string; name: string; purchase: string }[];
  expect(list.length).toBe(3 + 9);
  // imported without a brand code
  const roma = list.find((i) => i.name === 'Modular switch 6A · Anchor Roma')!;
  expect(roma.code).toBe('');
  const d = await (await request.get(APP + `/api/items/${roma.id}`, { headers })).json();
  expect(d.movements).toMatchObject([{ kind: 'opening', qty: '200.000', rate: '18.00', date: '2026-04-01', godown: 'Back godown' }]);
  expect(d.rateTable.layers).toEqual([{ rate: '18.00', qty: '200.000', since: '2026-04-01' }]);
  const solar = await (await request.get(APP + `/api/items/${list.find((i) => i.code === 'HV-SSL30')!.id}`, { headers })).json();
  // no date in the file: the opening stock is dated today (the test server's today)
  expect(solar.movements).toMatchObject([{ kind: 'opening', qty: '3.000', rate: '2100.00', date: '2026-10-01', godown: 'Main shop' }]);

  // the error rows file can be fixed and uploaded again; leaving through the sidebar asks, Discard goes
  await page.goto(APP + '/items/import');
  await page.setInputFiles('#imFile', errs);
  await expect(page.locator('#imTot')).toHaveText('errors.xlsx14 rows');
  // every row has an error: nothing to import, said in red (not "0 products will be imported" in green)
  await expect(page.locator('#imCount .stt.r')).toHaveText('Nothing to import yet: every row has an error. Fix the errors first.');
  await page.check('#imSkip');
  await expect(page.locator('#imCount .stt.r')).toHaveText('Nothing to import yet: every row has an error. Fix the errors first.');
  await expect(page.locator('#imCount .stt.g')).toHaveCount(0);
  await expect(page.locator('#imGo')).toBeDisabled();
  await page.click('#imBack');
  await page.click('#dcfYes');
  await expect(page).toHaveURL(APP + '/items');
  fs.rmSync(big);
});

test('Import products: a Single Range row may have no brand; a series needs a brand; names stay new; Multi Range still needs a brand', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  await importShop(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/items/import');
  const tpl = info.outputPath('template.xlsx');
  await download(page, () => page.click('#imTpl'), tpl);
  const file = info.outputPath('no-brand.xlsx');
  await fillTemplate(tpl, file, [
    ['Single Range', 'PVC INSULATION TAPE 18MM', '', '', '', 50, 12, '01-04-2026', 'PCS', 18, 10, '', '', 18, '3919'],
    ['Single Range', 'GI WALL PLUG 6MM', '', 'Coral', '', 100, 1, '01-04-2026', 'PCS', 2, '', '', 'Accessories', 18, ''],
    // already in the shop (with a brand): a Single Range name must be new, whatever the brand
    ['Single Range', 'bajaj bahar hs 225m e/f', '', '', '', '', '', '', 'PCS', 1550, '', '', 'Fans', 18, ''],
    ['Multi Range', 'Modular switch 6A', '', 'Roma', '', '', '', '', 'PCS', 26, '', '', 'Switches & MCBs', 18, ''],
  ]);
  await page.setInputFiles('#imFile', file);
  await expect(page.locator('#imTabs button')).toHaveText(['All4', 'Errors3', 'Warnings0', 'OK1']);
  const status = (line: number) => page.locator(`tr[data-row="${line}"] [data-st]`);
  const marks = (line: number, col: string) => page.locator(`tr[data-row="${line}"] td[data-col="${col}"] .egm`);
  await expect(status(2)).toHaveText('OK');
  await expect(marks(2, 'brand')).toHaveCount(0);
  await expect(marks(3, 'series')).toHaveText(['Series needs a brand. Enter the brand name, or clear the series.']);
  await expect(page.locator('tr[data-row="3"] [data-where]')).toHaveText('Check: Series / range name');
  await expect(marks(4, 'name')).toHaveText(['An item called “BAJAJ BAHAR HS 225M E/F” already exists.']);
  await expect(marks(5, 'brand')).toHaveText(['Enter the brand name.']);
  await expect(page.locator('#imNew')).toHaveCount(0);

  await page.check('#imSkip');
  await page.click('#imGo');
  await expect(page.locator('#imConfirm li')).toHaveText([
    '1 product will be added, 1 with opening stock.',
    '3 rows with errors will be skipped.',
    'Items are never deleted, only made inactive. Check the rows before you import.',
  ]);
  await page.click('#imcGo');
  await expect(page.locator('#imDone > ul > li')).toHaveText(['1 product created, 1 with opening stock.', '3 rows skipped because of errors:']);
  await expect(page.locator('#imSkipped tbody tr')).toHaveText([
    '3Series / range name: Series needs a brand. Enter the brand name, or clear the series.',
    '4Product name: An item called “BAJAJ BAHAR HS 225M E/F” already exists.',
    '5Brand name: Enter the brand name.',
  ]);

  // nothing is shown for the brand: no chip on the list row or on the item, like an Add item Single without a brand
  await page.click('#imToItems');
  const row = page.locator('#itList .ptr', { hasText: 'PVC INSULATION TAPE 18MM' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.brc')).toHaveCount(0);
  await row.click();
  await expect(page.locator('#vItems .ptt h2')).toHaveText('PVC INSULATION TAPE 18MM');
  await expect(page.locator('#vItems .ptt .brc')).toHaveCount(0);
  const r = await request.post(APP + '/api/auth/login', { data: who });
  const headers = { Authorization: `Bearer ${(await r.json()).accessToken}` };
  const list = (await (await request.get(APP + '/api/items', { headers })).json()) as { name: string; brand: string; series: string; stock: string }[];
  expect(list.find((i) => i.name === 'PVC INSULATION TAPE 18MM')).toMatchObject({ brand: '', series: '', stock: '50.000' });
  // no brand was made from the blank cells
  const brands = (await (await request.get(APP + '/api/brands', { headers })).json()) as { name: string }[];
  expect(brands.map((b) => b.name).sort()).toEqual(['Anchor', 'Bajaj', 'Havells']);
});
