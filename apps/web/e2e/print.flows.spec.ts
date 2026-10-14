/**
 * Settings › Print & invoice drives every printed invoice (owner's bug, 14 Oct 2026:
 * the Sales preview kept the old layout). One renderer draws the Settings preview,
 * the preview windows, Print and "Save as PDF"; these tests keep it that way.
 */
import { expect, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, savePrint, signInAs } from './setup';

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

async function openPrintSettings(page: Page) {
  await page.goto(APP + '/settings');
  await page.click('#subnav button:has-text("Print & invoice")');
  await page.waitForSelector('#pv #pvPaper .ppage');
}
/** the invoice preview window, from the invoice's row menu (Preview) */
async function previewInvoice(page: Page, no: string) {
  await page.goto(APP + '/sales');
  const row = page.locator(`#slRows tr[data-sno="${no}"]`);
  await row.waitFor();
  const b = await row.boundingBox();
  await page.mouse.click(b!.x + 200, b!.y + 10, { button: 'right' });
  await page.click('#slCtx [data-sla="prev"]');
  await page.waitForSelector('#ipv:not([hidden]) #ipvSheet .ppage');
}
const saved = (page: Page) => page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH' && r.ok());

test('a change in Settings › Print shows in the Sales invoice preview', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await freshShop(request, 'sales-shop'));

  // default: the boxed layout from the owner's sample bill
  await previewInvoice(page, 'INV-0101');
  await expect(page.locator('#ipvSheet .ivx')).toBeVisible();
  await expect(page.locator('#ipvSheet')).toContainText('Tax Invoice');
  await expect(page.locator('#ipvSheet')).toContainText('Billed Qty');

  // rename the sale, change a column heading and add the Brand column
  await openPrintSettings(page);
  await page.click('#pNamesBtn');
  await page.fill('#tn_sale', 'Rough Invoice');
  let s = saved(page);
  await page.click('#tnmSave');
  await s;
  await page.click('#pColsBtn');
  await page.fill('#ictm input[aria-label="Heading for Billed Qty"]', 'Qty Billed');
  await page.check('#ictm input[aria-label="Print Brand"]');
  s = saved(page);
  await page.click('#ictmDone');
  await s;

  await previewInvoice(page, 'INV-0101');
  const sheet = page.locator('#ipvSheet');
  await expect(sheet).toContainText('Rough Invoice');
  await expect(sheet).toContainText('Qty Billed');
  await expect(sheet.locator('.ivxtab thead')).toContainText('Brand');
  await expect(sheet).not.toContainText('Tax Invoice');

  // switch to the Simple layout: the preview window follows
  await openPrintSettings(page);
  s = saved(page);
  await page.click('#cPrLayout button.po:has-text("Simple")');
  await s;
  await previewInvoice(page, 'INV-0101');
  await expect(page.locator('#ipvSheet .ivpg')).toBeVisible();
  await expect(page.locator('#ipvSheet .ivx')).toHaveCount(0);
  await expect(page.locator('#ipvSheet .ivt b')).toHaveText('ROUGH INVOICE');
});

test('Settings preview, Sales preview, print and PDF show the same invoice, and only the invoice', async ({ browser, request }) => {
  const who = await freshShop(request, 'sales-shop');
  await savePrint(request, who, { names: { sale: 'Rough Invoice' } });
  const page = await newPage(browser, 1366);
  await signInAs(page, who);

  // Settings preview with the shop's last invoice
  await openPrintSettings(page);
  await page.click('#pv [data-pvs="last"]');
  await expect(page.locator('#pvPaper .ivxmeta b').first()).not.toHaveText('SAMPLE-001');
  const no = (await page.locator('#pvPaper .ivxmeta b').first().innerText()).trim();
  const inSettings = norm(await page.locator('#pvPaper .ppage').innerText());

  // the Sales preview window shows the same paper
  await previewInvoice(page, no);
  const inDialog = norm(await page.locator('#ipvSheet .ppage').innerText());
  expect(inDialog).toBe(inSettings);
  expect(inDialog).toContain('Rough Invoice');

  // Print: the same paper is what prints, named for "Save as PDF"
  await page.evaluate(() => { window.print = () => undefined; });
  await page.click('#ipvPrint');
  await expect(page).toHaveTitle(`Rough Invoice ${no}`);
  const printed = page.locator('body > .prclone .ppage').first();
  expect(norm(await printed.innerText())).toBe(inDialog);

  // the PDF has the invoice and nothing of the page behind it
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  expect(text).toContain('Rough Invoice');
  expect(text).toContain(no);
  for (const behind of ['Sales invoices', 'Payment link', 'Share on WhatsApp', 'New invoice', 'Dashboard']) expect(text).not.toContain(behind);

  // a delivery challan prints only its own paper too
  await page.goto(APP + '/delivery-challans');
  await page.click('#dcRows [data-dcprint="DC-0001"]');
  await page.waitForSelector('#ipv:not([hidden]) #ipvSheet .ppage');
  await page.evaluate(() => { window.print = () => undefined; });
  await page.click('#ipvPrint');
  await expect(page.locator('body > .prclone .ppage').first()).toContainText('DC-0001');
  await expect(page).toHaveTitle('Delivery Challan DC-0001');
});
