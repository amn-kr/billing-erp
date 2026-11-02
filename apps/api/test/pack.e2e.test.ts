/**
 * Pack and loose (Features › mrp_pack, owner's request, 2 Nov 2026): stock is counted in the loose unit, prices and MRP are
 * per pack, a line keeps its own unit. Every place that reads a line's quantity is checked here.
 */
import type { INestApplication } from '@nestjs/common';
import { todayIst } from '@billing/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = todayIst();
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
type It = { id: string; name: string };
let n = 0;
const features = (o: S, enabled: string[]) => http().put('/api/settings/features').set(auth(o)).send({ enabled }).expect(200);
async function shop(enabled = ['batch_expiry', 'mrp_pack']) {
  const o = await owner(app);
  await features(o, enabled);
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: `Ram Pharma ${++n}`, kind: 'supplier' }).expect(201)).body as { id: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: `Raju Stores ${n}` }).expect(201)).body as { id: string };
  return { o, sup, cust };
}
const newItem = (o: S, extra: object = {}) => http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'TAB', packUnit: 'STRIP', packSize: '10', gstRate: 0, sale: '100', mrp: '120', ...extra });
const item = async (o: S, extra: object = {}) => (await newItem(o, extra).expect(201)).body as It;
const pl = (it: It, qty: string, rate: string, unit = 'STRIP', extra: object = {}) => ({ itemId: it.id, name: it.name, qty, unit, rate, discPct: '0', gstRate: '0', ...extra });
const purchase = (o: S, sup: string, kind: string, lines: object[], extra: object = {}) => http().post('/api/purchases').set(auth(o)).send({ kind, date: D, ...(kind === 'debit_note' ? { reason: 'Damaged goods' } : { dueDate: D }), partyId: sup, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines, ...extra });
const line = (it: It, qty: string, unit: string, price: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, unit, price, discPct: '0', gstRate: '0', ...extra });
const body = (party: string, lines: object[], extra: object = {}) => ({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: party, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', payments: [], extra: {}, ...extra, lines });
const sell = (o: S, party: string, lines: object[], extra: object = {}) => http().post('/api/sales').set(auth(o)).send(body(party, lines, extra));
const credit = (o: S, party: string, lines: object[]) => http().post('/api/credit-notes').set(auth(o)).send({ partyId: party, date: D, reason: 'Damaged goods', settle: 'adjust', refundMode: 'Cash', lines });
interface Card { stock: string; purchase: string; packUnit: string; packSize: string | null; hasStockHistory: boolean; rateTable: { avgRate: string; value: string; layers: { rate: string; qty: string }[] }; batches: { rows: { id: string | null; no: string; qty: string; rate: string; value: string; mrp: string | null }[] } | null; movements: { qty: number; rate: number; type: string }[] }
const card = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as Card;

describe('setting up an item', () => {
  it('saves the pack; the view gives it back, and refuses a bad one', async () => {
    const { o } = await shop();
    const it = (await newItem(o).expect(201)).body;
    expect(it).toMatchObject({ unit: 'TAB', packUnit: 'STRIP', packSize: '10.000', sale: '100.00', mrp: '120.00' });
    expect((await newItem(o, { packUnit: 'TAB' }).expect(400)).body.message).toContain('must be different');
    expect((await newItem(o, { packSize: '1' }).expect(400)).body.message).toContain('more than 1');
    expect((await newItem(o, { packSize: '' }).expect(400)).body.message).toContain('more than 1');
    expect((await newItem(o, { kind: 'service' }).expect(400)).body.message).toContain('service');
  });

  it('only an item with no stock history can change; the same set-up sent again is no change', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ packUnit: 'BOX', packSize: '20' }).expect(200);
    expect(await card(o, it.id)).toMatchObject({ packUnit: 'BOX', packSize: '20.000', hasStockHistory: false });
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ packUnit: 'STRIP', packSize: '10' }).expect(200);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70')]).expect(201);
    expect((await card(o, it.id)).hasStockHistory).toBe(true);
    for (const change of [{ packUnit: 'STRIP', packSize: '15' }, { packUnit: 'BOX', packSize: '10' }, { packUnit: '' }, { unit: 'CAP' }]) {
      expect((await http().patch(`/api/items/${it.id}`).set(auth(o)).send(change).expect(400)).body.message).toContain('already has stock history');
    }
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ name: `Renamed ${n}`, packUnit: 'STRIP', packSize: '10', unit: 'TAB' }).expect(200);
    // an ordinary item with stock can't become one either
    const old = (await http().post('/api/items').set(auth(o)).send({ name: `Old ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0 }).expect(201)).body as It;
    await purchase(o, sup.id, 'bill', [pl(old, '1', '70', 'PCS')]).expect(201);
    expect((await http().patch(`/api/items/${old.id}`).set(auth(o)).send({ packUnit: 'BOX', packSize: '10' }).expect(400)).body.message).toContain('already has stock history');
  });

  it('with the feature off the pack sent is ignored, and is kept when it was set', async () => {
    const { o } = await shop(['batch_expiry']);
    const off = (await newItem(o).expect(201)).body;
    expect(off.packUnit).toBe('');
    await features(o, ['batch_expiry', 'mrp_pack']);
    const it = await item(o);
    await features(o, ['batch_expiry']);
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ packUnit: '' }).expect(200);
    expect((await card(o, it.id)).packUnit).toBe('STRIP');
  });

  it('the change is in the audit log', async () => {
    const { o } = await shop();
    const it = await item(o);
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ packUnit: 'BOX', packSize: '20' }).expect(200);
    const log = (await http().get('/api/audit?limit=50').set(auth(o)).expect(200)).body as { entity: string; action: string; entityId: string; after: { changes?: unknown } }[];
    expect(JSON.stringify(log.find((e) => e.entity === 'item' && e.action === 'update' && e.entityId === it.id)!.after.changes)).toContain('BOX');
  });

  it('opening stock is in the loose unit at a price per pack', async () => {
    const { o } = await shop();
    const it = await item(o, { packSize: '15', openingQty: '30', openingRate: '100', openingDate: D });
    expect(await card(o, it.id)).toMatchObject({ stock: '30.000', purchase: '100.00' });
    const c = await card(o, it.id);
    expect(c.rateTable).toMatchObject({ value: '200.00', avgRate: '100.00' });
    expect(c.rateTable.layers[0]!.rate).toBe('100.00');
  });
});

describe('buying', () => {
  it('a bill in packs: stock in the loose unit, the price per pack, the value exact', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { packSize: '15', sale: '150' });
    const bill = (await purchase(o, sup.id, 'bill', [pl(it, '3', '100')]).expect(201)).body as { id: string };
    expect(await card(o, it.id)).toMatchObject({ stock: '45.000', purchase: '100.00' });
    expect((await card(o, it.id)).rateTable).toMatchObject({ value: '300.00', avgRate: '100.00' });
    const doc = (await http().get(`/api/purchases/${bill.id}`).set(auth(o)).expect(200)).body as { lines: { qty: string; unit: string; packSize: string; rate: string }[] };
    expect(doc.lines[0]).toMatchObject({ qty: '3.000', unit: 'STRIP', packSize: '15.000', rate: '100.00' });
    const list = (await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body as { qty: string }[];
    expect(list[0]!.qty).toBe('45.000');
  });

  it('a bill loose: its own quantity, the price still per pack', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '5', '7', 'TAB')]).expect(201);
    expect(await card(o, it.id)).toMatchObject({ stock: '5.000', purchase: '70.00' });
  });

  it('editing a bill from packs to more packs moves the difference; cancelling puts it all back', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    const b = (await purchase(o, sup.id, 'bill', [pl(it, '2', '70')]).expect(201)).body as { id: string };
    await http().put(`/api/purchases/${b.id}`).set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [pl(it, '3', '70')] }).expect(200);
    expect((await card(o, it.id)).stock).toBe('30.000');
    await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(201);
    expect((await card(o, it.id)).stock).toBe('0.000');
  });

  it('a debit note in packs takes that many packs’ worth, and no more than is in stock', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '3', '70')]).expect(201);
    expect((await purchase(o, sup.id, 'debit_note', [pl(it, '4', '70')]).expect(400)).body.message).toContain('Only 30 TAB');
    await purchase(o, sup.id, 'debit_note', [pl(it, '1', '70')]).expect(201);
    expect((await card(o, it.id)).stock).toBe('20.000');
    expect((await card(o, it.id)).rateTable.value).toBe('140.00');
  });

  it('a tracked item’s debit note can’t take more than the batch has, counted in the loose unit', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { trackBatch: true });
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70', 'STRIP', { batchNo: 'A1', expiry: '03/40' })]).expect(201);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70', 'STRIP', { batchNo: 'B2', expiry: '03/41' })]).expect(201);
    const a1 = (await card(o, it.id)).batches!.rows.find((r) => r.no === 'A1')!;
    expect(a1).toMatchObject({ qty: '10.000', rate: '70.00', value: '70.00' });
    expect((await purchase(o, sup.id, 'debit_note', [pl(it, '2', '70', 'STRIP', { batchId: a1.id })]).expect(400)).body.message).toContain('in batch A1');
    await purchase(o, sup.id, 'debit_note', [pl(it, '5', '7', 'TAB', { batchId: a1.id })]).expect(201);
    expect((await card(o, it.id)).batches!.rows.find((r) => r.no === 'A1')!.qty).toBe('5.000');
  });

  it('a purchase order moves no stock and keeps its unit', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    const po = (await purchase(o, sup.id, 'order', [pl(it, '4', '70')]).expect(201)).body as { id: string };
    expect((await card(o, it.id)).stock).toBe('0.000');
    expect(((await http().get(`/api/purchases/${po.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string; packSize: string }[] }).lines[0]).toMatchObject({ unit: 'STRIP', packSize: '10.000' });
  });
});

describe('selling', () => {
  it('in packs and loose: the stock, the totals, the cost, and the list', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { packSize: '15' });
    await purchase(o, sup.id, 'bill', [pl(it, '3', '100')]).expect(201);
    const s1 = (await sell(o, cust.id, [line(it, '2', 'STRIP', '100')]).expect(201)).body as { id: string; total: string };
    expect(s1.total).toBe('200.00');
    expect((await card(o, it.id)).stock).toBe('15.000');
    const s2 = (await sell(o, cust.id, [line(it, '7', 'TAB', '6.67')]).expect(201)).body as { id: string; total: string };
    expect(s2.total).toBe('46.69');
    expect((await card(o, it.id)).stock).toBe('8.000');
    const doc = (await http().get(`/api/sales/${s1.id}`).set(auth(o)).expect(200)).body as { lines: { qty: string; unit: string; packSize: string | null; mrp: string; batchUnit: string }[] };
    expect(doc.lines[0]).toMatchObject({ qty: '2.000', unit: 'STRIP', packSize: '15.000', mrp: '120.00', batchUnit: 'TAB' });
    const loose = (await http().get(`/api/sales/${s2.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string; packSize: string | null; mrp: string }[] };
    expect(loose.lines[0]).toMatchObject({ unit: 'TAB', packSize: null, mrp: '8.00' });
    const list = (await http().get('/api/sales?kind=invoice').set(auth(o)).expect(200)).body as { number: string; qty: string; id: string }[];
    expect(list.find((x) => x.id === s1.id)!.qty).toBe('30.000');
    // what is left + what was sold = what was bought
    expect((await card(o, it.id)).rateTable.value).toBe('53.33');
    const cost = (await http().post('/api/sales/cost').set(auth(o)).send({ id: s1.id, date: D, lines: [{ itemId: it.id, qty: '30' }] }).expect(200)).body as { lines: { cost: string }[] };
    expect(cost.lines[0]!.cost).toBe('200.00');
  });

  it('a unit that is neither counts as the item’s own; Quick sale’s loose line is ordinary', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70')]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '3', 'KG', '10')]).expect(201)).body as { id: string };
    expect(((await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string; packSize: string | null }[] }).lines[0]).toMatchObject({ unit: 'TAB', packSize: null });
    expect((await card(o, it.id)).stock).toBe('7.000');
  });

  it('editing and cancelling put back exactly what the line moved', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70')]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '2', 'STRIP', '100')]).expect(201)).body as { id: string };
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '3', 'TAB', '10')])).expect(200);
    expect((await card(o, it.id)).stock).toBe('47.000');
    await http().post(`/api/sales/${s.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(200);
    expect((await card(o, it.id)).stock).toBe('50.000');
  });

  it('batches are held in the loose unit: a strip can use two batches; a hand choice must add up in loose', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true });
    await purchase(o, sup.id, 'bill', [pl(it, '6', '7', 'TAB', { batchNo: 'A1', expiry: '03/40' })]).expect(201);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70', 'STRIP', { batchNo: 'B2', expiry: '03/41' })]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '1', 'STRIP', '100')]).expect(201)).body as { id: string };
    const d = (await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body as { lines: { batches: { no: string; qty: string }[] }[] };
    expect(d.lines[0]!.batches.map((b) => `${b.no} ${b.qty}`)).toEqual(['A1 6.000', 'B2 4.000']);
    const b2 = (await card(o, it.id)).batches!.rows.find((r) => r.no === 'B2')!;
    expect((await sell(o, cust.id, [line(it, '1', 'STRIP', '100', { batches: [{ batchId: b2.id, qty: '1' }] })]).expect(400)).body.message).toContain('add up to 1');
    await sell(o, cust.id, [line(it, '0.5', 'STRIP', '100', { batches: [{ batchId: b2.id, qty: '5' }] })]).expect(201);
    expect((await card(o, it.id)).batches!.rows.find((r) => r.no === 'B2')!.qty).toBe('1.000');
  });

  it('with the feature off a saved pack item still moves the right stock', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70')]).expect(201);
    await features(o, ['batch_expiry']);
    const s = (await sell(o, cust.id, [line(it, '3', 'TAB', '10')]).expect(201)).body as { id: string };
    expect((await card(o, it.id)).stock).toBe('47.000');
    expect(((await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string }[] }).lines[0]!.unit).toBe('TAB');
    // back on: everything is still there
    await features(o, ['batch_expiry', 'mrp_pack']);
    expect(await card(o, it.id)).toMatchObject({ packUnit: 'STRIP', purchase: '70.00' });
  });
});

describe('MRP in a pack item', () => {
  it('a pack line is compared with the MRP, a loose line with its share; the batch’s MRP counts; rounding is no false alarm', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { sale: '140', trackBatch: true });
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70', 'STRIP', { batchNo: 'A1', expiry: '03/40', batchMrp: '125' })]).expect(201);
    await sell(o, cust.id, [line(it, '1', 'STRIP', '125')]).expect(201);
    const over = (await sell(o, cust.id, [line(it, '1', 'STRIP', '125.01')]).expect(409)).body;
    expect(over).toMatchObject({ code: 'above_mrp' });
    expect(over.overMrp[0]).toMatchObject({ rate: '125.01', mrp: '125.00' });
    await sell(o, cust.id, [line(it, '1', 'TAB', '12.50')]).expect(201);
    expect((await sell(o, cust.id, [line(it, '1', 'TAB', '12.51')]).expect(409)).body.overMrp[0]).toMatchObject({ rate: '12.51', mrp: '12.50' });
    const seven = await item(o, { packSize: '7', sale: '100', mrp: '100' });
    await purchase(o, sup.id, 'bill', [pl(seven, '1', '70')]).expect(201);
    // 100 ÷ 7 = 14.29: 7 × 14.29 is more than 100, and that isn't above MRP
    await sell(o, cust.id, [line(seven, '1', 'TAB', '14.29')]).expect(201);
  });

  it('an edit at the same rate isn’t asked again, in either unit', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { sale: '140' });
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70')]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '1', 'STRIP', '130')], { confirmAboveMrp: true }).expect(201)).body as { id: string };
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '2', 'STRIP', '130')])).expect(200);
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '4', 'TAB', '13')])).expect(200);
    expect((await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '2', 'STRIP', '135')])).expect(409)).body.code).toBe('above_mrp');
  });
});

describe('returning', () => {
  it('worked out in the loose unit: part of a strip comes back at the loose rate; no more than was sold', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true });
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70', 'STRIP', { batchNo: 'A1', expiry: '03/40' })]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '2', 'STRIP', '100')]).expect(201)).body as { id: string };
    const r = (await http().get(`/api/sales/${s.id}/returnable`).set(auth(o)).expect(200)).body as object[];
    expect(r[0]).toMatchObject({ unit: 'TAB', packUnit: 'STRIP', packSize: '10.000', soldPacks: '2.000', sold: '20.000', max: '20.000', price: '10.00' });
    const cn = (await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '5', price: '10', gstRate: '0' }]).expect(201)).body as { id: string; total: string };
    expect(cn.total).toBe('50.00');
    expect((await card(o, it.id)).stock).toBe('35.000');
    expect((await card(o, it.id)).batches!.rows[0]).toMatchObject({ no: 'A1', qty: '35.000' });
    expect(((await http().get(`/api/sales/${s.id}/returnable`).set(auth(o)).expect(200)).body as { max: string }[])[0]!.max).toBe('15.000');
    expect((await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '16', price: '10', gstRate: '0' }]).expect(400)).body.message).toContain('Only 15');
    await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '15', price: '10', gstRate: '0' }]).expect(201);
    expect((await card(o, it.id)).stock).toBe('50.000');
    // the goods come back at what they cost
    expect((await card(o, it.id)).rateTable.value).toBe('350.00');
  });

  it('a line sold in both units has one limit, in the loose unit', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70')]).expect(201);
    const s = (await sell(o, cust.id, [line(it, '1', 'STRIP', '100'), line(it, '3', 'TAB', '10')]).expect(201)).body as { id: string };
    expect((await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '14', price: '10', gstRate: '0' }]).expect(400)).body.message).toContain('Only 13');
    await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '13', price: '10', gstRate: '0' }]).expect(201);
    expect((await card(o, it.id)).stock).toBe('50.000');
  });

  it('commission given back is the share of the stock returned', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '5', '70')]).expect(201);
    const ref = (await http().post('/api/referrers').set(auth(o)).send({ name: `Dr Rao ${n}` }).expect(201)).body as { id: string };
    const s = (await sell(o, cust.id, [line(it, '2', 'STRIP', '110', { basePrice: '100' })], { referrerId: ref.id }).expect(201)).body as { id: string };
    await credit(o, cust.id, [{ invoiceId: s.id, itemId: it.id, qty: '5', price: '11', gstRate: '0' }]).expect(201);
    const c = (await http().get('/api/commission').set(auth(o)).expect(200)).body as { id: string; bills: { returns?: { amt: string; qty: number }[] }[] }[];
    const ret = JSON.stringify(c.find((x) => x.id === ref.id));
    // 2 strips earned ₹20: 5 of the 20 tablets give back ₹5
    expect(ret).toContain('"amt":"5.00"');
  });
});

describe('everything else that reads a line', () => {
  it('quotation and challan keep their unit and move no stock', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70')]).expect(201);
    const q = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2', 'STRIP', '100')], { kind: 'quotation', dueDate: null })).expect(201)).body as { id: string };
    expect(((await http().get(`/api/sales/${q.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string; packSize: string }[] }).lines[0]).toMatchObject({ unit: 'STRIP', packSize: '10.000' });
    const dc = (await http().post('/api/challans').set(auth(o)).send({ partyId: cust.id, date: D, lines: [{ itemId: it.id, qty: '2', unit: 'STRIP' }, { itemId: it.id, qty: '3' }] }).expect(201)).body as { id: string };
    const doc = (await http().get(`/api/sales/${dc.id}`).set(auth(o)).expect(200)).body as { lines: { unit: string; packSize: string | null }[] };
    expect(doc.lines.map((l) => l.unit)).toEqual(['STRIP', 'TAB']);
    expect((await card(o, it.id)).stock).toBe('10.000');
  });

  it('Party Report By Item adds up in the loose unit', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '2', '70')]).expect(201);
    await sell(o, cust.id, [line(it, '1', 'STRIP', '100'), line(it, '3', 'TAB', '10')]).expect(201);
    const r = (await http().get(`/api/reports/party-items/${cust.id}?from=${D}&to=${D}`).set(auth(o)).expect(200)).body as { rows: { sq: number }[] };
    expect(JSON.stringify(r)).toContain('13');
  });

  it('an adjustment is in the loose unit, at the loose cost when no rate is typed', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { packSize: '15' });
    await purchase(o, sup.id, 'bill', [pl(it, '1', '100')]).expect(201);
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'add', qty: '15', date: D, reason: 'Found' }).expect(201);
    expect((await card(o, it.id)).stock).toBe('30.000');
    expect((await card(o, it.id)).rateTable.value).toBe('200.00');
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'reduce', qty: '3', date: D, reason: 'Damaged' }).expect(201);
    expect((await card(o, it.id)).stock).toBe('27.000');
  });

  it('the item batch report gives the pack; another shop can’t see or use the item', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { trackBatch: true });
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70', 'STRIP', { batchNo: 'A1', expiry: '03/40' })]).expect(201);
    const rep = (await http().get('/api/reports/batches').set(auth(o)).expect(200)).body as object[];
    expect(rep[0]).toMatchObject({ qty: '10.000', rate: '70.00', unit: 'TAB', packUnit: 'STRIP', packSize: '10.000' });
    const other = await shop();
    await http().get(`/api/items/${it.id}`).set(auth(other.o)).expect(404);
    expect((await sell(other.o, other.cust.id, [line(it, '1', 'STRIP', '100')]).expect(400)).body.message).toContain('isn’t in your items');
  });

  it('staff can sell in packs but can’t change a pack without the right to edit items', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await purchase(o, sup.id, 'bill', [pl(it, '1', '70')]).expect(201);
    const staff = await member(app, o, 'billing_staff');
    await sell(staff, cust.id, [line(it, '1', 'STRIP', '100')]).expect(201);
    await http().patch(`/api/items/${it.id}`).set(auth(staff)).send({ packUnit: '' }).expect((r) => { if (r.status === 200) throw new Error('allowed'); });
  });
});
