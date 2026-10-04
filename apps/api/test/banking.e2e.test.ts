import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/** Banking & cash: accounts, each account's book, transfers, deposits, money in / out, cash count. */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
const accounts = async (o: S) => (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { id: string; kind: string; name: string; balance: string; isDefault: boolean; used: boolean }[];
const book = async (o: S, id: string) => (await http().get(`/api/banking/accounts/${id}/book`).set(auth(o)).expect(200)).body;
const move = (o: S, body: object) => http().post('/api/banking/entries').set(auth(o)).send({ date: D, ...body });

describe('accounts', () => {
  it('a new shop has cash in hand; banks are added, checked and the first takes UPI and bank transfers', async () => {
    const o = await owner(app);
    const [cash] = await accounts(o);
    expect(cash).toMatchObject({ kind: 'cash', name: 'Cash in hand', balance: '0.00' });
    const add = (body: object) => http().post('/api/banking/accounts').set(auth(o)).send(body);
    expect((await add({ name: '' }).expect(400)).body.message).toBe('Enter the bank name.');
    expect((await add({ name: 'HDFC Bank', accountNo: '12ab' }).expect(400)).body.message).toBe('Account number should be 6 to 18 digits.');
    expect((await add({ name: 'HDFC Bank', ifsc: 'HDFC123' }).expect(400)).body.message).toBe('IFSC looks wrong — it is 11 characters like HDFC0001234.');
    const h = (await add({ name: 'HDFC Bank', sub: 'Current account', accountNo: '50200012347703', ifsc: 'hdfc0001234', branch: 'Hazratganj', openingBalance: '325000', openingDate: '2026-09-01' }).expect(201)).body;
    const s = (await add({ name: 'State Bank of India', sub: 'Savings account', openingBalance: '118000' }).expect(201)).body;
    const L = await accounts(o);
    expect(L.map((a) => [a.name, a.balance, a.isDefault])).toEqual([['Cash in hand', '0.00', true], ['HDFC Bank', '325000.00', true], ['State Bank of India', '118000.00', false]]);
    // making SBI the default moves UPI there
    await http().put(`/api/banking/accounts/${s.id}`).set(auth(o)).send({ name: 'State Bank of India', sub: 'Savings account', openingBalance: '118000', isDefault: true }).expect(200);
    expect((await accounts(o)).filter((a) => a.isDefault).map((a) => a.name)).toEqual(['Cash in hand', 'State Bank of India']);
    // an account with no entries can be removed; one with entries cannot
    await move(o, { kind: 'in', accountId: h.id, amount: '500', category: 'Interest received' }).expect(201);
    expect((await http().post(`/api/banking/accounts/${h.id}/remove`).set(auth(o)).expect(400)).body.message).toBe('This account has entries. Move them first.');
    await http().post(`/api/banking/accounts/${s.id}/remove`).set(auth(o)).expect(201);
    expect((await accounts(o)).map((a) => [a.name, a.isDefault])).toEqual([['Cash in hand', true], ['HDFC Bank', true]]);
  });
});

describe('the money book', () => {
  it('cash received from a customer lands in cash in hand; UPI in the default bank', async () => {
    const o = await owner(app);
    const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '1000' }).expect(201)).body;
    const raju = (await http().post('/api/parties').set(auth(o)).send({ name: 'Raju Electrician', kind: 'customer', openingBalance: '5000', openingType: 'receive' }).expect(201)).body;
    await http().post('/api/receipts').set(auth(o)).send({ partyId: raju.id, date: D, amount: '1200', mode: 'Cash', ref: '' }).expect(201);
    await http().post('/api/receipts').set(auth(o)).send({ partyId: raju.id, date: D, amount: '800', mode: 'UPI', ref: 'UPI 7712' }).expect(201);
    const [cash] = await accounts(o);
    const cb = await book(o, cash!.id);
    expect(cb.balance).toBe('1200.00');
    expect(cb.entries).toEqual([expect.objectContaining({ date: D, amt: '1200.00', kind: 'Payment received', party: 'Raju Electrician', doc: 'PI-0001', mode: 'Cash', run: '1200.00' })]);
    const bb = await book(o, bank.id);
    expect(bb.entries[0]).toMatchObject({ amt: '800.00', mode: 'UPI', ref: 'UPI 7712', run: '1800.00' });
  });

  it('transfers, deposits and withdrawals move money between accounts; cash cannot go below zero', async () => {
    const o = await owner(app);
    const h = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
    const s = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'State Bank of India' }).expect(201)).body;
    const cash = (await accounts(o))[0]!;
    await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '45000' }).expect(200);
    expect((await move(o, { kind: 'transfer', fromId: h.id, toId: h.id, amount: '10' }).expect(400)).body.message).toBe('Choose two different accounts.');
    expect((await move(o, { kind: 'transfer', fromId: h.id, toId: s.id, amount: '0' }).expect(400)).body.message).toBe('Enter the amount.');
    expect((await move(o, { kind: 'deposit', fromId: cash.id, toId: h.id, amount: '50000' }).expect(400)).body.message).toBe('Only 45,000.00 cash in hand.');
    const t = (await move(o, { kind: 'transfer', fromId: h.id, toId: s.id, amount: '25000', reference: 'IMPS 66120', note: 'Moved to savings' }).expect(201)).body;
    expect(t.number).toBe('BT-0001');
    await move(o, { kind: 'deposit', fromId: cash.id, toId: h.id, amount: '40000', reference: 'Slip 2231' }).expect(201);
    await move(o, { kind: 'out', accountId: h.id, amount: '354', category: 'Bank charges', note: 'SMS & service charges' }).expect(201);
    expect((await accounts(o)).map((a) => [a.name, a.balance])).toEqual([['Cash in hand', '5000.00'], ['HDFC Bank', '64646.00'], ['State Bank of India', '25000.00']]);
    const hb = await book(o, h.id);
    expect(hb.entries.map((e: { kind: string; party: string; amt: string }) => [e.kind, e.party, e.amt])).toEqual([
      ['Cash deposited', 'From Cash in hand', '40000.00'], ['Transfer', 'To State Bank of India', '-25000.00'], ['Bank charges', 'SMS & service charges', '-354.00'],
    ]);
    // a cancelled entry no longer counts
    await http().post(`/api/banking/entries/${t.id}/cancel`).set(auth(o)).expect(201);
    expect((await accounts(o)).map((a) => a.balance)).toEqual(['5000.00', '89646.00', '0.00']);
    expect((await http().post(`/api/banking/entries/${t.id}/cancel`).set(auth(o)).expect(400)).body.message).toBe('Already cancelled');
  });

  it('counting cash saves the difference as cash excess or short', async () => {
    const o = await owner(app);
    const cash = (await accounts(o))[0]!;
    await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '2000' }).expect(200);
    expect((await http().post('/api/banking/count-cash').set(auth(o)).send({ counted: '2000', date: D }).expect(201)).body).toMatchObject({ match: true });
    expect((await http().post('/api/banking/count-cash').set(auth(o)).send({ counted: '1850', date: D }).expect(201)).body).toMatchObject({ match: false, diff: '-150.00', number: 'BT-0001' });
    const cb = await book(o, cash.id);
    expect(cb.entries[0]).toMatchObject({ kind: 'Cash short on count', party: 'Cash count', amt: '-150.00', run: '1850.00' });
  });

  it('reconciliation: starts on the last day of last month with nothing ticked; the ticks and balance are kept', async () => {
    const o = await owner(app);
    const h = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '1000' }).expect(201)).body;
    const r0 = (await http().get(`/api/banking/accounts/${h.id}/reconciliation`).set(auth(o)).expect(200)).body;
    expect(r0).toEqual({ asOf: '2026-09-30', statement: null, ticked: [] });
    await move(o, { kind: 'in', accountId: h.id, amount: '412', category: 'Interest received', date: '2026-09-29' }).expect(201);
    const line = (await book(o, h.id)).entries[0].key;
    await http().put(`/api/banking/accounts/${h.id}/reconciliation`).set(auth(o)).send({ asOf: '2026-09-30', statement: '1412', ticked: [line] }).expect(200);
    expect((await http().get(`/api/banking/accounts/${h.id}/reconciliation`).set(auth(o)).expect(200)).body).toEqual({ asOf: '2026-09-30', statement: '1412.00', ticked: [line] });
    await http().put(`/api/banking/accounts/${h.id}/reconciliation`).set(auth(o)).send({ asOf: '2026-10-31', statement: '', ticked: [] }).expect(200);
    expect((await http().get(`/api/banking/accounts/${h.id}/reconciliation`).set(auth(o)).expect(200)).body).toEqual({ asOf: '2026-10-31', statement: null, ticked: [] });
  });

  it('billing staff can see balances but not move money', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/banking/accounts').set(auth(staff)).expect(200);
    const cash = (await accounts(o))[0]!;
    await http().post('/api/banking/entries').set(auth(staff)).send({ date: D, kind: 'in', accountId: cash.id, amount: '10' }).expect(403);
  });
});
