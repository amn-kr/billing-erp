import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/** Item details: stock left by the purchase rate it was bought at (first in, first out) — the owner's rate rules. */
let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = Awaited<ReturnType<typeof owner>>;
interface Rates { layers: { rate: string; qty: string; since: string }[]; hidden: number; totalQty: string; shortQty: string; avgRate: string; value: string; lastRate: string | null }

async function shop() {
  const o = await owner(app);
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body;
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  return { o, sup, cust };
}
let n = 0;
const item = async (o: S, purchase: string, extra: object = {}) =>
  (await http().post('/api/items').set(auth(o)).send({ name: `Switch ${++n}`, sale: '100', purchase, gstRate: 18, ...extra }).expect(201)).body as { id: string; name: string };
const ln = (it: { id: string; name: string }, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
const bill = async (o: S, sup: { id: string }, it: { id: string; name: string }, qty: string, rate: string, date: string) =>
  (await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [ln(it, qty, rate)] }).expect(201)).body as { id: string };
const sell = async (o: S, cust: { id: string }, it: { id: string; name: string }, qty: string, date: string) =>
  (await http().post('/api/sales').set(auth(o)).send({ partyId: cust.id, date, dueDate: date, lines: [{ itemId: it.id, name: it.name, qty, price: '100', discPct: '0', gstRate: '18' }], payments: [] }).expect(201)).body as { id: string };
const adjust = (o: S, it: { id: string }, mode: 'add' | 'reduce', qty: string, rate: string | null, date: string) =>
  http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode, qty, rate, date, reason: 'Count' }).expect(201);
const creditNote = (o: S, cust: { id: string }, it: { id: string }, inv: { id: string } | null, qty: string, date: string) =>
  http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date, reason: 'Damaged goods', settle: 'adjust', lines: [{ invoiceId: inv?.id ?? null, itemId: it.id, qty, price: '100', gstRate: '18' }] }).expect(201);
const debitNote = (o: S, sup: { id: string }, it: { id: string; name: string }, b: { id: string } | null, qty: string, rate: string, date: string) =>
  http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', partyId: sup.id, againstId: b?.id ?? null, reason: 'Damaged goods', date, dueDate: date, lines: [ln(it, qty, rate)] }).expect(201);

/** The table's columns, and a check that its total equals the item's stock. */
async function rates(o: S, it: { id: string }) {
  const d = (await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as { stock: string; rateTable: Rates };
  if (d.rateTable.layers.length) expect(d.rateTable.totalQty).toBe(d.stock);
  return { cols: d.rateTable.layers.map((l) => [l.rate, l.qty]), t: d.rateTable, stock: d.stock };
}

describe('item rate table', () => {
  it('several rates oldest first; sales use the oldest first; sold-out rates before stock hide except the newest', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, '70', { openingQty: '30', openingRate: '60', openingDate: '2026-05-01' });
    await bill(o, sup, it, '40', '65', '2026-06-02');
    await bill(o, sup, it, '50', '61', '2026-07-03');
    await sell(o, cust, it, '9', '2026-07-20');
    const r = await rates(o, it);
    expect(r.cols).toEqual([['60.00', '21.000'], ['65.00', '40.000'], ['61.00', '50.000']]);
    expect(r.t).toMatchObject({ hidden: 0, totalQty: '111.000', value: '6910.00', avgRate: '62.25' });
    expect(r.t.layers[0]!.since).toBe('2026-05-01');

    await sell(o, cust, it, '70', '2026-08-01'); // all the 60s and 65s, 9 of the 61s
    expect((await rates(o, it)).cols).toEqual([['65.00', '0.000'], ['61.00', '41.000']]);
    expect((await rates(o, it)).t.hidden).toBe(1);
  });

  it('6–7. opening stock at its price, or at the item’s purchase price without one', async () => {
    const { o, sup } = await shop();
    const a = await item(o, '44', { openingQty: '12', openingRate: '40', openingDate: '2026-04-01' });
    await bill(o, sup, a, '8', '44', '2026-05-01');
    expect((await rates(o, a)).cols).toEqual([['40.00', '12.000'], ['44.00', '8.000']]);
    const b = await item(o, '33.50', { openingQty: '10', openingDate: '2026-04-01' });
    expect((await rates(o, b)).cols).toEqual([['33.50', '10.000']]);
  });

  it('8–9. adjustments: add at the price entered or the purchase price; reduce takes the oldest rate first', async () => {
    const { o, sup } = await shop();
    const a = await item(o, '52');
    await bill(o, sup, a, '5', '50', '2026-04-01');
    await adjust(o, a, 'add', '3', '47', '2026-04-02');
    await adjust(o, a, 'add', '2', null, '2026-04-03');
    expect((await rates(o, a)).cols).toEqual([['50.00', '5.000'], ['47.00', '3.000'], ['52.00', '2.000']]);
    const b = await item(o, '58');
    for (const [r, d] of [['50', '2026-04-01'], ['55', '2026-04-02'], ['58', '2026-04-03']] as const) await bill(o, sup, b, '6', r, d);
    await adjust(o, b, 'reduce', '9', null, '2026-04-04');
    expect((await rates(o, b)).cols).toEqual([['50.00', '0.000'], ['55.00', '3.000'], ['58.00', '6.000']]);
  });

  it('10. a credit note goes back to its invoice’s rate (a sold-out rate comes back); one not linked, to the latest sales', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, '45');
    await bill(o, sup, it, '10', '40', '2026-04-01');
    await bill(o, sup, it, '10', '45', '2026-04-02');
    const inv1 = await sell(o, cust, it, '10', '2026-04-03');
    await sell(o, cust, it, '4', '2026-04-04');
    expect((await rates(o, it)).cols).toEqual([['40.00', '0.000'], ['45.00', '6.000']]);
    await creditNote(o, cust, it, inv1, '3', '2026-04-05');
    expect((await rates(o, it)).cols).toEqual([['40.00', '3.000'], ['45.00', '6.000']]);
    await creditNote(o, cust, it, null, '2', '2026-04-06'); // the latest sale took 45s
    expect((await rates(o, it)).cols).toEqual([['40.00', '3.000'], ['45.00', '8.000']]);
  });

  it('11. a debit note linked to a bill comes out of that bill’s rate (then oldest first); one not linked, oldest first', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, '48');
    await bill(o, sup, it, '10', '40', '2026-04-01');
    const b2 = await bill(o, sup, it, '10', '45', '2026-04-02');
    await bill(o, sup, it, '10', '48', '2026-04-03');
    await debitNote(o, sup, it, b2, '4', '45', '2026-04-04');
    await debitNote(o, sup, it, null, '3', '48', '2026-04-05');
    expect((await rates(o, it)).cols).toEqual([['40.00', '7.000'], ['45.00', '6.000'], ['48.00', '10.000']]);
    // the bill's lot partly sold: its 3 left go first, then the oldest
    await sell(o, cust, it, '10', '2026-04-06'); // 7 of the 40s, 3 of the 45s
    await debitNote(o, sup, it, b2, '5', '45', '2026-04-07');
    expect((await rates(o, it)).cols).toEqual([['45.00', '0.000'], ['48.00', '8.000']]);
  });

  it('12. a mix in date order', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, '36', { openingQty: '10', openingRate: '30', openingDate: '2026-04-01' });
    await bill(o, sup, it, '20', '34', '2026-05-01');
    const inv = await sell(o, cust, it, '18', '2026-05-15');
    await bill(o, sup, it, '10', '36', '2026-06-01');
    await creditNote(o, cust, it, inv, '5', '2026-06-10');
    await adjust(o, it, 'reduce', '2', null, '2026-06-20');
    const r = await rates(o, it);
    expect(r.cols).toEqual([['30.00', '0.000'], ['34.00', '15.000'], ['36.00', '10.000']]);
    expect(r.t).toMatchObject({ totalQty: '25.000', avgRate: '34.80', value: '870.00' });
  });

  it('cancelled bills, edited sales and godown transfers leave no trace', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, '50');
    await bill(o, sup, it, '10', '50', '2026-04-01');
    const bad = await bill(o, sup, it, '10', '99', '2026-04-02');
    await http().post(`/api/purchases/${bad.id}/cancel`).set(auth(o)).send({}).expect(201);
    const s = await sell(o, cust, it, '6', '2026-04-03');
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send({ partyId: cust.id, date: '2026-04-03', dueDate: '2026-04-03', lines: [{ itemId: it.id, name: it.name, qty: '2', price: '100', discPct: '0', gstRate: '18' }], payments: [] }).expect(200);
    const gd = (await http().post('/api/godowns').set(auth(o)).send({ name: 'Back store' }).expect(201)).body;
    const main = (await http().get('/api/godowns').set(auth(o)).expect(200)).body.find((g: { isDefault: boolean }) => g.isDefault);
    await http().post('/api/stock-transfers').set(auth(o)).send({ itemId: it.id, fromGodownId: main.id, toGodownId: gd.id, qty: 3, date: '2026-04-04' }).expect(201);
    expect((await rates(o, it)).cols).toEqual([['50.00', '8.000']]);
  });

  it('no stock, never bought, sold more than bought, and services', async () => {
    const { o, sup, cust } = await shop();
    const gone = await item(o, '35');
    await bill(o, sup, gone, '5', '30', '2026-04-01');
    await sell(o, cust, gone, '5', '2026-04-02');
    expect((await rates(o, gone)).t).toMatchObject({ layers: [], totalQty: '0.000', shortQty: '0.000', lastRate: '30.00' });
    expect((await rates(o, await item(o, '20'))).t).toMatchObject({ layers: [], lastRate: null });
    const over = await item(o, '40');
    await bill(o, sup, over, '5', '40', '2026-04-01');
    await sell(o, cust, over, '8', '2026-04-02');
    const r = await rates(o, over);
    expect(r.stock).toBe('-3.000');
    expect(r.t).toMatchObject({ layers: [], shortQty: '3.000' });
    const svc = (await http().post('/api/items').set(auth(o)).send({ name: 'Wiring labour', kind: 'service', sale: '500', gstRate: 18 }).expect(201)).body;
    expect((await http().get(`/api/items/${svc.id}`).set(auth(o)).expect(200)).body.rateTable).toBeNull();
  });
});
