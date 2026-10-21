import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/**
 * Stock value by purchase-rate lots, first in first out by date (owner's rules, Oct 2026), and the
 * automatic purchase price. The same value must show in the items list, the item card (its table and
 * its "Stock value"), brand totals and godown totals. Each test has its own shop; lists are read by id
 * or name, never by position.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = Awaited<ReturnType<typeof owner>>;
type It = { id: string; name: string };
interface Card { stock: string; purchase: string; movements: unknown[]; rateTable: { layers: { rate: string; qty: string }[]; value: string; avgRate: string; totalQty: string } }

async function shop() {
  const o = await owner(app);
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body as { id: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body as { id: string };
  return { o, sup, cust };
}
let n = 0;
/** Add item as the screen sends it now: no purchase price, only the opening stock's "At price / unit" */
const item = async (o: S, extra: object = {}) =>
  (await http().post('/api/items').set(auth(o)).send({ name: `Fan ${++n}`, sale: '100', gstRate: 18, brand: 'Orient', ...extra }).expect(201)).body as It & { purchase: string };
const ln = (it: It, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
const billBody = (sup: { id: string }, it: It, qty: string, rate: string, date: string) => ({ kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [ln(it, qty, rate)] });
const bill = async (o: S, sup: { id: string }, it: It, qty: string, rate: string, date: string) =>
  (await http().post('/api/purchases').set(auth(o)).send(billBody(sup, it, qty, rate, date)).expect(201)).body as { id: string };
const saleBody = (cust: { id: string }, it: It, qty: string, date: string) => ({ partyId: cust.id, date, dueDate: date, lines: [{ itemId: it.id, name: it.name, qty, price: '100', discPct: '0', gstRate: '18' }], payments: [] });
const sell = async (o: S, cust: { id: string }, it: It, qty: string, date: string) =>
  (await http().post('/api/sales').set(auth(o)).send(saleBody(cust, it, qty, date)).expect(201)).body as { id: string };
const card = async (o: S, it: It) => (await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as Card;
const lots = async (o: S, it: It) => (await card(o, it)).rateTable.layers.filter((l) => l.qty !== '0.000').map((l) => [l.rate, l.qty]);
const godowns = async (o: S) => (await http().get('/api/godowns').set(auth(o)).expect(200)).body as { id: string; name: string; isDefault: boolean; value: string }[];

/** The item's value in every place that shows it: they must all agree, and equal `want`. */
async function valueEverywhere(o: S, it: It, want: string) {
  const c = await card(o, it);
  expect(c.rateTable.value).toBe(want);
  const list = (await http().get('/api/items').set(auth(o)).expect(200)).body as { id: string; value: string | null }[];
  expect(list.find((x) => x.id === it.id)!.value).toBe(want);
  const brand = ((await http().get('/api/brands').set(auth(o)).expect(200)).body as { name: string; value: string }[]).find((b) => b.name === 'Orient')!;
  expect(brand.value).toBe(want);
  // one godown, no negative stock: the godown total is the item's value
  if (Number(c.stock) >= 0) {
    const main = (await godowns(o)).find((g) => g.isDefault)!;
    expect(main.value).toBe(want);
    const rows = (await http().get(`/api/godowns/${main.id}/items`).set(auth(o)).expect(200)).body as { itemId: string; value: string }[];
    if (Number(c.stock) > 0) expect(rows.find((r) => r.itemId === it.id)!.value).toBe(want);
  }
}

describe('stock value by purchase-rate lots', () => {
  it("owner's example 1: 2000, 8000, 7000, 8250, 4250", async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '100', openingRate: '20', openingDate: '2026-10-01' });
    expect(it.purchase).toBe('20.00');
    await valueEverywhere(o, it, '2000.00');
    expect(await lots(o, it)).toEqual([['20.00', '100.000']]);

    await bill(o, sup, it, '200', '30', '2026-10-02');
    await valueEverywhere(o, it, '8000.00');
    expect(await lots(o, it)).toEqual([['20.00', '100.000'], ['30.00', '200.000']]);

    await sell(o, cust, it, '50', '2026-10-03');
    await valueEverywhere(o, it, '7000.00');
    expect(await lots(o, it)).toEqual([['20.00', '50.000'], ['30.00', '200.000']]);

    await bill(o, sup, it, '50', '25', '2026-10-04');
    await valueEverywhere(o, it, '8250.00');
    expect(await lots(o, it)).toEqual([['20.00', '50.000'], ['30.00', '200.000'], ['25.00', '50.000']]);

    await sell(o, cust, it, '150', '2026-10-05');
    await valueEverywhere(o, it, '4250.00');
    expect(await lots(o, it)).toEqual([['30.00', '100.000'], ['25.00', '50.000']]);
    const c = await card(o, it);
    expect(c.stock).toBe('150.000');
    // the purchase price is the newest bill's rate
    expect(c.purchase).toBe('25.00');
  });

  it("owner's example 2: a bill entered late with an old date moves the value from 5400 to 6750", async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '100', openingRate: '20', openingDate: '2026-10-01' });
    await bill(o, sup, it, '200', '30', '2026-10-05');
    await sell(o, cust, it, '120', '2026-10-10');
    await valueEverywhere(o, it, '5400.00');
    expect(await lots(o, it)).toEqual([['30.00', '180.000']]);

    await bill(o, sup, it, '50', '25', '2026-10-02');
    await valueEverywhere(o, it, '6750.00');
    expect(await lots(o, it)).toEqual([['25.00', '30.000'], ['30.00', '200.000']]);
    const c = await card(o, it);
    expect(c.stock).toBe('230.000');
    // the newest bill by date is still the one of 5 Oct
    expect(c.purchase).toBe('30.00');
  });

  it('cancelling and editing a bill or a sale brings the value back to the right number', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '100', openingRate: '20', openingDate: '2026-10-01' });
    const b = await bill(o, sup, it, '200', '30', '2026-10-02');
    await valueEverywhere(o, it, '8000.00');
    // edit the bill: 100 at 35
    await http().put(`/api/purchases/${b.id}`).set(auth(o)).send(billBody(sup, it, '100', '35', '2026-10-02')).expect(200);
    await valueEverywhere(o, it, '5500.00');
    expect((await card(o, it)).purchase).toBe('35.00');
    const s = await sell(o, cust, it, '120', '2026-10-03'); // 100 at 20, 20 at 35
    await valueEverywhere(o, it, '2800.00');
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(saleBody(cust, it, '50', '2026-10-03')).expect(200);
    await valueEverywhere(o, it, '4500.00');
    await http().post(`/api/sales/${s.id}/cancel`).set(auth(o)).send({ reason: 'Wrong bill' }).expect(200);
    await valueEverywhere(o, it, '5500.00');
    await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({ reason: 'Wrong supplier' }).expect(201);
    await valueEverywhere(o, it, '2000.00');
    // no bill left: back to the opening stock's rate
    expect((await card(o, it)).purchase).toBe('20.00');
  });

  it('a credit note puts stock back at the rate its invoice took; a debit note takes its bill’s lot out', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '10', openingRate: '20', openingDate: '2026-10-01' });
    const b = await bill(o, sup, it, '10', '30', '2026-10-02');
    const inv = await sell(o, cust, it, '12', '2026-10-03'); // 10 at 20, 2 at 30
    await valueEverywhere(o, it, '240.00');
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: '2026-10-04', reason: 'Damaged goods', settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: it.id, qty: '3', price: '100', gstRate: '18' }] }).expect(201);
    // the newest taken first: 2 at 30, then 1 at 20
    expect(await lots(o, it)).toEqual([['20.00', '1.000'], ['30.00', '10.000']]);
    await valueEverywhere(o, it, '320.00');
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', partyId: sup.id, againstId: b.id, reason: 'Damaged goods', date: '2026-10-05', dueDate: '2026-10-05', lines: [ln(it, '4', '30')] }).expect(201);
    expect(await lots(o, it)).toEqual([['20.00', '1.000'], ['30.00', '6.000']]);
    await valueEverywhere(o, it, '200.00');
    // a debit note isn't a purchase: the purchase price stays the bill's
    expect((await card(o, it)).purchase).toBe('30.00');
  });

  it('a stock adjustment up comes in at its own rate or at the purchase price; down takes the oldest first', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { openingQty: '10', openingRate: '20', openingDate: '2026-10-01' });
    await bill(o, sup, it, '10', '30', '2026-10-02');
    const adj = (mode: 'add' | 'reduce', qty: string, rate: string | null, date: string) =>
      http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode, qty, rate, date, reason: 'Count' }).expect(201);
    await adj('add', '5', '40', '2026-10-03');
    await adj('add', '5', null, '2026-10-04'); // at the purchase price, 30
    expect(await lots(o, it)).toEqual([['20.00', '10.000'], ['30.00', '10.000'], ['40.00', '5.000'], ['30.00', '5.000']]);
    await valueEverywhere(o, it, '850.00');
    await adj('reduce', '12', null, '2026-10-05'); // 10 at 20, 2 at 30
    expect(await lots(o, it)).toEqual([['30.00', '8.000'], ['40.00', '5.000'], ['30.00', '5.000']]);
    await valueEverywhere(o, it, '590.00');
  });

  it('a transfer between godowns keeps the item value; each godown is its quantity at the average rate', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { openingQty: '10', openingRate: '20', openingDate: '2026-10-01' });
    await bill(o, sup, it, '10', '30', '2026-10-02');
    const back = (await http().post('/api/godowns').set(auth(o)).send({ name: 'Back store' }).expect(201)).body as { id: string };
    const main = (await godowns(o)).find((g) => g.isDefault)!;
    await http().post('/api/stock-transfers').set(auth(o)).send({ itemId: it.id, fromGodownId: main.id, toGodownId: back.id, qty: 5, date: '2026-10-03' }).expect(201);
    const c = await card(o, it);
    expect([c.rateTable.value, c.rateTable.avgRate]).toEqual(['500.00', '25.00']);
    expect(await lots(o, it)).toEqual([['20.00', '10.000'], ['30.00', '10.000']]);
    const gs = await godowns(o);
    expect(gs.find((g) => g.id === main.id)!.value).toBe('375.00');
    expect(gs.find((g) => g.id === back.id)!.value).toBe('125.00');
    const rows = (await http().get(`/api/godowns/${back.id}/items`).set(auth(o)).expect(200)).body as { itemId: string; value: string; inGodown: string }[];
    expect(rows.find((r) => r.itemId === it.id)).toMatchObject({ inGodown: '5.000', value: '125.00' });
  });

  it('an item with only a stored purchase price, one with nothing, and one sold short', async () => {
    const { o, sup, cust } = await shop();
    // stock without a rate counts at the stored purchase price (an older item, or one sent with a price)
    const old = await item(o, { purchase: '40', openingQty: '5', openingRate: '0', openingDate: '2026-10-01' });
    expect((await card(o, old)).rateTable.layers).toEqual([{ rate: '40.00', qty: '5.000', since: '2026-10-01' }]);
    expect(old.purchase).toBe('40.00');
    await valueEverywhere(o, old, '200.00');
    const none = await item(o, { name: 'Nothing fan', brand: 'Bajaj' });
    expect(none.purchase).toBe('0.00');
    expect((await card(o, none)).rateTable.value).toBe('0.00');
    // sold more than bought: the short part counts as 0
    const short = await item(o, { name: 'Short fan', brand: 'Bajaj' });
    await bill(o, sup, short, '5', '30', '2026-10-01');
    await sell(o, cust, short, '8', '2026-10-02');
    const c = await card(o, short);
    expect([c.stock, c.rateTable.value]).toEqual(['-3.000', '0.00']);
    const list = (await http().get('/api/items').set(auth(o)).expect(200)).body as { id: string; value: string | null }[];
    expect(list.find((x) => x.id === short.id)!.value).toBe('0.00');
    const bajaj = ((await http().get('/api/brands').set(auth(o)).expect(200)).body as { name: string; value: string }[]).find((b) => b.name === 'Bajaj')!;
    expect(bajaj.value).toBe('0.00');
    // the next stock fills the short part first: 3 of 10 go to it, 7 at 32 are left
    await bill(o, sup, short, '10', '32', '2026-10-03');
    expect((await card(o, short)).rateTable.value).toBe('224.00');
  });
});

describe('automatic purchase price', () => {
  it('Add item with an opening quantity and "At price" only: the opening rate is the purchase price', async () => {
    const { o } = await shop();
    const it = await item(o, { openingQty: '12', openingRate: '45.50', openingDate: '2026-10-01' });
    expect(it.purchase).toBe('45.50');
    const c = await card(o, it);
    expect(c.rateTable.layers).toEqual([{ rate: '45.50', qty: '12.000', since: '2026-10-01' }]);
    expect(c.rateTable.value).toBe('546.00');
  });

  it('Add item without an opening quantity: no opening movement and an empty purchase price', async () => {
    const { o } = await shop();
    const it = await item(o);
    const c = await card(o, it);
    expect([c.purchase, c.stock, c.movements]).toEqual(['0.00', '0.000', []]);
  });

  it('follows bills: create, edit, cancel; the newest by bill date; back to empty when no bill is left', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    const b1 = await bill(o, sup, it, '5', '30', '2026-10-05');
    expect((await card(o, it)).purchase).toBe('30.00');
    // an older bill entered later doesn't change it
    const b0 = await bill(o, sup, it, '5', '28', '2026-10-01');
    expect((await card(o, it)).purchase).toBe('30.00');
    await http().put(`/api/purchases/${b1.id}`).set(auth(o)).send(billBody(sup, it, '5', '33', '2026-10-05')).expect(200);
    expect((await card(o, it)).purchase).toBe('33.00');
    await http().post(`/api/purchases/${b1.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect((await card(o, it)).purchase).toBe('28.00');
    await http().post(`/api/purchases/${b0.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect((await card(o, it)).purchase).toBe('0.00');
    // every change is in the price history
    const hist = (await http().get(`/api/prices/history?itemId=${it.id}`).set(auth(o)).expect(200)).body as { field: string; oldValue: string | null; newValue: string | null }[];
    expect(hist.filter((h) => h.field === 'purchase').map((h) => [h.oldValue, h.newValue]).sort()).toEqual([['0.00', '30.00'], ['28.00', '0.00'], ['30.00', '33.00'], ['33.00', '28.00']].sort());
  });

  it('an item that had a price before keeps it when its only bill is cancelled', async () => {
    const { o, sup } = await shop();
    const it = await item(o, { purchase: '40' });
    const b = await bill(o, sup, it, '5', '30', '2026-10-01');
    expect((await card(o, it)).purchase).toBe('30.00');
    await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect((await card(o, it)).purchase).toBe('40.00');
  });
});
