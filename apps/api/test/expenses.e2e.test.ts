import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/** Expenses: categories, paid from cash or a bank, GST input credit, cancelled never deleted. */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-01';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
const cats = async (o: S) => (await http().get('/api/expense-categories').set(auth(o)).expect(200)).body as { id: string; name: string; fixed: boolean }[];
const accounts = async (o: S) => (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { id: string; kind: string; name: string; balance: string }[];

describe('expenses', () => {
  it('a new shop has the prototype’s categories; an expense comes out of cash and shows in the cash book', async () => {
    const o = await owner(app);
    const C = await cats(o);
    expect(C.map((c) => c.name)).toEqual(['Rent', 'Salary & wages', 'Electricity', 'Telephone & internet', 'Transport & freight', 'Petrol & travel', 'Tea & refreshments', 'Packing material', 'Shop maintenance', 'Repairs', 'Office & stationery', 'Advertising', 'Professional fees', 'Bank charges', 'Shop expenses', 'Other']);
    expect(C.filter((c) => c.fixed).map((c) => c.name)).toEqual(['Salary & wages', 'Bank charges', 'Shop expenses']);
    const cash = (await accounts(o))[0]!;
    await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '10000' }).expect(200);
    const tea = C.find((c) => c.name === 'Tea & refreshments')!;
    const add = (body: object) => http().post('/api/expenses').set(auth(o)).send({ date: D, categoryId: tea.id, mode: 'Cash', ...body });
    expect((await http().post('/api/expenses').set(auth(o)).send({ date: D, lines: [{ amt: '10' }] }).expect(400)).body.message).toBe('Choose a category.');
    expect((await add({ lines: [] }).expect(400)).body.message).toBe('Enter the amount spent.');
    expect((await add({ lines: [{ name: 'Tea', amt: '100' }, { name: 'Snacks', amt: '' }] }).expect(400)).body.message).toBe('Each line needs an amount. Remove empty lines.');
    const x = (await add({ payee: 'Sharma Tea Stall', lines: [{ name: 'Tea & snacks', qty: '1', rate: '640', amt: '640' }] }).expect(201)).body;
    expect(x).toMatchObject({ number: 'EXP-0001', total: '640.00', account: cash.id });
    expect((await accounts(o))[0]!.balance).toBe('9360.00');
    const book = (await http().get(`/api/banking/accounts/${cash.id}/book`).set(auth(o)).expect(200)).body;
    expect(book.entries[0]).toMatchObject({ kind: 'Expense · Tea & refreshments', party: 'Sharma Tea Stall', doc: 'EXP-0001', mode: 'Cash', amt: '-640.00' });
    const L = (await http().get('/api/expenses').set(auth(o)).expect(200)).body;
    expect(L[0]).toMatchObject({ number: 'EXP-0001', category: 'Tea & refreshments', payee: 'Sharma Tea Stall', total: '640.00', gst: '0.00', lines: [{ name: 'Tea & snacks', qty: '1', rate: '640.00', gst: 0, amt: '640.00' }] });
  });

  it('GST inside the amount is input credit (only with GST on); editing reposts; cancelling puts the money back', async () => {
    const o = await owner(app);
    await http().patch('/api/settings').set(auth(o)).send({ gstEnabled: true }).expect(200);
    const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
    const rep = (await cats(o)).find((c) => c.name === 'Repairs')!;
    const x = (await http().post('/api/expenses').set(auth(o)).send({ date: D, categoryId: rep.id, mode: 'UPI', reference: 'UPI 9932', payee: 'Cool Air Services', lines: [{ name: 'Shop AC servicing', qty: '1', rate: '2500', gst: '18', amt: '2950' }] }).expect(201)).body;
    expect(x.account).toBe(bank.id);
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body[0]).toMatchObject({ total: '2950.00', gst: '450.00' });
    expect((await accounts(o)).find((a) => a.id === bank.id)!.balance).toBe('47050.00');
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).send({ date: D, categoryId: rep.id, mode: 'UPI', payee: 'Cool Air Services', lines: [{ name: 'Shop AC servicing', amt: '3540', gst: '18' }] }).expect(200);
    expect((await accounts(o)).find((a) => a.id === bank.id)!.balance).toBe('46460.00');
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body[0]).toMatchObject({ number: 'EXP-0001', total: '3540.00', gst: '540.00' });
    await http().post(`/api/expenses/${x.id}/cancel`).set(auth(o)).expect(201);
    expect((await accounts(o)).find((a) => a.id === bank.id)!.balance).toBe('50000.00');
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body).toEqual([]);
  });

  it('cash-book money taken out for shop expenses, salary or bank charges is listed as an expense', async () => {
    const o = await owner(app);
    const cash = (await accounts(o))[0]!;
    await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '5000' }).expect(200);
    await http().post('/api/banking/entries').set(auth(o)).send({ date: D, kind: 'out', accountId: cash.id, amount: '650', category: 'Shop expense', note: 'Tea & snacks' }).expect(201);
    await http().post('/api/banking/entries').set(auth(o)).send({ date: D, kind: 'out', accountId: cash.id, amount: '100', category: 'Owner drawings' }).expect(201);
    const L = (await http().get('/api/expenses').set(auth(o)).expect(200)).body;
    expect(L).toEqual([expect.objectContaining({ src: 'bt', number: 'BT-0001', category: 'Shop expenses', payee: 'Tea & snacks', mode: 'Cash', total: '650.00' })]);
  });

  it('categories: add, rename (fixes every entry), the book’s own ones keep their names, unused ones can go', async () => {
    const o = await owner(app);
    const c = (await http().post('/api/expense-categories').set(auth(o)).send({ name: 'Generator diesel' }).expect(201)).body;
    expect((await http().post('/api/expense-categories').set(auth(o)).send({ name: 'generator DIESEL' }).expect(400)).body.message).toBe('generator DIESEL already exists');
    await http().post('/api/expenses').set(auth(o)).send({ date: D, categoryId: c.id, mode: 'Cash', lines: [{ amt: '900' }] }).expect(201);
    await http().put(`/api/expense-categories/${c.id}`).set(auth(o)).send({ name: 'Diesel for generator' }).expect(200);
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body[0].category).toBe('Diesel for generator');
    expect((await http().post(`/api/expense-categories/${c.id}/remove`).set(auth(o)).expect(400)).body.message).toBe('Diesel for generator is in use and can’t be removed.');
    const salary = (await cats(o)).find((x) => x.name === 'Salary & wages')!;
    expect((await http().put(`/api/expense-categories/${salary.id}`).set(auth(o)).send({ name: 'Wages' }).expect(400)).body.message).toBe('Also used by the cash and bank book, so it keeps this name');
    const other = (await cats(o)).find((x) => x.name === 'Advertising')!;
    await http().post(`/api/expense-categories/${other.id}/remove`).set(auth(o)).expect(201);
    expect((await cats(o)).some((x) => x.name === 'Advertising')).toBe(false);
  });

  it('a cheque expense waits with the cheques issued, not in the bank book; billing staff cannot record one', async () => {
    const o = await owner(app);
    await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201);
    const rent = (await cats(o)).find((c) => c.name === 'Rent')!;
    const x = (await http().post('/api/expenses').set(auth(o)).send({ date: D, categoryId: rent.id, mode: 'Cheque', reference: '004520', lines: [{ amt: '25000' }] }).expect(201)).body;
    expect((await accounts(o)).map((a) => a.balance)).toEqual(['0.00', '50000.00']);
    expect(x.number).toBe('EXP-0001');
    const staff = await member(app, o, 'billing_staff');
    await http().post('/api/expenses').set(auth(staff)).send({ date: D, categoryId: rent.id, mode: 'Cash', lines: [{ amt: '1' }] }).expect(403);
  });
});
