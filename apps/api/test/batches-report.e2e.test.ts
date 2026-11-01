/** Item Batch Report (Features › batch_expiry, owner's request, 1 Nov 2026): every batch's stock and value, from the one lot calculation. */
import type { INestApplication } from '@nestjs/common';
import { money, todayIst } from '@billing/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = todayIst();
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
type Row = { id: string | null; no: string; item: string; itemId: string; unit: string; expiry: string | null; qty: string; value: string };
const report = async (s: S) => (await http().get('/api/reports/batches').set(auth(s)).expect(200)).body as Row[];
const tick = (o: S, on = true) => http().put('/api/settings/features').set(auth(o)).send({ enabled: on ? ['batch_expiry'] : [] }).expect(200);
const item = async (o: S, name: string, extra: object = {}) => (await http().post('/api/items').set(auth(o)).send({ name, kind: 'goods', unit: 'PCS', gstRate: 0, trackBatch: true, ...extra }).expect(201)).body as { id: string; name: string };
const add = (o: S, id: string, batchNo: string, expiry: string, qty: number, rate: string) => http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: id, mode: 'add', qty, rate, date: D, reason: 'Other', batchNo, expiry }).expect(201);

describe('Item Batch Report', () => {
  it('earliest expiry first across items, no expiry next, stock without a batch last; untracked items aren’t listed', async () => {
    const o = await owner(app);
    await tick(o);
    const a = await item(o, 'Alpha', { openingQty: '1', openingRate: '10', openingDate: D });
    const b = await item(o, 'Beta');
    await item(o, 'Plain', { trackBatch: false, openingQty: '5', openingRate: '5', openingDate: D });
    await add(o, a.id, 'LATE', '03/40', 2, '10');
    await add(o, b.id, 'OLD', '01/20', 3, '20');
    await add(o, b.id, 'NOEXP', '', 4, '5');
    await add(o, a.id, 'SOON', '03/30', 1, '7');
    const r = await report(o);
    expect(r.map((x) => [x.item, x.no])).toEqual([['Beta', 'OLD'], ['Alpha', 'SOON'], ['Alpha', 'LATE'], ['Beta', 'NOEXP'], ['Alpha', 'No batch']]);
    expect(r[0]).toMatchObject({ unit: 'PCS', expiry: '2020-01-31', qty: '3.000', value: '60.00', itemId: b.id });
  });

  it('adds up to each item’s stock value, and follows sales', async () => {
    const o = await owner(app);
    await tick(o);
    const a = await item(o, 'Alpha');
    await add(o, a.id, 'B1', '03/40', 3, '33.33');
    await add(o, a.id, 'B2', '03/41', 7, '11.11');
    const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Raju Stores' }).expect(201)).body as { id: string };
    await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], fromQuotationIds: [], lines: [{ itemId: a.id, name: a.name, qty: '4', unit: 'PCS', price: '50', discPct: '0', gstRate: '0' }] }).expect(201);
    const r = await report(o);
    expect(r.map((x) => [x.no, x.qty])).toEqual([['B2', '6.000']]);
    const card = (await http().get(`/api/items/${a.id}`).set(auth(o)).expect(200)).body as { rateTable: { value: string } };
    expect(r.reduce((t, x) => t.plus(x.value), money(0)).toFixed(2)).toBe(card.rateTable.value);
  });

  it('with the feature off it is empty; batches stay and come back', async () => {
    const o = await owner(app);
    await tick(o);
    const a = await item(o, 'Alpha');
    await add(o, a.id, 'B1', '03/40', 3, '10');
    await tick(o, false);
    expect(await report(o)).toEqual([]);
    await tick(o);
    expect(await report(o)).toHaveLength(1);
  });

  it('who may see it, and shops don’t see each other’s', async () => {
    const o = await owner(app);
    await tick(o);
    const a = await item(o, 'Alpha');
    await add(o, a.id, 'B1', '03/40', 3, '10');
    expect(await report(await member(app, o, 'accountant'))).toHaveLength(1);
    await http().get('/api/reports/batches').set(auth(await member(app, o, 'billing_staff'))).expect(403);
    const other = await owner(app);
    await tick(other);
    expect(await report(other)).toEqual([]);
  });
});
