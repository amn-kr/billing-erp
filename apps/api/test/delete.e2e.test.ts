import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, expectNoPasscode, member, owner, startApp } from './helpers';

/**
 * Delete for saved sales documents and payments received: never erased. It undoes the document the
 * way Cancel does (stock, party balance, payments, the books), then hides it from the lists. Totals
 * and reports come out exactly as for a cancelled document; the number is never given again.
 * Made-up passcodes only.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';
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
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540' }).expect(201)).body;
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200' }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000', openingDate: D }).expect(201)).body;
  return { o, fan, bulb, verma };
}
const line = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const sale = (o: S, body: object) => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, ...body });
const del = (o: S, id: string, pass?: string) => { const r = http().post(`/api/sales/${id}/delete`).set(auth(o)); return (pass ? r.set(H, pass) : r).send({}); };
const delPay = (o: S, id: string, pass?: string) => { const r = http().post(`/api/receipts/${id}/delete`).set(auth(o)); return (pass ? r.set(H, pass) : r).send({}); };
const balanceOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;
const stockOf = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;
const list = async (o: S, kind: string) => (await http().get(`/api/sales?kind=${kind}`).set(auth(o)).expect(200)).body as { id: string; number: string; cancelled: boolean }[];
const cashBal = async (o: S) => ((await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { kind: string; balance: string }[]).filter((a) => a.kind === 'cash').map((a) => a.balance);
const audit = async (o: S) => (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; after: Record<string, unknown> | null }[];
const turnOn = (o: S) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);
/** ids and times differ between two shops; everything else must be the same */
const same = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time');

/** Everything a total or report shows for one shop. */
async function figures(o: S, s: Awaited<ReturnType<typeof shop>>) {
  const st = (await http().get(`/api/reports/statement/${s.verma.id}?from=2026-04-01&to=2027-03-31`).set(auth(o)).expect(200)).body;
  return same({
    balance: await balanceOf(o, s.verma.id), fan: await stockOf(o, s.fan.id), bulb: await stockOf(o, s.bulb.id), cash: await cashBal(o),
    dues: (await http().get(`/api/parties/${s.verma.id}/dues`).set(auth(o)).expect(200)).body,
    statement: { open: st.open, dr: st.dr, cr: st.cr, close: st.close, overdue: st.overdue },
    parties: (await http().get('/api/reports/parties').set(auth(o)).expect(200)).body,
    activity: (await http().get('/api/reports/party-activity?from=2026-04-01&to=2027-03-31').set(auth(o)).expect(200)).body,
    items: (await http().get(`/api/reports/party-items/${s.verma.id}?from=2026-04-01&to=2027-03-31`).set(auth(o)).expect(200)).body,
    partyTx: (await http().get(`/api/reports/party-tx/${s.verma.id}`).set(auth(o)).expect(200)).body,
    home: (await http().get(`/api/reports/home?today=${D}`).set(auth(o)).expect(200)).body,
    receipts: (await http().get('/api/receipts').set(auth(o)).expect(200)).body,
    accounts: (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body,
  });
}

describe('delete a sale invoice', () => {
  it('with the passcode on: none or wrong is refused, the right one deletes it; stock and the party balance come back', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const before = { stock: await stockOf(o, fan.id), bal: await balanceOf(o, verma.id) };
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')], payments: [{ mode: 'Cash', amount: '2000' }] }).expect(201)).body;
    expect(await stockOf(o, fan.id)).toBe('22.000');
    expect((await del(o, inv.id).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await del(o, inv.id, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect((await list(o, 'invoice')).map((x) => x.number)).toEqual(['INV-0001']);
    const r = (await del(o, inv.id, PASS).expect(200)).body;
    // like cancel: what was received stays with the party as an advance
    expect(r).toEqual({ id: inv.id, number: 'INV-0001', movedToAdvance: '2000.00' });
    expect(await stockOf(o, fan.id)).toBe(before.stock);
    expect(await balanceOf(o, verma.id)).toBe('-1000.00'); // opening 1000 − advance 2000
    expect(before.bal).toBe('1000.00');
    // gone from the list and from lookups
    expect(await list(o, 'invoice')).toEqual([]);
    await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(404);
    await http().get(`/api/sales/${inv.id}/returnable`).set(auth(o)).expect(404);
    const a = await audit(o);
    expect(a.find((e) => e.action === 'delete')).toMatchObject({ entity: 'sales_document', entityId: inv.id, after: { reason: '', wasCancelled: false, movedToAdvance: '2000.00' } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: inv.id, after: { for: 'delete', document: 'sale' } });
    expectNoPasscode(a, PASS);
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await del(o, inv.id, '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await del(o, inv.id, PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect((await list(o, 'invoice'))).toHaveLength(1);
  });

  it('with the passcode off it needs no passcode', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    await del(o, inv.id).expect(200);
    expect(await list(o, 'invoice')).toEqual([]);
    expect(await stockOf(o, fan.id)).toBe('25.000');
  });

  it('can’t be edited, cancelled or deleted again; its number is never given again', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    await del(o, inv.id).expect(200);
    expect((await http().put(`/api/sales/${inv.id}`).set(auth(o)).send({ date: D, partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(400)).body.message).toBe('INV-0001 is deleted. It can’t be changed.');
    expect((await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toBe('Already deleted');
    expect((await del(o, inv.id).expect(400)).body.message).toBe('Already deleted');
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect((await http().get(`/api/sales/next-number?kind=invoice&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('INV-0002');
    expect((await sale(o, { number: 'INV-0001', partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(400)).body.message).toBe('Invoice number INV-0001 is already used.');
    expect((await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body.number).toBe('INV-0002');
  });

  it('every total and report is the same as for a cancelled invoice', async () => {
    const run = async (how: 'cancel' | 'delete') => {
      const s = await shop();
      const { o, fan, bulb, verma } = s;
      await sale(o, { partyId: verma.id, lines: [line(bulb, '4', '95')] }).expect(201);
      const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890'), line(bulb, '3', '95')], payments: [{ mode: 'Cash', amount: '1500' }] }).expect(201)).body;
      await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '500', mode: 'Cash', allocations: [{ to: inv.id, amount: '500' }] }).expect(201);
      const walkIn = (await sale(o, { mode: 'cash', lines: [line(bulb, '2', '95')], payments: [{ mode: 'Cash', amount: '190' }] }).expect(201)).body;
      for (const id of [inv.id, walkIn.id]) await http().post(`/api/sales/${id}/${how}`).set(auth(o)).send({}).expect(200);
      return { f: await figures(o, s), o, s, ids: [inv.id, walkIn.id] };
    };
    const c = await run('cancel');
    const d = await run('delete');
    // the party list counts the statement's lines: the cancelled invoice's ₹0 line is hidden once deleted
    expect(d.f).toBe(c.f.replace('"entries":5', '"entries":4'));
    // the only difference: cancelled ones stay in the list as "Cancelled", deleted ones are hidden
    expect((await list(c.o, 'invoice')).map((x) => [x.number, x.cancelled])).toEqual([['INV-0003', true], ['INV-0002', true], ['INV-0001', false]]);
    expect((await list(d.o, 'invoice')).map((x) => [x.number, x.cancelled])).toEqual([['INV-0001', false]]);
    // … and on the party's statement and the item's page
    const rows = async (x: typeof c) => ((await http().get(`/api/reports/statement/${x.s.verma.id}?from=2026-04-01&to=2027-03-31`).set(auth(x.o)).expect(200)).body.rows as { kind: string }[]).map((r) => r.kind);
    expect(await rows(c)).toContain('Sale (cancelled)');
    expect(await rows(d)).not.toContain('Sale (cancelled)');
    const moves = async (x: typeof c) => ((await http().get(`/api/items/${x.s.fan.id}`).set(auth(x.o)).expect(200)).body.movements as { kind: string }[]).map((m) => m.kind);
    expect((await moves(c)).sort()).toEqual(['cancel', 'opening', 'sale']);
    expect(await moves(d)).toEqual(['opening']);
  });

  it('a walk-in sale: the money taken with it is refunded, like cancel', async () => {
    const { o, bulb } = await shop();
    const cash0 = await cashBal(o);
    const inv = (await sale(o, { mode: 'cash', lines: [line(bulb, '2', '95')], payments: [{ mode: 'Cash', amount: '190' }] }).expect(201)).body;
    expect(await cashBal(o)).not.toEqual(cash0);
    expect((await del(o, inv.id).expect(200)).body.movedToAdvance).toBe('0.00');
    expect(await cashBal(o)).toEqual(cash0);
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body).toEqual([]);
  });

  it('a cancelled invoice can be deleted: nothing more is undone, it keeps its own cancel time', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({}).expect(200);
    await del(o, inv.id).expect(200);
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect(await balanceOf(o, verma.id)).toBe('1000.00');
    const a = await audit(o);
    expect(a.filter((e) => e.entityId === inv.id && e.entity === 'sales_document').map((e) => e.action)).toEqual(['delete', 'cancel', 'create']);
    expect(a.find((e) => e.action === 'delete')!.after).toMatchObject({ wasCancelled: true, movedToAdvance: '0.00' });
  });

  it('billing staff can’t delete (same permission as cancel); another shop never sees or deletes it', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const staff = await member(app, o, 'billing_staff');
    await http().post(`/api/sales/${inv.id}/delete`).set(auth(staff)).send({}).expect(403);
    const other = await owner(app);
    await del(other, inv.id).expect(404);
    await delPay(other, inv.id).expect(404);
    expect(await list(other, 'invoice')).toEqual([]);
    expect(await list(o, 'invoice')).toHaveLength(1);
    await del(o, inv.id).expect(200);
    await http().get(`/api/sales/${inv.id}`).set(auth(other)).expect(404);
  });
});

describe('delete a quotation, challan or credit note', () => {
  it('a quotation and a challan are hidden; nothing else changes', async () => {
    const { o, fan, verma } = await shop();
    const q = (await sale(o, { kind: 'quotation', partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    const brand = { date: D, cust: 'Verma Traders', disc: 5, sel: ['s1'], qty: { r5: 30 }, items: 1, pcs: 30, low: { name: 'Havells Coral White', total: 5230.5 } };
    const bq = (await http().post('/api/quotations/brand').set(auth(o)).send(brand).expect(201)).body;
    const dc = (await http().post('/api/challans').set(auth(o)).send({ partyId: verma.id, date: D, lines: [{ itemId: fan.id, qty: '3' }] }).expect(201)).body;
    for (const id of [q.id, bq.id, dc.id]) await del(o, id).expect(200);
    expect(await list(o, 'quotation')).toEqual([]);
    expect(await list(o, 'challan')).toEqual([]);
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect(await balanceOf(o, verma.id)).toBe('1000.00');
    expect((await http().put(`/api/quotations/brand/${bq.id}`).set(auth(o)).send(brand).expect(400)).body.message).toBe(`${bq.number} is deleted. It can’t be changed.`);
    expect((await http().put(`/api/sales/${q.id}`).set(auth(o)).send({ kind: 'quotation', date: D, partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(400)).body.message).toBe(`${q.number} is deleted. It can’t be changed.`);
    expect((await http().get(`/api/sales/next-number?kind=challan&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('DC-0002');
  });

  it('a credit note: the returned goods go out of stock again and the invoice is owed again', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send({ partyId: verma.id, date: D, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '1', price: '1890', gstRate: '18' }] }).expect(201)).body;
    expect(await stockOf(o, fan.id)).toBe('24.000');
    expect(await balanceOf(o, verma.id)).toBe('2890.00');
    await del(o, cn.id).expect(200);
    expect(await stockOf(o, fan.id)).toBe('23.000');
    expect(await balanceOf(o, verma.id)).toBe('4780.00'); // opening 1000 + 3780
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.balance).toBe('3780.00');
    expect((await http().get('/api/credit-notes').set(auth(o)).expect(200)).body).toEqual([]);
    // the goods can be returned again
    expect((await http().get(`/api/sales/${inv.id}/returnable`).set(auth(o)).expect(200)).body[0].max).toBe('2.000');
    expect((await http().get(`/api/sales/next-number?kind=credit_note&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('CN-0002');
  });

  it('a refunded credit note: the refund no longer counts in the cash', async () => {
    const { o, bulb } = await shop();
    const inv = (await sale(o, { mode: 'cash', lines: [line(bulb, '2', '95')], payments: [{ mode: 'Cash', amount: '190' }] }).expect(201)).body;
    const cash0 = await cashBal(o);
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send({ partyId: null, date: D, settle: 'refund', refundMode: 'Cash', lines: [{ invoiceId: inv.id, itemId: bulb.id, qty: '1', price: '95', gstRate: '18' }] }).expect(201)).body;
    expect(await cashBal(o)).not.toEqual(cash0);
    await del(o, cn.id).expect(200);
    expect(await cashBal(o)).toEqual(cash0);
    expect(await stockOf(o, bulb.id)).toBe('198.000');
  });
});

describe('delete a payment received', () => {
  it('needs the passcode; the invoices it paid are owed again; hidden from the list', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const cash0 = await cashBal(o);
    const pay = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '1000', mode: 'Cash', allocations: [{ to: inv.id, amount: '1000' }] }).expect(201)).body;
    expect(await balanceOf(o, verma.id)).toBe('1890.00');
    await delPay(o, pay.id).expect(403);
    await delPay(o, pay.id, '0000').expect(403);
    expect((await delPay(o, pay.id, PASS).expect(200)).body).toEqual({ id: pay.id, number: 'PI-0001', amount: '1000.00' });
    expect(await balanceOf(o, verma.id)).toBe('2890.00');
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.balance).toBe('1890.00');
    expect(await cashBal(o)).toEqual(cash0);
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body).toEqual([]);
    expect((await delPay(o, pay.id, PASS).expect(400)).body.message).toBe('Already deleted');
    expect((await http().get(`/api/sales/next-number?kind=receipt&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('PI-0002');
    const a = await audit(o);
    expect(a.find((e) => e.action === 'delete')).toMatchObject({ entity: 'payment', entityId: pay.id, after: { wasCancelled: false } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: pay.id, after: { for: 'delete', document: 'receipt' } });
  });

  it('a cheque still waiting is cancelled with it; a cleared cheque must be undone first', async () => {
    const { o, verma } = await shop();
    const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
    const p1 = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '400', mode: 'Cheque', ref: '004512', allocations: [] }).expect(201)).body;
    const p2 = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '600', mode: 'Cheque', ref: '004513', allocations: [] }).expect(201)).body;
    const chq = async () => (await http().get('/api/banking/cheques').set(auth(o)).expect(200)).body as { id: string; ref: string }[];
    const c2 = (await chq()).find((c) => c.ref === '004513')!;
    await http().post(`/api/banking/cheques/${c2.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(201);
    await delPay(o, p1.id).expect(200);
    expect((await chq()).map((c) => c.ref)).toEqual(['004513']);
    expect((await delPay(o, p2.id).expect(400)).body.message).toBe('Cheque 004513 on this payment is already cleared. Undo it on the Cheques page first.');
    expect(await balanceOf(o, verma.id)).toBe('400.00'); // opening 1000 − 600 still counted
  });

  it('money taken on an invoice is deleted with the invoice, not on its own', async () => {
    const { o, fan, verma } = await shop();
    await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')], payments: [{ mode: 'Cash', amount: '1890' }] }).expect(201);
    const [pi] = (await http().get('/api/receipts').set(auth(o)).expect(200)).body;
    expect((await delPay(o, pi.id).expect(400)).body.message).toBe('This payment was taken with INV-0001. Edit or delete the invoice instead.');
  });

  it('billing staff can’t delete a payment; another shop never sees or deletes it', async () => {
    const { o, verma } = await shop();
    const pay = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '100', mode: 'Cash', allocations: [] }).expect(201)).body;
    const staff = await member(app, o, 'billing_staff');
    await http().post(`/api/receipts/${pay.id}/delete`).set(auth(staff)).send({}).expect(403);
    const other = await owner(app);
    await delPay(other, pay.id).expect(404);
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body).toHaveLength(1);
    await delPay(o, pay.id).expect(200);
    expect((await http().get('/api/receipts').set(auth(other)).expect(200)).body).toEqual([]);
  });
});
