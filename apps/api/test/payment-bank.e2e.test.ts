import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/**
 * Bank account chosen on a payment (UPI, bank transfer, card): payment in, payment out, money
 * taken on a sale invoice and paid with a purchase bill land in the bank picked — the default bank
 * when none is picked. A payment ticked in Reconciliation can't be changed.
 */
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
interface Acc { id: string; kind: string; name: string; balance: string }
const accounts = async (o: S) => (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as Acc[];
const balances = async (o: S) => Object.fromEntries((await accounts(o)).map((a) => [a.name, a.balance]));
const book = async (o: S, id: string) => (await http().get(`/api/banking/accounts/${id}/book`).set(auth(o)).expect(200)).body as { balance: string; entries: { key: string; amt: string; kind: string; doc: string; mode: string }[] };
const line = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const bline = (it: { id: string; name: string }, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });

/** Cash, HDFC (the default bank) and SBI; a customer, a supplier and an item. */
async function shop() {
  const o = await owner(app);
  const add = async (body: object) => (await http().post('/api/banking/accounts').set(auth(o)).send(body).expect(201)).body as Acc;
  const hdfc = await add({ name: 'HDFC Bank', openingBalance: '1000' });
  const sbi = await add({ name: 'State Bank of India', openingBalance: '500' });
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', kind: 'customer', openingBalance: '20000', openingType: 'receive' }).expect(201)).body;
  const kc = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body;
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1000', purchase: '800', gstRate: 18, openingQty: '50' }).expect(201)).body;
  return { o, hdfc, sbi, verma, kc, fan };
}

describe('payment in', () => {
  it('UPI into the bank picked; nothing picked goes to the default bank; cash ignores a bank', async () => {
    const { o, hdfc, sbi, verma } = await shop();
    const pin = (body: object) => http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, ref: '', ...body }).expect(201);
    const a = (await pin({ amount: '700', mode: 'UPI', accountId: sbi.id })).body;
    await pin({ amount: '300', mode: 'Bank transfer' });
    await pin({ amount: '200', mode: 'Cash', accountId: sbi.id });
    await pin({ amount: '100', mode: 'Card', accountId: sbi.id });
    expect(await balances(o)).toEqual({ 'Cash in hand': '200.00', 'HDFC Bank': '1300.00', 'State Bank of India': '1300.00' });
    const b = await book(o, sbi.id);
    expect(b.entries.map((e) => [e.doc, e.amt, e.mode])).toEqual(expect.arrayContaining([[a.number, '700.00', 'UPI']]));
    expect((await book(o, hdfc.id)).entries.map((e) => e.amt)).toEqual(['300.00']);
    // the edit window shows the bank it went into
    expect((await http().get(`/api/receipts/${a.id}`).set(auth(o)).expect(200)).body).toMatchObject({ mode: 'UPI', accountId: sbi.id });
  });

  it('editing the bank moves the money between the two books', async () => {
    const { o, hdfc, sbi, verma } = await shop();
    const a = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '700', mode: 'UPI', accountId: sbi.id, ref: 'U1' }).expect(201)).body;
    await http().put(`/api/receipts/${a.id}`).set(auth(o)).send({ partyId: verma.id, date: D, amount: '700', mode: 'UPI', accountId: hdfc.id, ref: 'U1' }).expect(200);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1700.00', 'State Bank of India': '500.00' });
    expect((await book(o, sbi.id)).entries).toEqual([]);
  });

  it('a bank that is not this shop’s (or is removed) falls back to the default bank', async () => {
    const { o, verma } = await shop();
    const other = await shop();
    await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '50', mode: 'UPI', accountId: other.sbi.id, ref: '' }).expect(201);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1050.00', 'State Bank of India': '500.00' });
  });
});

describe('payment out', () => {
  it('bank transfer from the bank picked, and the edit window shows it', async () => {
    const { o, sbi, kc } = await shop();
    const p = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '400', mode: 'Bank transfer', accountId: sbi.id, ref: 'UTR9' }).expect(201)).body;
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1000.00', 'State Bank of India': '100.00' });
    expect((await http().get(`/api/payments-made/${p.id}`).set(auth(o)).expect(200)).body).toMatchObject({ mode: 'Bank transfer', accountId: sbi.id });
  });
});

describe('payments on an invoice and a bill', () => {
  it('each payment row goes to its own bank; reopening the invoice shows them', async () => {
    const { o, hdfc, sbi, verma, fan } = await shop();
    // 1 fan = 1000 + 18% = 1180
    const inv = (await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, pricesInclTax: false, lines: [line(fan, '1', '1000')], payments: [{ mode: 'UPI', amount: '680', ref: 'U7', accountId: sbi.id }, { mode: 'Card', amount: '500', ref: '', accountId: hdfc.id }] }).expect(201)).body;
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1500.00', 'State Bank of India': '1180.00' });
    const doc = (await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body;
    expect(doc.payment.splits).toEqual([{ mode: 'UPI', amount: '680.00', ref: 'U7', accountId: sbi.id }, { mode: 'Card', amount: '500.00', ref: '', accountId: hdfc.id }]);
  });

  it('money paid with a purchase bill comes out of the bank picked', async () => {
    const { o, sbi, kc, fan } = await shop();
    const b = (await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: kc.id, lines: [bline(fan, '1', '100')], payments: [{ mode: 'UPI', amount: '118', ref: '', accountId: sbi.id }] }).expect(201)).body;
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1000.00', 'State Bank of India': '382.00' });
    const doc = (await http().get(`/api/purchases/${b.id}`).set(auth(o)).expect(200)).body;
    expect(doc.settlements.filter((x: { atBill: boolean }) => x.atBill).map((x: { accountId: string }) => x.accountId)).toEqual([sbi.id]);
  });
});

describe('reconciliation', () => {
  const tick = async (o: S, accountId: string, key: string) =>
    http().put(`/api/banking/accounts/${accountId}/reconciliation`).set(auth(o)).send({ asOf: D, statement: '', ticked: [key] }).expect(200);
  const msg = 'This entry is ticked in Reconciliation for State Bank of India. Untick it there first, then change it.';

  it('a ticked payment in can’t be edited or deleted; unticked it can', async () => {
    const { o, hdfc, sbi, verma } = await shop();
    const body = { partyId: verma.id, date: D, amount: '700', mode: 'UPI', accountId: sbi.id, ref: 'U1' };
    const a = (await http().post('/api/receipts').set(auth(o)).send(body).expect(201)).body;
    await tick(o, sbi.id, (await book(o, sbi.id)).entries[0]!.key);
    expect((await http().get(`/api/receipts/${a.id}`).set(auth(o)).expect(200)).body.locked).toBe(msg);
    expect((await http().put(`/api/receipts/${a.id}`).set(auth(o)).send({ ...body, accountId: hdfc.id }).expect(400)).body.message).toBe(msg);
    expect((await http().post(`/api/receipts/${a.id}/delete`).set(auth(o)).send({}).expect(400)).body.message).toBe(msg);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1000.00', 'State Bank of India': '1200.00' });
    await http().put(`/api/banking/accounts/${sbi.id}/reconciliation`).set(auth(o)).send({ asOf: D, statement: '', ticked: [] }).expect(200);
    await http().put(`/api/receipts/${a.id}`).set(auth(o)).send({ ...body, accountId: hdfc.id }).expect(200);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1700.00', 'State Bank of India': '500.00' });
  });

  it('a ticked payment out can’t be edited', async () => {
    const { o, hdfc, sbi, kc } = await shop();
    const body = { partyId: kc.id, date: D, amount: '400', mode: 'Bank transfer', accountId: sbi.id, ref: 'UTR9' };
    const p = (await http().post('/api/payments-made').set(auth(o)).send(body).expect(201)).body;
    await tick(o, sbi.id, (await book(o, sbi.id)).entries[0]!.key);
    expect((await http().get(`/api/payments-made/${p.id}`).set(auth(o)).expect(200)).body.locked).toBe(msg);
    expect((await http().put(`/api/payments-made/${p.id}`).set(auth(o)).send({ ...body, accountId: hdfc.id }).expect(400)).body.message).toBe(msg);
  });

  it('an invoice whose ticked payment stays the same can still be edited (the tick stays); changing its bank is refused', async () => {
    const { o, hdfc, sbi, verma, fan } = await shop();
    const pay = [{ mode: 'UPI', amount: '1180', ref: 'U7', accountId: sbi.id }];
    const body = { date: D, dueDate: D, partyId: verma.id, pricesInclTax: false, lines: [line(fan, '1', '1000')], payments: pay };
    const inv = (await http().post('/api/sales').set(auth(o)).send(body).expect(201)).body;
    const key = (await book(o, sbi.id)).entries[0]!.key;
    await tick(o, sbi.id, key);
    await http().put(`/api/sales/${inv.id}`).set(auth(o)).send({ ...body, notes: 'Delivered' }).expect(200);
    expect((await book(o, sbi.id)).entries.map((e) => e.key)).toEqual([key]);
    expect((await http().put(`/api/sales/${inv.id}`).set(auth(o)).send({ ...body, payments: [{ ...pay[0], accountId: hdfc.id }] }).expect(400)).body.message).toBe(msg);
    expect((await http().put(`/api/sales/${inv.id}`).set(auth(o)).send({ ...body, payments: [] }).expect(400)).body.message).toBe(msg);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1000.00', 'State Bank of India': '1680.00' });
  });

  it('a bill whose ticked payment stays the same can still be edited; changing its bank is refused', async () => {
    const { o, hdfc, sbi, kc, fan } = await shop();
    const pay = [{ mode: 'UPI', amount: '118', ref: '', accountId: sbi.id }];
    const body = { kind: 'bill', date: D, dueDate: D, partyId: kc.id, lines: [bline(fan, '1', '100')], payments: pay };
    const b = (await http().post('/api/purchases').set(auth(o)).send(body).expect(201)).body;
    const key = (await book(o, sbi.id)).entries[0]!.key;
    await tick(o, sbi.id, key);
    await http().put(`/api/purchases/${b.id}`).set(auth(o)).send({ ...body, notes: 'Checked' }).expect(200);
    expect((await book(o, sbi.id)).entries.map((e) => e.key)).toEqual([key]);
    expect((await http().put(`/api/purchases/${b.id}`).set(auth(o)).send({ ...body, payments: [{ ...pay[0], accountId: hdfc.id }] }).expect(400)).body.message).toBe(msg);
    expect(await balances(o)).toMatchObject({ 'HDFC Bank': '1000.00', 'State Bank of India': '382.00' });
  });

  it('a walk-in invoice whose payment is ticked can’t be cancelled or deleted (its money would be refunded); unticked it can', async () => {
    const { o, sbi, fan } = await shop();
    const inv = (await http().post('/api/sales').set(auth(o)).send({ mode: 'cash', cashName: 'Counter', date: D, pricesInclTax: false, lines: [line(fan, '1', '1000')], payments: [{ mode: 'UPI', amount: '1180', ref: '', accountId: sbi.id }] }).expect(201)).body;
    const key = (await book(o, sbi.id)).entries[0]!.key;
    await tick(o, sbi.id, key);
    expect((await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({ reason: 'Typed twice' }).expect(400)).body.message).toBe(msg);
    expect((await http().post(`/api/sales/${inv.id}/delete`).set(auth(o)).send({ reason: 'Typed twice' }).expect(400)).body.message).toBe(msg);
    // nothing changed: the invoice is live, the money is still in the bank, the tick still fits
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.cancelled).toBeFalsy();
    expect((await book(o, sbi.id)).entries.map((e) => e.key)).toEqual([key]);
    expect(await balances(o)).toMatchObject({ 'State Bank of India': '1680.00' });
    await http().put(`/api/banking/accounts/${sbi.id}/reconciliation`).set(auth(o)).send({ asOf: D, statement: '', ticked: [] }).expect(200);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({ reason: 'Typed twice' }).expect(200);
    expect(await balances(o)).toMatchObject({ 'State Bank of India': '500.00' });
  });

  it('cancelling a customer’s invoice or a supplier’s bill keeps its ticked payment in the bank (kept as an advance), so the tick still fits', async () => {
    const { o, sbi, verma, kc, fan } = await shop();
    const inv = (await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, pricesInclTax: false, lines: [line(fan, '1', '1000')], payments: [{ mode: 'UPI', amount: '1180', ref: '', accountId: sbi.id }] }).expect(201)).body;
    const bill = (await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: kc.id, lines: [bline(fan, '1', '100')], payments: [{ mode: 'UPI', amount: '118', ref: '', accountId: sbi.id }] }).expect(201)).body;
    const keys = (await book(o, sbi.id)).entries.map((e) => e.key).sort();
    await http().put(`/api/banking/accounts/${sbi.id}/reconciliation`).set(auth(o)).send({ asOf: D, statement: '', ticked: keys }).expect(200);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({ reason: 'Wrong customer' }).expect(200);
    await http().post(`/api/purchases/${bill.id}/cancel`).set(auth(o)).send({ reason: 'Wrong supplier' }).expect(201);
    expect((await book(o, sbi.id)).entries.map((e) => e.key).sort()).toEqual(keys);
    expect(await balances(o)).toMatchObject({ 'State Bank of India': '1562.00' });
    expect((await http().get(`/api/banking/accounts/${sbi.id}/reconciliation`).set(auth(o)).expect(200)).body.ticked.sort()).toEqual(keys);
  });
});
