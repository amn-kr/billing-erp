/**
 * Expiry monitoring (Features › batch_expiry, owner's request, 2 Nov 2026): the Expiry Report, Batch Wise Sales And Profit,
 * and what a return to the supplier and a write-off do to stock, value and the ledger. Dates are fixed: the report is asked
 * for a day, so it doesn't change with the calendar.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const ON = '2026-10-01', D = '2026-09-01';
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
type It = { id: string; name: string };
let n = 0;
const features = (o: S, enabled: string[]) => http().put('/api/settings/features').set(auth(o)).send({ enabled }).expect(200);
async function shop(enabled = ['batch_expiry', 'mrp_pack']) {
  const o = await owner(app);
  await features(o, enabled);
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: `Ram Pharma ${++n}`, kind: 'supplier' }).expect(201)).body as { id: string; name: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: `Raju Stores ${n}` }).expect(201)).body as { id: string };
  return { o, sup, cust };
}
const item = async (o: S, extra: object = {}) => (await http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, trackBatch: true, sale: '100', ...extra }).expect(201)).body as It;
const buy = (o: S, sup: string, it: It, batchNo: string, expiry: string, qty = '10', rate = '10', extra: object = {}, date = D) => http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date, dueDate: date, partyId: sup, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [{ itemId: it.id, name: it.name, qty, unit: 'PCS', rate, discPct: '0', gstRate: '0', batchNo, expiry, ...extra }] }).expect(201);
const line = (it: It, qty: string, price: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, unit: 'PCS', price, discPct: '0', gstRate: '0', ...extra });
const sell = (o: S, party: string, lines: object[], date = D) => http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date, dueDate: date, mode: 'credit', partyId: party, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', payments: [], extra: {}, lines });
interface Row { id: string; no: string; item: string; expiry: string; qty: string; rate: string; value: string; supplier: string; supplierId: string | null; billId: string | null; billNo: string; packUnit: string }
const report = async (o: S, on = ON) => (await http().get(`/api/reports/expiry?today=${on}`).set(auth(o)).expect(200)).body as { writtenOff: string; rows: Row[] };
interface Sold { itemId: string; no: string; batchId: string | null; qty: string; sale: string; cost: string; profit: string; packUnit: string }
const sold = async (o: S, from = '2026-04-01', to = '2027-03-31') => (await http().get(`/api/reports/batch-sales?from=${from}&to=${to}`).set(auth(o)).expect(200)).body as Sold[];
const value = async (o: S, id: string) => ((await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as { stock: string; rateTable: { value: string } });

describe('Expiry Report', () => {
  it('every batch with stock and an expiry, earliest first, with the same value as the stock value and its supplier', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'LATE', '03/40', '5', '12');
    const bill = (await buy(o, sup.id, it, 'OLD', '09/26', '10', '10')).body as { id: string; number: string };
    const { rows } = await report(o);
    expect(rows.map((r) => r.no)).toEqual(['OLD', 'LATE']);
    expect(rows[0]).toMatchObject({ expiry: '2026-09-30', qty: '10.000', rate: '10.00', value: '100.00', supplier: sup.name, supplierId: sup.id, billId: bill.id, billNo: bill.number });
    expect(rows.reduce((a, r) => a + Number(r.value), 0).toFixed(2)).toBe((await value(o, it.id)).rateTable.value);
  });

  it('leaves out stock without a batch or expiry, batches with no stock, services and other shops’ batches', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '2', openingRate: '5', openingDate: D });
    await buy(o, sup.id, it, 'NOEXP', '', '3');
    await buy(o, sup.id, it, 'GONE', '11/26', '1');
    await sell(o, cust.id, [line(it, '6', '100')]).expect(201);
    expect((await report(o)).rows).toEqual([]);
    const other = await shop();
    expect((await report(other.o)).rows).toEqual([]);
  });

  it('the supplier is the latest bill’s; a cancelled bill doesn’t count; stock with no bill has none', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    const sup2 = (await http().post('/api/parties').set(auth(o)).send({ name: `Sun ${++n}`, kind: 'supplier' }).expect(201)).body as { id: string; name: string };
    await buy(o, sup.id, it, 'A1', '11/26');
    const late = (await buy(o, sup2.id, it, 'A1', '11/26', '1', '10', {}, '2026-09-10')).body as { id: string };
    expect((await report(o)).rows[0]!.supplier).toBe(sup2.name);
    await http().post(`/api/purchases/${late.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(201);
    expect((await report(o)).rows[0]!.supplier).toBe(sup.name);
    const added = await item(o);
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: added.id, mode: 'add', qty: '4', rate: '5', date: D, reason: 'Found', batchNo: 'X9', expiry: '11/26' }).expect(201);
    expect((await report(o)).rows.find((r) => r.no === 'X9')).toMatchObject({ supplier: '', supplierId: null, billId: null, value: '20.00' });
  });

  it('a batch is listed on its last day, and is expired the day after (the screen’s filters read the expiry)', async () => {
    const { o, sup } = await shop();
    await buy(o, sup.id, await item(o), 'E', '09/26');
    expect((await report(o, '2026-09-30')).rows[0]!.expiry).toBe('2026-09-30');
  });

  it('with the feature off: nothing; a report without the right is refused', async () => {
    const { o, sup } = await shop();
    await buy(o, sup.id, await item(o), 'E', '09/26');
    const staff = await member(app, o, 'billing_staff');
    await http().get(`/api/reports/expiry?today=${ON}`).set(auth(staff)).expect(403);
    await http().get('/api/reports/batch-sales?from=2026-04-01&to=2027-03-31').set(auth(staff)).expect(403);
    await features(o, []);
    expect(await report(o)).toEqual({ writtenOff: '0.00', rows: [] });
    expect(await sold(o)).toEqual([]);
    await features(o, ['batch_expiry']);
    expect((await report(o)).rows).toHaveLength(1);
  });
});

describe('returning a batch to the supplier', () => {
  const note = (o: S, sup: string, it: It, batchId: string, qty: string, rate: string, extra: object = {}, unit = 'PCS') => http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: ON, partyId: sup, reason: 'Expired goods', transport: '0', labour: '0', pricesInclTax: false, roundOff: false, ...extra, lines: [{ itemId: it.id, name: it.name, qty, unit, rate, discPct: '0', gstRate: '0', batchId }] });
  const bal = async (o: S, id: string) => Number(((await http().get('/api/parties').set(auth(o)).expect(200)).body as { id: string; balance: string }[]).find((p) => p.id === id)!.balance);

  it('takes it out of that batch at its cost, lowers the supplier’s balance, and keeps its reason; cancelling undoes all of it', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    const bill = (await buy(o, sup.id, it, 'A1', '09/26', '10', '10')).body as { id: string };
    await buy(o, sup.id, it, 'B2', '03/40', '10', '20');
    const r = (await report(o)).rows.find((x) => x.no === 'A1')!;
    const before = await bal(o, sup.id);
    const dn = (await note(o, sup.id, it, r.id, '10', '10', { againstId: bill.id }).expect(201)).body as { id: string; total: string };
    expect(dn.total).toBe('100.00');
    expect((await report(o)).rows.map((x) => x.no)).toEqual(['B2']);
    expect(await value(o, it.id)).toMatchObject({ stock: '10.000' });
    expect((await value(o, it.id)).rateTable.value).toBe('200.00');
    expect(Math.abs(await bal(o, sup.id) - before)).toBe(100);
    const saved = (await http().get(`/api/purchases/${dn.id}`).set(auth(o)).expect(200)).body as { reason: string; sourceId: string; lines: { batchId: string }[] };
    expect(saved).toMatchObject({ reason: 'Expired goods', sourceId: bill.id });
    expect(saved.lines[0]!.batchId).toBe(r.id);
    await http().post(`/api/purchases/${dn.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(201);
    expect((await report(o)).rows.map((x) => x.no)).toEqual(['A1', 'B2']);
    expect(await bal(o, sup.id)).toBe(before);
    const log = (await http().get('/api/audit?limit=100').set(auth(o)).expect(200)).body as { entity: string; action: string; entityId: string }[];
    expect(log.filter((e) => e.entityId === dn.id).map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'cancel']));
  });

  it('can’t return more than the batch has; profit on what was sold doesn’t change', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '11/26', '10', '10');
    await sell(o, cust.id, [line(it, '4', '50')]).expect(201);
    const r = (await report(o)).rows[0]!;
    expect((await note(o, sup.id, it, r.id, '7', '10').expect(400)).body.message).toContain('Only 6');
    const before = await sold(o);
    await note(o, sup.id, it, r.id, '6', '10').expect(201);
    expect(await sold(o)).toEqual(before);
  });

  it('a pack item: whole strips, or part of one loose', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { unit: 'TAB', packUnit: 'STRIP', packSize: '10' });
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [{ itemId: it.id, name: it.name, qty: '3', unit: 'STRIP', rate: '70', discPct: '0', gstRate: '0', batchNo: 'A1', expiry: '11/26' }] }).expect(201);
    const r = (await report(o)).rows[0]!;
    expect(r).toMatchObject({ qty: '30.000', rate: '70.00', value: '210.00', packUnit: 'STRIP' });
    await note(o, sup.id, it, r.id, '1', '70', {}, 'STRIP').expect(201);
    expect((await report(o)).rows[0]).toMatchObject({ qty: '20.000', value: '140.00' });
    await note(o, sup.id, it, r.id, '5', '7', {}, 'TAB').expect(201);
    expect((await report(o)).rows[0]).toMatchObject({ qty: '15.000', value: '105.00' });
  });
});

describe('writing off expired stock', () => {
  const off = (o: S, it: It, batchId: string, qty: string, rate: string, reason = 'Expired', date = ON) => http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'reduce', qty, rate, date, reason, batchId });

  it('takes it out of that batch; counted in Written off; no ledger entry; cancelling undoes it', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '09/26', '10', '10');
    await buy(o, sup.id, it, 'B2', '03/40', '10', '20');
    const r = (await report(o)).rows[0]!;
    const balance = async () => JSON.stringify((await http().get('/api/parties').set(auth(o)).expect(200)).body);
    const before = await balance();
    const a = (await off(o, it, r.id, '10', '10').expect(201)).body as { id: string; number: string };
    const after = await report(o);
    expect(after.writtenOff).toBe('100.00');
    expect(after.rows.map((x) => x.no)).toEqual(['B2']);
    expect((await value(o, it.id)).rateTable.value).toBe('200.00');
    expect(await balance()).toBe(before);
    await http().post(`/api/stock-adjustments/${a.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect((x) => { if (x.status >= 300) throw new Error(`${x.status} ${JSON.stringify(x.body)}`); });
    const back = await report(o);
    expect(back.writtenOff).toBe('0.00');
    expect(back.rows.map((x) => x.no)).toEqual(['A1', 'B2']);
    expect((await value(o, it.id)).rateTable.value).toBe('300.00');
  });

  it('only the reason Expired, only reductions, only this financial year count; part of a batch stays listed', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '09/26', '20', '10');
    const id = (await report(o)).rows[0]!.id;
    await off(o, it, id, '1', '10', 'Damaged').expect(201);
    await off(o, it, id, '2', '10').expect(201);
    expect(await report(o)).toMatchObject({ writtenOff: '20.00' });
    expect((await report(o)).rows[0]!.qty).toBe('17.000');
    expect((await report(o, '2027-04-01')).writtenOff).toBe('0.00');
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'add', qty: '1', rate: '10', date: ON, reason: 'Expired', batchNo: 'A1' }).expect(201);
    expect((await report(o)).writtenOff).toBe('20.00');
  });

  it('can’t write off more than the batch has; Billing staff can’t write off or return', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '09/26', '5', '10');
    const id = (await report(o)).rows[0]!.id;
    expect((await off(o, it, id, '6', '10').expect(400)).body.message).toContain('Only');
    const staff = await member(app, o, 'billing_staff');
    await off(staff, it, id, '1', '10').expect(403);
    await http().post('/api/purchases').set(auth(staff)).send({ kind: 'debit_note', date: ON, partyId: sup.id, reason: 'Expired goods', transport: '0', labour: '0', lines: [{ itemId: it.id, name: it.name, qty: '1', unit: 'PCS', rate: '10', discPct: '0', gstRate: '0', batchId: id }] }).expect(403);
  });
});

describe('Batch Wise Sales And Profit', () => {
  it('a line over two batches: quantity, value and cost for each, adding up to the bill and to Party wise Profit & Loss', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '11/26', '2', '10');
    await buy(o, sup.id, it, 'B2', '12/26', '10', '20');
    await sell(o, cust.id, [line(it, '3', '100')]).expect(201);
    const R = await sold(o);
    expect(R.map((r) => [r.no, r.qty, r.sale, r.cost, r.profit])).toEqual([['A1', '2.000', '200.00', '20.00', '180.00'], ['B2', '1.000', '100.00', '20.00', '80.00']]);
    const pl = (await http().get('/api/reports/party-activity?from=2026-04-01&to=2027-03-31').set(auth(o)).expect(200)).body as { id: string; tv: number; cost: number }[];
    const p = pl.find((x) => x.id === cust.id)!;
    expect(R.reduce((a, r) => a + Number(r.sale), 0)).toBe(p.tv);
    expect(R.reduce((a, r) => a + Number(r.cost), 0)).toBe(p.cost);
  });

  it('a return comes off its batch, at the value and cost it sold at; cancelled documents and other periods don’t count', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await buy(o, sup.id, it, 'A1', '11/26', '10', '10');
    const s = (await sell(o, cust.id, [line(it, '4', '50')]).expect(201)).body as { id: string };
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, reason: 'Damaged goods', settle: 'adjust', refundMode: 'Cash', lines: [{ invoiceId: s.id, itemId: it.id, qty: '1', price: '50', gstRate: '0' }] }).expect(201);
    expect((await sold(o))[0]).toMatchObject({ qty: '3.000', sale: '150.00', cost: '30.00', profit: '120.00' });
    expect(await sold(o, '2026-10-01', '2026-10-31')).toEqual([]);
    const other = (await sell(o, cust.id, [line(it, '2', '50')]).expect(201)).body as { id: string };
    expect((await sold(o))[0]).toMatchObject({ qty: '5.000' });
    await http().post(`/api/sales/${other.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(200);
    expect((await sold(o))[0]).toMatchObject({ qty: '3.000', sale: '150.00' });
  });

  it('value is before GST; a pack item is in the loose unit at the exact cost; untracked items aren’t listed; No batch is', async () => {
    const { o, sup, cust } = await shop();
    const gst = await item(o, { gstRate: 18 });
    await buy(o, sup.id, gst, 'G1', '11/26', '5', '10');
    await sell(o, cust.id, [line(gst, '1', '118', { gstRate: '18' })]).expect(201);
    const pack = await item(o, { unit: 'TAB', packUnit: 'STRIP', packSize: '15' });
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [{ itemId: pack.id, name: pack.name, qty: '1', unit: 'STRIP', rate: '100', discPct: '0', gstRate: '0', batchNo: 'P1', expiry: '11/26' }] }).expect(201);
    await sell(o, cust.id, [{ ...line(pack, '1', '150'), unit: 'STRIP' }]).expect(201);
    const plain = (await http().post('/api/items').set(auth(o)).send({ name: `Plain ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, sale: '10' }).expect(201)).body as It;
    await sell(o, cust.id, [line(plain, '1', '10')]).expect(201);
    const short = await item(o);
    await sell(o, cust.id, [line(short, '1', '10')]).expect(201);
    const R = await sold(o);
    expect(R.find((r) => r.itemId === gst.id)).toMatchObject({ sale: '100.00', cost: '10.00' });
    expect(R.find((r) => r.itemId === pack.id)).toMatchObject({ qty: '15.000', cost: '100.00', packUnit: 'STRIP' });
    expect(R.some((r) => r.itemId === plain.id)).toBe(false);
    expect(R.find((r) => r.itemId === short.id)).toMatchObject({ no: 'No batch', batchId: null, cost: '0.00' });
  });

  it('a period is required', async () => {
    const { o } = await shop();
    await http().get('/api/reports/batch-sales').set(auth(o)).expect(400);
  });
});
