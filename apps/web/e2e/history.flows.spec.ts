/**
 * "View history" against the real API: the row actions menu (right-click and ⋮) opens the small
 * window with one box per edit, newest first; a long box shows 2 lines and "Show More"; a document
 * never edited says "No edits yet". It needs no passcode, even with the passcode on. On the item
 * page an edited sale shows one line, never a "Sale cancelled" line. A new shop has the currency
 * symbol switched off (the prototype's default), so amounts show without "₹" here, as everywhere.
 * Made-up passcodes only.
 */
import { expect, test, type Page } from '@playwright/test';
import { books } from './history.data';
import { APP, freshShop, newPage, signInAs } from './setup';

/** Picks "View history" in a row's menu, opened by right-click or by its ⋮ button. */
async function viewHistory(page: Page, rows: string, menu: string, no: string, how: 'right' | 'dots') {
  const row = page.locator(rows).filter({ has: page.locator(`[data-slm="${no}"]`) });
  if (how === 'dots') await row.locator('[data-slm]').click();
  else { const b = (await row.locator('td').first().boundingBox())!; await page.mouse.click(b.x + 10, b.y + 10, { button: 'right' }); }
  await expect(page.locator(menu)).toBeVisible();
  await expect(page.locator(`${menu} [data-sla="hist"]`)).toHaveText('View history');
  await expect(page.locator(`${menu} [data-sla="hist"]`)).toBeEnabled();
  await page.click(`${menu} [data-sla="hist"]`);
  await expect(page.locator('#slm')).toBeVisible();
}
const close = async (page: Page) => { await page.click('#slmCancel'); await expect(page.locator('#slm')).toBeHidden(); };

test('Sales invoices: View history by right-click and by ⋮; newest first, Show More, No edits yet; no passcode asked', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/sales');

  await viewHistory(page, '#slRows tr', '#slCtx', b.inv.number, 'right');
  await expect(page.locator('#slmT')).toHaveText(`Edit History for Invoice #${b.inv.number}`);
  await expect(page.locator('#pcm')).toBeHidden();
  const boxes = page.locator('#ehList .dgterms');
  await expect(boxes).toHaveCount(2);
  // newest first: the second edit has 4 changes, so its box shows 2 and "Show More"
  await expect(boxes.nth(0).locator('li')).toHaveText(['Total changed from 15,120.00 to 16,550.00', 'Notes was added (value: Deliver on Monday)']);
  await boxes.nth(0).getByRole('button', { name: 'Show More' }).click();
  await expect(boxes.nth(0).locator('li')).toHaveText([
    'Total changed from 15,120.00 to 16,550.00', 'Notes was added (value: Deliver on Monday)',
    'Item Ceiling fan 1200mm (history): rate changed from 1,890.00 to 1,950.00', 'Item LED bulb 9W (history) was added (value: quantity 10, rate 95.00, GST 18%)',
  ]);
  await expect(boxes.nth(0).getByRole('button', { name: 'Show More' })).toHaveCount(0);
  await expect(boxes.nth(1).locator('li')).toHaveText(['Total changed from 11,340.00 to 15,120.00', 'Item Ceiling fan 1200mm (history): quantity changed from 6 to 8']);
  for (const k of [0, 1]) {
    await expect(boxes.nth(k).locator('b')).toHaveText(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} [ap]m$/);
    await expect(boxes.nth(k).locator('small')).toHaveText('Pooja Verma');
  }
  await close(page);

  await viewHistory(page, '#slRows tr', '#slCtx', b.inv.number, 'dots');
  await expect(page.locator('#ehList .dgterms')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#slm')).toBeHidden();

  await viewHistory(page, '#slRows tr', '#slCtx', b.plain.number, 'dots');
  await expect(page.locator('#slmT')).toHaveText(`Edit History for Invoice #${b.plain.number}`);
  await expect(page.locator('#ehList')).toHaveText('No edits yet');
  await close(page);

  // an edit is not a status: the edited invoice shows the same status as the one never edited (same dates, unpaid)
  const stt = (no: string) => page.locator(`#slRows tr[data-sno="${no}"] .stt`);
  await expect(stt(b.inv.number)).toHaveText((await stt(b.plain.number).textContent())!);
  await expect(stt(b.inv.number)).not.toHaveText(/edit/i);
});

test('a purchase bill and an expense: View history from their own lists', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/purchase-bills');
  await viewHistory(page, '#puRows tr', '#puCtx', b.bill.number, 'right');
  await expect(page.locator('#slmT')).toHaveText(`Edit History for Purchase bill #${b.bill.number}`);
  await expect(page.locator('#ehList .dgterms li')).toHaveText(['Total changed from 732.00 to 878.00', 'Item LED bulb 9W (history): quantity changed from 10 to 12']);
  await close(page);

  await page.goto(APP + '/expenses');
  await viewHistory(page, '#exRows tr', '#exCtx', `EX:${b.ex.number}`, 'dots');
  await expect(page.locator('#slmT')).toHaveText(`Edit History for Expense #${b.ex.number}`);
  await expect(page.locator('#ehList .dgterms li')).toHaveText(['Line AC servicing: rate changed from 1,200.00 to 1,500.00', 'Line AC servicing: amount changed from 1,200.00 to 1,500.00', 'Total changed from 1,200.00 to 1,500.00']);
  await close(page);
});

test('item page: the edited sale shows one line with its current quantity, never "Sale cancelled"', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/items');
  await page.click(`#itList [data-iid="${b.fan.id}"]`);
  const rows = page.locator('#itTx tr', { hasText: b.inv.number });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Sale');
  await expect(rows.first()).toContainText('8');
  await expect(page.locator('#itTx')).not.toContainText('Sale cancelled');
});
