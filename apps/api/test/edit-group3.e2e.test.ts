import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, expectNoPasscode, owner, startApp } from './helpers';

/**
 * Edit for saved records, group 3: expenses, cash / bank entries typed by hand, stock adjustments
 * and stock transfers. An edit undoes the old effects (the same rows a cancel adds) and writes the
 * new ones under the same number, in one go. The strongest check: after an edit every balance,
 * book, stock figure and report is exactly what it would be had the record been saved that way in
 * the first place. Made-up passcodes only; fixed dates, never today.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';
const D2 = '2026-10-09';
const PASS = '4826';
const H = 'x-txn-passcode';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
interface Acc { id: string; kind: string; name: string; balance: string; openingBalance: string }
interface Gd { id: string; name: string; isDefault: boolean }

async function shop() {
  const o = await owner(app);
  const get = async (p: string) => (await http().get(`/api/${p}`).set(auth(o)).expect(200)).body;
  const cash = ((await get('banking/accounts')) as Acc[]).find((a) => a.kind === 'cash')!;
  await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '20000', openingDate: '2026-04-01' }).expect(200);
  const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000', openingDate: '2026-04-01' }).expect(201)).body as { id: string };
  const sbi = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'SBI', openingBalance: '10000', openingDate: '2026-04-01' }).expect(201)).body as { id: string };
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540' }).expect(201)).body as { id: string; name: string };
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200' }).expect(201)).body as { id: string; name: string };
  const main = ((await get('godowns')) as Gd[]).find((g) => g.isDefault)!;
  const store = (await http().post('/api/godowns').set(auth(o)).send({ name: 'Aminabad godown' }).expect(201)).body as Gd;
  const cats = (await get('expense-categories')) as { id: string; name: string }[];
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  return { o, get, cash, bank, sbi, fan, bulb, main, store, cat };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const put = (o: S, path: string, body: object, pass?: string) => { const r = http().put(`/api/${path}`).set(auth(o)); return (pass ? r.set(H, pass) : r).send(body); };
const post = (o: S, path: string, body: object) => http().post(`/api/${path}`).set(auth(o)).send(body);
const turnOn = (o: S) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);
const audit = async (o: S) => (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
const same = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time'));
const balances = async (s: Shop) => Object.fromEntries(((await s.get('banking/accounts')) as Acc[]).map((a) => [a.name, a.balance]));
const stock = async (s: Shop, it: { id: string }) => (await s.get(`items/${it.id}`)).stock as string;
const inGodown = async (s: Shop, it: { id: string }, g: Gd) => ((await s.get(`items/${it.id}`)).godowns as { id: string; stock: string }[]).find((x) => x.id === g.id)!.stock;
const sell = (s: Shop, it: { id: string; name: string }, qty: string) => post(s.o, 'sales', { date: D2, dueDate: D2, mode: 'cash', cashName: 'Ramesh', lines: [{ itemId: it.id, name: it.name, qty, price: '1890', discPct: '0', gstRate: '18' }], payments: [] });

/** Everything a balance, book, stock figure or report shows for one shop (ids and times left out). */
async function figures(s: Shop) {
  const { get } = s;
  const book = async (id: string) => { const b = await get(`banking/accounts/${id}/book`); return { balance: b.balance, entries: (b.entries as Record<string, unknown>[]).map(({ key: _k, sourceId: _s, ...e }) => e) }; };
  // the item's godowns come in no fixed order: sorted by name
  const item = async (id: string) => { const x = await get(`items/${id}`); return { stock: x.stock, godowns: (x.godowns as { name: string }[]).sort((a, b) => a.name.localeCompare(b.name)), rateTable: x.rateTable }; };
  return same({
    accounts: await get('banking/accounts'), cash: await book(s.cash.id), bank: await book(s.bank.id), sbi: await book(s.sbi.id),
    expenses: ((await get('expenses')) as Record<string, unknown>[]).map(({ key: _k, number: _n, ...x }) => x),
    home: await get(`reports/home?today=${D2}`),
    fan: await item(s.fan.id), bulb: await item(s.bulb.id), godowns: await get('godowns'),
    mainItems: await get(`godowns/${s.main.id}/items`), storeItems: await get(`godowns/${s.store.id}/items`),
    adjustments: ((await get('stock-adjustments')) as Record<string, unknown>[]).map(({ number: _n, ...a }) => a),
    transfers: ((await get('stock-transfers')) as Record<string, unknown>[]).map(({ number: _n, ...t }) => t),
  });
}

/* ───────── expenses ───────── */

const xp = (s: Shop, more: object = {}) => ({ date: D, categoryId: s.cat('Repairs'), mode: 'Cash', payee: 'Cool Air Services', reference: '', notes: '', lines: [{ name: 'AC servicing', qty: '1', rate: '1200', gst: '0', amt: '1200' }], ...more });

describe('edit an expense', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; same number; the money moves to the new account', async () => {
    const s = await shop();
    await turnOn(s.o);
    const x = (await post(s.o, 'expenses', xp(s)).expect(201)).body;
    const body = xp(s, { mode: 'UPI', accountId: s.bank.id, date: D2, categoryId: s.cat('Electricity'), lines: [{ name: 'Wiring', qty: '2', rate: '900', gst: '0', amt: '1800' }] });
    expect((await put(s.o, `expenses/${x.id}`, body).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await put(s.o, `expenses/${x.id}`, body, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '18800.00', 'HDFC Bank': '50000.00' });
    expect((await put(s.o, `expenses/${x.id}`, body, PASS).expect(200)).body).toMatchObject({ id: x.id, number: 'EXP-0001', total: '1800.00', account: s.bank.id });
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '20000.00', 'HDFC Bank': '48200.00' });
    expect((await s.get('expenses')).map((e: { number: string; category: string }) => [e.number, e.category])).toEqual([['EXP-0001', 'Electricity']]);
    expect((await s.get('expenses/next-number')).number).toBe('EXP-0002');
    const a = await audit(s.o);
    expect(a.find((e) => e.action === 'update' && e.entity === 'expense')).toMatchObject({ entityId: x.id, before: { number: 'EXP-0001', total: '1200', mode: 'Cash' }, after: { number: 'EXP-0001', total: '1800', mode: 'UPI', category: 'Electricity' } });
    // each changed field, old and new value (who and when are the entry's own user and time)
    const xc = a.find((e) => e.action === 'update' && e.entity === 'expense')!.after!.changes as { field: string; old: unknown; new: unknown }[];
    expect(xc.map((c) => c.field)).toEqual(['date', 'category', 'mode', 'accountId', 'lines', 'total']);
    expect(xc).toContainEqual({ field: 'date', old: D, new: D2 });
    expect(xc).toContainEqual({ field: 'category', old: 'Repairs', new: 'Electricity' });
    expect(xc).toContainEqual({ field: 'accountId', old: s.cash.id, new: s.bank.id });
    expect(xc).toContainEqual({ field: 'lines', old: [{ name: 'AC servicing', qty: '1.000', rate: '1200.00', gst: 0, amt: '1200.00' }], new: [{ name: 'Wiring', qty: '2.000', rate: '900.00', gst: 0, amt: '1800.00' }] });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: x.id, after: { for: 'edit', document: 'expense' } });
    expectNoPasscode(a, PASS);
  });

  it('every balance, book and report is the same as if it had been saved that way', async () => {
    const A = await shop(), B = await shop();
    const edited = (s: Shop) => xp(s, { mode: 'UPI', accountId: s.bank.id, date: D2, categoryId: s.cat('Electricity'), lines: [{ name: 'Wiring', qty: '2', rate: '900', gst: '0', amt: '1800' }] });
    const x = (await post(A.o, 'expenses', xp(A)).expect(201)).body;
    await put(A.o, `expenses/${x.id}`, edited(A)).expect(200);
    await post(B.o, 'expenses', edited(B)).expect(201);
    expect(await figures(A)).toEqual(await figures(B));
  });

  it('a different number, a cancelled expense, a cleared cheque and a reconciled entry are refused in plain words', async () => {
    const s = await shop();
    const x = (await post(s.o, 'expenses', xp(s)).expect(201)).body;
    expect((await put(s.o, `expenses/${x.id}`, xp(s, { number: 'EXP-0099' })).expect(400)).body.message).toBe('The number of a saved expense can’t be changed. It stays EXP-0001.');
    await put(s.o, `expenses/${x.id}`, xp(s, { number: 'EXP-0001', notes: 'same number is fine' })).expect(200);
    // paid by cheque, and the bank already paid the cheque
    const c = (await post(s.o, 'expenses', xp(s, { mode: 'Cheque', reference: '004519', accountId: s.bank.id })).expect(201)).body;
    const chq = ((await s.get('banking/cheques')) as { id: string; ref: string }[]).find((q) => q.ref === '004519')!;
    await post(s.o, `banking/cheques/${chq.id}/clear`, { accountId: s.bank.id, date: D2 }).expect(201);
    const why = 'Cheque 004519 on this expense is already cleared. Undo it on the Cheques page first.';
    expect((await put(s.o, `expenses/${c.id}`, xp(s, { mode: 'Cheque', reference: '004519', accountId: s.bank.id, lines: [{ name: 'AC', amt: '999' }] })).expect(400)).body.message).toBe(why);
    expect(((await s.get('expenses')) as { id: string; locked: string }[]).find((e) => e.id === c.id)!.locked).toBe(why);
    // paid by UPI from the bank, and ticked in Reconciliation
    const u = (await post(s.o, 'expenses', xp(s, { mode: 'UPI', accountId: s.bank.id })).expect(201)).body;
    const line = ((await s.get(`banking/accounts/${s.bank.id}/book`)).entries as { key: string; doc: string }[]).find((e) => e.doc === u.number)!.key;
    await put(s.o, `banking/accounts/${s.bank.id}/reconciliation`, { asOf: D2, statement: null, ticked: [line] }).expect(200);
    expect((await put(s.o, `expenses/${u.id}`, xp(s, { mode: 'UPI', accountId: s.bank.id, lines: [{ name: 'AC', amt: '1' }] })).expect(400)).body.message).toBe('This entry is ticked in Reconciliation for HDFC Bank. Untick it there first, then change it.');
    await put(s.o, `banking/accounts/${s.bank.id}/reconciliation`, { asOf: D2, statement: null, ticked: [] }).expect(200);
    await put(s.o, `expenses/${u.id}`, xp(s, { mode: 'UPI', accountId: s.bank.id, lines: [{ name: 'AC', amt: '1' }] })).expect(200);
    // cancelled
    await post(s.o, `expenses/${x.id}/cancel`, {}).expect(201);
    expect((await put(s.o, `expenses/${x.id}`, xp(s)).expect(400)).body.message).toBe('This expense is cancelled.');
    // nothing refused moved any money: cash = 20000 − nothing live in cash
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '20000.00', 'HDFC Bank': '48799.00' });
  });
});

/* ───────── cash / bank entries ───────── */

const entry = (more: object) => ({ date: D, reference: '', note: '', category: '', ...more });

describe('edit a cash / bank entry', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; same number; both books follow', async () => {
    const s = await shop();
    await turnOn(s.o);
    const e = (await post(s.o, 'banking/entries', entry({ kind: 'deposit', amount: '5000', fromId: s.cash.id, toId: s.bank.id })).expect(201)).body;
    const body = entry({ kind: 'transfer', amount: '7000', fromId: s.bank.id, toId: s.sbi.id, date: D2, reference: 'UTR 8812' });
    expect((await put(s.o, `banking/entries/${e.id}`, body).expect(403)).body.code).toBe('passcode');
    expect((await put(s.o, `banking/entries/${e.id}`, body, '1111').expect(403)).body.message).toBe('Wrong passcode. 4 tries left.');
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '15000.00', 'HDFC Bank': '55000.00', SBI: '10000.00' });
    expect((await put(s.o, `banking/entries/${e.id}`, body, PASS).expect(200)).body).toEqual({ id: e.id, number: 'BT-0001', amount: '7000.00' });
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '20000.00', 'HDFC Bank': '43000.00', SBI: '17000.00' });
    expect(await s.get(`banking/entries/${e.id}`)).toMatchObject({ number: 'BT-0001', kind: 'transfer', amount: '7000.00', reference: 'UTR 8812', locked: '' });
    const a = await audit(s.o);
    expect(a.find((x) => x.action === 'update' && x.entity === 'bank_entry')).toMatchObject({ entityId: e.id, before: { number: 'BT-0001', kind: 'deposit', amount: '5000' }, after: { number: 'BT-0001', kind: 'transfer', amount: '7000' } });
    expect(a.find((x) => x.action === 'update' && x.entity === 'bank_entry')!.after!.changes).toEqual([
      { field: 'date', old: D, new: D2 }, { field: 'kind', old: 'deposit', new: 'transfer' }, { field: 'accountId', old: s.cash.id, new: s.bank.id },
      { field: 'toAccountId', old: s.bank.id, new: s.sbi.id }, { field: 'amount', old: '5000', new: '7000' }, { field: 'reference', old: '', new: 'UTR 8812' },
    ]);
    expect(a.find((x) => x.action === 'passcode_used')).toMatchObject({ entityId: e.id, after: { for: 'edit', document: 'bank_entry' } });
    expectNoPasscode(a, PASS);
    // the next entry still gets the next number
    expect((await post(s.o, 'banking/entries', entry({ kind: 'in', amount: '10', accountId: s.cash.id, category: 'Other income' })).expect(201)).body.number).toBe('BT-0002');
  });

  it('every balance, book and report is the same as if it had been saved that way; the Expenses page follows a book expense', async () => {
    const A = await shop(), B = await shop();
    const to = (s: Shop) => entry({ kind: 'out', amount: '2500', accountId: s.bank.id, category: 'Salary', note: 'Raju', date: D2 });
    const e = (await post(A.o, 'banking/entries', entry({ kind: 'out', amount: '400', accountId: A.cash.id, category: 'Shop expense', note: 'Tea' })).expect(201)).body;
    await put(A.o, `banking/entries/${e.id}`, to(A)).expect(200);
    await post(B.o, 'banking/entries', to(B)).expect(201);
    expect(await figures(A)).toEqual(await figures(B));
    expect((await A.get('expenses'))[0]).toMatchObject({ number: 'BT-0001', category: 'Salary & wages', total: '2500.00', accountId: A.bank.id, locked: '' });
  });

  it('cash in hand is checked without the old entry; refusals are in plain words and change nothing', async () => {
    const s = await shop();
    const e = (await post(s.o, 'banking/entries', entry({ kind: 'deposit', amount: '15000', fromId: s.cash.id, toId: s.bank.id })).expect(201)).body;
    // 20000 cash at the start: the old 15000 is given back before the new amount is checked
    await put(s.o, `banking/entries/${e.id}`, entry({ kind: 'deposit', amount: '19000', fromId: s.cash.id, toId: s.bank.id })).expect(200);
    expect((await put(s.o, `banking/entries/${e.id}`, entry({ kind: 'deposit', amount: '20001', fromId: s.cash.id, toId: s.bank.id })).expect(400)).body.message).toBe('Only 20,000.00 cash in hand.');
    expect((await put(s.o, `banking/entries/${e.id}`, entry({ kind: 'deposit', amount: '100', fromId: s.cash.id, toId: s.bank.id, number: 'BT-0042' })).expect(400)).body.message).toBe('The number of a saved entry can’t be changed. It stays BT-0001.');
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '1000.00', 'HDFC Bank': '69000.00' });
    // ticked in Reconciliation
    const line = ((await s.get(`banking/accounts/${s.bank.id}/book`)).entries as { key: string; doc: string }[]).find((x) => x.doc === 'BT-0001')!.key;
    await put(s.o, `banking/accounts/${s.bank.id}/reconciliation`, { asOf: D2, statement: '69000', ticked: [line] }).expect(200);
    const rec = 'This entry is ticked in Reconciliation for HDFC Bank. Untick it there first, then change it.';
    expect((await put(s.o, `banking/entries/${e.id}`, entry({ kind: 'deposit', amount: '100', fromId: s.cash.id, toId: s.bank.id })).expect(400)).body.message).toBe(rec);
    expect((await s.get(`banking/entries/${e.id}`)).locked).toBe(rec);
    // a cash count difference
    const cc = (await post(s.o, 'banking/count-cash', { counted: '900', date: D }).expect(201)).body;
    const ccId = ((await s.get(`banking/accounts/${s.cash.id}/book`)).entries as { doc: string; sourceId: string }[]).find((x) => x.doc === cc.number)!.sourceId;
    expect((await put(s.o, `banking/entries/${ccId}`, entry({ kind: 'out', amount: '50', accountId: s.cash.id, category: 'Other' })).expect(400)).body.message).toBe('This is a cash count difference. Count the cash again to correct it.');
    // cancelled
    const t = (await post(s.o, 'banking/entries', entry({ kind: 'in', amount: '300', accountId: s.sbi.id, category: 'Interest received' })).expect(201)).body;
    await post(s.o, `banking/entries/${t.id}/cancel`, {}).expect(201);
    expect((await put(s.o, `banking/entries/${t.id}`, entry({ kind: 'in', amount: '30', accountId: s.sbi.id, category: 'Interest received' })).expect(400)).body.message).toBe('This entry is cancelled, so it can’t be changed.');
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '900.00', 'HDFC Bank': '69000.00', SBI: '10000.00' });
  });
});

/* ───────── stock adjustments ───────── */

const adj = (s: Shop, more: object = {}) => ({ itemId: s.fan.id, mode: 'add', qty: 10, rate: '1500', date: D, reason: 'Physical count correction', ...more });

describe('edit a stock adjustment', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; same number; stock follows', async () => {
    const s = await shop();
    await turnOn(s.o);
    const a = (await post(s.o, 'stock-adjustments', adj(s)).expect(201)).body;
    expect(await stock(s, s.fan)).toBe('35.000');
    const body = adj(s, { mode: 'reduce', qty: 3, reason: 'Damaged', date: D2 });
    expect((await put(s.o, `stock-adjustments/${a.id}`, body).expect(403)).body.code).toBe('passcode');
    expect((await put(s.o, `stock-adjustments/${a.id}`, body, '9999').expect(403)).body.message).toBe('Wrong passcode. 4 tries left.');
    expect(await stock(s, s.fan)).toBe('35.000');
    expect((await put(s.o, `stock-adjustments/${a.id}`, body, PASS).expect(200)).body).toEqual({ id: a.id, number: 'ADJ-0001', stock: '22.000' });
    expect(await stock(s, s.fan)).toBe('22.000');
    expect((await s.get('stock-adjustments'))[0]).toMatchObject({ number: 'ADJ-0001', qty: '-3.000', reason: 'Damaged', date: D2, cancelled: false });
    const au = await audit(s.o);
    expect(au.find((x) => x.action === 'update' && x.entity === 'stock_adjustment')).toMatchObject({ entityId: a.id, before: { number: 'ADJ-0001', qty: '10', reason: 'Physical count correction' }, after: { number: 'ADJ-0001', qty: '-3', reason: 'Damaged' } });
    expect(au.find((x) => x.action === 'update' && x.entity === 'stock_adjustment')!.after!.changes).toEqual([
      { field: 'date', old: D, new: D2 }, { field: 'qty', old: '10', new: '-3' }, { field: 'reason', old: 'Physical count correction', new: 'Damaged' },
    ]);
    // the old quantity is put back the way a sales edit does it: kind "cancel", note "Edited <number>"
    const mv = (await s.get(`items/${s.fan.id}`)).movements as { kind: string; qty: string; note: string; ref: string }[];
    expect(mv.filter((m) => m.ref === 'ADJ-0001').map((m) => [m.kind, m.qty, m.note])).toEqual(expect.arrayContaining([['adjustment', '10.000', 'Physical count correction'], ['cancel', '-10.000', 'Edited ADJ-0001'], ['adjustment', '-3.000', 'Damaged']]));
    expect(au.find((x) => x.action === 'passcode_used')).toMatchObject({ entityId: a.id, after: { for: 'edit', document: 'stock_adjustment' } });
    expectNoPasscode(au, PASS);
    expect((await post(s.o, 'stock-adjustments', adj(s, { qty: 1 })).expect(201)).body.number).toBe('ADJ-0002');
  });

  it('every stock figure, value and report is the same as if it had been saved that way (other item too)', async () => {
    const A = await shop(), B = await shop();
    const to = (s: Shop) => adj(s, { itemId: s.bulb.id, mode: 'reduce', qty: 12, rate: '60', reason: 'Expired', date: D2 });
    const a = (await post(A.o, 'stock-adjustments', adj(A)).expect(201)).body;
    await put(A.o, `stock-adjustments/${a.id}`, to(A)).expect(200);
    await post(B.o, 'stock-adjustments', to(B)).expect(201);
    expect(await figures(A)).toEqual(await figures(B));
    expect(await stock(A, A.fan)).toBe('25.000');
    expect(await stock(A, A.bulb)).toBe('188.000');
  });

  it('goods sold since: an edit that would make stock negative is refused (as cancel is); one that does not is saved', async () => {
    const s = await shop();
    const a = (await post(s.o, 'stock-adjustments', adj(s)).expect(201)).body; // 25 + 10
    await sell(s, s.fan, '32').expect(201); // 3 left
    const neg = 'Saving this would make stock negative. Some of it has been sold since.';
    expect((await put(s.o, `stock-adjustments/${a.id}`, adj(s, { qty: 2 })).expect(400)).body.message).toBe(neg);
    expect((await post(s.o, `stock-adjustments/${a.id}/cancel`, {}).expect(400)).body.message).toBe('Cancelling this would make stock negative. Some of it has been sold since.');
    expect(await stock(s, s.fan)).toBe('3.000');
    await put(s.o, `stock-adjustments/${a.id}`, adj(s, { qty: 7, reason: 'Found in store room' })).expect(200);
    expect(await stock(s, s.fan)).toBe('0.000');
    expect((await put(s.o, `stock-adjustments/${a.id}`, adj(s, { qty: 7, number: 'ADJ-0007' })).expect(400)).body.message).toBe('The number of a saved adjustment can’t be changed. It stays ADJ-0001.');
    const r = (await post(s.o, 'stock-adjustments', adj(s, { itemId: s.bulb.id, qty: 5 })).expect(201)).body;
    expect((await put(s.o, `stock-adjustments/${r.id}`, adj(s, { itemId: s.bulb.id, mode: 'reduce', qty: 206 })).expect(400)).body.message).toBe('Only 200 in stock. You can’t reduce by more than that.');
    await http().post(`/api/stock-adjustments/${r.id}/cancel`).set(auth(s.o)).expect(204);
    expect((await put(s.o, `stock-adjustments/${r.id}`, adj(s, { itemId: s.bulb.id, qty: 1 })).expect(400)).body.message).toBe('This adjustment is cancelled, so it can’t be changed.');
    expect(await stock(s, s.bulb)).toBe('200.000');
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const s = await shop();
    await turnOn(s.o);
    const a = (await post(s.o, 'stock-adjustments', adj(s)).expect(201)).body;
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await put(s.o, `stock-adjustments/${a.id}`, adj(s, { qty: 1 }), '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await put(s.o, `stock-adjustments/${a.id}`, adj(s, { qty: 1 }), PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect(await stock(s, s.fan)).toBe('35.000');
  });
});

/* ───────── stock transfers ───────── */

const trf = (s: Shop, more: object = {}) => ({ itemId: s.fan.id, fromGodownId: s.main.id, toGodownId: s.store.id, qty: 10, date: D, note: '', ...more });

describe('edit a stock transfer', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; same number; both godowns follow', async () => {
    const s = await shop();
    await turnOn(s.o);
    const t = (await post(s.o, 'stock-transfers', trf(s)).expect(201)).body;
    const body = trf(s, { qty: 4, date: D2 });
    expect((await put(s.o, `stock-transfers/${t.id}`, body).expect(403)).body.code).toBe('passcode');
    expect((await put(s.o, `stock-transfers/${t.id}`, body, '2222').expect(403)).body.message).toBe('Wrong passcode. 4 tries left.');
    expect([await inGodown(s, s.fan, s.main), await inGodown(s, s.fan, s.store)]).toEqual(['15.000', '10.000']);
    expect((await put(s.o, `stock-transfers/${t.id}`, body, PASS).expect(200)).body).toEqual({ id: t.id, number: 'TRF-0001' });
    expect([await inGodown(s, s.fan, s.main), await inGodown(s, s.fan, s.store), await stock(s, s.fan)]).toEqual(['21.000', '4.000', '25.000']);
    expect((await s.get('stock-transfers'))[0]).toMatchObject({ number: 'TRF-0001', qty: '4.000', date: D2, itemId: s.fan.id, fromId: s.main.id, toId: s.store.id });
    const au = await audit(s.o);
    expect(au.find((x) => x.action === 'update' && x.entity === 'stock_transfer')).toMatchObject({ entityId: t.id, before: { number: 'TRF-0001', qty: '10' }, after: { number: 'TRF-0001', qty: '4' } });
    expect(au.find((x) => x.action === 'update' && x.entity === 'stock_transfer')!.after!.changes).toEqual([{ field: 'date', old: D, new: D2 }, { field: 'qty', old: '10', new: '4' }]);
    const mv = (await s.get(`items/${s.fan.id}`)).movements as { kind: string; qty: string; note: string; ref: string }[];
    expect(mv.filter((m) => m.kind === 'cancel').map((m) => [m.qty, m.note]).sort()).toEqual([['-10.000', 'Edited TRF-0001'], ['10.000', 'Edited TRF-0001']]);
    expect(au.find((x) => x.action === 'passcode_used')).toMatchObject({ entityId: t.id, after: { for: 'edit', document: 'stock_transfer' } });
  });

  it('every stock figure is the same as if it had been saved that way (other item, other way round)', async () => {
    const A = await shop(), B = await shop();
    const first = (s: Shop) => trf(s, { itemId: s.bulb.id, qty: 50 });
    const to = (s: Shop) => trf(s, { itemId: s.bulb.id, fromGodownId: s.store.id, toGodownId: s.main.id, qty: 20, date: D2 });
    // B has the same stock in the godown it moves from: 50 moved there first by another transfer
    await post(A.o, 'stock-transfers', first(A)).expect(201);
    const t = (await post(A.o, 'stock-transfers', trf(A)).expect(201)).body;
    await put(A.o, `stock-transfers/${t.id}`, to(A)).expect(200);
    await post(B.o, 'stock-transfers', first(B)).expect(201);
    await post(B.o, 'stock-transfers', to(B)).expect(201);
    expect(await figures(A)).toEqual(await figures(B));
  });

  it('goods moved on from the receiving godown: an edit that would make it negative is refused; refusals change nothing', async () => {
    const s = await shop();
    const t = (await post(s.o, 'stock-transfers', trf(s)).expect(201)).body;
    await post(s.o, 'stock-transfers', trf(s, { fromGodownId: s.store.id, toGodownId: s.main.id, qty: 8 })).expect(201); // 2 left in the store
    expect((await put(s.o, `stock-transfers/${t.id}`, trf(s, { qty: 5 })).expect(400)).body.message).toBe('Saving this would make stock negative in the receiving godown. Some of it has been sold or moved since.');
    expect((await put(s.o, `stock-transfers/${t.id}`, trf(s, { qty: 34 })).expect(400)).body.message).toBe('Only 33 PCS available in Main shop.');
    expect((await put(s.o, `stock-transfers/${t.id}`, trf(s, { number: 'TRF-0009' })).expect(400)).body.message).toBe('The number of a saved transfer can’t be changed. It stays TRF-0001.');
    expect([await inGodown(s, s.fan, s.main), await inGodown(s, s.fan, s.store)]).toEqual(['23.000', '2.000']);
    await put(s.o, `stock-transfers/${t.id}`, trf(s, { qty: 9, note: 'One kept back' })).expect(200);
    expect([await inGodown(s, s.fan, s.main), await inGodown(s, s.fan, s.store)]).toEqual(['24.000', '1.000']);
    const c = (await post(s.o, 'stock-transfers', trf(s, { itemId: s.bulb.id, qty: 3 })).expect(201)).body;
    await http().post(`/api/stock-transfers/${c.id}/cancel`).set(auth(s.o)).expect(204);
    expect((await put(s.o, `stock-transfers/${c.id}`, trf(s, { itemId: s.bulb.id, qty: 1 })).expect(400)).body.message).toBe('This transfer is cancelled, so it can’t be changed.');
  });
});

/* ───────── every type ───────── */

describe('group 3 edits and other shops, staff and opening values', () => {
  it('another shop’s records are not found (row-level security)', async () => {
    const s = await shop();
    const other = await shop();
    const x = (await post(s.o, 'expenses', xp(s)).expect(201)).body;
    const e = (await post(s.o, 'banking/entries', entry({ kind: 'in', amount: '10', accountId: s.cash.id, category: 'Other income' })).expect(201)).body;
    const a = (await post(s.o, 'stock-adjustments', adj(s)).expect(201)).body;
    const t = (await post(s.o, 'stock-transfers', trf(s)).expect(201)).body;
    await put(other.o, `expenses/${x.id}`, xp(other)).expect(404);
    await put(other.o, `banking/entries/${e.id}`, entry({ kind: 'in', amount: '99', accountId: other.cash.id, category: 'Other income' })).expect(404);
    await put(other.o, `stock-adjustments/${a.id}`, adj(other)).expect(404);
    await put(other.o, `stock-transfers/${t.id}`, trf(other)).expect(404);
    expect(await balances(s)).toMatchObject({ 'Cash in hand': '18810.00' });
    expect(await stock(s, s.fan)).toBe('35.000');
  });

  it('opening stock, opening cash and bank balances are never changed by these edits (extra fields are ignored)', async () => {
    const s = await shop();
    const opening = async () => ({
      acc: ((await s.get('banking/accounts')) as Acc[]).map((a) => [a.name, a.openingBalance]),
      fan: ((await s.get(`items/${s.fan.id}`)).movements as { kind: string; qty: string }[]).filter((m) => m.kind === 'opening'),
    });
    const at0 = await opening();
    const extra = { openingBalance: '0', openingQty: '0', openingRate: '0', openingDate: '2026-04-02' };
    const x = (await post(s.o, 'expenses', xp(s)).expect(201)).body;
    await put(s.o, `expenses/${x.id}`, { ...xp(s, { mode: 'UPI', accountId: s.bank.id }), ...extra }).expect(200);
    const e = (await post(s.o, 'banking/entries', entry({ kind: 'withdraw', amount: '100', fromId: s.bank.id, toId: s.cash.id })).expect(201)).body;
    await put(s.o, `banking/entries/${e.id}`, { ...entry({ kind: 'withdraw', amount: '300', fromId: s.sbi.id, toId: s.cash.id }), ...extra }).expect(200);
    const a = (await post(s.o, 'stock-adjustments', adj(s)).expect(201)).body;
    await put(s.o, `stock-adjustments/${a.id}`, { ...adj(s, { qty: 2 }), ...extra }).expect(200);
    const t = (await post(s.o, 'stock-transfers', trf(s)).expect(201)).body;
    await put(s.o, `stock-transfers/${t.id}`, { ...trf(s, { qty: 1 }), ...extra }).expect(200);
    expect(await opening()).toEqual(at0);
    expect(at0.fan).toHaveLength(1);
    expect(await stock(s, s.fan)).toBe('27.000');
  });
});
