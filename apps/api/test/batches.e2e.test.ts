/**
 * Batch and expiry, part 1a (Features › batch_expiry, owner's request, 1 Nov 2026): a tracked item's batch on purchase
 * bills, debit notes, adjustments and opening stock, its stock by batch on the item card, and nothing at all with the
 * feature off or for items not tracked.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { money, todayIst } from '@billing/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const D = todayIst();
beforeAll(async () => {
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

type S = { token: string };
type Row = { id: string | null; no: string; mfg: string | null; expiry: string | null; qty: string; rate: string; value: string };
const tick = (o: S, on = true) => http().put('/api/settings/features').set(auth(o)).send({ enabled: on ? ['batch_expiry'] : [] }).expect(200);
let n = 0;
const newItem = async (o: S, extra: object = {}) => (await http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, ...extra }).expect(201)).body as { id: string; name: string; trackBatch: boolean; stock: string };
const supplier = async (o: S) => (await http().post('/api/parties').set(auth(o)).send({ name: `Ram Pharma ${++n}`, kind: 'supplier' }).expect(201)).body as { id: string };
const line = (it: { id: string; name: string }, qty: string, rate: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '0', ...extra });
const bill = (o: S, party: string, lines: object[], kind = 'bill') => http().post('/api/purchases').set(auth(o)).send({ kind, date: D, dueDate: kind === 'bill' ? D : null, partyId: party, transport: '0', labour: '0', reason: 'Damaged goods', lines });
const card = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as { stock: string; trackBatch: boolean; rateTable: { value: string }; batches: { rows: Row[]; shortQty: string } | null };
const left = (rows: Row[]) => rows.map((r) => [r.no, r.qty]);
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];

async function shop() {
  const o = await owner(app);
  await tick(o);
  const it = await newItem(o, { trackBatch: true });
  const sup = await supplier(o);
  return { o, it, sup };
}

describe('with the feature off', () => {
  it('the switch and batch data are ignored; the item card has no batches', async () => {
    const o = await owner(app);
    const it = await newItem(o, { trackBatch: true, openingQty: '5', openingRate: '10', openingDate: D, openingBatchNo: 'A1', openingExpiry: '03/30' });
    expect(it.trackBatch).toBe(false);
    const sup = await supplier(o);
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', expiry: '03/30' })]).expect(201);
    const c = await card(o, it.id);
    expect(c.batches).toBeNull();
    expect(c.stock).toBe('9.000');
    expect((await http().get(`/api/items/${it.id}/batches`).set(auth(o)).expect(200)).body).toEqual({ rows: [], shortQty: '0.000' });
    expect(await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM batches WHERE item_id = ${it.id}::uuid`).toEqual([{ n: 0n }]);
  });

  it('a batch can’t be edited', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1' })]).expect(201);
    const id = (await card(o, it.id)).batches!.rows[0]!.id!;
    await tick(o, false);
    await http().patch(`/api/batches/${id}`).set(auth(o)).send({ batchNo: 'B2' }).expect(400);
  });

  it('unticking hides the batches and keeps them; stock sold meanwhile comes out of the oldest; ticking brings them back', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '10', '12', { batchNo: 'B1', expiry: '03/30' })]).expect(201);
    await tick(o, false);
    expect((await card(o, it.id)).batches).toBeNull();
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'reduce', qty: 3, date: D, reason: 'Damaged' }).expect(201);
    await tick(o);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '7.000']]);
  });
});

describe('the item switch', () => {
  it('existing items stay untracked; it turns on and off; a service never has batches', async () => {
    const o = await owner(app);
    const old = await newItem(o);
    await tick(o);
    expect((await card(o, old.id)).trackBatch).toBe(false);
    expect((await card(o, old.id)).batches).toBeNull();
    await http().patch(`/api/items/${old.id}`).set(auth(o)).send({ trackBatch: true }).expect(200);
    expect((await card(o, old.id)).batches).toEqual({ rows: [], shortQty: '0.000' });
    const log = (await audit(o)).find((e) => e.entity === 'item' && e.action === 'update' && e.entityId === old.id);
    expect(JSON.stringify(log?.after)).toContain('trackBatch');
    await http().patch(`/api/items/${old.id}`).set(auth(o)).send({ trackBatch: false }).expect(200);
    const svc = await newItem(o, { kind: 'service', trackBatch: true });
    expect(svc.trackBatch).toBe(false);
  });

  it('stock from before tracking stays as No batch', async () => {
    const o = await owner(app);
    const it = await newItem(o, { openingQty: '5', openingRate: '10', openingDate: D });
    await tick(o);
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ trackBatch: true }).expect(200);
    expect((await card(o, it.id)).batches!.rows).toMatchObject([{ id: null, no: 'No batch', qty: '5.000', rate: '10.00', value: '50.00' }]);
  });

  it('opening stock can name a batch, or stays No batch when blank', async () => {
    const o = await owner(app);
    await tick(o);
    const a = await newItem(o, { trackBatch: true, openingQty: '5', openingRate: '10', openingDate: D, openingBatchNo: 'A1', openingExpiry: '03/30' });
    expect((await card(o, a.id)).batches!.rows).toMatchObject([{ no: 'A1', expiry: '2030-03-31', qty: '5.000' }]);
    const b = await newItem(o, { trackBatch: true, openingQty: '5', openingRate: '10', openingDate: D });
    expect((await card(o, b.id)).batches!.rows).toMatchObject([{ id: null, no: 'No batch', qty: '5.000' }]);
  });
});

describe('purchase bill', () => {
  it('a tracked item needs a batch no.; dates are optional; an untracked item on the same bill needs nothing', async () => {
    const { o, it, sup } = await shop();
    const plain = await newItem(o);
    expect((await bill(o, sup.id, [line(it, '4', '12'), line(plain, '1', '5')]).expect(400)).body.message).toBe(`Enter the batch no. for “${it.name}”.`);
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1' }), line(plain, '1', '5')]).expect(201);
    expect((await card(o, it.id)).batches!.rows).toMatchObject([{ no: 'B1', mfg: null, expiry: null, qty: '4.000' }]);
    expect((await card(o, plain.id)).batches).toBeNull();
    expect((await card(o, plain.id)).stock).toBe('1.000');
  });

  it('dates: MM/YY and full dates are saved; a wrong one or expiry before mfg is refused and nothing is saved', async () => {
    const { o, it, sup } = await shop();
    expect((await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', expiry: '13/27' })]).expect(400)).body.message).toContain('isn’t a date');
    expect((await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', mfg: '13/27' })]).expect(400)).body.message).toContain('mfg');
    expect((await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', mfg: '03/27', expiry: '01/27' })]).expect(400)).body.message).toContain('before the mfg');
    expect((await card(o, it.id)).stock).toBe('0.000');
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', mfg: '01/26', expiry: '03/30' })]).expect(201);
    await bill(o, sup.id, [line(it, '1', '12', { batchNo: 'B2', expiry: '15/06/2031' })]).expect(201);
    expect((await card(o, it.id)).batches!.rows).toMatchObject([{ no: 'B1', mfg: '2026-01-01', expiry: '2030-03-31' }, { no: 'B2', expiry: '2031-06-15' }]);
  });

  it('the same batch no. (any capitals) is one batch; different dates are refused; an empty date is filled in', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '4', '10', { batchNo: 'B1' })]).expect(201);
    await bill(o, sup.id, [line(it, '1', '20', { batchNo: 'b1', expiry: '03/30' })]).expect(201);
    expect((await bill(o, sup.id, [line(it, '1', '10', { batchNo: 'B1', expiry: '04/30' })]).expect(400)).body.message).toContain('already has expiry Mar 2030');
    expect((await card(o, it.id)).batches!.rows).toMatchObject([{ no: 'B1', expiry: '2030-03-31', qty: '5.000', value: '60.00' }]);
    // another item may use the same batch no.
    const other = await newItem(o, { trackBatch: true });
    await bill(o, sup.id, [line(other, '1', '10', { batchNo: 'B1', expiry: '09/31' })]).expect(201);
    expect((await card(o, other.id)).batches!.rows).toMatchObject([{ no: 'B1', expiry: '2031-09-30' }]);
  });

  it('the bill shows its batch; a purchase order takes none', async () => {
    const { o, it, sup } = await shop();
    const b = (await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', mfg: '01/26', expiry: '03/30' })]).expect(201)).body;
    expect((await http().get(`/api/purchases/${b.id}`).set(auth(o)).expect(200)).body.lines[0]).toMatchObject({ batchNo: 'B1', mfg: '2026-01-01', expiry: '2030-03-31' });
    await bill(o, sup.id, [line(it, '4', '12')], 'order').expect(201);
    expect((await card(o, it.id)).stock).toBe('4.000');
  });

  it('values add up to the item’s stock value, and the card is in the order of use', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '3', '33.33', { batchNo: 'LATE', expiry: '03/32' })]).expect(201);
    await bill(o, sup.id, [line(it, '7', '11.11', { batchNo: 'SOON', expiry: '03/30' })]).expect(201);
    await bill(o, sup.id, [line(it, '1', '9.99', { batchNo: 'NONE' })]).expect(201);
    await bill(o, sup.id, [line(it, '2', '5', { batchNo: 'OLD', expiry: '01/20' })]).expect(201);
    const c = await card(o, it.id);
    expect(c.batches!.rows.map((r) => r.no)).toEqual(['OLD', 'SOON', 'LATE', 'NONE']);
    expect(c.batches!.rows.reduce((a, r) => a.plus(r.value), money(0)).toFixed(2)).toBe(c.rateTable.value);
    expect(c.batches!.rows.reduce((a, r) => a.plus(r.qty), money(0)).toFixed(3)).toBe(c.stock);
  });

  it('editing moves the goods to the new batch; the old one empties', async () => {
    const { o, it, sup } = await shop();
    const b = (await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1' })]).expect(201)).body;
    await http().put(`/api/purchases/${b.id}`).set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', lines: [line(it, '6', '12', { batchNo: 'B2' })] }).expect(200);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B2', '6.000']]);
  });

  it('cancelling takes the batch out, and is refused when that batch has gone since', async () => {
    const { o, it, sup } = await shop();
    const b1 = (await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1' })]).expect(201)).body;
    const b2 = (await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B2' })]).expect(201)).body;
    await http().post(`/api/purchases/${b1.id}/cancel`).set(auth(o)).send({ reason: 'test' }).expect(201);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B2', '4.000']]);
    const id = (await card(o, it.id)).batches!.rows[0]!.id;
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'reduce', qty: 1, date: D, reason: 'Damaged', batchId: id }).expect(201);
    // other stock would cover it, but not of that batch
    await bill(o, sup.id, [line(it, '10', '12', { batchNo: 'B3' })]).expect(201);
    expect((await http().post(`/api/purchases/${b2.id}/cancel`).set(auth(o)).send({ reason: 'test' }).expect(400)).body.message).toContain('Some of batch B2');
    expect((await card(o, it.id)).stock).toBe('13.000');
  });
});

describe('debit note', () => {
  it('against a bill it comes out of that bill’s batch; or out of the batch chosen; more than the batch holds is refused', async () => {
    const { o, it, sup } = await shop();
    const b1 = (await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', expiry: '03/30' })]).expect(201)).body;
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B2', expiry: '03/31' })]).expect(201);
    const note = (extra: object, qty = '1') => http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: D, partyId: sup.id, transport: '0', labour: '0', reason: 'Damaged goods', ...extra, lines: [line(it, qty, '12', (extra as { l?: object }).l ?? {})] });
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: D, partyId: sup.id, transport: '0', labour: '0', reason: 'Damaged goods', againstId: b1.id, lines: [line(it, '1', '12')] }).expect(201);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '3.000'], ['B2', '4.000']]);
    const b2id = (await card(o, it.id)).batches!.rows[1]!.id;
    await note({ l: { batchId: b2id } }).expect(201);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '3.000'], ['B2', '3.000']]);
    expect((await note({ l: { batchId: b2id } }, '5').expect(400)).body.message).toContain('in batch B2');
    // two lines of one batch count together
    const two = await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: D, partyId: sup.id, transport: '0', labour: '0', reason: 'Damaged goods', lines: [line(it, '2', '12', { batchId: b2id }), line(it, '2', '12', { batchId: b2id })] }).expect(400);
    expect(two.body.message).toContain('in batch B2');
    expect((await note({}, '1').expect(400)).body.message).toContain('without a batch');
  });
});

describe('stock adjustment', () => {
  it('adding goes into the batch typed (blank = No batch); reducing comes out of the batch chosen', async () => {
    const { o, it } = await shop();
    const adj = (b: object) => http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, date: D, reason: 'Other', rate: '10', ...b });
    await adj({ mode: 'add', qty: 3, batchNo: 'B1', expiry: '01/20' }).expect(201);
    await adj({ mode: 'add', qty: 2 }).expect(201);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '3.000'], ['No batch', '2.000']]);
    const id = (await card(o, it.id)).batches!.rows[0]!.id;
    expect((await adj({ mode: 'reduce', qty: 4, batchId: id }).expect(400)).body.message).toContain('in batch B1');
    expect((await adj({ mode: 'reduce', qty: 3 }).expect(400)).body.message).toContain('without a batch');
    await adj({ mode: 'reduce', qty: 3, batchId: id, reason: 'Expired' }).expect(201);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['No batch', '2.000']]);
  });

  it('editing and cancelling put back the right batch; an added batch since used can’t be cancelled', async () => {
    const { o, it } = await shop();
    const adj = (b: object) => http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, date: D, reason: 'Other', rate: '10', ...b });
    await adj({ mode: 'add', qty: 5, batchNo: 'B1' }).expect(201);
    const id = (await card(o, it.id)).batches!.rows[0]!.id;
    const out = (await adj({ mode: 'reduce', qty: 2, batchId: id }).expect(201)).body as { id: string; number: string };
    await http().put(`/api/stock-adjustments/${out.id}`).set(auth(o)).send({ itemId: it.id, date: D, reason: 'Other', rate: '10', mode: 'reduce', qty: 3, batchId: id, number: out.number }).expect(200);
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '2.000']]);
    const row = ((await http().get('/api/stock-adjustments').set(auth(o)).expect(200)).body as { id: string; batchId: string; batchNo: string }[]).find((a) => a.id === out.id)!;
    expect(row).toMatchObject({ batchId: id, batchNo: 'B1' });
    await http().post(`/api/stock-adjustments/${out.id}/cancel`).set(auth(o)).send({}).expect((r) => expect(r.status).toBeLessThan(300));
    expect(left((await card(o, it.id)).batches!.rows)).toEqual([['B1', '5.000']]);
  });
});

describe('editing a batch', () => {
  it('corrects the no. and dates, in the audit log; a no. the item already has is refused', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1', expiry: '03/30' })]).expect(201);
    await bill(o, sup.id, [line(it, '1', '12', { batchNo: 'B2' })]).expect(201);
    const [one] = (await card(o, it.id)).batches!.rows;
    await http().patch(`/api/batches/${one!.id}`).set(auth(o)).send({ batchNo: 'B9', mfg: '01/26', expiry: '04/30' }).expect(200);
    expect((await card(o, it.id)).batches!.rows[0]).toMatchObject({ no: 'B9', mfg: '2026-01-01', expiry: '2030-04-30', qty: '4.000' });
    const log = (await audit(o)).find((e) => e.entity === 'batch' && e.action === 'update' && e.entityId === one!.id)!;
    expect(log.before).toMatchObject({ batchNo: 'B1' });
    expect(log.after).toMatchObject({ batchNo: 'B9' });
    await http().patch(`/api/batches/${one!.id}`).set(auth(o)).send({ batchNo: 'b2' }).expect(409);
    await http().patch(`/api/batches/${one!.id}`).set(auth(o)).send({ batchNo: 'B9', expiry: 'soon' }).expect(400);
    expect((await audit(o)).some((e) => e.entity === 'batch' && e.action === 'create')).toBe(true);
  });

  it('who may: a manager yes, billing staff read only; another shop’s batch doesn’t exist', async () => {
    const { o, it, sup } = await shop();
    await bill(o, sup.id, [line(it, '4', '12', { batchNo: 'B1' })]).expect(201);
    const id = (await card(o, it.id)).batches!.rows[0]!.id;
    await http().patch(`/api/batches/${id}`).set(auth(await member(app, o, 'manager'))).send({ batchNo: 'B2' }).expect(200);
    const staff = await member(app, o, 'billing_staff');
    await http().patch(`/api/batches/${id}`).set(auth(staff)).send({ batchNo: 'B3' }).expect(403);
    expect((await http().get(`/api/items/${it.id}/batches`).set(auth(staff)).expect(200)).body.rows).toHaveLength(1);
    const other = await owner(app);
    await tick(other);
    await http().patch(`/api/batches/${id}`).set(auth(other)).send({ batchNo: 'B4' }).expect(404);
    await http().get(`/api/items/${it.id}/batches`).set(auth(other)).expect(404);
  });
});
