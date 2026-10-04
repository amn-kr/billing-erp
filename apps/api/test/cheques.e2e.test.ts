import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/** Cheques: pending until deposited / cleared or bounced; undo puts them back. */
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
async function shop() {
  const o = await owner(app);
  const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
  const mehta = (await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals', kind: 'customer', openingBalance: '25000', openingType: 'receive' }).expect(201)).body;
  const kc = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier', openingBalance: '48000', openingType: 'pay' }).expect(201)).body;
  return { o, bank, mehta, kc };
}
const cheques = async (o: S) => (await http().get('/api/banking/cheques').set(auth(o)).expect(200)).body as { id: string; dir: string; number: string; ref: string; party: string; amount: string; against: string; status: string; statusDate: string | null; charges: string; note: string }[];
const bankBal = async (o: S, id: string) => ((await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { id: string; balance: string }[]).find((a) => a.id === id)!.balance;
const partyBal = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;

describe('cheques', () => {
  it('a cheque received waits; deposited, the money lands in the bank and shows in its book', async () => {
    const { o, bank, mehta } = await shop();
    await http().post('/api/receipts').set(auth(o)).send({ partyId: mehta.id, date: D, amount: '5000', mode: 'Cheque', ref: '004512', allocations: [{ to: 'opening', amount: '5000' }] }).expect(201);
    const [c] = await cheques(o);
    expect(c).toMatchObject({ dir: 'in', number: 'PI-0001', ref: '004512', party: 'Mehta Electricals', amount: '5000.00', against: 'Opening balance', status: 'pending' });
    expect(await bankBal(o, bank.id)).toBe('50000.00');
    expect((await http().post(`/api/banking/cheques/${c!.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: '2026-10-03' }).expect(201)).body).toMatchObject({ ref: '004512', account: 'HDFC Bank', dir: 'in' });
    expect(await bankBal(o, bank.id)).toBe('55000.00');
    expect((await cheques(o))[0]).toMatchObject({ status: 'cleared', statusDate: '2026-10-03' });
    const book = (await http().get(`/api/banking/accounts/${bank.id}/book`).set(auth(o)).expect(200)).body;
    expect(book.entries.at(-1)).toMatchObject({ kind: 'Cheque deposited', party: 'Mehta Electricals', doc: 'PI-0001', mode: 'Cheque', ref: '004512', amt: '5000.00' });
    // undo: pending again, the money leaves the bank
    await http().post(`/api/banking/cheques/${c!.id}/undo`).set(auth(o)).expect(201);
    expect(await bankBal(o, bank.id)).toBe('50000.00');
    expect((await cheques(o))[0]!.status).toBe('pending');
  });

  it('a bounced cheque puts the amount back on the customer’s account; the bank’s charges come out of the bank', async () => {
    const { o, bank, mehta } = await shop();
    await http().post('/api/receipts').set(auth(o)).send({ partyId: mehta.id, date: D, amount: '5000', mode: 'Cheque', ref: '004512' }).expect(201);
    expect(await partyBal(o, mehta.id)).toBe('20000.00');
    const [c] = await cheques(o);
    await http().post(`/api/banking/cheques/${c!.id}/bounce`).set(auth(o)).send({ accountId: bank.id, date: '2026-10-04', charges: '250', note: 'Insufficient funds' }).expect(201);
    expect(await partyBal(o, mehta.id)).toBe('25000.00');
    expect(await bankBal(o, bank.id)).toBe('49750.00');
    expect((await cheques(o))[0]).toMatchObject({ status: 'bounced', charges: '250.00', note: 'Insufficient funds' });
    const book = (await http().get(`/api/banking/accounts/${bank.id}/book`).set(auth(o)).expect(200)).body;
    expect(book.entries.at(-1)).toMatchObject({ kind: 'Cheque bounce charges', amt: '-250.00' });
    expect((await http().post(`/api/banking/cheques/${c!.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(400)).body.message).toBe('This cheque is not pending.');
    await http().post(`/api/banking/cheques/${c!.id}/undo`).set(auth(o)).expect(201);
    expect([await partyBal(o, mehta.id), await bankBal(o, bank.id)]).toEqual(['20000.00', '50000.00']);
  });

  it('cheques issued to a supplier or for an expense leave the bank when cleared', async () => {
    const { o, bank, kc } = await shop();
    await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '10000', mode: 'Cheque', ref: '004890' }).expect(201);
    const rent = ((await http().get('/api/expense-categories').set(auth(o)).expect(200)).body as { id: string; name: string }[]).find((c) => c.name === 'Rent')!;
    await http().post('/api/expenses').set(auth(o)).send({ date: '2026-09-30', categoryId: rent.id, payee: 'R.K. Properties', mode: 'Cheque', reference: '004891', lines: [{ amt: '25000' }] }).expect(201);
    const L = await cheques(o);
    expect(L.map((c) => [c.dir, c.number, c.ref, c.party, c.against, c.status])).toEqual([['out', 'PO-0001', '004890', 'Kanpur Cables', '', 'pending'], ['out', 'EXP-0001', '004891', 'R.K. Properties', 'Rent', 'pending']]);
    for (const c of L) await http().post(`/api/banking/cheques/${c.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: '2026-10-04' }).expect(201);
    expect(await bankBal(o, bank.id)).toBe('15000.00');
    const book = (await http().get(`/api/banking/accounts/${bank.id}/book`).set(auth(o)).expect(200)).body;
    expect(book.entries.map((e: { kind: string; doc: string }) => [e.kind, e.doc])).toEqual([['Cheque cleared', 'PO-0001'], ['Cheque cleared', 'EXP-0001']]);
  });
});
