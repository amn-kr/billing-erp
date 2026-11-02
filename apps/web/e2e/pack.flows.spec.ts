/**
 * Pack and loose (Features › mrp_pack, owner's request, 2 Nov 2026): setting an item up, buying and selling by the keyboard
 * in either unit, Choose batch in the loose unit, a return loose from a strip sale, printing, and nothing at all with the
 * feature off (the item is then sold loose at the loose price).
 */
import { expect, test, type Page } from '@playwright/test';
import { CUSTOMER, ITEM, SUPPLIER, packShop } from './batch.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const OPTION = (name: string) => `.cbl:not([hidden]) .cbo:not(.add):has-text("${name}")`;
const row = '#siRows tr[data-ln="0"]';
const newSale = async (page: Page) => {
  await page.goto(APP + '/sales/new');
  await page.waitForSelector('#qeItem');
  await page.fill('#siParty', CUSTOMER);
  await page.click(OPTION(CUSTOMER));
  await expect(page.locator('#qeItem')).toBeFocused();
};
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
const charges = async (page: Page) => { await page.click('#siChgBtn'); await page.click('#siChgDone'); };

test('rapid entry starts on the pack; the Unit list changes unit and price; batches, saving and printing use the right units', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '4');
  const unit = page.locator(`${row} [data-f="unit"]`);
  await expect(unit).toHaveValue('STRIP');
  await expect(page.locator(`${row} [data-f="price"]`)).toHaveValue('100');
  await expect(page.locator(`${row} [data-o="amt"]`)).toHaveText('400.00');
  await expect(page.locator(`${row} small[title="In stock"]`)).toHaveText('5 STRIP');
  // a strip spans two batches: 30 from A123, 10 from B456, in tablets
  await expect(page.locator('[data-bxl="0"]')).toContainText('A123 × 30 TAB, B456 × 10 TAB');
  await page.click('[data-bxl="0"]');
  await expect(page.locator('#bxPick p')).toContainText('4 STRIP = 40 TAB');
  await expect(page.locator('#bxPickRows tr[data-batch="A123"]')).toContainText('3 STRIP');
  await page.keyboard.press('Escape');

  await unit.selectOption('TAB');
  await expect(page.locator(`${row} [data-f="price"]`)).toHaveValue('10');
  await expect(page.locator(`${row} [data-o="amt"]`)).toHaveText('40.00');
  await expect(page.locator('[data-bxl="0"]')).toContainText('A123 × 4 TAB');
  await unit.selectOption('STRIP');
  await page.fill(`${row} [data-f="qty"]`, '2');
  await page.locator(`${row} [data-f="qty"]`).blur();
  await expect(page.locator(`${row} [data-o="amt"]`)).toHaveText('200.00');

  await charges(page);
  await page.click('#siSave');
  const printed = page.locator('#ipvSheet tr:has([data-pbatch])');
  await expect(printed).toContainText('Batch A123 × 20 TAB');
  await expect(printed).toContainText('STRIP');
  await page.click('#ipvClose');

  // the card: stock in both units, rates per strip, value exact
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itHead')).toContainText('1 STRIP = 10 TAB');
  await expect(page.locator('#itHead')).toContainText('3 STRIP');
  await expect(page.locator('#itRates')).toContainText('per STRIP');
  await expect(page.locator('#itBatchRows tr[data-batch="A123"]')).toContainText('1 STRIP');
  await expect(page.locator('#itBatchRows tr[data-batch="A123"]')).toContainText('60.00');
});

test('a saved bill reopens in its own unit', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner, { invoice: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '1');
  await page.locator(`${row} [data-f="unit"]`).selectOption('TAB');
  await expect(page.locator(`${row} [data-f="price"]`)).toHaveValue('10');
  await page.fill(`${row} [data-f="fr"]`, '10');
  await charges(page);
  await page.click('#siSave');
  await page.click('#ipvClose');
  // the saved bill: back in tablets, at the tablet's rate; the batches it used are back in stock while it is edited
  const tok = ((await (await request.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
  const list = (await (await request.get(APP + '/api/sales?kind=invoice', { headers: { Authorization: `Bearer ${tok}` } })).json()) as { id: string; qty: string }[];
  await page.goto(APP + `/sales/new?edit=${list.find((x) => x.qty === '1.000')!.id}`);
  await expect(page.locator(`${row} [data-f="unit"]`)).toHaveValue('TAB');
  await expect(page.locator(`${row} [data-f="price"]`)).toHaveValue('10');
  await expect(page.locator(`${row} [data-f="qty"]`)).toHaveValue('1');
  await expect(page.locator('[data-bxl="0"]')).toContainText('A123 × 1 TAB');
});

test('Purchase: a line starts on the pack with the rate per pack; the Unit list converts it; stock reads in both units', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(`${APP}/purchases/new?kind=bill`);
  await page.waitForSelector('#peRows');
  await page.fill('#peParty', SUPPLIER);
  await page.click(OPTION(SUPPLIER));
  await page.fill('#peRows .pe-item', ITEM);
  await page.click(OPTION(ITEM));
  const unit = page.locator('#peRows [data-pf="unit"]');
  await expect(unit).toHaveValue('STRIP');
  await expect(page.locator('#peRows [data-pf="rate"]').first()).toHaveValue('70');
  await expect(page.locator('[data-bxmsg]')).toContainText('per STRIP');
  await page.locator('#peRows [data-pf="qty"]').first().fill('2');
  await expect(page.locator('#peRows')).toContainText('Stock 5 STRIP → 7 STRIP');
  await unit.selectOption('TAB');
  await expect(page.locator('#peRows [data-pf="rate"]').first()).toHaveValue('7');
  await unit.selectOption('STRIP');
  await expect(page.locator('#peRows [data-pf="rate"]').first()).toHaveValue('70');
  await page.fill('[data-bf="batchNo"]', 'C789');
  await page.fill('[data-bf="expiry"]', '02/40');
  await page.click('#peSave');
  await page.waitForURL(/purchase-bills|purchases/);
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itHead')).toContainText('7 STRIP');
});

test('A credit note returns loose from a strip sale, within the limit in tablets', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner, { invoice: true });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/credit-notes');
  await page.click('#cnNew');
  const party = (await page.$$eval('#cnParty option', (o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent ?? '']))).find((x) => x[1]!.includes(CUSTOMER))!;
  await page.selectOption('#cnParty', party[0]!);
  await page.locator('#cnInvs input[type=checkbox]').first().click();
  const q = page.locator('[data-cnq]').first();
  await expect(q).toBeVisible();
  await expect(page.locator('#cnRowsI tr[data-cnk]').first()).toContainText('2 STRIP');
  await expect(page.locator('#cnRowsI tr[data-cnk]').first()).toContainText('= 20 TAB');
  await q.fill('25');
  await expect(q).toHaveValue('20');
  await q.fill('5');
  await expect(page.locator('[data-cnpack]')).toHaveText('TAB · = 0.5 STRIP');
  await expect(page.locator('#cnRowsI tr[data-cnk]').first()).toContainText('50.00');
  await page.click('#cnSave');
  await expect(page.locator('#cnm')).toBeHidden();
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itHead')).toContainText('3 STRIP 5 TAB');
});

test('Add item: the switch sets a pack up; an item with stock history is refused; with the feature off there is no switch', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.goto(APP + '/items');
  await page.click('button:has-text("Add item")');
  await page.fill('#aiName', 'Cough syrup strip');
  await page.click('#aiUnit');
  await page.check('#aiUPack');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnits [role=alert]')).toContainText('Choose the pack unit');
  await page.selectOption('#aiUPackU', { index: 1 });
  const pack = await page.inputValue('#aiUPackU');
  const loose = await page.inputValue('#aiUBase');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnits [role=alert]')).toContainText('more than 1');
  await page.fill('#aiUSize', '12');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnit')).toHaveText(`1 ${pack} = 12 ${loose}`);
  await page.fill('#aiSale', '60');
  await page.click('#aiSave');
  await expect(page.locator('#ai')).toBeHidden();
  await expect(page.locator('#itHead')).toContainText(`1 ${pack} = 12 ${loose}`);

  // an item with stock history: refused in the window, with the reason
  await page.click(`#itList button:has-text("${ITEM}")`);
  await page.click('#itEdit');
  await page.click('#aiUnit');
  await page.fill('#aiUSize', '15');
  await page.click('#aiUSave');
  await expect(page.locator('#aiUnits [role=alert]')).toContainText('already has stock history');
  await page.click('#aiUnits button[aria-label="Close"]');
  await page.click('#aiClose');
});

test('Feature off: the item is sold loose at the loose price, with no Unit list and no switch', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner, { features: ['batch_expiry'] });
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await newSale(page);
  await rapid(page, '2');
  await expect(page.locator(`${row} [data-f="unit"]`)).toHaveCount(0);
  await expect(page.locator(row)).toContainText('TAB');
  await expect(page.locator(`${row} [data-f="price"]`)).toHaveValue('10');
  await expect(page.locator(`${row} [data-o="amt"]`)).toHaveText('20.00');
  await expect(page.locator(`${row} small[title="In stock"]`)).toHaveText('50 TAB');
  await page.goto(APP + '/items');
  await page.click('button:has-text("Add item")');
  await page.click('#aiUnit');
  await expect(page.locator('#aiUPack')).toHaveCount(0);
});

test('Quick sale sells loose at the loose price; a quotation in strips imports in strips', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await freshShop(request);
  await packShop(owner);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);
  await page.keyboard.press('Alt+n');
  // the window puts the cursor here a moment after opening: typing elsewhere before that would close the item list
  await expect(page.locator('#qsParty')).toBeFocused();
  await page.fill('#qsParty', 'Sunil');
  await page.locator('#qsRows .qs-item').first().fill('Paracetamol');
  await page.click(OPTION(ITEM));
  await page.locator('#qsRows .qsq').first().fill('3');
  await expect(page.locator('#qsRows')).toContainText('@ 10.00');
  await expect(page.locator('#qsTotal')).toContainText('30');
  await page.click('#qsPay [data-qspay="Cash"]');
  await page.click('#qsSave');
  await expect(page.locator('#qsm')).toBeHidden();
  await page.goto(APP + '/items');
  await page.click(`#itList button:has-text("${ITEM}")`);
  await expect(page.locator('#itHead')).toContainText('4 STRIP 7 TAB');

  const tok = ((await (await request.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
  const headers = { Authorization: `Bearer ${tok}` };
  const parties = (await (await request.get(APP + '/api/parties', { headers })).json()) as { id: string; name: string }[];
  const items = (await (await request.get(APP + '/api/items', { headers })).json()) as { id: string; name: string }[];
  const q = await request.post(APP + '/api/sales', { headers, data: { kind: 'quotation', date: '2026-10-01', mode: 'credit', partyId: parties.find((p) => p.name === CUSTOMER)!.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', payments: [], extra: {}, lines: [{ itemId: items.find((i) => i.name === ITEM)!.id, name: ITEM, qty: '2', unit: 'STRIP', price: '100', discPct: '0', gstRate: '0' }] } });
  const number = ((await q.json()) as { number: string }).number;
  await newSale(page);
  await page.click('#siTitle');
  await page.click('#siImpQ');
  await page.click(`[data-iq="${number}"]`);
  await page.click('#iqGo');
  await expect(page.locator(`${row} [data-f="unit"]`)).toHaveValue('STRIP');
  await expect(page.locator(`${row} [data-f="qty"]`)).toHaveValue('2');
  await expect(page.locator(`${row} [data-o="amt"]`)).toHaveText('200.00');
});
