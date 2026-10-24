import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/** Purchases: bills, orders, debit notes, payments made — and what they do to stock, what you owe and the books. */
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
async function shop() {
  const o = await owner(app);
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '20' }).expect(201)).body;
  const wire = (await http().post('/api/items').set(auth(o)).send({ name: 'Copper wire 1.5 sq mm', sale: '1890', purchase: '1500', gstRate: 18 }).expect(201)).body;
  const kc = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier', gstin: '09AAACK1234L1Z5', creditDays: 30 }).expect(201)).body;
  return { o, bulb, wire, kc };
}
const line = (it: { id: string; name: string }, qty: string, rate: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18', ...extra });
const buy = (o: S, body: object) => http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: '2026-11-03', ...body });
const balanceOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;
const stockOf = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;

describe('purchase bill', () => {
  it('adds stock, adds to what you owe, takes a payment with it, and can update purchase prices', async () => {
    const { o, bulb, wire, kc } = await shop();
    expect((await http().get('/api/purchases/next-number?kind=bill').set(auth(o)).expect(200)).body.number).toBe('PB-0001');
    const r = await buy(o, { partyId: kc.id, supplierRef: 'KC/2209', lines: [line(bulb, '100', '58'), line(wire, '2', '1450')], transport: '150', payments: [{ mode: 'UPI', amount: '3000', ref: 'UPI 881' }], updatePrices: true }).expect(201);
    // 5800 + 2900 = 8700 taxable, GST 18% = 1566, + 150 transport = 10416
    expect(r.body).toMatchObject({ number: 'PB-0001', total: '10416.00', priceChanges: 2 });
    expect(await stockOf(o, bulb.id)).toBe('120.000');
    expect(await balanceOf(o, kc.id)).toBe('-7416.00'); // to pay
    const bills = (await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body;
    expect(bills[0]).toMatchObject({ number: 'PB-0001', supplierRef: 'KC/2209', total: '10416.00', paid: '3000.00', balance: '7416.00', partyName: 'Kanpur Cables' });
    expect((await http().get(`/api/items/${bulb.id}`).set(auth(o)).expect(200)).body.purchase).toBe('58.00');
    const pays = (await http().get('/api/payments-made').set(auth(o)).expect(200)).body;
    expect(pays[0]).toMatchObject({ number: 'PO-0001', amount: '3000.00', mode: 'UPI', bills: [{ number: 'PB-0001', amount: '3000.00' }], unused: '0.00' });
    const doc = (await http().get(`/api/purchases/${r.body.id}`).set(auth(o)).expect(200)).body;
    expect(doc).toMatchObject({ taxable: '8700.00', cgst: '783.00', sgst: '783.00', igst: '0.00', balance: '7416.00' });
    expect(doc.settlements).toEqual([{ kind: 'payment', number: 'PO-0001', date: D, mode: 'UPI', amount: '3000.00', ref: 'UPI 881', accountId: expect.any(String), atBill: true }]);
  });

  it('remembers the last rates from each supplier', async () => {
    const { o, bulb, kc } = await shop();
    await buy(o, { partyId: kc.id, date: '2026-09-20', lines: [line(bulb, '100', '58')] }).expect(201);
    await buy(o, { partyId: kc.id, date: '2026-09-30', lines: [line(bulb, '50', '60', { discPct: '5' })] }).expect(201);
    const h = (await http().get(`/api/purchases/price-history?item=${bulb.id}&party=${kc.id}`).set(auth(o)).expect(200)).body;
    expect(h).toEqual([{ date: '2026-09-30', number: 'PB-0002', qty: '50', price: '60.00', discPct: '5' }, { date: '2026-09-20', number: 'PB-0001', qty: '100', price: '58.00', discPct: '0' }]);
  });

  it('refuses a bill the way the old app did', async () => {
    const { o, bulb, kc } = await shop();
    expect((await buy(o, { partyId: kc.id, lines: [] }).expect(400)).body.message).toBe('Add at least one item.');
    expect((await buy(o, { partyId: kc.id, lines: [line(bulb, '0', '58')] }).expect(400)).body.message).toBe('Enter a quantity for “LED bulb 9W”.');
    expect((await buy(o, { partyId: kc.id, lines: [line(bulb, '5', '0')] }).expect(400)).body.message).toBe('Enter a rate for every item.');
    await buy(o, { partyId: kc.id, number: 'PB-0218', lines: [line(bulb, '5', '58')] }).expect(201);
    expect((await buy(o, { partyId: kc.id, number: 'PB-0218', lines: [line(bulb, '5', '58')] }).expect(400)).body.message).toBe('Number PB-0218 is already used.');
    // a typed number moves the series on
    expect((await http().get('/api/purchases/next-number?kind=bill').set(auth(o)).expect(200)).body.number).toBe('PB-0219');
  });

  it('a supplier in another state is charged IGST', async () => {
    const { o, bulb } = await shop();
    const dl = (await http().post('/api/parties').set(auth(o)).send({ name: 'Delhi Lights', kind: 'supplier', gstin: '07AABCD1234E1Z2' }).expect(201)).body;
    const r = await buy(o, { partyId: dl.id, lines: [line(bulb, '10', '50')] }).expect(201);
    expect((await http().get(`/api/purchases/${r.body.id}`).set(auth(o)).expect(200)).body).toMatchObject({ interState: true, igst: '90.00', cgst: '0.00', total: '590.00' });
  });
});

describe('purchase order', () => {
  it('changes nothing until converted to a bill; then it is received', async () => {
    const { o, bulb, kc } = await shop();
    const po = (await buy(o, { kind: 'order', partyId: kc.id, dueDate: '2026-10-09', lines: [line(bulb, '50', '58')] }).expect(201)).body;
    expect(po.number).toBe('ORD-0001');
    expect(await stockOf(o, bulb.id)).toBe('20.000');
    expect(await balanceOf(o, kc.id)).toBe('0.00');
    await buy(o, { partyId: kc.id, lines: [line(bulb, '50', '58')], fromOrderId: po.id }).expect(201);
    const orders = (await http().get('/api/purchases?kind=order').set(auth(o)).expect(200)).body;
    expect(orders[0]).toMatchObject({ number: 'ORD-0001', status: 'received', bill: 'PB-0001', total: '3422.00' });
    // an open order can be cancelled
    const po2 = (await buy(o, { kind: 'order', partyId: kc.id, lines: [line(bulb, '5', '58')] }).expect(201)).body;
    await http().post(`/api/purchases/${po2.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect((await http().get('/api/purchases?kind=order').set(auth(o)).expect(200)).body.find((x: { number: string }) => x.number === 'ORD-0002')).toMatchObject({ status: 'cancelled', cancelled: true });
  });
});

describe('debit note', () => {
  it('sends stock back and reduces the bill; never more than is in stock', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, { partyId: kc.id, lines: [line(bulb, '100', '50')] }).expect(201)).body; // 5900
    const dn = (await buy(o, { kind: 'debit_note', partyId: kc.id, againstId: b.id, reason: 'Damaged goods', lines: [line(bulb, '10', '50')] }).expect(201)).body; // 590
    expect(dn).toMatchObject({ number: 'DN-0001', total: '590.00' });
    expect(await stockOf(o, bulb.id)).toBe('110.000');
    expect(await balanceOf(o, kc.id)).toBe('-5310.00');
    expect((await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body[0]).toMatchObject({ balance: '5310.00', paid: '590.00' });
    expect((await http().get('/api/purchases?kind=debit_note').set(auth(o)).expect(200)).body[0]).toMatchObject({ number: 'DN-0001', against: b.number, reason: 'Damaged goods', qty: '10.000', balance: '0.00' });
    // a return against no bill is kept as credit with the supplier
    await buy(o, { kind: 'debit_note', partyId: kc.id, reason: 'Extra quantity', lines: [line(bulb, '1', '50')] }).expect(201);
    expect((await http().get('/api/purchases?kind=debit_note').set(auth(o)).expect(200)).body[0]).toMatchObject({ number: 'DN-0002', balance: '59.00' });
    expect((await buy(o, { kind: 'debit_note', partyId: kc.id, lines: [line(bulb, '500', '50')] }).expect(400)).body.message).toBe('Only 109 PCS of “LED bulb 9W” in stock to return.');
  });
});

describe("the party's transactions (Parties page)", () => {
  it("show the supplier's own number on bills and debit notes; other rows, other parties and other shops never get it", async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, { partyId: kc.id, supplierRef: 'KC/2209', lines: [line(bulb, '10', '50')] }).expect(201)).body;
    await buy(o, { partyId: kc.id, date: '2026-10-05', lines: [line(bulb, '5', '50')] }).expect(201); // no supplier number
    await buy(o, { kind: 'debit_note', partyId: kc.id, date: '2026-10-06', supplierRef: 'KC/DN-7', againstId: b.id, reason: 'Damaged goods', lines: [line(bulb, '1', '50')] }).expect(201);
    await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: '2026-10-07', amount: '100', mode: 'Cash', ref: '' }).expect(201);
    const tx = (await http().get(`/api/reports/party-tx/${kc.id}`).set(auth(o)).expect(200)).body as Record<string, string>[];
    expect(tx.map((t) => [t.type, t.no, t.supplierRef])).toEqual([
      ['Payment-Out', 'PO-0001', undefined], ['Debit note', 'DN-0001', 'KC/DN-7'], ['Purchase', 'PB-0002', undefined], ['Purchase', 'PB-0001', 'KC/2209'],
    ]);
    // rows without a supplier number keep exactly the old fields
    for (const t of [tx[0], tx[2]]) expect(Object.keys(t!).sort()).toEqual(['bal', 'date', 'due', 'no', 'total', 'type']);
    expect(tx[3]).toEqual({ type: 'Purchase', no: 'PB-0001', date: D, total: '590.00', bal: '531.00', due: '2026-11-03', supplierRef: 'KC/2209' });

    // a customer's sale rows are unchanged
    const cu = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
    await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: cu.id, lines: [{ itemId: bulb.id, name: bulb.name, qty: '1', price: '95', discPct: '0', gstRate: '18' }] }).expect(201);
    const ctx = (await http().get(`/api/reports/party-tx/${cu.id}`).set(auth(o)).expect(200)).body as Record<string, string>[];
    expect(ctx.map((t) => t.type)).toEqual(['Sale']);
    expect(Object.keys(ctx[0]!).sort()).toEqual(['bal', 'date', 'due', 'no', 'total', 'type']);

    // another shop never sees this supplier or its numbers
    const other = await owner(app);
    const r = await http().get(`/api/reports/party-tx/${kc.id}`).set(auth(other)).expect(404);
    expect(JSON.stringify(r.body)).not.toContain('KC/');
  });
});

describe('payments made', () => {
  it('settles the bills chosen, keeps the rest as an advance, and a cheque needs its number', async () => {
    const { o, bulb, kc } = await shop();
    const b1 = (await buy(o, { partyId: kc.id, lines: [line(bulb, '10', '50')] }).expect(201)).body; // 590
    const b2 = (await buy(o, { partyId: kc.id, lines: [line(bulb, '20', '50')] }).expect(201)).body; // 1180
    expect((await http().get(`/api/parties/${kc.id}/unpaid-bills`).set(auth(o)).expect(200)).body.map((x: { number: string }) => x.number)).toEqual(['PB-0001', 'PB-0002']);
    const pay = (body: object) => http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, mode: 'Bank transfer', ref: 'NEFT 1', ...body });
    expect((await pay({ amount: '0' }).expect(400)).body.message).toBe('Enter the amount paid.');
    expect((await pay({ amount: '500', mode: 'Cheque', ref: '' }).expect(400)).body.message).toBe('Enter the cheque number.');
    expect((await pay({ amount: '500', allocations: [{ to: b1.id, amount: '590' }] }).expect(400)).body.message).toBe('The bill amounts add up to more than the payment.');
    const p = (await pay({ amount: '1000', allocations: [{ to: b1.id, amount: '590' }] }).expect(201)).body;
    expect(p).toMatchObject({ number: 'PO-0001', amount: '1000.00' });
    expect((await http().get('/api/payments-made').set(auth(o)).expect(200)).body[0]).toMatchObject({ bills: [{ number: 'PB-0001', amount: '590.00' }], unused: '410.00' });
    expect(await balanceOf(o, kc.id)).toBe('-770.00'); // 1770 − 1000
    await pay({ amount: '200', mode: 'Cheque', ref: '004512', allocations: [{ to: b2.id, amount: '200' }] }).expect(201);
    expect((await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body.map((x: { number: string; balance: string }) => [x.number, x.balance])).toEqual([['PB-0002', '980.00'], ['PB-0001', '0.00']]);
  });
});

describe('cancelling', () => {
  it('a cancelled bill puts stock back, owes nothing, and money paid with it becomes an advance', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, { partyId: kc.id, lines: [line(bulb, '10', '50')], payments: [{ mode: 'Cash', amount: '200', ref: '' }] }).expect(201)).body;
    expect(await stockOf(o, bulb.id)).toBe('30.000');
    await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({ reason: 'Wrong supplier' }).expect(201);
    expect(await stockOf(o, bulb.id)).toBe('20.000');
    expect(await balanceOf(o, kc.id)).toBe('200.00'); // advance with the supplier
    expect((await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body[0]).toMatchObject({ cancelled: true, balance: '0.00' });
    expect((await http().get('/api/payments-made').set(auth(o)).expect(200)).body[0].unused).toBe('200.00');
    expect((await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toBe('Already cancelled');
  });

  it('billing staff cannot see or record purchases', async () => {
    const { o, bulb, kc } = await shop();
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/purchases?kind=bill').set(auth(staff)).expect(403);
    await buy(staff as unknown as S, { partyId: kc.id, lines: [line(bulb, '1', '50')] }).expect(403);
  });
});
