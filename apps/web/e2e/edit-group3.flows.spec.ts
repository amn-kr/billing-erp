/**
 * Edit for saved records, group 3, against the real API: expenses, cash / bank entries, stock
 * adjustments and stock transfers. The row actions menu opens from the ⋮ button and by right-click
 * on every list; Edit opens the window the record was made in, filled in; saving asks for the
 * passcode when it is on (a wrong one is refused). The cash / bank balance and the stock follow the
 * edit. Records that can't be changed say why. Made-up passcodes only; fixed dates.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const PASS = '4826';
const D = '2026-10-01';
type Who = { email: string; password: string };

async function api(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const send = async <T>(method: 'post' | 'put', path: string, data: object) => {
    const r = await request[method](APP + '/api' + path, { headers, data });
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  };
  return {
    get: async <T>(path: string) => (await (await request.get(APP + '/api' + path, { headers })).json()) as T,
    post: <T>(path: string, data: object) => send<T>('post', path, data),
    put: <T>(path: string, data: object) => send<T>('put', path, data),
  };
}

interface Acc { id: string; kind: string; name: string; balance: string }
interface BookRow { key: string; doc: string; src: string; sourceId: string }

/** Cash and a bank with money, a fan in stock, a second godown, an expense, an entry, an adjustment and a transfer. */
async function books(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const cash = (await a.get<Acc[]>('/banking/accounts')).find((x) => x.kind === 'cash')!;
  await a.put(`/banking/accounts/${cash.id}`, { openingBalance: '20000', openingDate: D });
  const bank = await a.post<{ id: string }>('/banking/accounts', { name: 'HDFC Bank (edit)', openingBalance: '50000', openingDate: D });
  const fan = await a.post<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm (edit 3)', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingDate: D });
  const main = (await a.get<{ id: string; isDefault: boolean }[]>('/godowns')).find((g) => g.isDefault)!;
  const store = await a.post<{ id: string }>('/godowns', { name: 'Aminabad godown (edit)' });
  const cats = await a.get<{ id: string; name: string }[]>('/expense-categories');
  const rent = cats.find((c) => c.name === 'Rent')!;
  const xp = await a.post<{ id: string; number: string }>('/expenses', { date: D, categoryId: rent.id, mode: 'Cash', payee: 'Mr Khanna (landlord)', lines: [{ name: 'Shop rent', qty: '1', rate: '1200', gst: '0', amt: '1200' }] });
  const be = await a.post<{ id: string; number: string }>('/banking/entries', { kind: 'deposit', date: D, amount: '3000', fromId: cash.id, toId: bank.id, reference: '', note: '' });
  const adj = await a.post<{ id: string; number: string }>('/stock-adjustments', { itemId: fan.id, mode: 'add', qty: 10, rate: '1500', date: D, reason: 'Physical count correction' });
  const trf = await a.post<{ id: string; number: string }>('/stock-transfers', { itemId: fan.id, fromGodownId: main.id, toGodownId: store.id, qty: 6, date: D });
  const look = async () => {
    const accs = await a.get<Acc[]>('/banking/accounts');
    const item = await a.get<{ stock: string; godowns: { id: string; stock: string }[] }>(`/items/${fan.id}`);
    return { cash: accs.find((x) => x.id === cash.id)!.balance, bank: accs.find((x) => x.id === bank.id)!.balance, fan: item.stock, store: item.godowns.find((g) => g.id === store.id)!.stock };
  };
  const line = async (accountId: string, doc: string) => (await a.get<{ entries: BookRow[] }>(`/banking/accounts/${accountId}/book`)).entries.find((e) => e.doc === doc)!;
  return { a, cash, bank, fan, rent, xp, be, adj, trf, look, line };
}

/** Opens a row's menu with its ⋮ button, closes it with Esc, then opens it again by right-click on the row. */
async function bothWays(page: Page, row: ReturnType<Page['locator']>, menu: string, head: string, table = true) {
  await row.locator('[data-slm]').click();
  await expect(page.locator(menu)).toBeVisible();
  await expect(page.locator(`${menu} .cmh b`)).toHaveText(head);
  await expect(page.locator(`${menu} [data-sla]`).first()).toHaveText('Edit');
  await expect(page.locator(`${menu} button`).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  const b = (await row.locator(table ? 'td' : 'span').first().boundingBox())!;
  await page.mouse.click(b.x + 5, b.y + 5, { button: 'right' });
  await expect(page.locator(menu)).toBeVisible();
  if (table) await expect(row).toHaveClass(/ctxon/);
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
}

async function passcode(page: Page, code: string) {
  await page.locator('#pcm input').first().fill(code);
  await page.keyboard.press('Enter');
}

test('expenses, both books, stock adjustments and transfers open the same actions menu from ⋮ and by right-click', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/expenses');
  await bothWays(page, page.locator(`#exRows tr[data-exk="EX:${b.xp.number}"]`), '#exCtx', b.xp.number);
  await page.goto(APP + '/cash-in-hand');
  await bothWays(page, page.locator(`#caRows tr[data-bke="${(await b.line(b.cash.id, b.be.number)).key}"]`), '#caCtx', b.be.number);
  await page.goto(APP + `/bank-accounts?acct=${b.bank.id}`);
  await bothWays(page, page.locator(`#bkRows tr[data-bke="${(await b.line(b.bank.id, b.be.number)).key}"]`), '#bkCtx', b.be.number);
  await page.goto(APP + '/stock-adjustments');
  await bothWays(page, page.locator(`#adjRows tr[data-adj="${b.adj.number}"]`), '#adjCtx', b.adj.number);
  await page.goto(APP + '/godowns');
  await bothWays(page, page.locator(`#trRows [data-trno="${b.trf.number}"]`), '#trCtx', b.trf.number, false);

  // the opening balance line has no menu; the browser's own menu stays blocked on these pages
  await page.goto(APP + '/cash-in-hand');
  await page.locator('#caRows tr.bkopen').waitFor();
  await expect(page.locator('#caRows tr.bkopen [data-slm]')).toHaveCount(0);
  const stopped = (sel: string) => page.evaluate((s) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector(s)!.dispatchEvent(e); return e.defaultPrevented; }, sel);
  expect(await stopped('#caRows tr.bkopen td')).toBe(true);
  expect(await stopped('.pthd')).toBe(true);
  expect(await stopped('#caQ')).toBe(false);
  await expect(page.locator('.ctxm:not([hidden])')).toHaveCount(0);
});

test('edit an expense and a stock adjustment with the passcode: a wrong one is refused; cash, bank and stock follow', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  await b.a.post('/settings/passcode/on', { passcode: PASS });
  const start = await b.look();
  await signInAs(page, who);

  // expense: ₹1,200 cash → ₹1,500 from the bank; the number stays
  await page.goto(APP + '/expenses');
  await page.locator(`#exRows tr[data-exk="EX:${b.xp.number}"] [data-slm]`).click();
  await page.click('#exCtx [data-sla="edit"]');
  await expect(page.locator('#xpT')).toHaveText('Edit expense');
  await expect(page.locator('#xpNo')).toHaveText(b.xp.number);
  await expect(page.locator('#xpLines [data-f="amt"]').first()).toHaveValue('1200');
  await page.locator('#xpLines [data-f="amt"]').first().fill('1500');
  await page.selectOption('#xpAcct', b.bank.id);
  await page.click('#xpSave');
  await passcode(page, '1111');
  await expect(page.locator('#pcm')).toContainText('Wrong passcode. 4 tries left.');
  expect(await b.look()).toEqual(start);
  await passcode(page, PASS);
  await expect(page.locator('#xpm')).toBeHidden();
  await expect(page.locator(`#exRows tr[data-exk="EX:${b.xp.number}"]`)).toContainText('1,500.00');
  const afterXp = await b.look();
  expect(Number(afterXp.cash)).toBe(Number(start.cash) + 1200);
  expect(Number(afterXp.bank)).toBe(Number(start.bank) - 1500);

  // stock adjustment: +10 → +4 (right-click on the row); stock 6 lower, the rest unchanged
  await page.goto(APP + '/stock-adjustments');
  const row = page.locator(`#adjRows tr[data-adj="${b.adj.number}"]`);
  const box = (await row.locator('td').first().boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 10, { button: 'right' });
  await page.click('#adjCtx [data-sla="edit"]');
  await expect(page.locator('#adjT')).toHaveText(`Edit ${b.adj.number}`);
  await expect(page.locator('#adjQty')).toHaveValue('10');
  await expect(page.locator('#adjFor')).toContainText('in stock 25'); // as if it had not been made
  await page.fill('#adjQty', '4');
  await expect(page.locator('#adjAfter')).toContainText('29');
  await page.click('#adjForm button[type="submit"]');
  await passcode(page, PASS);
  await expect(page.locator('#adj')).toBeHidden();
  await expect(row).toContainText('+4');
  expect(await b.look()).toEqual({ ...afterXp, fan: String((Number(afterXp.fan) - 6).toFixed(3)) });
});

test('passcode off: a bank entry and a transfer save straight away; records that can’t be changed say why', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  const b = await books(request, who);
  const start = await b.look();
  await signInAs(page, who);

  // cash book: the deposit of ₹3,000 becomes ₹1,000
  await page.goto(APP + '/cash-in-hand');
  await page.locator(`#caRows tr[data-bke="${(await b.line(b.cash.id, b.be.number)).key}"] [data-slm]`).click();
  await page.click('#caCtx [data-sla="edit"]');
  await expect(page.locator('#bmmT')).toHaveText(`Edit ${b.be.number}`);
  await expect(page.locator('#bmmAmt')).toHaveValue('3000');
  await page.fill('#bmmAmt', '1000');
  await page.click('#bmmSave');
  await expect(page.locator('#bmm')).toBeHidden();
  await expect(page.locator('#pcm')).toBeHidden();
  const afterBe = await b.look();
  expect([Number(afterBe.cash) - Number(start.cash), Number(afterBe.bank) - Number(start.bank)]).toEqual([2000, -2000]);

  // transfer: 6 fans to the store → 2
  await page.goto(APP + '/godowns');
  await page.locator(`#trRows [data-trno="${b.trf.number}"] [data-slm]`).click();
  await page.click('#trCtx [data-sla="edit"]');
  await expect(page.locator('#trT')).toHaveText(`Edit ${b.trf.number}`);
  await expect(page.locator('#trQty')).toHaveValue('6');
  await page.fill('#trQty', '2');
  await page.click('#trForm button[type="submit"]');
  await expect(page.locator('#trm')).toBeHidden();
  expect(await b.look()).toEqual({ ...afterBe, store: '2.000' });

  // an expense paid by a cheque the bank already cleared: Edit is off, with the reason
  const chq = await b.a.post<{ id: string; number: string }>('/expenses', { date: D, categoryId: b.rent.id, mode: 'Cheque', reference: '004519', accountId: b.bank.id, lines: [{ name: 'Shop rent', amt: '900' }] });
  const c = (await b.a.get<{ id: string; ref: string }[]>('/banking/cheques')).find((x) => x.ref === '004519')!;
  await b.a.post(`/banking/cheques/${c.id}/clear`, { accountId: b.bank.id, date: D });
  await page.goto(APP + '/expenses');
  await page.locator(`#exRows tr[data-exk="EX:${chq.number}"] [data-slm]`).click();
  await expect(page.locator('#exCtx [data-sla="edit"]')).toBeDisabled();
  await expect(page.locator('#exCtx [data-sla="edit"]')).toHaveAttribute('title', 'Cheque 004519 on this expense is already cleared. Undo it on the Cheques page first.');
  await page.keyboard.press('Escape');

  // an entry ticked in Reconciliation: Edit says why and opens nothing
  const tick = await b.line(b.bank.id, b.be.number);
  await b.a.put(`/banking/accounts/${b.bank.id}/reconciliation`, { asOf: D, statement: null, ticked: [tick.key] });
  await page.goto(APP + `/bank-accounts?acct=${b.bank.id}`);
  await page.locator(`#bkRows tr[data-bke="${tick.key}"] [data-slm]`).click();
  await page.click('#bkCtx [data-sla="edit"]');
  await expect(page.locator('#toast')).toContainText('This entry is ticked in Reconciliation for HDFC Bank (edit). Untick it there first, then change it.');
  await expect(page.locator('#bmm')).toBeHidden();
  // only the ₹900 cheque the bank paid has moved since
  expect(await b.look()).toEqual({ ...afterBe, store: '2.000', bank: (Number(afterBe.bank) - 900).toFixed(2) });
});
