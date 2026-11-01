/**
 * Batch and expiry, part 1b (Features › batch_expiry, owner's request, 1 Nov 2026): sales and credit notes use batches,
 * earliest expiry first; expired stock needs "Sell anyway" and is noted in the audit log; the money on a bill never changes.
 */
import type { INestApplication } from '@nestjs/common';
import { money, todayIst } from '@billing/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = todayIst();
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
type Row = { id: string | null; no: string; qty: string; value: string };
let n = 0;

async function shop(feature = true) {
  const o = await owner(app);
  if (feature) await http().put('/api/settings/features').set(auth(o)).send({ enabled: ['batch_expiry'] }).expect(200);
  const it = (await http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, sale: '20', trackBatch: true, openingQty: '1', openingRate: '10', openingDate: D }).expect(201)).body as { id: string; name: string };
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: `Ram Pharma ${n}`, kind: 'supplier' }).expect(201)).body as { id: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: `Raju Stores ${n}` }).expect(201)).body as { id: string };
  return { o, it, sup, cust };
}
const buy = (o: S, sup: string, it: { id: string; name: string }, batchNo: string, expiry: string, qty: string, rate: string) =>
  http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup, transport: '0', labour: '0', lines: [{ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '0', batchNo, expiry }] }).expect(201);
const line = (it: { id: string; name: string }, qty: string, batches?: { batchId: string | null; qty: string }[], extra: object = {}) => ({ itemId: it.id, name: it.name, qty, unit: 'PCS', price: '20', discPct: '0', gstRate: '0', ...(batches && { batches }), ...extra });
const body = (party: string, lines: object[], extra: object = {}) => ({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: party, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], fromQuotationIds: [], lines, ...extra });
const card = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as { stock: string; rateTable: { value: string }; batches: { rows: Row[] } | null };
const left = async (o: S, id: string) => (await card(o, id)).batches!.rows.map((r) => [r.no, Number(r.qty)]);
const idOf = async (o: S, id: string, no: string) => (await card(o, id)).batches!.rows.find((r) => r.no === no)!.id;
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entityId: string | null; after: Record<string, unknown> | null }[];

/** No batch 1, X100 2 (long expired), A123 3 @12, B456 4 @15, C789 5 @16 (no expiry). */
async function stocked() {
  const s = await shop();
  await buy(s.o, s.sup.id, s.it, 'A123', '03/40', '3', '12');
  await buy(s.o, s.sup.id, s.it, 'B456', '08/41', '4', '15');
  await buy(s.o, s.sup.id, s.it, 'X100', '01/20', '2', '9');
  await buy(s.o, s.sup.id, s.it, 'C789', '', '5', '16');
  return s;
}

describe('picked automatically', () => {
  it('No batch first, then earliest expiry; expired stock is left alone', async () => {
    const { o, it, cust } = await stocked();
    await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '5')])).expect(201);
    expect(await left(o, it.id)).toEqual([['X100', 2], ['B456', 3], ['C789', 5]]);
  });

  it('saves which batches a line used, shown when the bill is read', async () => {
    const { o, it, cust } = await stocked();
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2')])).expect(201)).body;
    const d = (await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body;
    expect(d.lines[0].batches).toMatchObject([{ no: 'No batch', qty: '1.000', expiry: null }, { no: 'A123', qty: '1.000', expiry: '2040-03-31' }]);
  });

  it('two lines of one item share the stock; more than is in stock goes to No batch and stock totals stay right', async () => {
    const { o, it, cust } = await stocked();
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2'), line(it, '20')])).expect(201)).body;
    const d = (await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body;
    expect(d.lines[0].batches.map((b: { no: string }) => b.no)).toEqual(['No batch', 'A123']);
    // 13 could be picked (the 2 expired stay out), so 9 of the 22 are beyond it
    expect(d.lines[1].batches.find((b: { no: string }) => b.no === 'No batch').qty).toBe('9.000');
    const c = await card(o, it.id);
    expect(c.stock).toBe('-7.000');
  });

  it('an untracked item on the same bill has no batches', async () => {
    const { o, it, cust } = await stocked();
    const plain = (await http().post('/api/items').set(auth(o)).send({ name: `Plain ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, openingQty: '5', openingRate: '5', openingDate: D }).expect(201)).body;
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1'), line(plain, '2')])).expect(201)).body;
    const d = (await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body;
    expect(d.lines[1].batches).toEqual([]);
    expect((await card(o, plain.id)).stock).toBe('3.000');
  });
});

describe('picked by hand', () => {
  it('takes the batches chosen, with its value following', async () => {
    const { o, it, cust } = await stocked();
    await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: await idOf(o, it.id, 'C789'), qty: '2' }])])).expect(201);
    expect(await left(o, it.id)).toContainEqual(['C789', 3]);
    expect(await left(o, it.id)).toContainEqual(['A123', 3]);
    const c = await card(o, it.id);
    expect(c.batches!.rows.reduce((a, r) => a.plus(r.value), money(0)).toFixed(2)).toBe(c.rateTable.value);
  });

  it('refuses amounts that don’t add up, more than a batch holds, and another item’s batch', async () => {
    const { o, it, sup, cust } = await stocked();
    const a = await idOf(o, it.id, 'A123');
    expect((await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: a, qty: '1' }])])).expect(400)).body.message).toContain('add up to 1');
    expect((await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '4', [{ batchId: a, qty: '4' }])])).expect(400)).body.message).toContain('Only 3');
    // two lines of one batch count together
    expect((await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: a, qty: '2' }]), line(it, '2', [{ batchId: a, qty: '2' }])])).expect(400)).body.message).toContain('Only 3');
    const other = (await http().post('/api/items').set(auth(o)).send({ name: `Other ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, trackBatch: true }).expect(201)).body;
    await buy(o, sup.id, other, 'Z1', '03/40', '5', '5');
    const z = await idOf(o, other.id, 'Z1');
    expect((await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: z, qty: '1' }])])).expect(400)).body.message).toContain('isn’t a batch');
    expect((await card(o, it.id)).stock).toBe('15.000');
  });

  it('another shop’s batch doesn’t exist here', async () => {
    const { o, it } = await stocked();
    const other = await shop();
    const a = await idOf(o, it.id, 'A123');
    await http().post('/api/sales').set(auth(other.o)).send(body(other.cust.id, [line(other.it, '1', [{ batchId: a, qty: '1' }])])).expect(400);
  });
});

describe('expired stock', () => {
  it('needs “Sell anyway”, then saves and is noted in the audit log', async () => {
    const { o, it, cust } = await stocked();
    const x = await idOf(o, it.id, 'X100');
    const no = await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])])).expect(409);
    expect(no.body.code).toBe('expired_batch');
    expect(no.body.message).toContain('X100 expired on 31 Jan 2020');
    expect((await audit(o)).some((e) => e.action === 'sold_expired')).toBe(false);
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])], { confirmExpired: true })).expect(201)).body;
    expect(await left(o, it.id)).toContainEqual(['X100', 1]);
    const log = (await audit(o)).find((e) => e.action === 'sold_expired')!;
    expect(log.entityId).toBe(s.id);
    expect(log.after).toMatchObject({ lines: [{ batch: 'X100', expiry: '2020-01-31', qty: '1.000' }] });
  });

  it('goes by the bill’s date: a bill dated before the expiry isn’t asked', async () => {
    const { o, it, cust } = await stocked();
    const x = await idOf(o, it.id, 'X100');
    await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])], { date: '2020-01-31', dueDate: '2020-01-31' })).expect(201);
  });

  it('editing a saved bill isn’t asked again for what it already sold, only for more', async () => {
    const { o, it, cust } = await stocked();
    const x = await idOf(o, it.id, 'X100');
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])], { confirmExpired: true })).expect(201)).body;
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])], { notes: 'changed' })).expect(200);
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: x, qty: '2' }])])).expect(409);
  });
});

describe('editing and cancelling', () => {
  it('an edit puts the old batches back and takes the new; its own goods count as in stock', async () => {
    const { o, it, cust } = await stocked();
    const a = await idOf(o, it.id, 'A123');
    const c = await idOf(o, it.id, 'C789');
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '3', [{ batchId: a, qty: '3' }])])).expect(201)).body;
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '3', [{ batchId: a, qty: '3' }])])).expect(200);
    expect(await left(o, it.id)).not.toContainEqual(['A123', 3]);
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: c, qty: '2' }])])).expect(200);
    expect(await left(o, it.id)).toEqual([['X100', 2], ['No batch', 1], ['A123', 3], ['B456', 4], ['C789', 3]]);
  });

  it('cancelling puts the batches back; a purchase bill whose batch was sold can’t be cancelled', async () => {
    const { o, it, sup, cust } = await stocked();
    const bill = (await buy(o, sup.id, it, 'D111', '03/42', '2', '20')).body;
    const d = await idOf(o, it.id, 'D111');
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: d, qty: '1' }])])).expect(201)).body;
    expect((await http().post(`/api/purchases/${bill.id}/cancel`).set(auth(o)).send({ reason: 'test' }).expect(400)).body.message).toContain('Some of batch D111');
    await http().post(`/api/sales/${s.id}/cancel`).set(auth(o)).send({}).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await left(o, it.id)).toContainEqual(['D111', 2]);
    await http().post(`/api/purchases/${bill.id}/cancel`).set(auth(o)).send({ reason: 'test' }).expect((r) => expect(r.status).toBeLessThan(300));
  });
});

describe('the money doesn’t change', () => {
  it('the same bill totals, with discount, with and without batches; the sale value isn’t split', async () => {
    const a = await stocked();
    const b = await shop(false);
    await http().post('/api/stock-adjustments').set(auth(b.o)).send({ itemId: b.it.id, mode: 'add', qty: 20, date: D, reason: 'Other', rate: '10' }).expect(201);
    const lines = (it: { id: string; name: string }) => [line(it, '5', undefined, { discPct: '10' })];
    const extra = { billDiscPct: '5', transport: '30' };
    const x = (await http().post('/api/sales').set(auth(a.o)).send(body(a.cust.id, lines(a.it), extra)).expect(201)).body;
    const y = (await http().post('/api/sales').set(auth(b.o)).send(body(b.cust.id, lines(b.it), extra)).expect(201)).body;
    const dx = (await http().get(`/api/sales/${x.id}`).set(auth(a.o)).expect(200)).body;
    const dy = (await http().get(`/api/sales/${y.id}`).set(auth(b.o)).expect(200)).body;
    expect(dx.total).toBe(dy.total);
    expect(dx.lines).toHaveLength(1);
    expect(dx.lines[0].amount).toBe(dy.lines[0].amount);
    expect(dx.lines[0].batches.length).toBeGreaterThan(1);
  });
});

describe('cost follows the batch', () => {
  it('the profit pop-up and the saved bill use the cost of the batch picked', async () => {
    const { o, it, cust } = await stocked();
    const c = await idOf(o, it.id, 'C789');
    const draft = (await http().post('/api/sales/cost').set(auth(o)).send({ date: D, lines: [{ itemId: it.id, qty: '2', batches: [{ batchId: c, qty: '2' }] }] }).expect((r) => expect(r.status).toBeLessThan(300))).body;
    expect(draft.lines[0].cost).toBe('32.00');
    const auto = (await http().post('/api/sales/cost').set(auth(o)).send({ date: D, lines: [{ itemId: it.id, qty: '2' }] }).expect((r) => expect(r.status).toBeLessThan(300))).body;
    expect(auto.lines[0].cost).toBe('22.00');
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '2', [{ batchId: c, qty: '2' }])])).expect(201)).body;
    const saved = (await http().post('/api/sales/cost').set(auth(o)).send({ id: s.id, date: D, lines: [{ itemId: it.id, qty: '2', batches: [{ batchId: c, qty: '2' }] }] }).expect((r) => expect(r.status).toBeLessThan(300))).body;
    expect(saved.lines[0].cost).toBe('32.00');
  });
});

describe('credit note', () => {
  it('left to itself, goods go back to the batches that invoice sold them from, a later return continuing', async () => {
    const { o, it, cust } = await stocked();
    const a = await idOf(o, it.id, 'A123');
    const b = await idOf(o, it.id, 'B456');
    const inv = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '5', [{ batchId: a, qty: '3' }, { batchId: b, qty: '2' }])])).expect(201)).body;
    expect(await left(o, it.id)).toEqual([['X100', 2], ['No batch', 1], ['B456', 2], ['C789', 5]]);
    const note = (qty: string) => http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, reason: 'Damaged goods', settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: it.id, qty, price: '20', gstRate: '0' }] }).expect(201);
    await note('1');
    expect(await left(o, it.id)).toContainEqual(['B456', 3]);
    await note('2');
    expect(await left(o, it.id)).toContainEqual(['B456', 4]);
    expect(await left(o, it.id)).toContainEqual(['A123', 1]);
  });

  it('can go back to a batch chosen or to No batch; another item’s batch is refused', async () => {
    const { o, it, cust } = await stocked();
    const a = await idOf(o, it.id, 'A123');
    const c = await idOf(o, it.id, 'C789');
    const inv = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '3', [{ batchId: a, qty: '3' }])])).expect(201)).body;
    const send = (l: object) => http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: it.id, qty: '1', price: '20', gstRate: '0', ...l }] });
    await send({ batchId: c }).expect(201);
    expect(await left(o, it.id)).toContainEqual(['C789', 6]);
    await send({ batchId: null }).expect(201);
    expect(await left(o, it.id)).toContainEqual(['No batch', 2]);
    await send({ batchId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });

  it('a return with no invoice stays as No batch unless one is chosen', async () => {
    const { o, it, cust } = await stocked();
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, settle: 'adjust', lines: [{ itemId: it.id, qty: '1', price: '20', gstRate: '0' }] }).expect(201);
    expect(await left(o, it.id)).toContainEqual(['No batch', 2]);
  });

  it('cancelling takes them out again, refused when they have gone since; returnable says what was sold', async () => {
    const { o, it, cust } = await stocked();
    const a = await idOf(o, it.id, 'A123');
    const inv = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '3', [{ batchId: a, qty: '3' }])])).expect(201)).body;
    expect((await http().get(`/api/sales/${inv.id}/returnable`).set(auth(o)).expect(200)).body[0].soldBatches).toMatchObject([{ batchId: a, no: 'A123', qty: '3.000' }]);
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: it.id, qty: '2', price: '20', gstRate: '0' }] }).expect(201)).body;
    expect(await left(o, it.id)).toContainEqual(['A123', 2]);
    await http().post(`/api/sales/${cn.id}/cancel`).set(auth(o)).send({}).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await left(o, it.id)).not.toContainEqual(['A123', 2]);
  });
});

describe('with the feature off', () => {
  it('batches sent are ignored, nothing is asked, and the bill has none', async () => {
    const { o, it, sup, cust } = await stocked();
    const x = await idOf(o, it.id, 'X100');
    await http().put('/api/settings/features').set(auth(o)).send({ enabled: [] }).expect(200);
    expect((await http().get('/api/batches').set(auth(o)).expect(200)).body).toEqual({});
    const s = (await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1', [{ batchId: x, qty: '1' }])])).expect(201)).body;
    expect((await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body.lines[0].batches).toEqual([]);
    void sup;
    // it comes out of stock without a batch first, as an untracked item would; ticking brings the batches back
    await http().put('/api/settings/features').set(auth(o)).send({ enabled: ['batch_expiry'] }).expect(200);
    expect(await left(o, it.id)).toEqual([['X100', 2], ['A123', 3], ['B456', 4], ['C789', 5]]);
  });

  it('quotations and challans take no batch and move no stock', async () => {
    const { o, it, cust } = await stocked();
    await http().post('/api/sales').set(auth(o)).send(body(cust.id, [line(it, '1')], { kind: 'quotation' })).expect(201);
    expect((await card(o, it.id)).stock).toBe('15.000');
  });
});
