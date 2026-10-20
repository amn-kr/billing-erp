/**
 * Items › ⋮ › Bulk update items against the real API: the table works like a spreadsheet (arrow keys
 * in four directions, a value selected on arrival so typing replaces it, F2 / Enter / Tab / Esc, list
 * cells with the keyboard, Space on tick boxes), a wrong value stays as typed and blocks Update, the
 * chip counts only valid changes, heading filters, the tax slab for ticked items, the passcode, and
 * the new values on the Items page; a long list (2,000 items) stays quick to move through. Made-up
 * passcodes only; values are checked field by field.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bulkShop, signedApi } from './bulk.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const row = (page: Page, name: string) => page.locator('#buGrid tbody tr[data-row]').filter({ has: page.locator('td.eglead', { hasText: exact(name) }) });
const td = (page: Page, name: string, col: string) => row(page, name).locator(`td[data-col="${col}"]`);
const cell = (page: Page, name: string, col: string) => td(page, name, col).locator('input, select');
/** the item name of the row the focus is in, and the column */
const at = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return { name: a?.closest('tr')?.querySelector('td.eglead')?.textContent ?? '', col: a?.closest('td')?.getAttribute('data-col') ?? '' };
});
const selected = (l: Locator) => l.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd, e.value.length]);

async function open(page: Page) {
  await page.goto(APP + '/items');
  await page.click('#itMoreBtn');
  await page.click('#itBulkMenu');
  await expect(page).toHaveURL(APP + '/items/bulk-update');
  await page.waitForSelector('#buGrid tbody tr[data-row]');
}

test('Bulk update items: the table works like a spreadsheet', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1366);
  await signInAs(page, await bulkShop(request));
  await open(page);

  // the list is newest first: … Switch 6A, Wire 2.5 sq mm, Wire 1.5 sq mm, LED batten 20W …
  await cell(page, 'Wire 2.5 sq mm', 'code').click();
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'code' });
  await expect(td(page, 'Wire 2.5 sq mm', 'code')).toHaveClass(/egact/);
  // clicked: the whole value is selected
  expect(await selected(cell(page, 'Wire 2.5 sq mm', 'code'))).toEqual([0, 4, 4]);

  // arrows in four directions, across the tick box and the item name too
  await page.keyboard.press('ArrowRight');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'description' });
  await page.keyboard.press('ArrowRight');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'gstRate' });
  await page.keyboard.press('ArrowDown');
  expect(await at(page)).toEqual({ name: 'Wire 1.5 sq mm', col: 'gstRate' });
  for (const col of ['description', 'code', 'category', '_name', '_sel']) {
    await page.keyboard.press('ArrowLeft');
    expect(await at(page)).toEqual({ name: 'Wire 1.5 sq mm', col });
  }
  await page.keyboard.press('ArrowUp');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: '_sel' });
  await page.keyboard.press('ArrowUp');
  expect(await at(page)).toEqual({ name: 'Switch 6A', col: '_sel' });

  // Space ticks the tick box; Shift+Space ticks the row from another cell
  await page.keyboard.press('Space');
  await expect(cell(page, 'Switch 6A', '_sel')).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await at(page)).toEqual({ name: 'Switch 6A', col: 'code' });
  await page.keyboard.press('Shift+Space');
  await expect(cell(page, 'Switch 6A', '_sel')).not.toBeChecked();
  await expect(cell(page, 'Switch 6A', 'code')).toHaveValue('SW6');

  // arriving by arrow selects the value: typing replaces it; Enter confirms and goes down
  await page.keyboard.type('SW-6A');
  await expect(cell(page, 'Switch 6A', 'code')).toHaveValue('SW-6A');
  await page.keyboard.press('Enter');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'code' });
  expect(await selected(cell(page, 'Wire 2.5 sq mm', 'code'))).toEqual([0, 4, 4]);

  // F2 edits with the caret at the end; Left / Right move the caret; Esc puts the old value back
  await page.keyboard.press('F2');
  expect(await selected(cell(page, 'Wire 2.5 sq mm', 'code'))).toEqual([4, 4, 4]);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('-');
  await expect(cell(page, 'Wire 2.5 sq mm', 'code')).toHaveValue('WR2-5');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'code' });
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Wire 2.5 sq mm', 'code')).toHaveValue('WR25');
  // Tab confirms and goes right, Shift+Tab left
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  await page.keyboard.press('Tab');
  await expect(cell(page, 'Wire 2.5 sq mm', 'code')).toHaveValue('WR25X');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'description' });
  await page.keyboard.press('Shift+Tab');
  expect(await at(page)).toEqual({ name: 'Wire 2.5 sq mm', col: 'code' });
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Wire 2.5 sq mm', 'code')).toHaveValue('WR25X');
  // a double-click edits with the caret at the end too
  await cell(page, 'Wire 1.5 sq mm', 'code').dblclick();
  expect(await selected(cell(page, 'Wire 1.5 sq mm', 'code'))).toEqual([4, 4, 4]);
  await page.keyboard.press('Escape');

  // list cells: arrows pass by while closed; Enter / Space / Alt+Down open; Up / Down choose; Enter confirms; Esc closes
  await page.keyboard.press('ArrowLeft');
  expect(await at(page)).toEqual({ name: 'Wire 1.5 sq mm', col: 'category' });
  await expect(cell(page, 'Wire 1.5 sq mm', 'category')).toHaveValue('Wires');
  await page.keyboard.press('Enter');
  const list = page.locator('#buGrid-list');
  await expect(list).toBeVisible();
  await expect(list.locator('button.on')).toHaveText('Wires');
  await page.keyboard.press('ArrowUp');
  await expect(list.locator('button.on')).not.toHaveText('Wires');
  const picked = await list.locator('button.on').textContent();
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(cell(page, 'Wire 1.5 sq mm', 'category')).toHaveValue(picked!);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(cell(page, 'Wire 1.5 sq mm', 'category')).toHaveValue(picked!);
  // a letter jumps to the next choice starting with it
  await page.keyboard.press('s');
  await expect(cell(page, 'Wire 1.5 sq mm', 'category')).toHaveValue(/^S/);
  await page.keyboard.press('Space');
  await expect(list).toBeVisible();
  // two categories start with W (a new shop has "Wires & cables"): a second W goes on to the next
  await page.keyboard.press('w');
  await expect(list.locator('button.on')).toHaveText('Wires & cables');
  await page.keyboard.press('w');
  await expect(list.locator('button.on')).toHaveText('Wires');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Wire 1.5 sq mm', 'category')).toHaveValue('Wires');
  // the tax slab list too
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await at(page)).toEqual({ name: 'Wire 1.5 sq mm', col: 'gstRate' });
  await page.keyboard.press('Enter');
  await expect(list.locator('button.on')).toHaveText('GST 0%');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Wire 1.5 sq mm', 'gstRate')).not.toHaveValue('0');
  await expect(td(page, 'Wire 1.5 sq mm', 'gstRate').locator('.egm.info')).toHaveText('was GST 0%');

  // the focus stays in the active cell while the table is drawn again
  await cell(page, 'Door bell', 'description').click();
  for (const ch of 'Two-tone chime') await page.keyboard.type(ch);
  await expect(cell(page, 'Door bell', 'description')).toBeFocused();
  await expect(cell(page, 'Door bell', 'description')).toHaveValue('Two-tone chime');
});

test('Bulk update items: wrong values stay as typed, block Update and the chip counts only valid changes', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1366);
  const who = await bulkShop(request);
  const api = await signedApi(request, who);
  await signInAs(page, who);
  await open(page);
  await expect(page.locator('#buBack')).toHaveText('← Items');
  await expect(page.locator('#vBulk h1')).toHaveText('Bulk Update Items');
  await expect(page.locator('#buGrid thead th')).toHaveText(['', '#', 'Item name', 'Category', 'Item code', 'Description', 'Tax slab']);
  await expect(page.locator('#buChip')).toHaveText('Item Information - 0 Updates');

  // a valid change and a code another item has (typed with spaces): kept exactly as typed
  const h = await row(page, 'Socket 16A').evaluate((e) => e.getBoundingClientRect().height);
  await cell(page, 'Door bell', 'description').click();
  await page.keyboard.type('Two-tone chime');
  await cell(page, 'Socket 16A', 'code').click();
  await page.keyboard.type(' lb9 ');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Socket 16A', 'code')).toHaveValue(' lb9 ');
  await expect(td(page, 'Socket 16A', 'code')).toHaveClass(/bad/);
  await expect(td(page, 'Socket 16A', 'code').locator('.egm.bad')).toHaveText('Used by another item.');
  // the problem is a line inside the cell: the row keeps its height
  expect(await row(page, 'Socket 16A').evaluate((e) => e.getBoundingClientRect().height)).toBe(h);
  await expect(page.locator('#buChip')).toHaveText('Item Information - 1 Update');
  await expect(page.locator('#buErrCount')).toHaveText('1 error');

  // Update does nothing but go to the first red cell (also when a filter hides it)
  await page.fill('#buQ', 'door');
  let sent = 0;
  page.on('request', (r) => { if (r.url().includes('/api/items/bulk-update')) sent++; });
  await page.click('#buGo');
  await expect(page.locator('#buErr')).toHaveText('1 cell needs fixing before Update: Socket 16A. It is marked in red.');
  await expect(cell(page, 'Socket 16A', 'code')).toBeFocused();
  await expect(cell(page, 'Socket 16A', 'code')).toHaveValue(' lb9 ');
  await expect(page.locator('#buConfirm')).toHaveCount(0);
  expect(sent).toBe(0);

  // fixed: two updates, no errors
  await page.keyboard.type('SK-16A');
  await expect(page.locator('#buErrCount')).toHaveCount(0);
  await expect(page.locator('#buChip')).toHaveText('Item Information - 2 Updates');

  // heading filters: the icon looks on only while a filter is on, with "Filter on" and Clear
  const catF = page.locator('[data-thf="bu-category"]');
  await expect(catF).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#buFilterOn')).toHaveCount(0);
  await catF.click();
  await page.locator('#thfPop button', { hasText: exact('Wires') }).click();
  await expect(catF).toHaveClass(/\bon\b/);
  await expect(page.locator('#buFilterOn')).toHaveText('Filter on');
  await expect(page.locator('#buFilterWhat')).toHaveText('Category: Wires');
  expect((await page.locator('#buGrid tbody td.eglead').allTextContents()).sort()).toEqual(['Wire 1.5 sq mm', 'Wire 2.5 sq mm']);
  // the tax slab for the ticked items
  await page.check('#buGrid thead input[type=checkbox]');
  await expect(page.locator('#buSel')).toContainText('2 items selected');
  await page.selectOption('#buTax', '5');
  await expect(cell(page, 'Wire 1.5 sq mm', 'gstRate')).toHaveValue('5');
  await expect(cell(page, 'Wire 2.5 sq mm', 'gstRate')).toHaveValue('5');
  await page.click('#buFilterClr');
  await expect(catF).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#buFilterOn')).toHaveCount(0);
  await expect(page.locator('#buGrid tbody tr[data-row]')).toHaveCount(12);
  await expect(page.locator('#buChip')).toHaveText('Item Information - 4 Updates');

  // the question, then the passcode (on for this shop): a wrong one is refused
  await api.post('/settings/passcode/on', { passcode: PASS });
  await page.click('#buGo');
  await expect(page.locator('#bucT')).toHaveText('Update 4 items?');
  await expect(page.locator('#bucD')).toHaveText('The item information of 4 items will change.');
  await page.click('#bucGo');
  await page.waitForSelector('#pcm .mdl');
  await page.fill('#pcPin', '0000');
  await page.click('#pcGo');
  await expect(page.locator('#pcErr')).toHaveText('Wrong passcode. 4 tries left.');
  await page.fill('#pcPin', PASS);
  await page.click('#pcGo');
  await expect(page.locator('#toast')).toHaveText('4 items updated');
  await expect(page.locator('#buChip')).toHaveText('Item Information - 0 Updates');
  await expect(td(page, 'Socket 16A', 'code').locator('.egm')).toHaveCount(0);

  // saved: checked field by field, and on the Items page
  const items = await api.get<{ name: string; code: string; description: string; gstRate: string; sale: string }[]>('/items');
  const by = (n: string) => items.find((i) => i.name === n)!;
  expect([by('Door bell').description, by('Socket 16A').code, by('Wire 1.5 sq mm').gstRate, by('Wire 2.5 sq mm').gstRate, by('LED bulb 9W').sale]).toEqual(['Two-tone chime', 'SK-16A', '5.00', '5.00', '95.00']);
  await page.click('#buBack');
  await expect(page).toHaveURL(APP + '/items');
  await page.locator('#itList [data-iid]', { hasText: 'Socket 16A' }).click();
  await expect(page.locator('#itHead .ptmeta .mono')).toHaveText('SK-16A');
  await page.locator('#itList [data-iid]', { hasText: 'Wire 1.5 sq mm' }).click();
  await expect(page.locator('#itHead .ptmeta')).toContainText('GST 5%');
});

test('Bulk update items: leaving with changes asks first', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  await signInAs(page, await bulkShop(request));
  await open(page);
  await cell(page, 'Door bell', 'code').click();
  await page.keyboard.type('DB-2');
  await page.click('#buBack');
  await expect(page.locator('#dcfT')).toHaveText('Discard this bulk update?');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(APP + '/items/bulk-update');
  await expect(cell(page, 'Door bell', 'code')).toHaveValue('DB-2');
});

test('Bulk update items: 2,000 items, the keyboard reaches the last row', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const who = await freshShop(request);
  const api = await signedApi(request, who);
  const blank = { qty: '', rate: '', date: '', unit: '', sale: '', min: '', godown: '', category: '', gst: '', hsn: '', series: '' };
  const rows = Array.from({ length: 2000 }, (_, i) => ({ line: i + 2, ...blank, type: 'Single Range', name: `Bulk item ${String(i + 1).padStart(4, '0')}`, brand: 'Havells', code: `BK${i + 1}` }));
  const r = await api.post<{ done: boolean }>('/items/import', { rows, skipErrors: false });
  expect(r.done).toBe(true);
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/items/bulk-update');
  await page.waitForSelector('#buGrid tbody tr[data-row]');
  await expect(page.locator('#buTot')).toHaveText('2,000 items');
  // only the rows in view are drawn
  expect(await page.locator('#buGrid tbody tr[data-row]').count()).toBeLessThan(80);

  const first = await page.locator('#buGrid tbody td.eglead').first().textContent();
  await page.locator('#buGrid tbody tr[data-row]').first().locator('td[data-col="code"] input').click();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  const a30 = await at(page);
  expect(a30.col).toBe('code');
  expect(a30.name).not.toBe(first);
  // Ctrl+Down: the last row, scrolled into view and selected
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  const last = await page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex'));
  expect(last).toBe('2001');
  const box = await page.evaluate(() => {
    const a = document.activeElement!.getBoundingClientRect(), t = document.querySelector('#buGrid .tw')!.getBoundingClientRect();
    return a.top >= t.top && a.bottom <= t.bottom + 1;
  });
  expect(box).toBe(true);
  await page.keyboard.type('LAST-1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveValue('LAST-1');
  await expect(page.locator('#buChip')).toHaveText('Item Information - 1 Update');
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  expect(await page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex'))).toBe('2');
});
