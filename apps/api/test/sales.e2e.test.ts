import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/** Sales: invoices, payments, credit notes, challans, quotations — and what they do to dues, stock and the books. */
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
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540' }).expect(201)).body;
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200' }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000' }).expect(201)).body;
  return { o, fan, bulb, verma };
}
const line = (it: { id: string; name: string }, qty: string, price: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18', ...extra });
const sale = (o: S, body: object) => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, ...body });
const balanceOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;
const stockOf = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;

describe('sale invoice', () => {
  it('works out the totals itself, takes stock out and adds to the party’s dues', async () => {
    const { o, fan, bulb, verma } = await shop();
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(o)).expect(200)).body.number).toBe('INV-0001');
    const r = await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890'), line(bulb, '2', '95')], billDiscPct: '5', transport: '150', total: '1' }).expect(201);
    expect(r.body).toMatchObject({ number: 'INV-0001', total: '5717.00', received: '0.00', balance: '5717.00' });
    const inv = (await http().get(`/api/sales/${r.body.id}`).set(auth(o)).expect(200)).body;
    expect(inv).toMatchObject({ taxable: '4717.80', tax: '849.20', cgst: '424.60', sgst: '424.60', billDiscount: '293.00', placeOfSupply: '09', words: 'Rupees Five Thousand Seven Hundred Seventeen Only' });
    expect(inv.lines).toHaveLength(2);
    expect(await balanceOf(o, verma.id)).toBe('6717.00'); // opening 1000 + 5717
    expect(await stockOf(o, fan.id)).toBe('22.000');
    const list = (await http().get('/api/sales').set(auth(o)).expect(200)).body;
    expect(list[0]).toMatchObject({ number: 'INV-0001', partyName: 'Verma Traders', total: '5717.00', balance: '5717.00', cancelled: false });
  });

  it('refuses a bill the way the old app did', async () => {
    const { o, fan, verma } = await shop();
    const msg = async (body: object) => (await sale(o, body).expect(400)).body.message;
    expect(await msg({ lines: [line(fan, '1', '1890')] })).toBe('Choose who this bill is for. For a counter sale, switch to Cash.');
    expect(await msg({ partyId: verma.id, lines: [{ name: '', qty: '1', price: '0' }] })).toBe('Add at least one item.');
    expect(await msg({ partyId: verma.id, lines: [line(fan, '0', '1890')] })).toBe('Enter a quantity for “Ceiling fan 1200mm”.');
    expect(await msg({ partyId: verma.id, lines: [{ name: 'Mystery switch', qty: '1', price: '10' }] })).toBe('“Mystery switch” isn’t in your items. Pick it from the list or add it as a new item.');
    await sale(o, { partyId: verma.id, number: 'INV-0042', lines: [line(fan, '1', '1890')] }).expect(201);
    expect(await msg({ partyId: verma.id, number: 'INV-0042', lines: [line(fan, '1', '1890')] })).toBe('Invoice number INV-0042 is already used.');
    // a typed number moves the series past it
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(o)).expect(200)).body.number).toBe('INV-0043');
  });

  it('asks once before going over the credit limit', async () => {
    const { o, fan } = await shop();
    const p = (await http().post('/api/parties').set(auth(o)).send({ name: 'Small Shop', creditLimit: '2000' }).expect(201)).body;
    const body = { partyId: p.id, lines: [line(fan, '2', '1890')] };
    const r = await sale(o, body).expect(409);
    expect(r.body).toMatchObject({ code: 'over_credit_limit', message: 'This sale goes over the credit limit. Press Save again to save anyway.' });
    await sale(o, { ...body, confirmOverLimit: true }).expect(201);
  });

  it('money above the bill clears older dues first, the rest is an advance', async () => {
    const { o, fan, verma } = await shop();
    const r = await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')], payments: [{ mode: 'UPI', amount: '2500', ref: 'UTR1' }, { mode: 'Cash', amount: '1000' }] }).expect(201);
    expect(r.body).toMatchObject({ total: '1890.00', received: '1890.00', balance: '0.00', settledOld: '1000.00', advance: '610.00' });
    expect(await balanceOf(o, verma.id)).toBe('-610.00');
    const rc = (await http().get('/api/receipts').set(auth(o)).expect(200)).body;
    expect(rc[0]).toMatchObject({ number: 'PI-0001', amount: '3500.00', unused: '610.00', mode: 'UPI + Cash', against: 'INV-0001, Opening balance' });
    expect((await http().get(`/api/parties/${verma.id}/dues`).set(auth(o)).expect(200)).body).toEqual([]);
  });

  it('a walk-in sale records only the bill; extra is change', async () => {
    const { o, bulb } = await shop();
    const r = await sale(o, { mode: 'cash', cashName: '', lines: [line(bulb, '1', '95')], payments: [{ mode: 'Cash', amount: '100' }] }).expect(201);
    expect(r.body).toMatchObject({ total: '95.00', received: '95.00', balance: '0.00', change: '5.00' });
    const inv = (await http().get(`/api/sales/${r.body.id}`).set(auth(o)).expect(200)).body;
    expect(inv.partyName).toBe('Walk-in customer');
    expect(inv.payment).toMatchObject({ amount: '95.00', mode: 'Cash' });
  });

  it('editing replaces lines, stock and the payment taken with it', async () => {
    const { o, fan, verma } = await shop();
    const body = { partyId: verma.id, lines: [line(fan, '2', '1890')], payments: [{ mode: 'Cash', amount: '1000' }] };
    const r = await sale(o, body).expect(201);
    expect(await stockOf(o, fan.id)).toBe('23.000');
    const e = await http().put(`/api/sales/${r.body.id}`).set(auth(o)).send({ date: D, dueDate: D, ...body, number: 'INV-0001', lines: [line(fan, '1', '1890')], payments: [{ mode: 'Cash', amount: '1890' }] }).expect(200);
    expect(e.body).toMatchObject({ number: 'INV-0001', total: '1890.00', received: '1890.00', balance: '0.00' });
    expect(await stockOf(o, fan.id)).toBe('24.000');
    expect(await balanceOf(o, verma.id)).toBe('1000.00');
    const rc = (await http().get('/api/receipts').set(auth(o)).expect(200)).body;
    expect(rc).toHaveLength(1);
    expect(rc[0]).toMatchObject({ number: 'PI-0001', amount: '1890.00' });
  });

  it('cancel keeps the invoice, returns stock, and money received becomes an advance', async () => {
    const { o, fan, verma } = await shop();
    const r = await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')], payments: [{ mode: 'UPI', amount: '1000', ref: 'x' }] }).expect(201);
    const c = await http().post(`/api/sales/${r.body.id}/cancel`).set(auth(o)).send({}).expect(200);
    expect(c.body.movedToAdvance).toBe('1000.00');
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect(await balanceOf(o, verma.id)).toBe('0.00'); // opening 1000 − advance 1000
    const list = (await http().get('/api/sales').set(auth(o)).expect(200)).body;
    expect(list[0]).toMatchObject({ cancelled: true, balance: '0.00' });
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body[0].unused).toBe('1000.00');
    expect((await http().post(`/api/sales/${r.body.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toBe('Already cancelled');
    expect((await http().put(`/api/sales/${r.body.id}`).set(auth(o)).send({ date: D, partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(400)).body.message).toBe('INV-0001 is cancelled. It can’t be changed.');
    const hist = (await http().get(`/api/sales/${r.body.id}`).set(auth(o)).expect(200)).body.history.map((h: { action: string }) => h.action);
    expect(hist).toEqual(['create', 'cancel']);
  });

  it('billing staff can sell but not cancel', async () => {
    const { o, fan, verma } = await shop();
    const staff = await member(app, o, 'billing_staff');
    const r = await sale(staff as unknown as S, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201);
    await http().post(`/api/sales/${r.body.id}/cancel`).set(auth(staff)).send({}).expect(403);
  });
});

describe('payments received', () => {
  it('settles the invoices chosen; the rest is an advance', async () => {
    const { o, fan, verma } = await shop();
    const a = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const dues = (await http().get(`/api/parties/${verma.id}/dues`).set(auth(o)).expect(200)).body;
    expect(dues.map((d: { number: string; balance: string }) => [d.number, d.balance])).toEqual([['Opening balance', '1000.00'], ['INV-0001', '1890.00']]);
    const msg = async (b: object) => (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, mode: 'Cash', ...b }).expect(400)).body.message;
    expect(await msg({ amount: '0' })).toBe('Enter the amount received.');
    expect(await msg({ amount: '100', mode: 'Cheque' })).toBe('Enter the cheque number.');
    expect(await msg({ amount: '100', allocations: [{ to: a.id, amount: '500' }] })).toBe('The invoice amounts add up to more than the payment.');
    const r = await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, mode: 'Cheque', ref: '004512', amount: '2000', allocations: [{ to: a.id, amount: '1890' }] }).expect(201);
    expect(r.body.number).toBe('PI-0001');
    expect((await http().get(`/api/sales/${a.id}`).set(auth(o)).expect(200)).body.balance).toBe('0.00');
    expect(await balanceOf(o, verma.id)).toBe('890.00');
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body[0]).toMatchObject({ unused: '110.00', against: 'INV-0001', mode: 'Cheque', reference: '004512' });
  });
});

describe('credit notes', () => {
  it('adjusts the invoice due, brings stock back, and never returns more than was sold', async () => {
    const { o, fan, bulb, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890'), line(bulb, '10', '95', { discPct: '10' })] }).expect(201)).body;
    const ret = (await http().get(`/api/sales/${inv.id}/returnable`).set(auth(o)).expect(200)).body;
    expect(ret.map((l: { name: string; max: string; price: string }) => [l.name, l.max, l.price])).toEqual([['Ceiling fan 1200mm', '2.000', '1890.00'], ['LED bulb 9W', '10.000', '85.50']]);
    const cn = await http().post('/api/credit-notes').set(auth(o)).send({ partyId: verma.id, date: D, reason: 'Damaged goods', settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '1', price: '1890', gstRate: '18' }] }).expect(201);
    expect(cn.body).toMatchObject({ number: 'CN-0001', total: '1890.00' });
    expect(await stockOf(o, fan.id)).toBe('24.000');
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.balance).toBe('2745.00'); // 3780 + 855 − 1890
    expect(await balanceOf(o, verma.id)).toBe('3745.00');
    const again = await http().post('/api/credit-notes').set(auth(o)).send({ partyId: verma.id, date: D, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '2', price: '1890', gstRate: '18' }] }).expect(400);
    expect(again.body.message).toBe('Only 1 can be returned on INV-0001');
    const list = (await http().get('/api/credit-notes').set(auth(o)).expect(200)).body;
    expect(list[0]).toMatchObject({ number: 'CN-0001', against: ['INV-0001'], qty: '1.000', unused: '0.00', settle: 'adjust' });
  });

  it('counter sales can only be refunded', async () => {
    const { o, bulb } = await shop();
    const inv = (await sale(o, { mode: 'cash', lines: [line(bulb, '2', '95')], payments: [{ mode: 'Cash', amount: '190' }] }).expect(201)).body;
    const body = { partyId: null, date: D, lines: [{ invoiceId: inv.id, itemId: bulb.id, qty: '1', price: '95', gstRate: '18' }] };
    expect((await http().post('/api/credit-notes').set(auth(o)).send({ ...body, settle: 'adjust' }).expect(400)).body.message).toBe('Counter sales have no customer account. Choose “Refund now”.');
    await http().post('/api/credit-notes').set(auth(o)).send({ ...body, settle: 'refund', refundMode: 'Cash' }).expect(201);
  });
});

describe('challans and quotations', () => {
  it('a challan changes nothing until it is billed', async () => {
    const { o, fan, verma } = await shop();
    expect((await http().post('/api/challans').set(auth(o)).send({ date: D, lines: [] }).expect(400)).body.message).toBe('Enter the name.');
    const dc = (await http().post('/api/challans').set(auth(o)).send({ partyId: verma.id, date: D, lines: [{ itemId: fan.id, qty: '3' }], transport: 'Self' }).expect(201)).body;
    expect(dc.number).toBe('DC-0001');
    expect(await stockOf(o, fan.id)).toBe('25.000');
    await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')], fromChallanId: dc.id }).expect(201);
    const L = (await http().get('/api/sales?kind=challan').set(auth(o)).expect(200)).body;
    expect(L[0]).toMatchObject({ status: 'invoiced', invoiceNo: 'INV-0001', transport: 'Self', qty: '3.000' });
  });

  it('an item-wise quotation starts at Q-0101, moves no stock, and is marked converted when billed', async () => {
    const { o, fan, verma } = await shop();
    const q = (await sale(o, { kind: 'quotation', partyId: verma.id, lines: [line(fan, '2', '1890')], extra: { validTill: '2026-10-19' } }).expect(201)).body;
    expect(q).toMatchObject({ number: 'Q-0101', total: '3780.00' });
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect(await balanceOf(o, verma.id)).toBe('1000.00');
    await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')], fromQuotationIds: [q.id] }).expect(201);
    const L = (await http().get('/api/sales?kind=quotation').set(auth(o)).expect(200)).body;
    expect(L[0]).toMatchObject({ number: 'Q-0101', status: 'converted', invoiceNo: 'INV-0001' });
  });
});
