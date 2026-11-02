/**
 * MRP (Features › mrp_pack, owner's request, 2 Nov 2026): a batch's own MRP; a rate above MRP needs "Save anyway" and is
 * noted in the audit log; with the feature off nothing is asked and batch MRPs are ignored.
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
const item = async (o: S, extra: object = {}) => (await http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, ...extra }).expect(201)).body as It;
const buy = (o: S, sup: string, it: It, batchNo: string, batchMrp: string | undefined, qty = '10') => http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup, transport: '0', labour: '0', lines: [{ itemId: it.id, name: it.name, qty, rate: '50', discPct: '0', gstRate: '0', batchNo, expiry: '03/40', ...(batchMrp !== undefined && { batchMrp }) }] });
const line = (it: It, price: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty: '1', unit: 'PCS', price, discPct: '0', gstRate: '0', ...extra });
const body = (party: string, lines: object[], extra: object = {}) => ({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: party, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], fromQuotationIds: [], lines, ...extra });
const sell = (o: S, party: string, lines: object[], extra: object = {}) => http().post('/api/sales').set(auth(o)).send(body(party, lines, extra));
const rows = async (o: S, id: string) => ((await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as { batches: { rows: { id: string; no: string; mrp: string | null }[] } }).batches.rows;
const log = async (o: S) => ((await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string; before: Record<string, unknown>; after: Record<string, unknown> }[]);

describe('a batch’s MRP', () => {
  it('saved from the purchase bill, one per batch no.; wrong or different ones are refused; an empty one is filled in', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { trackBatch: true });
    expect((await buy(o, sup.id, it, 'A1', 'abc').expect(400)).body.message).toContain('isn’t an MRP');
    expect((await buy(o, sup.id, it, 'A1', '0').expect(400)).body.message).toContain('isn’t an MRP');
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    expect((await rows(o, it.id))[0]).toMatchObject({ no: 'A1', mrp: '120.00' });
    expect((await buy(o, sup.id, it, 'a1', '125').expect(400)).body.message).toContain('already has MRP 120.00');
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    await buy(o, sup.id, it, 'B2', '').expect(201);
    expect((await rows(o, it.id)).find((r) => r.no === 'B2')!.mrp).toBeNull();
    await buy(o, sup.id, it, 'B2', '99.50').expect(201);
    expect((await rows(o, it.id)).find((r) => r.no === 'B2')!.mrp).toBe('99.50');
  });

  it('the bill shows it, and the item card’s Edit changes it, in the audit log; blank goes back to the item’s', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { trackBatch: true });
    const bill = (await buy(o, sup.id, it, 'A1', '120').expect(201)).body;
    expect((await http().get(`/api/purchases/${bill.id}`).set(auth(o)).expect(200)).body.lines[0].batchMrp).toBe('120.00');
    const id = (await rows(o, it.id))[0]!.id;
    await http().patch(`/api/batches/${id}`).set(auth(o)).send({ batchNo: 'A1', mrp: '140' }).expect(200);
    expect((await rows(o, it.id))[0]!.mrp).toBe('140.00');
    const e = (await log(o)).find((x) => x.entity === 'batch' && x.action === 'update')!;
    expect(String(e.before.mrp)).toBe('120');
    expect(String(e.after.mrp)).toBe('140');
    await http().patch(`/api/batches/${id}`).set(auth(o)).send({ batchNo: 'A1', mrp: 'x' }).expect(400);
    await http().patch(`/api/batches/${id}`).set(auth(o)).send({ batchNo: 'A1', mrp: '' }).expect(200);
    expect((await rows(o, it.id))[0]!.mrp).toBeNull();
  });
});

describe('a rate above MRP', () => {
  it('needs “Save anyway”, then saves and is in the audit log with the item, rate and MRP', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true });
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    const no = await sell(o, cust.id, [line(it, '130')]).expect(409);
    expect(no.body.code).toBe('above_mrp');
    expect(no.body.message).toContain('130.00 is above its MRP 120.00');
    expect((await log(o)).some((e) => e.action === 'sold_above_mrp')).toBe(false);
    const s = (await sell(o, cust.id, [line(it, '130')], { confirmAboveMrp: true }).expect(201)).body;
    const e = (await log(o)).find((x) => x.action === 'sold_above_mrp')!;
    expect(e.entityId).toBe(s.id);
    expect(e.after).toMatchObject({ lines: [{ rate: '130.00', mrp: '120.00' }] });
  });

  it('at MRP or below isn’t asked; a batch’s MRP comes before the item’s; no batch uses the item’s', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true, mrp: '100' });
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    await sell(o, cust.id, [line(it, '120')]).expect(201);
    const b = await item(o, { trackBatch: true, mrp: '100' });
    await buy(o, sup.id, b, 'B1', undefined).expect(201);
    await sell(o, cust.id, [line(b, '101')]).expect(409);
    await sell(o, cust.id, [line(b, '100')]).expect(201);
  });

  it('an untracked item uses its MRP; no MRP is never asked; a service isn’t checked', async () => {
    const { o, cust } = await shop();
    const a = await item(o, { mrp: '60' });
    await sell(o, cust.id, [line(a, '61')]).expect(409);
    await sell(o, cust.id, [line(a, '60')]).expect(201);
    await sell(o, cust.id, [line(await item(o), '9999')]).expect(201);
    await sell(o, cust.id, [line(await item(o, { kind: 'service', mrp: '10' }), '50')]).expect(201);
  });

  it('with several batches the lowest MRP counts', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true });
    await buy(o, sup.id, it, 'A1', '120', '1').expect(201);
    await buy(o, sup.id, it, 'B2', '100', '5').expect(201);
    const r = await rows(o, it.id);
    const id = (no: string) => r.find((x) => x.no === no)!.id;
    const mixed = (price: string) => [line(it, price, { qty: '2', batches: [{ batchId: id('A1'), qty: '1' }, { batchId: id('B2'), qty: '1' }] })];
    await sell(o, cust.id, mixed('110')).expect(409);
    await sell(o, cust.id, mixed('100')).expect(201);
  });

  it('stock without a batch counts at the item’s MRP, so it can’t escape the check', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true, mrp: '100', openingQty: '1', openingRate: '10', openingDate: D });
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    // 2: 1 from No batch at the item's 100, 1 from A1 at 120
    await sell(o, cust.id, [line(it, '110', { qty: '2' })]).expect(409);
    await sell(o, cust.id, [line(it, '100', { qty: '2' })]).expect(201);
  });

  it('counts GST and the line discount: what the customer pays', async () => {
    const { o, cust } = await shop();
    const it = await item(o, { mrp: '100', gstRate: 18 });
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'add', qty: 10, rate: '50', date: D, reason: 'Other' }).expect(201);
    const l = (price: string, discPct = '0') => line(it, price, { gstRate: '18', discPct });
    await sell(o, cust.id, [l('90')], { pricesInclTax: true }).expect(201);
    await sell(o, cust.id, [l('90')], { pricesInclTax: false }).expect(409);
    await sell(o, cust.id, [l('84')], { pricesInclTax: false }).expect(201);
    await sell(o, cust.id, [l('110', '10')], { pricesInclTax: true }).expect(201);
  });

  it('editing a saved bill isn’t asked again at that rate or lower, only higher', async () => {
    const { o, cust } = await shop();
    const it = await item(o, { mrp: '100' });
    const s = (await sell(o, cust.id, [line(it, '130')], { confirmAboveMrp: true }).expect(201)).body;
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '130')], { notes: 'changed' })).expect(200);
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '120')])).expect(200);
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '125')])).expect(409);
  });

  it('expired stock and a rate above MRP each need their own answer', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { trackBatch: true });
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', lines: [{ itemId: it.id, name: it.name, qty: '5', rate: '50', discPct: '0', gstRate: '0', batchNo: 'X1', expiry: '01/20', batchMrp: '100' }] }).expect(201);
    const id = (await rows(o, it.id))[0]!.id;
    const l = [line(it, '130', { batches: [{ batchId: id, qty: '1' }] })];
    expect((await sell(o, cust.id, l).expect(409)).body.code).toBe('expired_batch');
    expect((await sell(o, cust.id, l, { confirmExpired: true }).expect(409)).body.code).toBe('above_mrp');
    await sell(o, cust.id, l, { confirmExpired: true, confirmAboveMrp: true }).expect(201);
  });

  it('quotations aren’t checked; any role that can sell can save anyway', async () => {
    const { o, cust } = await shop();
    const it = await item(o, { mrp: '100' });
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'add', qty: 5, rate: '50', date: D, reason: 'Other' }).expect(201);
    await sell(o, cust.id, [line(it, '130')], { kind: 'quotation' }).expect(201);
    const staff = await member(app, o, 'billing_staff');
    await sell(staff, cust.id, [line(it, '130')]).expect(409);
    await sell(staff, cust.id, [line(it, '130')], { confirmAboveMrp: true }).expect(201);
  });
});

describe('with the feature off', () => {
  it('nothing is asked and a batch’s MRP is ignored', async () => {
    const { o, sup, cust } = await shop(['batch_expiry']);
    const it = await item(o, { trackBatch: true, mrp: '100' });
    await buy(o, sup.id, it, 'A1', '999').expect(201);
    expect((await rows(o, it.id))[0]!.mrp).toBeNull();
    await sell(o, cust.id, [line(it, '500')]).expect(201);
    expect((await log(o)).some((e) => e.action === 'sold_above_mrp')).toBe(false);
  });

  it('a saved batch MRP stays and comes back; Edit doesn’t change it while off', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { trackBatch: true });
    await buy(o, sup.id, it, 'A1', '120').expect(201);
    const id = (await rows(o, it.id))[0]!.id;
    await features(o, ['batch_expiry']);
    await http().patch(`/api/batches/${id}`).set(auth(o)).send({ batchNo: 'A2', mrp: '5' }).expect(200);
    await features(o, ['batch_expiry', 'mrp_pack']);
    expect((await rows(o, it.id))[0]).toMatchObject({ no: 'A2', mrp: '120.00' });
  });
});
