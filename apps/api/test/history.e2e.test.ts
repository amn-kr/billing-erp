import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIstDateTime } from '@billing/shared';
import { DbService } from '../src/common/db.service';
import { auth, member, SHOP, startApp } from './helpers';

/**
 * "View history": GET /api/history/:type/:id reads a document's edits from the audit log, newest
 * first. Read only: no passcode, nothing written, the document's status never changes. Also the
 * item page's Transactions list, which leaves out the lines an edit replaced. Made-up passcodes,
 * names and amounts only.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';
const D2 = '2026-10-09';
const PASS = '4826';
const H = 'x-txn-passcode';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

let n = 0;
/** An owner with a name (the history window shows who made each edit) and their shop. */
async function owner(name = 'Ravi Gupta') {
  const email = `hist.${Date.now().toString(36)}.${++n}@test.example.com`;
  const r = await http().post('/api/auth/register').send({ email, password: 'correct horse 1', name }).expect(201);
  const b = await http().post('/api/businesses').set(auth({ token: r.body.accessToken })).send(SHOP).expect(201);
  return { token: b.body.accessToken as string, cookie: '', email, businessId: b.body.business.id as string };
}
type S = Awaited<ReturnType<typeof owner>>;
async function shop(name?: string) {
  const o = await owner(name);
  const post = (p: string, body: object) => http().post(`/api/${p}`).set(auth(o)).send(body);
  const get = async (p: string) => (await http().get(`/api/${p}`).set(auth(o)).expect(200)).body;
  const fan = (await post('items', { name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540' }).expect(201)).body as { id: string; name: string };
  const bulb = (await post('items', { name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200' }).expect(201)).body as { id: string; name: string };
  const verma = (await post('parties', { name: 'Verma Traders' }).expect(201)).body as { id: string };
  const kc = (await post('parties', { name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body as { id: string };
  return { o, post, get, fan, bulb, verma, kc };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const line = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const saleBody = (s: Shop, qty: string, price = '1890', more: object = {}) => ({ date: D, dueDate: D, partyId: s.verma.id, lines: [line(s.fan, qty, price)], ...more });
const put = (o: S, path: string, body: object, pass?: string) => { const r = http().put(`/api/${path}`).set(auth(o)); return (pass ? r.set(H, pass) : r).send(body); };
const history = (o: { token: string }, type: string, id: string) => http().get(`/api/history/${type}/${id}`).set(auth(o));
interface Entry { id: string; at: string; when: string; user: string; lines: string[]; details: boolean }
const entries = async (o: S, type: string, id: string) => (await history(o, type, id).expect(200)).body.entries as Entry[];
const db = () => app.get(DbService);
const rawStock = (s: Shop, itemId: string) => db().scoped({ businessId: s.o.businessId }, (tx) => tx.stockMovement.findMany({ where: { itemId }, select: { kind: true, qty: true, note: true } }));

describe('the history of a sale edited twice', () => {
  it('two boxes, newest first, with the right old and new values, the person and the time in India', async () => {
    const s = await shop();
    const t0 = Date.now();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8', '1950', { notes: 'Deliver on Monday' })).expect(200);
    const r = (await history(s.o, 'sales', inv.id).expect(200)).body as { type: string; number: string; entries: Entry[] };
    expect([r.type, r.number]).toEqual(['Invoice', 'INV-0001']);
    expect(r.entries.map((e) => e.lines)).toEqual([
      ['Total changed from ₹15,120.00 to ₹15,600.00', 'Notes was added (value: Deliver on Monday)', 'Item Ceiling fan 1200mm: rate changed from ₹1,890.00 to ₹1,950.00'],
      ['Total changed from ₹11,340.00 to ₹15,120.00', 'Item Ceiling fan 1200mm: quantity changed from 6 to 8'],
    ]);
    expect(r.entries.map((e) => [e.user, e.details])).toEqual([['Ravi Gupta', true], ['Ravi Gupta', true]]);
    // newest first; each time is a real moment of this test, shown dd/mm/yyyy, hh:mm am/pm in India time
    const at = r.entries.map((e) => Date.parse(e.at));
    expect(at[0]).toBeGreaterThanOrEqual(at[1]!);
    for (const e of r.entries) {
      expect(Date.parse(e.at)).toBeGreaterThanOrEqual(t0 - 1000);
      expect(Date.parse(e.at)).toBeLessThanOrEqual(Date.now() + 1000);
      expect(e.when).toBe(formatIstDateTime(e.at));
      expect(e.when).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} [ap]m$/);
    }
    // an edit never changes the document's status
    const doc = await db().scoped({ businessId: s.o.businessId }, (tx) => tx.salesDocument.findUniqueOrThrow({ where: { id: inv.id }, select: { status: true, cancelledAt: true } }));
    expect(doc).toEqual({ status: 'open', cancelledAt: null });
  });

  it('a document never edited has no boxes; a cancelled one still shows its edits (a cancel is not an edit)', async () => {
    const s = await shop();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    const other = (await s.post('sales', saleBody(s, '2')).expect(201)).body;
    expect(await entries(s.o, 'sales', other.id)).toEqual([]);
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(s.o)).send({}).expect(200);
    expect((await entries(s.o, 'sales', inv.id)).map((e) => e.lines)).toEqual([['Total changed from ₹11,340.00 to ₹15,120.00', 'Item Ceiling fan 1200mm: quantity changed from 6 to 8']]);
  });

  it('needs no passcode, even with the passcode switched on; reading writes nothing', async () => {
    const s = await shop();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    await http().post('/api/settings/passcode/on').set(auth(s.o)).send({ passcode: PASS }).expect(200);
    const count = () => db().scoped({ businessId: s.o.businessId }, (tx) => tx.auditLog.count());
    const before = await count();
    expect(await entries(s.o, 'sales', inv.id)).toHaveLength(1);
    expect(await count()).toBe(before);
  });

  it('another shop can’t read it, not even knowing the id; the shop’s own staff can, by what their role may open', async () => {
    const s = await shop();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    const bill = (await s.post('purchases', { kind: 'bill', date: D, dueDate: D, partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '10', rate: '62', discPct: '0', gstRate: '18' }] }).expect(201)).body;
    const other = await owner('Someone Else');
    expect((await history(other, 'sales', inv.id).expect(404)).body.message).toBe('That document was not found.');
    expect((await history(other, 'purchase', bill.id).expect(404)).body.message).toBe('That document was not found.');
    const staff = await member(app, s.o, 'billing_staff');
    expect((await history(staff, 'sales', inv.id).expect(200)).body.entries).toHaveLength(1);
    expect((await history(staff, 'purchase', bill.id).expect(403)).body.message).toBe('Your role does not allow this. Ask the shop owner.');
    await history(s.o, 'nothing', inv.id).expect(404);
    await history(s.o, 'sales', 'not-an-id').expect(404);
    await http().get(`/api/history/sales/${inv.id}`).expect(401);
  });
});

describe('edits logged as the whole record before and after (sales side, purchases, payments)', () => {
  it('a purchase bill, a payment received and a delivery challan', async () => {
    const s = await shop();
    const bill = (await s.post('purchases', { kind: 'bill', date: D, dueDate: D, supplierRef: 'KC/101', partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '10', rate: '62', discPct: '0', gstRate: '18' }] }).expect(201)).body;
    await put(s.o, `purchases/${bill.id}`, { kind: 'bill', date: D, dueDate: D, supplierRef: 'KC/101A', partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '12', rate: '62', discPct: '0', gstRate: '18' }] }).expect(200);
    const b = (await history(s.o, 'purchase', bill.id).expect(200)).body;
    expect([b.type, b.number]).toEqual(['Purchase bill', bill.number]);
    expect(b.entries.map((e: Entry) => e.lines)).toEqual([['Supplier bill no. changed from KC/101 to KC/101A', 'Total changed from ₹732.00 to ₹878.00', 'Item LED bulb 9W: quantity changed from 10 to 12']]);

    const inv = (await s.post('sales', saleBody(s, '1')).expect(201)).body;
    const pay = (await s.post('receipts', { partyId: s.verma.id, date: D, amount: '1000', mode: 'Cash', ref: '', allocations: [{ to: inv.id, amount: '1000' }] }).expect(201)).body;
    await put(s.o, `receipts/${pay.id}`, { partyId: s.verma.id, date: D2, amount: '1500', mode: 'UPI', ref: 'UPI 7731', allocations: [{ to: inv.id, amount: '1500' }] }).expect(200);
    const p = (await history(s.o, 'receipt', pay.id).expect(200)).body;
    expect([p.type, p.number]).toEqual(['Payment received', 'PI-0001']);
    expect(p.entries[0].lines).toEqual([
      'Date changed from 04/10/2026 to 09/10/2026', 'Amount changed from ₹1,000.00 to ₹1,500.00', 'Mode changed from Cash to UPI', 'Reference was added (value: UPI 7731)',
      'Amount against INV-0001 changed from ₹1,000.00 to ₹1,500.00',
    ]);
    // a payment received is not a payment made
    await history(s.o, 'payment-made', pay.id).expect(404);

    const dc = (await s.post('challans', { partyId: s.verma.id, cashName: '', cashPhone: '', date: D, lines: [{ itemId: s.fan.id, qty: '3' }], transport: '', vehicle: '', note: '' }).expect(201)).body;
    await put(s.o, `challans/${dc.id}`, { partyId: s.verma.id, cashName: '', cashPhone: '', date: D, lines: [{ itemId: s.fan.id, qty: '5' }, { itemId: s.bulb.id, qty: '4' }], transport: '', vehicle: 'UP32 AB 1234', note: '' }).expect(200);
    const c = (await history(s.o, 'sales', dc.id).expect(200)).body;
    expect([c.type, c.entries[0].lines]).toEqual(['Delivery challan', ['Vehicle no. was added (value: UP32 AB 1234)', 'Item Ceiling fan 1200mm: quantity changed from 3 to 5', 'Item LED bulb 9W was added (value: quantity 4)']]);
  });

  it('a payment made (what it pays, by bill number) and a credit note (its lines)', async () => {
    const s = await shop();
    const bill = (await s.post('purchases', { kind: 'bill', date: D, dueDate: D, partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '10', rate: '100', discPct: '0', gstRate: '0' }] }).expect(201)).body;
    const pm = (await s.post('payments-made', { partyId: s.kc.id, date: D, amount: '400', mode: 'Bank transfer', ref: '', allocations: [{ to: bill.id, amount: '400' }] }).expect(201)).body;
    await put(s.o, `payments-made/${pm.id}`, { partyId: s.kc.id, date: D, amount: '600', mode: 'Bank transfer', ref: '', allocations: [{ to: bill.id, amount: '600' }] }).expect(200);
    const p = (await history(s.o, 'payment-made', pm.id).expect(200)).body;
    expect([p.type, p.entries[0].lines]).toEqual(['Payment made', ['Amount changed from ₹400.00 to ₹600.00', `Amount against ${bill.number} changed from ₹400.00 to ₹600.00`]]);
    await history(s.o, 'receipt', pm.id).expect(404);

    const inv = (await s.post('sales', saleBody(s, '5')).expect(201)).body;
    const cn = (await s.post('credit-notes', { partyId: s.verma.id, date: D, reason: 'Damaged goods', settle: 'adjust', refundMode: 'Cash', lines: [{ invoiceId: inv.id, itemId: s.fan.id, qty: '1', price: '1890', gstRate: '18' }] }).expect(201)).body;
    await put(s.o, `credit-notes/${cn.id}`, { partyId: s.verma.id, date: D, reason: 'Wrong item', settle: 'adjust', refundMode: 'Cash', lines: [{ invoiceId: inv.id, itemId: s.fan.id, qty: '2', price: '1890', gstRate: '18' }] }).expect(200);
    const c = (await history(s.o, 'sales', cn.id).expect(200)).body;
    expect([c.type, c.entries[0].lines]).toEqual(['Credit note', ['Total changed from ₹1,890.00 to ₹3,780.00', 'Reason changed from Damaged goods to Wrong item', 'Item Ceiling fan 1200mm: quantity changed from 1 to 2']]);
    // the credit note's note on the invoice it returns goods from is not an edit of that invoice
    expect(await entries(s.o, 'sales', inv.id)).toEqual([]);
  });
});

describe('edits logged with a list of changes (expenses, cash / bank entries, stock)', () => {
  it('ids become names: accounts, items and godowns', async () => {
    const s = await shop();
    const accs = (await s.get('banking/accounts')) as { id: string; kind: string; name: string }[];
    const cash = accs.find((a) => a.kind === 'cash')!;
    await put(s.o, `banking/accounts/${cash.id}`, { openingBalance: '20000', openingDate: '2026-04-01' }).expect(200);
    const bank = (await s.post('banking/accounts', { name: 'HDFC Bank', openingBalance: '50000', openingDate: '2026-04-01' }).expect(201)).body as { id: string };
    const cat = ((await s.get('expense-categories')) as { id: string; name: string }[]).find((c) => c.name === 'Repairs')!.id;
    const xp = (more: object) => ({ date: D, categoryId: cat, mode: 'Cash', payee: 'Cool Air Services', reference: '', notes: '', lines: [{ name: 'AC servicing', qty: '1', rate: '1200', gst: '0', amt: '1200' }], ...more });
    const x = (await s.post('expenses', xp({})).expect(201)).body;
    await put(s.o, `expenses/${x.id}`, xp({ mode: 'UPI', accountId: bank.id })).expect(200);
    const e = (await history(s.o, 'expense', x.id).expect(200)).body;
    expect([e.type, e.number, e.entries[0].lines]).toEqual(['Expense', 'EXP-0001', ['Paid by changed from Cash to UPI', `Paid from changed from ${cash.name} to HDFC Bank`]]);

    const main = ((await s.get('godowns')) as { id: string; isDefault: boolean; name: string }[]).find((g) => g.isDefault)!;
    const store = (await s.post('godowns', { name: 'Aminabad godown' }).expect(201)).body as { id: string };
    const adj = (await s.post('stock-adjustments', { itemId: s.fan.id, mode: 'add', qty: 10, rate: '1500', date: D, reason: 'Count' }).expect(201)).body;
    await put(s.o, `stock-adjustments/${adj.id}`, { itemId: s.fan.id, mode: 'reduce', qty: 3, rate: '1500', date: D, reason: 'Damaged' }).expect(200);
    expect((await entries(s.o, 'stock-adjustment', adj.id))[0]!.lines).toEqual(['Quantity changed from +10 to -3', 'Reason changed from Count to Damaged']);
    const trf = (await s.post('stock-transfers', { itemId: s.fan.id, fromGodownId: main.id, toGodownId: store.id, qty: 10, date: D, note: '' }).expect(201)).body;
    await put(s.o, `stock-transfers/${trf.id}`, { itemId: s.bulb.id, fromGodownId: main.id, toGodownId: store.id, qty: 4, date: D, note: '' }).expect(200);
    expect((await entries(s.o, 'stock-transfer', trf.id))[0]!.lines).toEqual(['Item changed from Ceiling fan 1200mm to LED bulb 9W', 'Quantity changed from 10 to 4']);

    const be = (await s.post('banking/entries', { date: D, reference: '', note: '', category: '', kind: 'deposit', amount: '5000', fromId: cash.id, toId: bank.id }).expect(201)).body;
    await put(s.o, `banking/entries/${be.id}`, { date: D, reference: '', note: '', category: '', kind: 'deposit', amount: '6000', fromId: cash.id, toId: bank.id }).expect(200);
    expect((await entries(s.o, 'bank-entry', be.id))[0]!.lines).toEqual(['Amount changed from ₹5,000.00 to ₹6,000.00']);
  });

  it('an id no longer found reads "(deleted or unknown)"; an entry without old / new values still gets its box', async () => {
    const s = await shop();
    const adj = (await s.post('stock-adjustments', { itemId: s.fan.id, mode: 'add', qty: 10, rate: '1500', date: D, reason: 'Count' }).expect(201)).body;
    const gone = '99999999-9999-4999-8999-999999999999';
    await db().scoped({ businessId: s.o.businessId }, async (tx) => {
      const user = (await tx.user.findFirstOrThrow({ where: { email: s.o.email } })).id;
      // as older entries could be: one with a changes list naming a godown that isn't there, one with nothing usable
      await tx.auditLog.create({ data: { businessId: s.o.businessId, userId: user, action: 'update', entity: 'stock_adjustment', entityId: adj.id, after: { changes: [{ field: 'godownId', old: gone, new: gone.replace(/9/g, '8') }] }, createdAt: new Date('2026-10-05T04:30:00.000Z') } });
      await tx.auditLog.create({ data: { businessId: s.o.businessId, userId: null, action: 'update', entity: 'stock_adjustment', entityId: adj.id, createdAt: new Date('2026-10-04T10:00:00.000Z') } });
    });
    expect((await entries(s.o, 'stock-adjustment', adj.id)).map((e) => [e.when, e.user, e.details, e.lines])).toEqual([
      ['05/10/2026, 10:00 am', 'Ravi Gupta', true, ['Godown changed from (deleted or unknown) to (deleted or unknown)']],
      ['04/10/2026, 03:30 pm', 'Unknown user', false, ['Edited (details were not saved)']],
    ]);
  });
});

/* ───────── item page: Transactions ───────── */

interface Mv { kind: string; qty: string; rate: string; ref: string; status: string; note: string; sourceType: string }
const movesOf = async (s: Shop, itemId: string) => ((await s.get(`items/${itemId}`)).movements as Mv[]).map((m) => ({ kind: m.kind, qty: m.qty, rate: m.rate, ref: m.ref, status: m.status }));

describe('item history: an edited document shows one line, as it is now', () => {
  it('INV-0001 edited once (6 to 8): one "sale" line with 8, no cancelled line; the stock lines themselves are all kept', async () => {
    const s = await shop();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    const mv = await movesOf(s, s.fan.id);
    expect(mv.filter((m) => m.ref === 'INV-0001')).toEqual([{ kind: 'sale', qty: '-8.000', rate: '1890.00', ref: 'INV-0001', status: 'Unpaid' }]);
    expect(mv.map((m) => m.kind).sort()).toEqual(['opening', 'sale']);
    expect((await rawStock(s, s.fan.id)).map((m) => [m.kind, m.qty.toFixed(3), m.note]).sort()).toEqual([['cancel', '6.000', 'Edited INV-0001'], ['opening', '25.000', 'Opening stock'], ['sale', '-6.000', 'INV-0001'], ['sale', '-8.000', 'INV-0001']]);
  });

  it('a sale edited twice: stock on hand, stock value and every stock figure are exactly as if it had been saved that way', async () => {
    const a = await shop();
    const inv = (await a.post('sales', saleBody(a, '6')).expect(201)).body;
    await put(a.o, `sales/${inv.id}`, saleBody(a, '8')).expect(200);
    await put(a.o, `sales/${inv.id}`, saleBody(a, '7', '1950')).expect(200);
    const b = await shop();
    await b.post('sales', saleBody(b, '7', '1950')).expect(201);
    const figures = async (s: Shop) => {
      const it = await s.get(`items/${s.fan.id}`);
      const main = ((await s.get('godowns')) as { id: string; isDefault: boolean }[]).find((g) => g.isDefault)!;
      const listed = ((await s.get('items')) as { id: string; stock: string; level: string }[]).find((x) => x.id === s.fan.id)!;
      const inGodown = ((await s.get(`godowns/${main.id}/items`)) as Record<string, unknown>[]).map(({ id: _i, itemId: _t, ...x }) => x);
      // Home (stock value tile and the rest), ids and times left out
      const home = JSON.parse(JSON.stringify(await s.get(`reports/home?today=${D2}`)).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time'));
      return { stock: it.stock, listed: [listed.stock, listed.level], rateTable: it.rateTable, godowns: (it.godowns as { name: string; stock: string }[]).map((g) => [g.name, g.stock]).sort(), inGodown, home, moves: await movesOf(s, s.fan.id) };
    };
    const fa = await figures(a);
    expect(fa).toEqual(await figures(b));
    expect(fa.stock).toBe('18.000');
    expect(fa.moves.filter((m) => m.ref === 'INV-0001')).toEqual([{ kind: 'sale', qty: '-7.000', rate: '1950.00', ref: 'INV-0001', status: 'Unpaid' }]);
    // the stock lines are untouched: the two reversals are still there, and all lines add up to the stock shown
    const raw = await rawStock(a, a.fan.id);
    expect(raw.filter((m) => m.kind === 'cancel').map((m) => [m.qty.toFixed(3), m.note]).sort()).toEqual([['6.000', 'Edited INV-0001'], ['8.000', 'Edited INV-0001']]);
    expect(raw.reduce((t, m) => t + Number(m.qty), 0)).toBe(18);
  });

  it('a really cancelled sale still shows "cancelled" (and after an edit, only its last lines)', async () => {
    const s = await shop();
    const inv = (await s.post('sales', saleBody(s, '6')).expect(201)).body;
    await put(s.o, `sales/${inv.id}`, saleBody(s, '8')).expect(200);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(s.o)).send({}).expect(200);
    const plain = (await s.post('sales', saleBody(s, '2')).expect(201)).body;
    await http().post(`/api/sales/${plain.id}/cancel`).set(auth(s.o)).send({}).expect(200);
    const mv = await movesOf(s, s.fan.id);
    const key = (m: { kind: string; qty: string; ref: string; status: string }) => `${m.ref} ${m.kind} ${m.qty} ${m.status}`;
    expect(mv.filter((m) => m.ref.startsWith('INV')).map(key).sort()).toEqual(['INV-0001 cancel 8.000 Cancelled', 'INV-0001 sale -8.000 Cancelled', 'INV-0002 cancel 2.000 Cancelled', 'INV-0002 sale -2.000 Cancelled']);
    expect((await s.get(`items/${s.fan.id}`)).stock).toBe('25.000');
  });

  it('an edited purchase bill and stock adjustment show their current line only', async () => {
    const s = await shop();
    const bill = (await s.post('purchases', { kind: 'bill', date: D, dueDate: D, partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '10', rate: '62', discPct: '0', gstRate: '0' }] }).expect(201)).body;
    await put(s.o, `purchases/${bill.id}`, { kind: 'bill', date: D, dueDate: D, partyId: s.kc.id, lines: [{ itemId: s.bulb.id, name: s.bulb.name, qty: '12', rate: '62', discPct: '0', gstRate: '0' }] }).expect(200);
    const adj = (await s.post('stock-adjustments', { itemId: s.bulb.id, mode: 'add', qty: 5, rate: '60', date: D, reason: 'Count' }).expect(201)).body;
    await put(s.o, `stock-adjustments/${adj.id}`, { itemId: s.bulb.id, mode: 'reduce', qty: 2, rate: '60', date: D, reason: 'Broken' }).expect(200);
    const mv = await movesOf(s, s.bulb.id);
    expect(mv.map((m) => `${m.kind} ${m.qty}`).sort()).toEqual(['adjustment -2.000', 'opening 200.000', 'purchase 12.000']);
    expect((await s.get(`items/${s.bulb.id}`)).stock).toBe('210.000');
  });
});
