import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/**
 * Profit by purchase-rate lots (owner's rules, Oct 2026): a sale's cost is what the lots it used
 * up cost, oldest first — the same lots as the stock value. The sale editor's pop-up (POST
 * /sales/cost) and Party wise Profit & Loss (party-activity) must always agree. Each test has its
 * own shop; lists are read by id, never by position.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = Awaited<ReturnType<typeof owner>>;
type It = { id: string; name: string };
type Cost = { cost: string; shortQty: string; noRate: boolean };

async function shop() {
  const o = await owner(app);
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body as { id: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body as { id: string };
  return { o, sup, cust };
}
let n = 0;
const item = async (o: S, extra: object = {}) =>
  (await http().post('/api/items').set(auth(o)).send({ name: `Fan ${++n}`, sale: '40', gstRate: 18, ...extra }).expect(201)).body as It & { purchase: string };
const bill = (o: S, sup: { id: string }, it: It, qty: string, rate: string, date: string) =>
  http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [{ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' }] }).expect(201);
const saleBody = (cust: { id: string }, date: string, lines: [It, string][]) =>
  ({ partyId: cust.id, date, dueDate: date, pricesInclTax: false, lines: lines.map(([it, qty]) => ({ itemId: it.id, name: it.name, qty, price: '40', discPct: '0', gstRate: '18' })), payments: [] });
const sell = async (o: S, cust: { id: string }, date: string, lines: [It, string][]) =>
  (await http().post('/api/sales').set(auth(o)).send(saleBody(cust, date, lines)).expect(201)).body as { id: string };
/** what the sale editor's pop-up shows for these lines */
const preview = async (o: S, date: string, lines: [It, string][], id?: string) =>
  ((await http().post('/api/sales/cost').set(auth(o)).send({ id: id ?? null, date, lines: lines.map(([it, qty]) => ({ itemId: it.id, qty })) }).expect(200)).body as { lines: Cost[] }).lines;
/** Party wise Profit & Loss: sale value before GST, cost, for one party */
const ppl = async (o: S, pid: string) => {
  const rows = (await http().get('/api/reports/party-activity?from=2026-04-01&to=2027-03-31').set(auth(o)).expect(200)).body as { id: string; tv: number; cost: number }[];
  const r = rows.find((x) => x.id === pid)!;
  return { tv: r.tv.toFixed(2), cost: r.cost.toFixed(2) };
};
/** the owner's lots: 50 × 20, 200 × 30, 50 × 25 in date order */
async function lots(o: S, sup: { id: string }) {
  const it = await item(o);
  await bill(o, sup, it, '50', '20', '2026-10-01');
  await bill(o, sup, it, '200', '30', '2026-10-02');
  await bill(o, sup, it, '50', '25', '2026-10-03');
  return it;
}

describe('profit by purchase-rate lots', () => {
  it("owner's example: 150 pcs at 40 = 6,000, cost 4,000, profit 2,000 — the pop-up and the report agree", async () => {
    const { o, sup, cust } = await shop();
    const it = await lots(o, sup);
    // before saving: the bill on screen
    expect(await preview(o, '2026-10-04', [[it, '150']])).toEqual([{ cost: '4000.00', shortQty: '0.000', noRate: false }]);
    const s = await sell(o, cust, '2026-10-04', [[it, '150']]);
    // the saved bill opened again shows the same
    expect(await preview(o, '2026-10-04', [[it, '150']], s.id)).toEqual([{ cost: '4000.00', shortQty: '0.000', noRate: false }]);
    expect(await ppl(o, cust.id)).toEqual({ tv: '6000.00', cost: '4000.00' });
    // the stored purchase price (newest bill, 25) is not used: 150 × 25 would be 3,750
    expect((await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body.purchase).toBe('25.00');
  });

  it('two lines of the same item share the average cost per unit', async () => {
    const { o, sup } = await shop();
    const it = await lots(o, sup);
    expect((await preview(o, '2026-10-04', [[it, '100'], [it, '50']])).map((l) => l.cost)).toEqual(['2666.67', '1333.33']);
  });

  it('an edited sale is worked out again; editing it on screen leaves its own old quantity out', async () => {
    const { o, sup, cust } = await shop();
    const it = await lots(o, sup);
    const s = await sell(o, cust, '2026-10-04', [[it, '150']]);
    // on screen, changed to 100 but not saved yet
    expect((await preview(o, '2026-10-04', [[it, '100']], s.id))[0]!.cost).toBe('2500.00');
    await http().put(`/api/sales/${s.id}`).set(auth(o)).send(saleBody(cust, '2026-10-04', [[it, '100']])).expect(200);
    expect(await ppl(o, cust.id)).toEqual({ tv: '4000.00', cost: '2500.00' }); // 50 × 20 + 50 × 30
  });

  it('a cancelled sale gives its lots back to the next sale', async () => {
    const { o, sup, cust } = await shop();
    const it = await lots(o, sup);
    const s = await sell(o, cust, '2026-10-04', [[it, '150']]);
    await http().post(`/api/sales/${s.id}/cancel`).set(auth(o)).send({ reason: 'Wrong bill' }).expect(200);
    await sell(o, cust, '2026-10-05', [[it, '60']]);
    expect(await ppl(o, cust.id)).toEqual({ tv: '2400.00', cost: '1300.00' }); // 50 × 20 + 10 × 30
  });

  it('a sale return takes off the cost of the lots its invoice used', async () => {
    const { o, sup, cust } = await shop();
    const it = await lots(o, sup);
    const s = await sell(o, cust, '2026-10-04', [[it, '150']]);
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: '2026-10-06', settle: 'adjust', lines: [{ invoiceId: s.id, itemId: it.id, qty: '30', price: '40', gstRate: '18', }] }).expect(201);
    // cost 4,000 less 30 × 30 put back; sale value 6,000 less 30 × 40 (prices on the credit note include GST: 1,016.95)
    const r = await ppl(o, cust.id);
    expect(r.cost).toBe('3100.00');
  });

  it('a late purchase bill changes the cost of an older sale (accepted, same as the stock value)', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o, { openingQty: '100', openingRate: '20', openingDate: '2026-10-01' });
    await bill(o, sup, it, '200', '30', '2026-10-05');
    await sell(o, cust, '2026-10-10', [[it, '120']]);
    expect((await ppl(o, cust.id)).cost).toBe('2600.00');
    await bill(o, sup, it, '50', '25', '2026-10-02');
    expect((await ppl(o, cust.id)).cost).toBe('2500.00');
  });

  it('no purchase entry: cost 0 (no fallback to the purchase price), and the pop-up says so', async () => {
    const { o, cust } = await shop();
    // opening stock without a rate, as the Add item screen sends it (no purchase price box)
    const it = await item(o, { openingQty: '10', openingDate: '2026-10-01' });
    expect(await preview(o, '2026-10-04', [[it, '4']])).toEqual([{ cost: '0.00', shortQty: '0.000', noRate: true }]);
    await sell(o, cust, '2026-10-04', [[it, '4']]);
    expect((await ppl(o, cust.id)).cost).toBe('0.00');
    const card = (await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as { bought: boolean; rateTable: { value: string } };
    expect(card.bought).toBe(false);
  });

  it('services and lines without stock: cost 0', async () => {
    const { o } = await shop();
    const svc = await item(o, { kind: 'service' });
    expect(await preview(o, '2026-10-04', [[svc, '2']])).toEqual([{ cost: '0.00', shortQty: '0.000', noRate: false }]);
  });

  it('short stock: the missing part costs 0 now, and the rate of the purchase that fills it later', async () => {
    const { o, sup, cust } = await shop();
    const it = await item(o);
    await bill(o, sup, it, '50', '20', '2026-10-01');
    expect(await preview(o, '2026-10-02', [[it, '80']])).toEqual([{ cost: '1000.00', shortQty: '30.000', noRate: false }]);
    await sell(o, cust, '2026-10-02', [[it, '80']]);
    expect((await ppl(o, cust.id)).cost).toBe('1000.00');
    await bill(o, sup, it, '100', '30', '2026-10-05');
    expect((await ppl(o, cust.id)).cost).toBe('1900.00');
  });

  it('the item card knows whether the item was ever bought', async () => {
    const { o, sup } = await shop();
    const it = await item(o);
    expect((await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body.bought).toBe(false);
    await bill(o, sup, it, '5', '70', '2026-10-01');
    expect((await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body.bought).toBe(true);
  });

  it('checks what it is sent', async () => {
    const { o } = await shop();
    await http().post('/api/sales/cost').set(auth(o)).send({ date: 'soon', lines: [] }).expect(400);
    await http().post('/api/sales/cost').send({ date: '2026-10-04', lines: [] }).expect(401);
  });
});
