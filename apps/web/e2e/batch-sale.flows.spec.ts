/**
 * Batch and expiry, part 1b (Features › batch_expiry, owner's request, 1 Nov 2026): rapid entry picks the batch by
 * itself, the Choose batch window changes it, expired stock asks first, the invoice prints it, a credit note puts it back.
 */
import { expect, test, type Page } from '@playwright/test';
import { CUSTOMER, ITEM, batchShop } from './batch.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;
const newSale = async (page: Page) => {
  await page.goto(APP + '/sales/new');
  await page.waitForSelector('#qeItem');
  await page.fill('#siParty', CUSTOMER);
  await page.click(OPTION(CUSTOMER));
  await expect(page.locator('#qeItem')).toBeFocused();
};
/** rapid entry, keys only: item, quantity, Ctrl+Enter */
const rapid = async (page: Page, qty: string) => {
  await page.locator('#qeItem').pressSequentially('Paracetamol');
  await page.waitForSelector(OPTION(ITEM));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#qeQty')).toBeFocused();
  await page.fill('#qeQty', qty);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#qeItem')).toBeFocused();
  await page.mouse.click(5, 700);
};
const checkCharges = async (page: Page) => { await page.click('#siChgBtn'); await page.click('#siChgDone'); };
const stock = async (page: Page) => {
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await page.waitForSelector('#itBatchRows');
  return page.locator('#itBatchRows tr').evaluateAll((r) => r.map((x) => [(x as HTMLElement).dataset.batch, (x as HTMLTableRowElement).cells[4]!.textContent]));
};

test('rapid entry picks earliest expiry by itself; the bill’s money doesn’t change; the invoice prints the batches', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '5');
  await expect(page.locator('[data-bxl="0"]')).toHaveText('No batch × 1, A123 × 3, B456 × 1 ▾');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-o="amt"]')).toHaveText('0.00');
  // the quantity changing picks again
  await page.fill('#siRows tr[data-ln="0"] [data-f="qty"]', '2');
  await expect(page.locator('[data-bxl="0"]')).toHaveText('No batch × 1, A123 × 1 ▾');
  await page.fill('#siRows tr[data-ln="0"] [data-f="qty"]', '5');
  await page.fill('#siRows tr[data-ln="0"] [data-f="fr"]', '20');
  await expect(page.locator('[data-bxl="0"]')).toHaveText('No batch × 1, A123 × 3, B456 × 1 ▾');
  await checkCharges(page);
  await page.click('#siSave');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
  await expect(page.locator('#ipvSheet [data-pbatch]')).toHaveText('Batch A123 × 3 (Exp 03/2040), B456 × 1 (Exp 08/2041), No batch × 1');
  await page.click('#ipvClose');
  expect(await stock(page)).toEqual([['X100', '1'], ['B456', '3']]);
});

test('Choose batch changes it by hand; expired stock asks first and can go back', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '2');

  await page.click('[data-bxl="0"]');
  await expect(page.locator('#bxPickRows tr[data-batch="A123"] input')).toHaveValue('1');
  // amounts that don't add up are explained
  await page.fill('#bxPickRows tr[data-batch="B456"] input', '4');
  await page.click('#bxDone');
  await expect(page.locator('#bxPickErr')).toContainText('Pick 2 PCS in all. You have picked 6');
  // Earliest expiry first puts it back; Escape leaves it as it was
  await page.click('#bxAuto');
  await expect(page.locator('#bxPickRows tr[data-batch="B456"] input')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#bxPick')).toBeHidden();

  await page.click('[data-bxl="0"]');
  await page.fill('#bxPickRows tr[data-batch="No batch"] input', '');
  await page.fill('#bxPickRows tr[data-batch="A123"] input', '');
  await page.fill('#bxPickRows tr[data-batch="B456"] input', '2');
  await page.click('#bxDone');
  await expect(page.locator('[data-bxl="0"]')).toHaveText('B456 × 2 ▾');

  // the expired batch: a note in the window, the question on saving
  await page.click('[data-bxl="0"]');
  await page.fill('#bxPickRows tr[data-batch="B456"] input', '1');
  await page.fill('#bxPickRows tr[data-batch="X100"] input', '1');
  await expect(page.locator('#bxSum')).toContainText('X100 expired on 31 Jan 2020');
  await page.click('#bxDone');
  await checkCharges(page);
  await page.click('#siSave');
  await expect(page.locator('#bxExpired')).toBeVisible();
  await expect(page.locator('#bxExpired p')).toContainText('1 of batch X100 expired on 31 Jan 2020');
  await page.click('#bxExpNo');
  await expect(page.locator('#bxExpired')).toBeHidden();
  await expect(page.locator('#siSave')).toBeVisible();
  await page.click('#siSave');
  await page.click('#bxExpYes');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
  await page.click('#ipvClose');
  expect(await stock(page)).toEqual([['No batch', '1'], ['A123', '3'], ['B456', '3']]);
});

test('editing a saved bill keeps its batches; a copy picks afresh; a credit note puts goods back', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, invoice: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  expect(await stock(page)).toEqual([['X100', '1'], ['A123', '1'], ['B456', '4']]);

  await page.goto(APP + '/sales');
  await page.click('tr:has-text("Raju Stores")');
  await page.waitForSelector('#ipv:not([hidden]) [data-pbatch]');
  await expect(page.locator('#ipvSheet [data-pbatch]')).toHaveText('Batch A123 × 2 (Exp 03/2040), No batch × 1');
  await page.click('#ipvClose');

  const id = await page.evaluate(async () => {
    const tok = (await (await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })).json()).accessToken as string;
    return ((await (await fetch('/api/sales?kind=invoice', { headers: { Authorization: `Bearer ${tok}` } })).json()) as { id: string }[])[0]!.id;
  });
  await page.goto(`${APP}/sales/new?edit=${id}`);
  await expect(page.locator('[data-bxl="0"]')).toHaveText('No batch × 1, A123 × 2 ▾');
  await page.goto(`${APP}/sales/new?copy=${id}`);
  await expect(page.locator('[data-bxl="0"]')).toHaveText('A123 × 1, B456 × 2 ▾');

  await page.goto(APP + '/credit-notes');
  await page.click('button:has-text("New credit note")');
  await page.waitForSelector('#cnm:not([hidden])');
  await page.locator('#cnParty').selectOption({ label: CUSTOMER });
  await page.click('#cnInvs input');
  await page.waitForSelector('[data-cnbatch]');
  await expect(page.locator('[data-cnbatch] option').first()).toHaveText('Back to the batches sold');
  await page.locator('[data-cnk="0"] input').first().fill('1');
  await page.click('#cnm button:has-text("Save credit note")');
  await expect(page.locator('#cnm')).toBeHidden();
  // the newest piece of the invoice comes back first
  expect(await stock(page)).toEqual([['X100', '1'], ['A123', '2'], ['B456', '4']]);
});

test('with the feature off the sale screen and the invoice show no batches', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await batchShop(owner, { bills: true, invoice: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/settings');
  await page.click('#subnav [data-settab="features"]');
  await page.click('#f_batch_expiry');
  await page.click('#cfmYes');
  await expect(page.locator('#f_batch_expiry')).not.toBeChecked();

  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/batches')) asked.push(r.url()); });
  await newSale(page);
  await rapid(page, '2');
  await expect(page.locator('#siRows tr[data-ln="0"] [data-f="qty"]')).toHaveValue('2');
  await expect(page.locator('[data-bxl]')).toHaveCount(0);
  expect(asked).toEqual([]);

  await page.goto(APP + '/sales');
  await page.click('tr:has-text("Raju Stores")');
  await page.waitForSelector('#ipv:not([hidden])');
  await expect(page.locator('#ipv [data-pbatch]')).toHaveCount(0);
});
