import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, expectNoPasscode, owner, startApp } from './helpers';

/**
 * Edit for saved purchase-side documents (group 2): purchase bills, purchase orders, debit notes and
 * payments made. An edit undoes the old effects and applies the new ones with the same code as a new
 * document, in one go, under the same number. The strongest check: after an edit every total and
 * report is exactly what it would be had the document been saved that way in the first place.
 * Made-up passcodes only.
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

type S = Awaited<ReturnType<typeof owner>>;
async function shop() {
  const o = await owner(app);
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '20' }).expect(201)).body;
  const wire = (await http().post('/api/items').set(auth(o)).send({ name: 'Copper wire 1.5 sq mm', sale: '1890', purchase: '1500', gstRate: 18 }).expect(201)).body;
  const kc = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier', gstin: '09AAACK1234L1Z5', creditDays: 30 }).expect(201)).body;
  // another state: IGST instead of CGST + SGST
  const dl = (await http().post('/api/parties').set(auth(o)).send({ name: 'Delhi Lights', kind: 'supplier', gstin: '07AABCD1234E1Z2', openingBalance: '2000', openingType: 'pay', openingDate: D }).expect(201)).body;
  const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
  return { o, bulb, wire, kc, dl, bank };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const line = (it: { id: string; name: string }, qty: string, rate: string, extra: object = {}) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18', ...extra });
const bill = (partyId: string, lines: object[], more: object = {}) => ({ kind: 'bill', date: D, dueDate: '2026-11-03', partyId, lines, ...more });
const buy = (o: S, body: object) => http().post('/api/purchases').set(auth(o)).send(body);
const put = (o: S, path: string, body: object, pass?: string) => { const r = http().put(`/api/${path}`).set(auth(o)); return (pass ? r.set(H, pass) : r).send(body); };
const pay = (partyId: string, amount: string, allocations: { to: string; amount: string }[] = [], more: object = {}) => ({ partyId, date: D, amount, mode: 'Bank transfer', ref: '', allocations, ...more });
const payOut = (o: S, body: object) => http().post('/api/payments-made').set(auth(o)).send(body);
const balanceOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;
const stockOf = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;
const doc = async (o: S, id: string) => (await http().get(`/api/purchases/${id}`).set(auth(o)).expect(200)).body;
const accounts = async (o: S) => (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { kind: string; name: string; balance: string; openingBalance: string }[];
const audit = async (o: S) => (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
const turnOn = (o: S) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);
const cheques = async (o: S) => ((await http().get('/api/banking/cheques?status=all').set(auth(o)).expect(200)).body as { id: string; ref: string; amount: string; status: string }[]);
const same = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time');

/** Everything a total or report shows for one shop. */
async function figures(s: Shop) {
  const { o } = s;
  const get = async (p: string) => (await http().get(`/api/${p}`).set(auth(o)).expect(200)).body;
  const st = async (id: string) => { const x = await get(`reports/statement/${id}?from=2026-04-01&to=2027-03-31`); return { open: x.open, dr: x.dr, cr: x.cr, close: x.close, overdue: x.overdue }; };
  // an item's history lists the edit (old entry and its reversal); what is left, by rate, must be the same
  const item = async (id: string) => { const x = await get(`items/${id}`); return { stock: x.stock, purchase: x.purchase, rateTable: x.rateTable, godowns: x.godowns }; };
  const bills = (await get('purchases?kind=bill')) as { id: string }[];
  return same({
    kc: await balanceOf(o, s.kc.id), dl: await balanceOf(o, s.dl.id), bulb: await item(s.bulb.id), wire: await item(s.wire.id),
    statement: await st(s.kc.id), statementDl: await st(s.dl.id),
    parties: await get('reports/parties'), activity: await get('reports/party-activity?from=2026-04-01&to=2027-03-31'),
    home: await get(`reports/home?today=${D2}`), accounts: await get('banking/accounts'), cheques: await get('banking/cheques?status=all'),
    bills, orders: await get('purchases?kind=order'), notes: await get('purchases?kind=debit_note'), payments: await get('payments-made'),
    docs: await Promise.all(bills.map((b) => get(`purchases/${b.id}`))),
    unpaid: [await get(`parties/${s.kc.id}/unpaid-bills`), await get(`parties/${s.dl.id}/unpaid-bills`)],
  });
}

/* ───────── purchase bills ───────── */

describe('edit a purchase bill', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; stock, supplier balance, GST and the payment follow; same numbers', async () => {
    const { o, bulb, wire, kc, bank } = await shop();
    await turnOn(o);
    const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')], { supplierRef: 'KC/2209', payments: [{ mode: 'Bank transfer', amount: '3000', ref: 'UTR 1' }] })).expect(201)).body;
    expect(b).toMatchObject({ number: 'PB-0001', total: '6844.00' }); // 5800 + 18%
    expect(await stockOf(o, bulb.id)).toBe('120.000');
    const body = bill(kc.id, [line(bulb, '50', '58'), line(wire, '2', '1450')], { supplierRef: 'KC/2209-A', transport: '150', labour: '50', payments: [{ mode: 'Bank transfer', amount: '4000', ref: 'UTR 2' }] });
    expect((await put(o, `purchases/${b.id}`, body).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await put(o, `purchases/${b.id}`, body, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect(await stockOf(o, bulb.id)).toBe('120.000');
    // 2900 + 2900 = 5800 taxable, 1044 GST, + 200 charges = 7044
    expect((await put(o, `purchases/${b.id}`, body, PASS).expect(200)).body).toMatchObject({ id: b.id, number: 'PB-0001', kind: 'bill', total: '7044.00' });
    expect(await stockOf(o, bulb.id)).toBe('70.000');
    expect(await stockOf(o, wire.id)).toBe('2.000');
    expect(await balanceOf(o, kc.id)).toBe('-3044.00'); // to pay: 7044 − 4000
    const d = await doc(o, b.id);
    expect(d).toMatchObject({ number: 'PB-0001', supplierRef: 'KC/2209-A', taxable: '5800.00', cgst: '522.00', sgst: '522.00', igst: '0.00', transport: '150.00', labour: '50.00', total: '7044.00', balance: '3044.00', locked: '' });
    expect(d.settlements).toEqual([{ kind: 'payment', number: 'PO-0001', date: D, mode: 'Bank transfer', amount: '4000.00', ref: 'UTR 2', accountId: expect.any(String), atBill: true }]);
    expect((await http().get('/api/payments-made').set(auth(o)).expect(200)).body.map((p: { number: string; amount: string }) => [p.number, p.amount])).toEqual([['PO-0001', '4000.00']]);
    expect((await accounts(o)).find((a) => a.name === 'HDFC Bank')?.balance).toBe('46000.00');
    expect(bank.id).toBeTruthy();
    for (const k of ['bill', 'payment']) expect((await http().get(`/api/purchases/next-number?kind=${k}&date=${D}`).set(auth(o)).expect(200)).body.number).toBe(k === 'bill' ? 'PB-0002' : 'PO-0002');
    const a = await audit(o);
    expect(a.find((e) => e.action === 'update' && e.entityId === b.id)).toMatchObject({ before: { number: 'PB-0001', supplierRef: 'KC/2209', total: '6844' }, after: { number: 'PB-0001', supplierRef: 'KC/2209-A', total: '7044', paidWith: [{ mode: 'Bank transfer', amount: '4000.00', ref: 'UTR 2' }] } });
    expect(a.find((e) => e.action === 'update' && e.entity === 'payment')).toMatchObject({ before: { amount: '3000' }, after: { amount: '4000' } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: b.id, after: { for: 'edit', document: 'purchase' } });
    expectNoPasscode(a, PASS);
  });

  it('every total and report is the same as if it had been saved that way (other supplier, items, rates, charges, discount, date, payment)', async () => {
    const build = async (edit: boolean) => {
      const s = await shop();
      const { o, bulb, wire, kc, dl } = s;
      await buy(o, bill(kc.id, [line(bulb, '10', '60')])).expect(201);
      const want = bill(dl.id, [line(bulb, '40', '57', { discPct: '5' }), line(wire, '3', '1400')], {
        date: D2, dueDate: '2026-11-08', supplierRef: 'DL/88', billDiscAmt: '100', transport: '250', labour: '75', roundOff: true, updatePrices: true,
        payments: [{ mode: 'Cash', amount: '1000', ref: '' }, { mode: 'UPI', amount: '500', ref: 'UPI 9' }],
      });
      if (edit) {
        const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')], { payments: [{ mode: 'Bank transfer', amount: '2000', ref: 'UTR 1' }], updatePrices: true })).expect(201)).body;
        await put(o, `purchases/${b.id}`, want).expect(200);
      } else await buy(o, want).expect(201);
      return figures(s);
    };
    const edited = await build(true);
    expect(edited).toBe(await build(false));
    expect(edited).toContain('"kc":"-708.00"'); // Kanpur's other bill only: 600 + 18%
  });

  it('the bill can’t go below what payments made and debit notes already settle; its supplier can’t change then', async () => {
    const { o, bulb, kc, dl } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')])).expect(201)).body; // 6844
    await payOut(o, pay(kc.id, '5000', [{ to: b.id, amount: '5000' }])).expect(201);
    await buy(o, { kind: 'debit_note', date: D, partyId: kc.id, againstId: b.id, reason: 'Damaged goods', lines: [line(bulb, '10', '50')] }).expect(201); // 590
    expect((await doc(o, b.id)).settledElsewhere).toBe('5590.00');
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '80', '58')])).expect(400)).body.message) // 5475.20
      .toBe('₹5,590.00 is already paid on PB-0001 (PO-0001, DN-0001). The bill total can’t be less than that. Change those payments or debit notes first.');
    expect((await put(o, `purchases/${b.id}`, bill(dl.id, [line(bulb, '100', '58')])).expect(400)).body).toMatchObject({ message: 'PO-0001, DN-0001 are set against PB-0001 for Kanpur Cables. The supplier of this bill can’t be changed.', field: 'partyId' });
    expect(await stockOf(o, bulb.id)).toBe('110.000');
    await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '90', '58')])).expect(200); // 6159.60, rounded 6160
    expect((await doc(o, b.id)).balance).toBe('570.00');
    expect(await stockOf(o, bulb.id)).toBe('100.000');
    expect(await balanceOf(o, kc.id)).toBe('-570.00');
  });

  it('our number can’t change, the supplier’s bill number can', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '10', '58')], { supplierRef: 'KC/1' })).expect(201)).body;
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '12', '58')], { number: 'PB-0099' })).expect(400)).body).toMatchObject({ message: 'The number of a saved purchase bill can’t be changed. It stays PB-0001.', field: 'number' });
    expect(await stockOf(o, bulb.id)).toBe('30.000');
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '12', '58')], { number: 'PB-0001', supplierRef: 'KC/1-REV' })).expect(200)).body.number).toBe('PB-0001');
    expect((await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body.map((x: { number: string; supplierRef: string }) => [x.number, x.supplierRef])).toEqual([['PB-0001', 'KC/1-REV']]);
    // a bill can't become another kind of document
    expect((await put(o, `purchases/${b.id}`, { ...bill(kc.id, [line(bulb, '12', '58')]), kind: 'order' }).expect(400)).body.message).toBe('PB-0001 is a purchase bill. It can’t be changed into another kind of document.');
  });

  it('goods already sold: the edit goes through the way Cancel does, and stock shows below zero', async () => {
    const { o, wire, kc } = await shop();
    const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
    const b = (await buy(o, bill(kc.id, [line(wire, '10', '1450')])).expect(201)).body;
    await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: cust.id, lines: [{ itemId: wire.id, name: wire.name, qty: '8', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201);
    expect(await stockOf(o, wire.id)).toBe('2.000');
    await put(o, `purchases/${b.id}`, bill(kc.id, [line(wire, '5', '1450')])).expect(200);
    expect(await stockOf(o, wire.id)).toBe('-3.000');
  });

  it('money paid with the bill: a part taken off is cancelled; a cleared cheque stays only if that part is unchanged', async () => {
    const { o, bulb, kc, bank } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')], { payments: [{ mode: 'Cheque', amount: '3000', ref: '004512' }, { mode: 'Cash', amount: '1000', ref: '' }] })).expect(201)).body;
    const [c] = (await cheques(o)).filter((x) => x.ref === '004512');
    await http().post(`/api/banking/cheques/${c!.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(201);
    // the cash part taken off, the cheque part as it was
    await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '90', '58')], { payments: [{ mode: 'Cheque', amount: '3000', ref: '004512' }] })).expect(200);
    const pays = (await http().get('/api/payments-made').set(auth(o)).expect(200)).body as { number: string; amount: string; cancelled: boolean }[];
    expect(pays.map((p) => [p.number, p.amount, p.cancelled]).sort()).toEqual([['PO-0001', '3000.00', false], ['PO-0002', '1000.00', true]]);
    expect((await cheques(o)).map((x) => [x.ref, x.status])).toEqual([['004512', 'cleared']]);
    expect(await balanceOf(o, kc.id)).toBe('-3160.00'); // 6159.60 rounded − 3000
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '90', '58')], { payments: [{ mode: 'Cheque', amount: '2500', ref: '004512' }] })).expect(400)).body.message)
      .toBe('Cheque 004512 on PO-0001 is already cleared. Undo it on the Cheques page first.');
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '90', '58')])).expect(400)).body.message).toBe('Cheque 004512 paid with PB-0001 is already cleared. Undo it on the Cheques page first.');
  });

  it('a cancelled bill can’t be edited; another shop can’t read or edit it', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '10', '58')])).expect(201)).body;
    const other = await owner(app);
    await http().get(`/api/purchases/${b.id}`).set(auth(other)).expect(404);
    const theirs = (await http().post('/api/parties').set(auth(other)).send({ name: 'Their supplier', kind: 'supplier' }).expect(201)).body;
    await put(other, `purchases/${b.id}`, bill(theirs.id, [line(bulb, '1', '1')])).expect(404);
    await http().post(`/api/purchases/${b.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect((await doc(o, b.id)).locked).toBe('PB-0001 is cancelled. It can’t be changed.');
    expect((await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '12', '58')])).expect(400)).body.message).toBe('PB-0001 is cancelled. It can’t be changed.');
    expect(await stockOf(o, bulb.id)).toBe('20.000');
  });
});

/* ───────── purchase orders ───────── */

describe('edit a purchase order', () => {
  it('lines, date and expected date change; stock and balances don’t; turned into a bill or cancelled, it can’t be edited', async () => {
    const { o, bulb, wire, kc } = await shop();
    await turnOn(o);
    const po = (await buy(o, { kind: 'order', date: D, dueDate: '2026-10-09', partyId: kc.id, lines: [line(bulb, '100', '58')] }).expect(201)).body;
    const body = { kind: 'order', date: D2, dueDate: '2026-10-20', partyId: kc.id, supplierRef: 'Q-12', lines: [line(bulb, '60', '57'), line(wire, '1', '1450')] };
    await put(o, `purchases/${po.id}`, body).expect(403);
    expect((await put(o, `purchases/${po.id}`, body, PASS).expect(200)).body).toMatchObject({ number: 'ORD-0001', kind: 'order' });
    expect((await http().get('/api/purchases?kind=order').set(auth(o)).expect(200)).body[0]).toMatchObject({ number: 'ORD-0001', date: D2, dueDate: '2026-10-20', items: 2, qty: '61.000', status: 'open' });
    expect(await stockOf(o, bulb.id)).toBe('20.000');
    expect(await balanceOf(o, kc.id)).toBe('0.00');
    await buy(o, bill(kc.id, [line(bulb, '60', '57')], { fromOrderId: po.id })).expect(201);
    expect((await doc(o, po.id)).locked).toBe('ORD-0001 is already turned into bill PB-0001. Edit the bill instead.');
    expect((await put(o, `purchases/${po.id}`, body, PASS).expect(400)).body.message).toBe('ORD-0001 is already turned into bill PB-0001. Edit the bill instead.');
    const po2 = (await buy(o, { kind: 'order', date: D, partyId: kc.id, lines: [line(bulb, '5', '58')] }).expect(201)).body;
    await http().post(`/api/purchases/${po2.id}/cancel`).set(auth(o)).set(H, PASS).send({}).expect(201);
    expect((await put(o, `purchases/${po2.id}`, body, PASS).expect(400)).body.message).toBe('ORD-0002 is cancelled. It can’t be changed.');
  });

  it('a bill made from an order stays linked to it after the bill is edited', async () => {
    const { o, bulb, kc } = await shop();
    const po = (await buy(o, { kind: 'order', date: D, partyId: kc.id, lines: [line(bulb, '100', '58')] }).expect(201)).body;
    const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')], { fromOrderId: po.id })).expect(201)).body;
    await put(o, `purchases/${b.id}`, bill(kc.id, [line(bulb, '90', '58')], { fromOrderId: null })).expect(200);
    expect(await doc(o, b.id)).toMatchObject({ sourceId: po.id, source: 'ORD-0001' });
    expect((await http().get('/api/purchases?kind=order').set(auth(o)).expect(200)).body[0]).toMatchObject({ status: 'received', bill: 'PB-0001' });
  });
});

/* ───────── debit notes ───────── */

describe('edit a debit note', () => {
  it('stock and what it takes off its bill follow; never more than the bill still owes (the rest is credit)', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58')])).expect(201)).body; // 6844
    await payOut(o, pay(kc.id, '6000', [{ to: b.id, amount: '6000' }])).expect(201);
    const dn = (await buy(o, { kind: 'debit_note', date: D, partyId: kc.id, againstId: b.id, reason: 'Damaged goods', lines: [line(bulb, '10', '50')] }).expect(201)).body; // 590
    expect(await stockOf(o, bulb.id)).toBe('110.000');
    expect((await doc(o, b.id)).balance).toBe('254.00');
    // 20 back at 50 = 1180: only 844 is still owed on the bill, the rest stays as credit
    expect((await put(o, `purchases/${dn.id}`, { kind: 'debit_note', date: D2, partyId: kc.id, againstId: b.id, reason: 'Wrong item sent', lines: [line(bulb, '20', '50')] }).expect(200)).body).toMatchObject({ number: 'DN-0001', total: '1180.00' });
    expect(await stockOf(o, bulb.id)).toBe('100.000');
    expect((await doc(o, b.id)).balance).toBe('0.00');
    expect((await http().get('/api/purchases?kind=debit_note').set(auth(o)).expect(200)).body[0]).toMatchObject({ number: 'DN-0001', date: D2, reason: 'Wrong item sent', against: 'PB-0001', total: '1180.00', balance: '336.00' });
    expect(await balanceOf(o, kc.id)).toBe('336.00'); // the supplier owes the shop the unused credit
  });

  it('can return what is in stock counting its own goods, not more; a bill of another supplier is refused', async () => {
    const { o, bulb, kc, dl } = await shop();
    const dn = (await buy(o, { kind: 'debit_note', date: D, partyId: kc.id, reason: 'Damaged goods', lines: [line(bulb, '15', '50')] }).expect(201)).body;
    expect(await stockOf(o, bulb.id)).toBe('5.000');
    await put(o, `purchases/${dn.id}`, { kind: 'debit_note', date: D, partyId: kc.id, lines: [line(bulb, '20', '50')] }).expect(200);
    expect(await stockOf(o, bulb.id)).toBe('0.000');
    expect((await put(o, `purchases/${dn.id}`, { kind: 'debit_note', date: D, partyId: kc.id, lines: [line(bulb, '21', '50')] }).expect(400)).body.message).toBe('Only 20 PCS of “LED bulb 9W” in stock to return.');
    const theirBill = (await buy(o, bill(dl.id, [line(bulb, '1', '50')])).expect(201)).body;
    expect((await put(o, `purchases/${dn.id}`, { kind: 'debit_note', date: D, partyId: kc.id, againstId: theirBill.id, lines: [line(bulb, '20', '50')] }).expect(400)).body.message).toBe('That bill is cancelled or is from another supplier. Choose the bill again.');
    expect(await stockOf(o, bulb.id)).toBe('1.000');
  });

  it('every total and report is the same as if it had been saved that way', async () => {
    const build = async (edit: boolean) => {
      const s = await shop();
      const { o, bulb, wire, kc } = s;
      const b = (await buy(o, bill(kc.id, [line(bulb, '100', '58'), line(wire, '5', '1450')])).expect(201)).body;
      const want = { kind: 'debit_note', date: D2, partyId: kc.id, againstId: b.id, reason: 'Extra quantity', supplierRef: 'KC/DN-7', lines: [line(wire, '2', '1450')] };
      if (edit) {
        const dn = (await buy(o, { kind: 'debit_note', date: D, partyId: kc.id, reason: 'Damaged goods', lines: [line(bulb, '30', '58')] }).expect(201)).body;
        await put(o, `purchases/${dn.id}`, want).expect(200);
      } else await buy(o, want).expect(201);
      return figures(s);
    };
    const edited = await build(true);
    expect(edited).toBe(await build(false));
  });
});

/* ───────── payments made ───────── */

describe('edit a payment made', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; bills, supplier balance and the bank follow; same number', async () => {
    const { o, bulb, kc } = await shop();
    await turnOn(o);
    const b1 = (await buy(o, bill(kc.id, [line(bulb, '10', '50')])).expect(201)).body; // 590
    const b2 = (await buy(o, bill(kc.id, [line(bulb, '20', '50')])).expect(201)).body; // 1180
    const p = (await payOut(o, pay(kc.id, '590', [{ to: b1.id, amount: '590' }])).expect(201)).body;
    const body = pay(kc.id, '1500', [{ to: b2.id, amount: '1180' }], { mode: 'Cash', date: D2 });
    await put(o, `payments-made/${p.id}`, body).expect(403);
    await put(o, `payments-made/${p.id}`, body, '0000').expect(403);
    expect((await put(o, `payments-made/${p.id}`, body, PASS).expect(200)).body).toEqual({ id: p.id, number: 'PO-0001', amount: '1500.00' });
    expect((await doc(o, b1.id)).balance).toBe('590.00');
    expect((await doc(o, b2.id)).balance).toBe('0.00');
    expect(await balanceOf(o, kc.id)).toBe('-270.00'); // 1770 − 1500
    expect((await accounts(o)).find((a) => a.name === 'HDFC Bank')?.balance).toBe('50000.00');
    expect((await http().get('/api/payments-made').set(auth(o)).expect(200)).body).toMatchObject([{ number: 'PO-0001', date: D2, mode: 'Cash', amount: '1500.00', bills: [{ number: 'PB-0002', amount: '1180.00' }], unused: '320.00', atBill: false }]);
    expect((await http().get(`/api/purchases/next-number?kind=payment&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('PO-0002');
    const a = await audit(o);
    expect(a.find((e) => e.action === 'update' && e.entityId === p.id)).toMatchObject({ before: { amount: '590', alloc: [{ billId: b1.id, amount: '590.00' }] }, after: { amount: '1500', alloc: [{ billId: b2.id, amount: '1180.00' }] } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: p.id, after: { for: 'edit', document: 'payment' } });
    expectNoPasscode(a, PASS);
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const { o, kc } = await shop();
    await turnOn(o);
    const p = (await payOut(o, pay(kc.id, '500')).expect(201)).body;
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await put(o, `payments-made/${p.id}`, pay(kc.id, '400'), '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await put(o, `payments-made/${p.id}`, pay(kc.id, '400'), PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect(await balanceOf(o, kc.id)).toBe('500.00');
  });

  it('the edit window sees the bills as if this payment had not paid them', async () => {
    const { o, bulb, kc } = await shop();
    const b = (await buy(o, bill(kc.id, [line(bulb, '10', '50')])).expect(201)).body;
    const p = (await payOut(o, pay(kc.id, '590', [{ to: b.id, amount: '590' }])).expect(201)).body;
    const unpaid = async (q: string) => ((await http().get(`/api/parties/${kc.id}/unpaid-bills${q}`).set(auth(o)).expect(200)).body as { id: string; balance: string }[]).map((x) => [x.id, x.balance]);
    expect(await unpaid('')).toEqual([]);
    expect(await unpaid(`?payment=${p.id}`)).toEqual([[b.id, '590.00']]);
    expect((await http().get(`/api/payments-made/${p.id}`).set(auth(o)).expect(200)).body).toMatchObject({ number: 'PO-0001', partyId: kc.id, amount: '590.00', mode: 'Bank transfer', allocations: [{ to: b.id, amount: '590.00' }], locked: '' });
  });

  it('a cheque still waiting is replaced; a cleared cheque must be undone first; money paid with a bill is edited on the bill', async () => {
    const { o, bulb, kc, bank } = await shop();
    const p = (await payOut(o, pay(kc.id, '400', [], { mode: 'Cheque', ref: '000771' })).expect(201)).body;
    await put(o, `payments-made/${p.id}`, pay(kc.id, '450', [], { mode: 'Cheque', ref: '000772' })).expect(200);
    // the old cheque no longer shows in the register
    expect((await cheques(o)).map((c) => [c.ref, c.amount, c.status])).toEqual([['000772', '450.00', 'pending']]);
    const c = (await cheques(o)).find((x) => x.ref === '000772')!;
    await http().post(`/api/banking/cheques/${c.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(201);
    expect((await put(o, `payments-made/${p.id}`, pay(kc.id, '500', [], { mode: 'Cheque', ref: '000772' })).expect(400)).body.message).toBe('Cheque 000772 on this payment is already cleared. Undo it on the Cheques page first.');
    expect((await http().get(`/api/payments-made/${p.id}`).set(auth(o)).expect(200)).body.locked).toBe('Cheque 000772 on this payment is already cleared. Undo it on the Cheques page first.');
    expect(await balanceOf(o, kc.id)).toBe('450.00');
    await buy(o, bill(kc.id, [line(bulb, '10', '50')], { payments: [{ mode: 'Cash', amount: '590', ref: '' }] })).expect(201);
    const atBill = ((await http().get('/api/payments-made').set(auth(o)).expect(200)).body as { id: string; number: string; atBill: boolean }[]).find((x) => x.atBill)!;
    expect((await put(o, `payments-made/${atBill.id}`, pay(kc.id, '10')).expect(400)).body.message).toBe('This payment was made with PB-0001. Edit the bill instead.');
  });

  it('every total and report is the same as if it had been saved that way (other supplier, bill, mode, date)', async () => {
    const build = async (edit: boolean) => {
      const s = await shop();
      const { o, bulb, kc, dl } = s;
      const b1 = (await buy(o, bill(kc.id, [line(bulb, '10', '50')])).expect(201)).body;
      const b2 = (await buy(o, bill(dl.id, [line(bulb, '20', '50')])).expect(201)).body;
      const want = pay(dl.id, '1500', [{ to: b2.id, amount: '1180' }], { mode: 'Cheque', ref: '000999', date: D2 });
      if (edit) {
        const p = (await payOut(o, pay(kc.id, '590', [{ to: b1.id, amount: '590' }])).expect(201)).body;
        await put(o, `payments-made/${p.id}`, want).expect(200);
      } else await payOut(o, want).expect(201);
      return figures(s);
    };
    const edited = await build(true);
    expect(edited).toBe(await build(false));
  });

  it('another shop can’t read or edit it', async () => {
    const { o, kc } = await shop();
    const p = (await payOut(o, pay(kc.id, '100')).expect(201)).body;
    const other = await owner(app);
    await http().get(`/api/payments-made/${p.id}`).set(auth(other)).expect(404);
    const theirs = (await http().post('/api/parties').set(auth(other)).send({ name: 'Their supplier', kind: 'supplier' }).expect(201)).body;
    await put(other, `payments-made/${p.id}`, pay(theirs.id, '5')).expect(404);
    expect(await balanceOf(o, kc.id)).toBe('100.00');
  });
});

/* ───────── opening values ───────── */

describe('opening values are never changed by a purchase-side edit', () => {
  it('opening stock, the supplier’s opening balance and opening cash / bank balances stay as they were', async () => {
    const { o, bulb, dl } = await shop();
    const opening = async () => {
      const p = (await http().get(`/api/parties/${dl.id}`).set(auth(o)).expect(200)).body;
      const it = (await http().get(`/api/items/${bulb.id}`).set(auth(o)).expect(200)).body;
      return { party: [p.openingBalance, p.openingType, p.openingDate], acc: (await accounts(o)).map((a) => [a.name, a.openingBalance]), stock: it.movements.filter((m: { kind: string }) => m.kind === 'opening').map((m: { qty: string }) => m.qty) };
    };
    const at0 = await opening();
    expect(at0.stock).toEqual(['20.000']);
    // extra fields in the body are ignored
    const b = (await buy(o, bill(dl.id, [line(bulb, '10', '50')], { payments: [{ mode: 'Cash', amount: '100', ref: '' }] })).expect(201)).body;
    await put(o, `purchases/${b.id}`, { ...bill(dl.id, [line(bulb, '5', '50')]), openingBalance: '0', openingQty: '0' }).expect(200);
    const p = (await payOut(o, pay(dl.id, '500')).expect(201)).body;
    await put(o, `payments-made/${p.id}`, { ...pay(dl.id, '300', [], { mode: 'Cash' }), openingBalance: '0', openingType: 'receive' }).expect(200);
    const dn = (await buy(o, { kind: 'debit_note', date: D, partyId: dl.id, lines: [line(bulb, '2', '50')] }).expect(201)).body;
    await put(o, `purchases/${dn.id}`, { kind: 'debit_note', date: D, partyId: dl.id, lines: [line(bulb, '3', '50')], openingQty: '0' }).expect(200);
    expect(await opening()).toEqual(at0);
    expect(await stockOf(o, bulb.id)).toBe('22.000'); // 20 opening + 5 − 3
    // there is no edit route for opening entries
    for (const path of ['opening', 'parties/opening', 'items/opening', 'banking/opening']) await http().put(`/api/${path}/${dl.id}`).set(auth(o)).send({ amount: '1' }).expect(404);
  });
});
