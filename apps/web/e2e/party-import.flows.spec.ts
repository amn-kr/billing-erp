/**
 * Parties › ⋮ › Import Parties against the real API: the menu opens the choice page, each card opens
 * its screen and Back returns; the Excel import with the prepared file (good rows, a wrong GSTIN, a
 * "Both" type, 3 decimals, a party the shop has, a row twice) shows each row's status and saves only
 * the OK rows; Bulk entry takes typed cells (Tab / Enter) and a pasted block with a heading row, marks
 * the wrong cells red, and Save all keeps the problem rows; the new parties are in the Parties list
 * with the right balances and opening-balance entries. From the prototype's tests (reference/tests/
 * flows.js): a hostile party name is shown as text, and each party's statement matches its balance.
 */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { partyShop, pasted, SAVED, writePartyFile } from './party-import.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const listRow = (page: Page, name: string) => page.locator('#ptList .ptr').filter({ hasText: name });

async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test('Import Parties: ⋮ menu → choice page → each screen, and Back', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request));
  await page.goto(APP + '/parties');
  await page.click('#ptMoreBtn');
  await expect(page.locator('#ptImportMenu')).toHaveText('Import Parties');
  await page.click('#ptImportMenu');
  await expect(page).toHaveURL(APP + '/parties/import');
  await expect(page.locator('#piExcel b')).toHaveText('Import from Excel');
  await expect(page.locator('#piBulk b')).toHaveText('Bulk entry (type or paste)');

  await page.click('#piExcel button');
  await expect(page).toHaveURL(APP + '/parties/import/excel');
  await expect(page.locator('#pxStart')).toBeVisible();
  await page.click('#piBack');
  await expect(page).toHaveURL(APP + '/parties/import');

  await page.click('#piBulk button');
  await expect(page).toHaveURL(APP + '/parties/import/bulk');
  await expect(page.locator('#pbGrid tbody tr[data-row]')).toHaveCount(10);
  await page.click('#piBack');
  await expect(page).toHaveURL(APP + '/parties/import');
  await page.click('#piBack');
  await expect(page).toHaveURL(APP + '/parties');
});

test('Import from Excel: sample file, preview with statuses, only OK rows saved, then the Parties list', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const who = await freshShop(request);
  await partyShop(request, who);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/parties/import/excel');
  await page.waitForSelector('#pxStart');

  // the sample file: the headings, one example row (it reads back as one OK row)
  const sample = info.outputPath('Import parties sample.xlsx');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#pxSample')]);
  await d.saveAs(sample);
  await page.setInputFiles('#pxFile', sample);
  await page.waitForSelector('#pxGrid tr[data-row="2"]');
  await expect(page.locator('#pxGrid tbody tr[data-row]')).toHaveCount(1);
  await expect(page.locator('#pxGrid tr[data-row="2"] td[data-col="name"]')).toHaveText('Example Traders');
  await expect(page.locator('#pxGrid tr[data-row="2"]')).toHaveAttribute('data-st', 'ok');

  // a file without a Party name column is refused with a clear message
  const noName = info.outputPath('no name.csv');
  fs.writeFileSync(noName, 'Mobile,City\n9123456780,Pune\n');
  // leaving the checked rows asks first
  await page.click('#piBack');
  await expect(page.locator('#dcfT')).toHaveText('Discard this import?');
  await page.click('#dcfYes');
  await page.click('#piExcel button');
  await page.setInputFiles('#pxFile', noName);
  await expect(page.locator('#pxFileErr')).toContainText('The file needs a “Party name” column in row 1. Headings found: “Mobile”, “City”.');

  // the prepared file
  const file = info.outputPath('parties.xlsx');
  await writePartyFile(file);
  await page.setInputFiles('#pxFile', file);
  await page.waitForSelector('#pxGrid tr[data-row="9"]');
  const st = (line: number) => page.locator(`#pxGrid tr[data-row="${line}"]`);
  expect(await Promise.all([2, 3, 4, 5, 6, 7, 8, 9].map((l) => st(l).getAttribute('data-st')))).toEqual(['ok', 'ok', 'ok', 'rejected', 'rejected', 'rejected', 'duplicate', 'duplicate']);
  await expect(st(5).locator('td[data-col="reason"]')).toHaveText('GSTIN: This GSTIN is not valid: its last character does not match. Check it for a typing mistake.');
  await expect(st(5).locator('td[data-col="gstin"]')).toHaveClass(/neg/);
  await expect(st(6).locator('td[data-col="reason"]')).toContainText('no “Both” party type');
  await expect(st(7).locator('td[data-col="reason"]')).toHaveText('Opening balance: At most 2 decimals (paise).');
  await expect(st(8).locator('td[data-col="reason"]')).toHaveText('A party named “Mehta Electricals” already exists.');
  await expect(st(9).locator('td[data-col="reason"]')).toHaveText('Same party name as row 2.');
  await expect(page.locator('[data-pxf="ok"] span')).toHaveText('3');
  await expect(page.locator('[data-pxf="rejected"] span')).toHaveText('3');
  await expect(page.locator('[data-pxf="duplicate"] span')).toHaveText('2');
  await page.click('[data-pxf="rejected"]');
  await expect(page.locator('#pxGrid tbody tr[data-row]')).toHaveCount(3);
  await page.click('[data-pxf="all"]');

  // the rejected rows as an Excel file: they read back as the same 3 rows
  const rej = info.outputPath('rejected.xlsx');
  const [r] = await Promise.all([page.waitForEvent('download'), page.click('#pxRejDl')]);
  await r.saveAs(rej);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(rej);
  const ws = wb.getWorksheet('Parties')!;
  expect([2, 3, 4].map((n) => ws.getRow(n).getCell(1).text)).toEqual(['Bad GSTIN Stores', 'Both Ways Co', 'Decimal Mart']);
  expect(ws.getRow(1).getCell(12).text).toBe('Problem');

  await expect(page.locator('#pxGo')).toHaveText('Import 3 parties');
  await page.click('#pxGo');
  await page.waitForSelector('#piDone');
  await expect(page.locator('#piSaved')).toHaveText('3 parties saved.');
  await expect(page.locator('#piRejected')).toHaveText('3 rows rejected');
  await expect(page.locator('#piSkipped')).toHaveText('2 duplicates skipped');

  await page.click('#piToParties');
  await expect(page).toHaveURL(APP + '/parties');
  for (const [name, bal] of SAVED) await expect(listRow(page, name).locator('span').last()).toHaveText(bal);
  await expect(page.locator('#ptList .ptr')).toHaveCount(4);
  await expect(listRow(page, 'Bad GSTIN Stores')).toHaveCount(0);
  // the opening balance is the party's first transaction, as for a party made with Add party
  await listRow(page, 'Gupta Wires').click();
  await expect(page.locator('#ptTx tr').first()).toContainText('Opening balance');
  await expect(page.locator('#ptTx tr').first()).toContainText('8,000.00');
  await expect(page.locator('#ptHead .ptmeta')).toContainText('GSTIN 27ABCDE1234F1Z0');
});

test('Bulk entry: type with Tab / Enter, paste a block with a heading row, red cells, Save all keeps the problem rows', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const who = await freshShop(request);
  await partyShop(request, who);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/parties/import/bulk');
  await page.waitForSelector('#pbGrid tbody tr[data-row]');
  const rowN = (n: number) => page.locator('#pbGrid tbody tr[data-row]').nth(n - 1);
  const cell = (n: number, col: string) => rowN(n).locator(`td[data-col="${col}"]`);

  // typing: Tab goes right, Enter confirms and goes down
  await cell(1, 'name').locator('input').click();
  await page.keyboard.type('Typed Party');
  await page.keyboard.press('Tab');
  await expect(cell(1, 'type').locator('select')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type('12345');
  await page.keyboard.press('Enter');
  await expect(cell(2, 'phone').locator('input')).toBeFocused();
  // a wrong phone is red with the reason; the count shows one problem
  await expect(cell(1, 'phone')).toHaveClass(/bad/);
  await expect(cell(1, 'phone').locator('.egm')).toHaveText('Enter a 10-digit mobile number.');
  await expect(page.locator('#pbBad')).toHaveText('1');
  await cell(1, 'phone').locator('input').fill('9300000001');
  await expect(page.locator('#pbOk')).toHaveText('1');
  await expect(page.locator('#pbBad')).toHaveText('0');

  // paste the prepared rows with their heading row into row 2: 8 rows, so rows are added
  await cell(2, 'name').locator('input').click();
  await paste(page, pasted(true));
  await expect(page.locator('#pbGrid tbody tr[data-row]')).toHaveCount(10);
  await expect(cell(2, 'name').locator('input')).toHaveValue('Sharma Traders');
  // pasted text is matched to the drop-downs: blank type stays blank (Customer), "To collect" → To receive, Uttar Pradesh kept
  await expect(cell(4, 'balType').locator('select')).toHaveValue('To receive');
  await expect(cell(2, 'state').locator('select')).toHaveValue('Uttar Pradesh');
  await expect(cell(5, 'gstin')).toHaveClass(/bad/);
  await expect(cell(6, 'type')).toHaveClass(/bad/);
  await expect(cell(7, 'opening')).toHaveClass(/bad/);
  await expect(cell(8, 'name')).toHaveClass(/bad/);
  await expect(cell(8, 'name').locator('.egm')).toHaveText('A party named “Mehta Electricals” already exists.');
  await expect(rowN(9).locator('[data-st]')).toHaveAttribute('data-st', 'duplicate');
  await expect(cell(9, 'name').locator('.egm')).toHaveText('Same party name as row 2.');
  await expect(page.locator('#pbOk')).toHaveText('4');
  await expect(page.locator('#pbBad')).toHaveText('5');
  await expect(page.locator('#pbProblems li')).toHaveCount(5);
  await expect(page.locator('#pbProblems li[data-line="5"]')).toContainText('GSTIN: This GSTIN is not valid');

  // remove a row, add a row (the focus goes to its name), and type a hostile name (it must stay plain text)
  await page.locator('[data-remove="10"]').click();
  await expect(page.locator('#pbGrid tbody tr[data-row]')).toHaveCount(9);
  await page.click('#pbAdd');
  await expect(page.locator('#pbGrid tbody tr[data-row]')).toHaveCount(10);
  await expect(cell(10, 'name').locator('input')).toBeFocused();
  await page.keyboard.type('<img src=x onerror="window.__xss=1">');
  // pasting without a heading row fills from the cell to the right, adding a row
  await cell(10, 'city').locator('input').click();
  await paste(page, 'Agra\tuttar pradesh\nMathura\t09\n');
  await expect(page.locator('#pbGrid tbody tr[data-row]')).toHaveCount(11);
  await expect(cell(10, 'city').locator('input')).toHaveValue('Agra');
  await expect(cell(11, 'state').locator('select')).toHaveValue('Uttar Pradesh');
  await cell(11, 'name').locator('input').click();
  await page.keyboard.type('Mathura Electric');
  await page.keyboard.press('Enter');

  // Save all: the OK rows are saved and leave the table; the problem rows stay
  await page.addStyleTag({ content: '#toast{visibility:hidden!important}' });
  await expect(page.locator('#pbSave')).toHaveText('Save all (6 parties)');
  await page.click('#pbSave');
  await page.waitForSelector('#piDone');
  await expect(page.locator('#piSaved')).toHaveText('6 parties saved.');
  await expect(page.locator('#piRejected')).toHaveText('3 rows rejected');
  await expect(page.locator('#piSkipped')).toHaveText('2 duplicates skipped');
  await expect(page.locator('#pbOk')).toHaveText('0');
  await expect(page.locator('#pbBad')).toHaveText('5');
  await expect(cell(1, 'name').locator('input')).toHaveValue('Bad GSTIN Stores');
  // fix one: the right GSTIN check digit, then save again
  await cell(1, 'gstin').locator('input').fill('09AAJPM7745Q1ZP');
  await expect(page.locator('#pbOk')).toHaveText('1');
  await page.click('#pbSave');
  await expect(page.locator('#piSaved')).toHaveText('1 party saved.');
  await expect(page.locator('#pbBad')).toHaveText('4');

  // leaving with problem rows asks first
  await page.click('#piToParties');
  await expect(page.locator('#dcfT')).toHaveText('Discard this import?');
  await page.click('#dcfYes');
  await expect(page).toHaveURL(APP + '/parties');
  for (const [name, bal] of SAVED) await expect(listRow(page, name).locator('span').last()).toHaveText(bal);
  await expect(listRow(page, 'Typed Party')).toHaveCount(1);
  await expect(listRow(page, 'Mathura Electric')).toHaveCount(1);
  await expect(listRow(page, 'Bad GSTIN Stores')).toHaveCount(1);
  await expect(listRow(page, '<img src=x onerror="window.__xss=1">')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // each party's statement total matches its balance (prototype flows.js: "party statements = balances")
  const login = await request.post(APP + '/api/auth/login', { data: who });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const all = (await (await request.get(APP + '/api/parties', { headers })).json()) as { id: string; name: string; balance: string }[];
  for (const p of all) {
    const tx = (await (await request.get(APP + `/api/reports/party-tx/${p.id}`, { headers })).json()) as { type: string; total: string }[];
    const open = tx.filter((t) => t.type === 'Opening balance').reduce((a, t) => a + Math.round(Number(t.total) * 100), 0);
    expect(Math.abs(Math.round(Number(p.balance) * 100)), p.name).toBe(open);
  }
});
