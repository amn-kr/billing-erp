import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/**
 * Delete for purchase bills, debit notes, payments made, credit notes and payments received (the
 * sale-invoice Delete, #34): undone like a cancel, hidden from the lists, kept, number never given
 * again, audit entry, passcode asked. Refused when goods were sold since, a payment is ticked in
 * Reconciliation or its cheque is cleared, and for money paid with a live bill. Made-up passcodes only.
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
type It = { id: string; name: string };
async function shop() {
  const o = await owner(app);
  const add = async (body: object) => (await http().post('/api/items').set(auth(o)).send(body).expect(201)).body as It;
  const fan = await add({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1540', gstRate: 18, openingQty: '10', openingRate: '1540' });
  const bulb = await add({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '50', openingRate: '60' });
  const board = await add({ name: 'Switch board 6 module', sale: '320', purchase: '200', gstRate: 18 });
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  const kc = (await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier', gstin: '09AAACK1234L1Z5' }).expect(201)).body;
  const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000', openingDate: '2026-10-01' }).expect(201)).body;
  return { o, fan, bulb, board, verma, kc, bank };
}
const pl = (it: It, qty: string, rate: string) => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
const sl = (it: It, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const buy = (o: S, body: object) => http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, transport: '0', labour: '0', ...body });
const sell = (o: S, body: object) => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, ...body });
const post = (o: S, path: string, pass?: string) => { const r = http().post(path).set(auth(o)); return (pass ? r.set(H, pass) : r).send({}); };
const delDoc = (o: S, id: string, pass?: string) => post(o, `/api/purchases/${id}/delete`, pass);
const delOut = (o: S, id: string, pass?: string) => post(o, `/api/payments-made/${id}/delete`, pass);
const get = async (o: S, path: string) => (await http().get(path).set(auth(o)).expect(200)).body;
const stockOf = async (o: S, id: string) => (await get(o, `/api/items/${id}`)).stock as string;
const balanceOf = async (o: S, id: string) => (await get(o, `/api/parties/${id}`)).balance as string;
const numbers = async (o: S, path: string) => ((await get(o, path)) as { number: string }[]).map((x) => x.number);
const paysOut = async (o: S) => (await get(o, '/api/payments-made')) as { id: string; number: string; bills: { number: string }[]; unused: string; atBill: boolean }[];
const audit = async (o: S) => (await get(o, '/api/audit')) as { action: string; entity: string; entityId: string | null; after: Record<string, unknown> | null }[];
/** Tick these documents' entries in the bank's Reconciliation. */
async function tick(o: S, bankId: string, docs: string[]) {
  const keys = ((await get(o, `/api/banking/accounts/${bankId}/book`)).entries as { key: string; doc: string }[]).filter((e) => docs.includes(e.doc)).map((e) => e.key);
  expect(keys).toHaveLength(docs.length);
  await http().put(`/api/banking/accounts/${bankId}/reconciliation`).set(auth(o)).send({ asOf: '2026-10-31', statement: '', ticked: keys }).expect(200);
}

describe('purchase bill', () => {
  it('is undone and hidden, kept, its number never given again; money paid with it stays as an advance', async () => {
    const { o, bulb, kc } = await shop();
    // 20 × 50 = 1000 + 18% = 1180, ₹500 paid with it
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(bulb, '20', '50')], payments: [{ mode: 'Cash', amount: '500', ref: '' }] }).expect(201)).body;
    expect(await stockOf(o, bulb.id)).toBe('70.000');
    expect(await balanceOf(o, kc.id)).toBe('-680.00');
    // money paid with a live bill belongs to the bill
    const [po] = await paysOut(o);
    expect(po).toMatchObject({ number: 'PO-0001', atBill: true });
    expect((await delOut(o, po!.id).expect(400)).body.message).toBe('This payment was made with PB-0001. Delete the bill instead.');

    expect((await delDoc(o, pb.id).expect(200)).body).toMatchObject({ number: 'PB-0001', movedToAdvance: '500.00' });
    expect(await stockOf(o, bulb.id)).toBe('50.000');
    expect(await balanceOf(o, kc.id)).toBe('500.00'); // the ₹500 is now an advance with the supplier
    expect(await numbers(o, '/api/purchases?kind=bill')).toEqual([]);
    expect((await paysOut(o))[0]).toMatchObject({ number: 'PO-0001', bills: [], unused: '500.00', atBill: false });
    expect((await get(o, `/api/items/${bulb.id}`)).movements.map((m: { ref: string }) => m.ref)).not.toContain('PB-0001');
    expect((await get(o, '/api/purchases/next-number?kind=bill')).number).toBe('PB-0002');
    expect((await delDoc(o, pb.id).expect(400)).body.message).toBe('Already deleted');
    expect((await http().post(`/api/purchases/${pb.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toBe('Already deleted');
    const a = (await audit(o)).find((x) => x.action === 'delete' && x.entityId === pb.id);
    expect(a).toMatchObject({ entity: 'purchase_document', after: { reason: '', wasCancelled: false, movedToAdvance: '500.00' } });

    // now an advance like any other: it can be deleted on its own
    await delOut(o, po!.id).expect(200);
    expect(await balanceOf(o, kc.id)).toBe('0.00');
    expect(await paysOut(o)).toEqual([]);
  });

  it('is refused when some of its goods were sold since', async () => {
    const { o, board, verma, kc } = await shop();
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(board, '5', '200')] }).expect(201)).body;
    await sell(o, { partyId: verma.id, lines: [sl(board, '3', '320')] }).expect(201);
    const msg = 'Some of it has been sold since: taking PB-0001’s “Switch board 6 module” out of stock again would make its stock negative.';
    expect((await delDoc(o, pb.id).expect(400)).body.message).toBe(msg);
    expect((await http().post(`/api/purchases/${pb.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toBe(msg);
    expect(await stockOf(o, board.id)).toBe('2.000');
    expect(await numbers(o, '/api/purchases?kind=bill')).toEqual(['PB-0001']);
  });

  it('one cancelled earlier is only marked deleted; a purchase order is cancelled, not deleted', async () => {
    const { o, bulb, kc } = await shop();
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(bulb, '10', '50')] }).expect(201)).body;
    await http().post(`/api/purchases/${pb.id}/cancel`).set(auth(o)).send({}).expect(201);
    expect(await stockOf(o, bulb.id)).toBe('50.000');
    expect((await delDoc(o, pb.id).expect(200)).body).toMatchObject({ movedToAdvance: '0.00' });
    expect(await stockOf(o, bulb.id)).toBe('50.000');
    expect((await audit(o)).find((x) => x.action === 'delete' && x.entityId === pb.id)?.after).toMatchObject({ wasCancelled: true });
    const po = (await http().post('/api/purchases').set(auth(o)).send({ kind: 'order', date: D, partyId: kc.id, transport: '0', labour: '0', lines: [pl(bulb, '1', '50')] }).expect(201)).body;
    expect((await delDoc(o, po.id).expect(400)).body.message).toBe('A purchase order is cancelled, not deleted.');
  });
});

describe('debit note', () => {
  it('its goods come back into stock and what it took off the bill is owed again', async () => {
    const { o, board, kc } = await shop();
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(board, '5', '200')] }).expect(201)).body;
    const dn = (await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: D, partyId: kc.id, againstId: pb.id, transport: '0', labour: '0', lines: [pl(board, '1', '200')] }).expect(201)).body;
    expect(await stockOf(o, board.id)).toBe('4.000');
    expect((await get(o, '/api/purchases?kind=bill'))[0].balance).toBe('944.00');
    await delDoc(o, dn.id).expect(200);
    expect(await stockOf(o, board.id)).toBe('5.000');
    expect((await get(o, '/api/purchases?kind=bill'))[0].balance).toBe('1180.00');
    expect(await balanceOf(o, kc.id)).toBe('-1180.00');
    expect(await numbers(o, '/api/purchases?kind=debit_note')).toEqual([]);
    expect((await get(o, '/api/purchases/next-number?kind=debit_note')).number).toBe('DN-0002');
  });
});

describe('payment made', () => {
  it('what it paid is owed again and a cheque still waiting is cancelled', async () => {
    const { o, board, kc } = await shop();
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(board, '5', '200')] }).expect(201)).body;
    const p1 = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '300', mode: 'Cash', ref: '', allocations: [{ to: pb.id, amount: '300' }] }).expect(201)).body;
    const p2 = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '100', mode: 'Cheque', ref: '000777' }).expect(201)).body;
    expect(await balanceOf(o, kc.id)).toBe('-780.00');
    expect((await delOut(o, p1.id).expect(200)).body).toMatchObject({ number: 'PO-0001', amount: '300.00' });
    await delOut(o, p2.id).expect(200);
    expect(await balanceOf(o, kc.id)).toBe('-1180.00');
    expect((await get(o, '/api/purchases?kind=bill'))[0].balance).toBe('1180.00');
    expect(await paysOut(o)).toEqual([]);
    // the cheque still waiting is cancelled: it leaves the Cheques page
    expect(((await get(o, '/api/banking/cheques')) as { ref: string }[]).map((c) => c.ref)).not.toContain('000777');
    expect((await get(o, '/api/purchases/next-number?kind=payment')).number).toBe('PO-0003');
    expect((await delOut(o, p1.id).expect(400)).body.message).toBe('Already deleted');
    expect((await audit(o)).filter((x) => x.action === 'delete' && x.entity === 'payment').map((x) => x.entityId).sort()).toEqual([p1.id, p2.id].sort());
  });

  it('is refused when ticked in Reconciliation or its cheque is cleared', async () => {
    const { o, kc, bank } = await shop();
    const p1 = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '200', mode: 'Bank transfer', accountId: bank.id, ref: 'NEFT 1' }).expect(201)).body;
    const p2 = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '150', mode: 'Cheque', ref: '000451' }).expect(201)).body;
    await tick(o, bank.id, ['PO-0001']);
    expect((await delOut(o, p1.id).expect(400)).body.message).toBe('This entry is ticked in Reconciliation for HDFC Bank. Untick it there first, then change it.');
    const chq = ((await get(o, '/api/banking/cheques')) as { id: string; ref: string }[]).find((c) => c.ref === '000451')!;
    await http().post(`/api/banking/cheques/${chq.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(201);
    expect((await delOut(o, p2.id).expect(400)).body.message).toBe('Cheque 000451 on this payment is already cleared. Undo it on the Cheques page first.');
    expect(await numbers(o, '/api/payments-made')).toEqual(['PO-0002', 'PO-0001']);
  });
});

describe('credit note', () => {
  it('its returned goods go out again; refused when they were sold since or its refund is ticked', async () => {
    const { o, fan, bulb, verma, bank } = await shop();
    const inv = (await sell(o, { partyId: verma.id, lines: [sl(fan, '5', '1890'), sl(bulb, '10', '95')] }).expect(201)).body;
    const cn = (body: object) => http().post('/api/credit-notes').set(auth(o)).send({ partyId: verma.id, date: D, reason: 'Damaged goods', ...body }).expect(201);
    const cn1 = (await cn({ lines: [{ invoiceId: inv.id, itemId: bulb.id, qty: '4', price: '95', gstRate: '18' }] })).body;
    const cn2 = (await cn({ lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '2', price: '1890', gstRate: '18' }] })).body;
    const cn3 = (await cn({ settle: 'refund', refundMode: 'Bank transfer', lines: [{ invoiceId: inv.id, itemId: bulb.id, qty: '1', price: '95', gstRate: '18' }] })).body;
    expect(await stockOf(o, bulb.id)).toBe('45.000');
    const bal = await balanceOf(o, verma.id);
    await post(o, `/api/sales/${cn1.id}/delete`).expect(200);
    expect(await stockOf(o, bulb.id)).toBe('41.000');
    expect(Number(await balanceOf(o, verma.id))).toBe(Number(bal) + 380);
    // every fan left is sold: the two returned on CN-0002 have been sold since
    await sell(o, { partyId: verma.id, lines: [sl(fan, await stockOf(o, fan.id), '1890')] }).expect(201);
    expect((await post(o, `/api/sales/${cn2.id}/delete`).expect(400)).body.message).toBe('Some of it has been sold since: taking CN-0002’s “Ceiling fan 1200mm” out of stock again would make its stock negative.');
    expect((await http().post(`/api/sales/${cn2.id}/cancel`).set(auth(o)).send({}).expect(400)).body.message).toContain('Some of it has been sold since');
    await tick(o, bank.id, ['CN-0003']);
    expect((await post(o, `/api/sales/${cn3.id}/delete`).expect(400)).body.message).toBe('This entry is ticked in Reconciliation for HDFC Bank. Untick it there first, then change it.');
    expect(await numbers(o, '/api/credit-notes')).toEqual(['CN-0003', 'CN-0002']);
  });
});

describe('payment received', () => {
  it('is refused when ticked in Reconciliation, deleted otherwise', async () => {
    const { o, fan, verma, bank } = await shop();
    const inv = (await sell(o, { partyId: verma.id, lines: [sl(fan, '1', '1890')] }).expect(201)).body;
    const rc = (body: object) => http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, allocations: [{ to: inv.id, amount: '500' }], ...body }).expect(201);
    const r1 = (await rc({ amount: '500', mode: 'Cash' })).body;
    const r2 = (await rc({ amount: '500', mode: 'UPI', accountId: bank.id, ref: 'UPI 1' })).body;
    await tick(o, bank.id, ['PI-0002']);
    expect((await post(o, `/api/receipts/${r2.id}/delete`).expect(400)).body.message).toBe('This entry is ticked in Reconciliation for HDFC Bank. Untick it there first, then change it.');
    await post(o, `/api/receipts/${r1.id}/delete`).expect(200);
    expect(await numbers(o, '/api/receipts')).toEqual(['PI-0002']);
  });
});

describe('passcode and reports', () => {
  it('every delete asks for the passcode when it is on', async () => {
    const { o, bulb, kc } = await shop();
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(bulb, '1', '50')] }).expect(201)).body;
    const po = (await http().post('/api/payments-made').set(auth(o)).send({ partyId: kc.id, date: D, amount: '10', mode: 'Cash', ref: '' }).expect(201)).body;
    await http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);
    expect((await delDoc(o, pb.id).expect(403)).body).toMatchObject({ code: 'passcode' });
    expect((await delOut(o, po.id).expect(403)).body).toMatchObject({ code: 'passcode' });
    await delDoc(o, pb.id, '0000').expect(403);
    await delDoc(o, pb.id, PASS).expect(200);
    await delOut(o, po.id, PASS).expect(200);
  });

  it('GST on Home and the party reports leave deleted bills, debit notes and credit notes out', async () => {
    const { o, fan, bulb, board, verma, kc } = await shop();
    const home = async () => (await get(o, `/api/reports/home?today=${D}`)).gst;
    const inv = (await sell(o, { partyId: verma.id, lines: [sl(fan, '1', '1890')] }).expect(201)).body;
    const before = await home();
    const parties = await get(o, '/api/reports/parties');
    const pb = (await buy(o, { partyId: kc.id, lines: [pl(board, '5', '200')] }).expect(201)).body;
    const dn = (await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', date: D, partyId: kc.id, againstId: pb.id, transport: '0', labour: '0', lines: [pl(board, '1', '200')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send({ partyId: verma.id, date: D, reason: 'Damaged goods', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '1', price: '1890', gstRate: '18' }] }).expect(201)).body;
    expect(await home()).not.toEqual(before);
    await delDoc(o, dn.id).expect(200);
    await delDoc(o, pb.id).expect(200);
    await post(o, `/api/sales/${cn.id}/delete`).expect(200);
    expect(await home()).toEqual(before);
    expect(await get(o, '/api/reports/parties')).toEqual(parties);
    expect(await stockOf(o, bulb.id)).toBe('50.000');
  });
});
